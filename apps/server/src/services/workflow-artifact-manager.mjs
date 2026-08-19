export function createWorkflowArtifactManager({
  access,
  effectiveRole,
  files,
  roleSet: ROLE_SET,
  runtime,
}) {
  const { actorUser, findArtifact, findSource, visible } = access;
  const { readArtifactText } = files;
  const { appendEvent, now, runTx, state } = runtime;
  function listArtifacts({ sourceId = null, role = null, availability = null } = {}, actor = null) {
    if (sourceId && !findSource(sourceId, actor)) {
      return { status: 404, body: { error: "workflow_source_not_found" } };
    }
    if (role && !ROLE_SET.has(role)) {
      return { status: 400, body: { error: "invalid_workflow_artifact_role" } };
    }
    const artifacts = state.workflowArtifacts.filter((item) =>
      visible(item, actor)
      && (!sourceId || item.sourceId === sourceId)
      && (!role || effectiveRole(item) === role)
      && (!availability || item.availability === availability));
    return { status: 200, body: { artifacts, count: artifacts.length } };
  }

  function getArtifactAnalysisInput({ artifactId } = {}, actor = null) {
    const artifact = findArtifact(artifactId, actor);
    if (!artifact) return { status: 404, body: { error: "workflow_artifact_not_found" } };
    if (artifact.exclusion) {
      return { status: 409, body: { error: "workflow_artifact_excluded" } };
    }
    if (artifact.availability !== "available") {
      return { status: 409, body: { error: "workflow_artifact_not_available" } };
    }
    const source = findSource(artifact.sourceId, actor);
    if (!source || source.state !== "active") {
      return { status: 409, body: { error: "workflow_source_revoked" } };
    }
    if (source.readMode !== "supported_text") {
      return { status: 409, body: { error: "workflow_business_analysis_requires_text_access" } };
    }
    const content = readArtifactText(state, source, artifact);
    if (!content) {
      return {
        status: 422,
        body: {
          error: artifact.extraction?.state === "needs_ocr"
            ? "workflow_business_analysis_needs_ocr"
            : "workflow_business_analysis_content_unavailable",
        },
      };
    }
    return {
      status: 200,
      body: {
        source,
        artifact,
        content,
        blocks: artifact.extraction?.blocks ?? [],
      },
    };
  }

  function confirmArtifact({ artifactId, role, expectedRevision } = {}, actor = null) {
    const artifact = findArtifact(artifactId, actor);
    if (!artifact) return { status: 404, body: { error: "workflow_artifact_not_found" } };
    if (artifact.exclusion) {
      return { status: 409, body: { error: "workflow_artifact_excluded" } };
    }
    if (!ROLE_SET.has(role)) {
      return { status: 400, body: { error: "invalid_workflow_artifact_role" } };
    }
    if (expectedRevision !== artifact.revision) {
      return {
        status: 409,
        body: { error: "workflow_artifact_revision_conflict", currentRevision: artifact.revision },
      };
    }
    runTx(() => {
      artifact.role = role;
      artifact.confirmationState = "confirmed";
      artifact.confirmedBy = actorUser(actor);
      artifact.confirmedAt = now();
      artifact.revision += 1;
      artifact.updatedAt = now();
      appendEvent({
        invocationId: null,
        type: "workflow_artifact_confirmed",
        level: "info",
        message: "Workflow artifact role confirmed.",
        data: { artifactId: artifact.id, sourceId: artifact.sourceId, role },
      });
    });
    return { status: 200, body: { artifact } };
  }

  function setArtifactExclusion({
    artifactId,
    expectedRevision,
    excluded,
    reason,
  } = {}, actor = null) {
    const artifact = findArtifact(artifactId, actor);
    if (!artifact) return { status: 404, body: { error: "workflow_artifact_not_found" } };
    if (expectedRevision !== artifact.revision) {
      return {
        status: 409,
        body: { error: "workflow_artifact_revision_conflict", currentRevision: artifact.revision },
      };
    }
    const note = String(reason ?? "").trim().slice(0, 1_000);
    if (excluded === true && !note) {
      return { status: 400, body: { error: "workflow_artifact_exclusion_reason_required" } };
    }
    const timestamp = now();
    runTx(() => {
      if (excluded === true) {
        artifact.exclusion = { reason: note, at: timestamp, by: actorUser(actor) };
      } else {
        delete artifact.exclusion;
        artifact.confirmationState = "changed";
      }
      artifact.revision += 1;
      artifact.updatedAt = timestamp;
      appendEvent({
        invocationId: null,
        type: excluded === true ? "workflow_artifact_excluded" : "workflow_artifact_included",
        level: excluded === true ? "warning" : "info",
        message: excluded === true
          ? "Workflow artifact excluded from learning."
          : "Workflow artifact returned to review.",
        data: { artifactId: artifact.id, sourceId: artifact.sourceId, reason: note },
      });
    });
    return { status: 200, body: { artifact } };
  }


  return { confirmArtifact, getArtifactAnalysisInput, listArtifacts, setArtifactExclusion };
}
