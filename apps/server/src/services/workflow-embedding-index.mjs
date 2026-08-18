export function createWorkflowEmbeddingIndexer({
  access,
  effectiveRole,
  embeddingAdapter,
  embeddingRecordFor,
  evaluateRetrieval,
  files,
  maxRecordsPerSource: MAX_EMBEDDING_RECORDS_PER_SOURCE,
  normalizedEmbedding,
  runtime,
}) {
  const { findSource } = access;
  const { readArtifactText } = files;
  const { nextId, now, runTx, state } = runtime;

  async function indexSourceEmbeddings({ sourceId } = {}, actor = null) {
    const source = findSource(sourceId, actor);
    if (!source) return { status: 404, body: { error: "workflow_source_not_found" } };
    if (!embeddingAdapter) {
      return { status: 409, body: { error: "workflow_embedding_not_configured" } };
    }
    const allEligible = state.workflowArtifacts.filter((artifact) =>
      artifact.sourceId === source.id
      && artifact.availability === "available"
      && !artifact.exclusion
      && effectiveRole(artifact) === "requirement");
    const eligible = allEligible.slice(0, MAX_EMBEDDING_RECORDS_PER_SOURCE);
    const reusable = eligible.filter(embeddingRecordFor);
    const pending = eligible.filter((artifact) => !embeddingRecordFor(artifact));
    let indexed = 0;
    for (let offset = 0; offset < pending.length; offset += embeddingAdapter.maxBatchSize ?? 8) {
      const batch = pending.slice(offset, offset + (embeddingAdapter.maxBatchSize ?? 8));
      let vectors;
      try {
        vectors = await embeddingAdapter.embed(batch.map((artifact) => {
          const sourceRecord = findSource(artifact.sourceId, actor);
          return `${artifact.relativePath}\n${readArtifactText(state, sourceRecord, artifact)}`.slice(0, 16_000);
        }));
      } catch (error) {
        return {
          status: 502,
          body: {
            error: "workflow_embedding_failed",
            message: String(error?.message ?? error).slice(0, 300),
            indexed,
            reused: reusable.length,
          },
        };
      }
      const normalized = vectors.map(normalizedEmbedding);
      if (normalized.some((vector) => !vector)) {
        return { status: 502, body: { error: "workflow_embedding_invalid_vector" } };
      }
      runTx(() => {
        const timestamp = now();
        batch.forEach((artifact, index) => {
          const existing = state.workflowEmbeddingIndex.find((record) =>
            record.artifactId === artifact.id
            && record.providerId === embeddingAdapter.providerId
            && record.modelVersion === embeddingAdapter.modelVersion);
          const values = {
            ownerTeamId: artifact.ownerTeamId,
            projectId: artifact.projectId,
            sourceId: artifact.sourceId,
            artifactId: artifact.id,
            fingerprint: artifact.fingerprint,
            parserVersion: artifact.extraction?.parserVersion ?? null,
            providerId: embeddingAdapter.providerId,
            model: embeddingAdapter.model,
            modelVersion: embeddingAdapter.modelVersion,
            dimensions: normalized[index].length,
            vector: normalized[index],
            state: "ready",
            updatedAt: timestamp,
          };
          if (existing) {
            Object.assign(existing, values, { revision: Number(existing.revision ?? 0) + 1 });
          } else {
            state.workflowEmbeddingIndex.push({
              id: nextId("wei"),
              ...values,
              revision: 1,
              createdAt: timestamp,
            });
          }
        });
      });
      indexed += batch.length;
    }
    const eligibleIds = new Set(eligible.map((artifact) => artifact.id));
    runTx(() => {
      state.workflowEmbeddingIndex.splice(
        0,
        state.workflowEmbeddingIndex.length,
        ...state.workflowEmbeddingIndex.filter((record) =>
          record.sourceId !== source.id
          || (
            record.providerId === embeddingAdapter.providerId
            && record.modelVersion === embeddingAdapter.modelVersion
            && eligibleIds.has(record.artifactId)
          )),
      );
    });
    const evaluation = evaluateRetrieval({ sourceId: source.id }, actor);
    runTx(() => {
      source.embeddingEvaluation = {
        providerId: embeddingAdapter.providerId,
        model: embeddingAdapter.model,
        modelVersion: embeddingAdapter.modelVersion,
        gate: evaluation.body.gate,
        current: evaluation.body.current,
        baseline: evaluation.body.baseline,
        evaluatedAt: now(),
      };
      source.updatedAt = now();
      source.revision += 1;
    });
    return {
      status: 200,
      body: {
        source,
        index: {
          providerId: embeddingAdapter.providerId,
          model: embeddingAdapter.model,
          modelVersion: embeddingAdapter.modelVersion,
          eligible: eligible.length,
          indexed,
          reused: reusable.length,
          truncated: allEligible.length > eligible.length,
        },
        evaluation: evaluation.body,
      },
    };
  }


  return { indexSourceEmbeddings };
}
