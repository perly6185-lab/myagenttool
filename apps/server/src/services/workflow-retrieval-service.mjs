export function createWorkflowRetrievalService({
  access,
  effectiveRole,
  embeddingAdapter,
  files,
  quality,
  retrievalVersion: WORKFLOW_RETRIEVAL_VERSION,
  runtime,
  scoring,
  views,
}) {
  const { findArtifact, findSource, visible } = access;
  const { readArtifactText } = files;
  const {
    caseHasExcludedEvidence,
    profileHasExcludedEvidence,
    qualityForCase,
  } = quality;
  const { state } = runtime;
  const {
    cosineSimilarity,
    embeddingRecordFor,
    extractStructuredFields,
    normalizedFieldLabel,
    rolloutEnabledFor,
    similarityTokens,
    summarizeWorkflowRetrievalRanks,
    tokenSimilarity,
  } = scoring;
  const { caseView, profileView } = views;

  function findSimilarCases({ artifactId, limit = 5 } = {}, actor = null) {
    const artifact = findArtifact(artifactId, actor);
    if (!artifact || artifact.exclusion || effectiveRole(artifact) !== "requirement") {
      return { status: 404, body: { error: "workflow_requirement_not_found" } };
    }
    const source = findSource(artifact.sourceId, actor);
    if (!source) return { status: 404, body: { error: "workflow_source_not_found" } };
    const queryContent = readArtifactText(state, source, artifact);
    const queryTokens = similarityTokens(`${artifact.relativePath}\n${queryContent}`);
    const queryFields = new Set(extractStructuredFields(queryContent).map((field) => field.key));
    const queryEmbedding = embeddingRecordFor(artifact);
    const vectorRollout = rolloutEnabledFor(source);
    const boundedLimit = Math.min(20, Math.max(1, Number(limit) || 5));
    const cases = state.deliveryCases
      .filter((item) =>
        item.state === "confirmed"
        && visible(item, actor)
        && !caseHasExcludedEvidence(item)
        && qualityForCase(item).status !== "blocked")
      .map((deliveryCase) => {
        const qualityAssessment = qualityForCase(deliveryCase);
        let bestSimilarity = 0;
        let sharedFieldCount = 0;
        let sameFormat = false;
        let bestVectorSimilarity = 0;
        for (const requirementId of deliveryCase.requirementArtifactIds ?? []) {
          const candidate = findArtifact(requirementId, actor);
          if (
            !candidate
            || candidate.id === artifact.id
            || candidate.availability !== "available"
            || candidate.exclusion
          ) continue;
          const candidateSource = findSource(candidate.sourceId, actor);
          if (!candidateSource) continue;
          const content = readArtifactText(state, candidateSource, candidate);
          bestSimilarity = Math.max(
            bestSimilarity,
            tokenSimilarity(queryTokens, similarityTokens(`${candidate.relativePath}\n${content}`)),
          );
          const candidateFields = new Set(extractStructuredFields(content).map((field) => field.key));
          sharedFieldCount = Math.max(
            sharedFieldCount,
            [...queryFields].filter((key) => candidateFields.has(key)).length,
          );
          sameFormat ||= candidate.extension === artifact.extension;
          const candidateEmbedding = embeddingRecordFor(candidate);
          if (queryEmbedding && candidateEmbedding) {
            bestVectorSimilarity = Math.max(
              bestVectorSimilarity,
              cosineSimilarity(queryEmbedding.vector, candidateEmbedding.vector),
            );
          }
        }
        const vectorCandidate = Math.max(0, bestVectorSimilarity) * 0.2;
        const scoreBreakdown = {
          lexical: bestSimilarity * 0.65,
          structuredFields: sharedFieldCount ? Math.min(0.15, sharedFieldCount * 0.05) : 0,
          format: sameFormat ? 0.08 : 0,
          learningQuality: qualityAssessment.status === "trusted" ? 0.05 : 0,
          source: deliveryCase.sourceId === artifact.sourceId ? 0.07 : 0,
          feedback: 0,
          vector: vectorRollout ? vectorCandidate : 0,
        };
        const reasons = [];
        if (bestSimilarity >= 0.08) reasons.push("similar_requirement_language");
        if (sharedFieldCount) {
          reasons.push("shared_structured_fields");
        }
        if (sameFormat) {
          reasons.push("same_requirement_format");
        }
        if (qualityAssessment.status === "trusted") {
          reasons.push("trusted_learning_case");
        }
        if (deliveryCase.sourceId === artifact.sourceId) {
          reasons.push("same_source");
        }
        const feedbackRun = state.workflowRuns.find((run) =>
          run.feedback?.deliveryCaseId === deliveryCase.id && visible(run, actor));
        if (feedbackRun?.feedback?.state === "accepted") {
          scoreBreakdown.feedback = 0.05;
          reasons.push("accepted_delivery");
        } else if (feedbackRun?.feedback?.state === "accepted_with_edits") {
          scoreBreakdown.feedback = 0.02;
          reasons.push("accepted_after_edits");
        }
        const rawScore = Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0);
        const baselineRawScore = rawScore - scoreBreakdown.learningQuality - scoreBreakdown.vector;
        const profile = (
          deliveryCase.workflowProfileId
            ? state.workflowProfiles.find((item) =>
                item.id === deliveryCase.workflowProfileId && visible(item, actor))
            : null
        ) ?? state.workflowProfiles.find((item) =>
          visible(item, actor) && (item.evidenceCaseIds ?? []).includes(deliveryCase.id)) ?? null;
        return {
          deliveryCase: caseView(deliveryCase),
          profileFamilyId: profile?.familyId ?? profile?.id ?? null,
          score: Math.min(1, Number(rawScore.toFixed(3))),
          scoreBreakdown: {
            ...Object.fromEntries(
              Object.entries(scoreBreakdown).map(([key, value]) => [key, Number(value.toFixed(3))]),
            ),
            vectorCandidate: Number(vectorCandidate.toFixed(3)),
            baselineTotal: Math.min(1, Number(baselineRawScore.toFixed(3))),
            noVectorTotal: Math.min(1, Number((rawScore - scoreBreakdown.vector).toFixed(3))),
            total: Math.min(1, Number(rawScore.toFixed(3))),
            experimentalTotal: Math.min(1, Number((rawScore - scoreBreakdown.vector + vectorCandidate).toFixed(3))),
          },
          reasons,
          evidence: {
            lexicalSimilarity: Number(bestSimilarity.toFixed(3)),
            sharedFieldCount,
            sameFormat,
            sameSource: deliveryCase.sourceId === artifact.sourceId,
          },
        };
      })
      .filter((item) => item.score >= 0.08 && item.reasons.length)
      .sort((left, right) => right.score - left.score || left.deliveryCase.id.localeCompare(right.deliveryCase.id))
      .slice(0, boundedLimit);
    return {
      status: 200,
      body: {
        artifact,
        cases,
        count: cases.length,
          retrieval: {
          version: WORKFLOW_RETRIEVAL_VERSION,
          mode: "structured_lexical",
          vector: {
            state: !embeddingAdapter
              ? "not_configured"
              : queryEmbedding
                ? vectorRollout ? "rollout_active" : "indexed_gated"
                : "index_required",
            used: Boolean(queryEmbedding && vectorRollout),
            providerId: embeddingAdapter?.providerId ?? null,
            model: embeddingAdapter?.model ?? null,
            modelVersion: embeddingAdapter?.modelVersion ?? null,
            rolloutPercent: Number(embeddingAdapter?.rolloutPercent ?? 0),
          },
          deterministicFallback: true,
        },
      },
    };
  }

  function evaluateRetrieval({ sourceId } = {}, actor = null) {
    const source = findSource(sourceId, actor);
    if (!source) return { status: 404, body: { error: "workflow_source_not_found" } };
    const familyByCaseId = new Map();
    for (const profile of state.workflowProfiles
      .filter((item) =>
        visible(item, actor)
        && item.sourceId === source.id
        && !item.supersededByProfileId
        && !["disabled", "archived"].includes(item.state)
        && !profileHasExcludedEvidence(item))) {
      const familyId = profile.familyId ?? profile.id;
      for (const caseId of profile.evidenceCaseIds ?? []) familyByCaseId.set(caseId, familyId);
    }
    const familyCaseCount = new Map();
    for (const familyId of familyByCaseId.values()) {
      familyCaseCount.set(familyId, (familyCaseCount.get(familyId) ?? 0) + 1);
    }

    const currentRanks = [];
    const baselineRanks = [];
    const samples = [];
    let vectorSampleCount = 0;
    const eligibleCases = state.deliveryCases.filter((deliveryCase) =>
      deliveryCase.sourceId === source.id
      && deliveryCase.state === "confirmed"
      && visible(deliveryCase, actor)
      && qualityForCase(deliveryCase).status !== "blocked");
    for (const deliveryCase of eligibleCases) {
      const expectedFamilyId = familyByCaseId.get(deliveryCase.id);
      if (!expectedFamilyId || (familyCaseCount.get(expectedFamilyId) ?? 0) < 2) continue;
      for (const artifactId of deliveryCase.requirementArtifactIds ?? []) {
        if (samples.length >= 100) break;
        const artifact = findArtifact(artifactId, actor);
        if (!artifact || artifact.exclusion || artifact.availability !== "available") continue;
        const result = findSimilarCases({ artifactId, limit: 20 }, actor);
        if (result.status !== 200) continue;
        const candidates = result.body.cases.filter((candidate) =>
          candidate.deliveryCase.id !== deliveryCase.id);
        const experimentalCandidates = [...candidates].sort((left, right) =>
          right.scoreBreakdown.experimentalTotal - left.scoreBreakdown.experimentalTotal
          || left.deliveryCase.id.localeCompare(right.deliveryCase.id));
        const currentRank = experimentalCandidates.findIndex((candidate) =>
          candidate.profileFamilyId === expectedFamilyId) + 1;
        const baselineCandidates = [...candidates].sort((left, right) =>
          right.scoreBreakdown.noVectorTotal - left.scoreBreakdown.noVectorTotal
          || left.deliveryCase.id.localeCompare(right.deliveryCase.id));
        const baselineRank = baselineCandidates.findIndex((candidate) =>
          candidate.profileFamilyId === expectedFamilyId) + 1;
        currentRanks.push(currentRank);
        baselineRanks.push(baselineRank);
        if (embeddingRecordFor(artifact)) vectorSampleCount += 1;
        samples.push({
          artifactId,
          expectedFamilyId,
          currentRank: currentRank || null,
          baselineRank: baselineRank || null,
        });
      }
      if (samples.length >= 100) break;
    }

    const current = summarizeWorkflowRetrievalRanks(currentRanks);
    const baseline = summarizeWorkflowRetrievalRanks(baselineRanks);
    const enoughSamples = current.sampleCount >= 3;
    const vectorCoverage = current.sampleCount
      ? Number((vectorSampleCount / current.sampleCount).toFixed(3))
      : 0;
    const noRegression = enoughSamples
      && current.top5 >= baseline.top5
      && current.mrr >= baseline.mrr;
    return {
      status: 200,
      body: {
        sourceId: source.id,
        retrieval: {
          version: WORKFLOW_RETRIEVAL_VERSION,
          mode: "structured_lexical",
          vector: {
            state: !embeddingAdapter ? "not_configured" : vectorCoverage ? "evaluated" : "index_required",
            used: false,
            providerId: embeddingAdapter?.providerId ?? null,
            model: embeddingAdapter?.model ?? null,
            modelVersion: embeddingAdapter?.modelVersion ?? null,
            rolloutPercent: Number(embeddingAdapter?.rolloutPercent ?? 0),
            coverage: vectorCoverage,
          },
          deterministicFallback: true,
        },
        current,
        baseline,
        gate: {
          status: !enoughSamples ? "insufficient_samples" : noRegression ? "passed" : "regressed",
          minimumSamples: 3,
          embeddingEligible: Boolean(embeddingAdapter && noRegression && vectorCoverage >= 0.8),
        },
        samples,
      },
    };
  }

  function matchProfiles({ artifactId } = {}, actor = null) {
    const artifact = findArtifact(artifactId, actor);
    if (!artifact || artifact.exclusion || effectiveRole(artifact) !== "requirement") {
      return { status: 404, body: { error: "workflow_requirement_not_found" } };
    }
    const similar = findSimilarCases({ artifactId, limit: 20 }, actor);
    const similarityByFamily = new Map();
    for (const candidate of similar.body?.cases ?? []) {
      if (!candidate.profileFamilyId) continue;
      similarityByFamily.set(
        candidate.profileFamilyId,
        Math.max(similarityByFamily.get(candidate.profileFamilyId) ?? 0, candidate.score),
      );
    }
    const matches = state.workflowProfiles
      .filter((profile) =>
        visible(profile, actor)
        && !profileHasExcludedEvidence(profile)
        && !profile.supersededByProfileId
        && !["disabled", "archived"].includes(profile.state))
      .map(profileView)
      .filter((profile) => profile.learningQuality.status !== "blocked")
      .map((profile) => {
        let score = 0;
        const reasons = [];
        if (profile.sourceId === artifact.sourceId) {
          score += 0.45;
          reasons.push("same_source");
        }
        if (profile.requirementSpec?.acceptedExtensions?.includes(artifact.extension)) {
          score += 0.25;
          reasons.push("supported_requirement_format");
        }
        if (profile.state === "established") {
          score += 0.15;
          reasons.push("established_profile");
        }
        if ((profile.evidenceCaseIds ?? []).length >= 3) {
          score += 0.1;
          reasons.push("confirmed_history");
        }
        if (profile.learningQuality.status === "trusted") {
          score += 0.05;
          reasons.push("trusted_learning_evidence");
        }
        const profileWords = normalizedFieldLabel(profile.name);
        const artifactWords = normalizedFieldLabel(artifact.relativePath);
        if (profileWords.length >= 2 && artifactWords.includes(profileWords)) {
          score += 0.05;
          reasons.push("name_match");
        }
        const similarCaseScore = similarityByFamily.get(profile.familyId ?? profile.id) ?? 0;
        if (similarCaseScore > 0) {
          score += Math.min(0.15, similarCaseScore * 0.15);
          reasons.push("similar_confirmed_cases");
        }
        return { profile, score: Math.min(1, Number(score.toFixed(2))), reasons };
      })
      .filter((match) => match.score >= 0.25)
      .sort((left, right) => right.score - left.score);
    return {
      status: 200,
      body: { artifact, matches, similarCases: (similar.body?.cases ?? []).slice(0, 5) },
    };
  }

  function inspectRequirement({ artifactId, profileId } = {}, actor = null) {
    const artifact = findArtifact(artifactId, actor);
    if (!artifact || artifact.exclusion || effectiveRole(artifact) !== "requirement") {
      return { status: 404, body: { error: "workflow_requirement_not_found" } };
    }
    const profileRecord = state.workflowProfiles.find((item) =>
      item.id === profileId && visible(item, actor));
    if (
      !profileRecord
      || profileHasExcludedEvidence(profileRecord)
      || ["disabled", "archived"].includes(profileRecord.state)
      || profileRecord.supersededByProfileId
    ) {
      return { status: 404, body: { error: "workflow_profile_not_found" } };
    }
    const profile = profileView(profileRecord);
    if (profile.learningQuality.status === "blocked") {
      return {
        status: 409,
        body: {
          error: "workflow_profile_learning_quality_blocked",
          learningQuality: profile.learningQuality,
        },
      };
    }
    const source = findSource(artifact.sourceId, actor);
    if (!source || source.state !== "active") {
      return { status: 409, body: { error: "workflow_source_revoked" } };
    }
    const extracted = extractStructuredFields(readArtifactText(state, source, artifact));
    const byKey = new Map(extracted.map((field) => [field.key, field]));
    const fields = (profile.requirementSpec?.fields ?? []).map((spec) => {
      const fact = byKey.get(spec.key);
      return {
        key: spec.key,
        label: spec.label,
        required: Boolean(spec.required),
        value: fact?.value ?? null,
        status: fact?.value ? "found" : "missing",
        evidenceArtifactId: fact?.value ? artifact.id : null,
      };
    });
    const missingFields = fields.filter((field) => field.required && field.status === "missing");
    const blockers = fields.length
      ? []
      : (profile.requirementSpec?.unresolved ?? ["Required requirement fields are not configured."]);
    return {
      status: 200,
      body: {
        artifact,
        profile,
        fields,
        missingFields,
        blockers,
        executionReady: missingFields.length === 0 && blockers.length === 0,
        plannedOutputs: profile.outcomeSpec?.outputs ?? [],
        pathTemplate: profile.outcomeSpec?.pathTemplate ?? null,
      },
    };
  }


  return { evaluateRetrieval, findSimilarCases, inspectRequirement, matchProfiles };
}
