import { basename } from "node:path";

export function createWorkflowSourceManager({
  access,
  activeScans,
  cancelledScans,
  defaultIntakeStabilityWindowMs: DEFAULT_INTAKE_STABILITY_WINDOW_MS,
  files,
  normalizeRelativePath,
  readModes: READ_MODES,
  runtime,
}) {
  const {
    actorCanAccessProject,
    actorTeam,
    actorUser,
    findSource,
    teamOf,
    visible,
  } = access;
  const { containedRealDirectory } = files;
  const { appendEvent, errorResult, nextId, now, runTx, state } = runtime;
  function listSources(actor) {
    return {
      status: 200,
      body: {
        sources: state.workflowSources.filter((item) => visible(item, actor)).map((item) => {
          if (item.purpose !== "template_learning") return item;
          const task = (state.templateLearningTasks ?? []).find((row) =>
            row.sourceId === item.id && visible(row, actor));
          if (!task) return item;
          return {
            ...item,
            selectedFileCount: task.cases.reduce((sum, learningCase) =>
              sum + learningCase.files.length, 0),
          };
        }),
      },
    };
  }

  function createSource(input = {}, actor = null) {
    try {
      const projectId = String(input.projectId ?? "").trim();
      const project = state.projects.find((item) => item.id === projectId);
      if (!project || !actorCanAccessProject(state, actor, projectId)) {
        return { status: 404, body: { error: "project_not_found" } };
      }
      const relativePath = normalizeRelativePath(input.relativePath);
      const readMode = String(input.readMode ?? "metadata");
      if (!READ_MODES.has(readMode)) {
        return { status: 400, body: { error: "invalid_workflow_source_read_mode" } };
      }
      containedRealDirectory(project.path, relativePath);
      const duplicate = state.workflowSources.find((item) =>
        item.ownerTeamId === actorTeam(actor)
        && item.projectId === projectId
        && item.relativePath === relativePath
        && item.state !== "deleted");
      if (duplicate) {
        return { status: 409, body: { error: "workflow_source_exists", source: duplicate } };
      }
      const timestamp = now();
      const source = {
        id: nextId("wfs"),
        ownerTeamId: teamOf(project),
        projectId,
        name: String(input.name ?? "").trim().slice(0, 200)
          || basename(relativePath || project.path)
          || "Workflow source",
        relativePath,
        readMode,
        state: "active",
        scanState: "idle",
        scanRevision: 0,
        intakeScanRevision: 0,
        intakeCursor: null,
        intakeStabilityWindowMs: DEFAULT_INTAKE_STABILITY_WINDOW_MS,
        revision: 1,
        fileCount: 0,
        skippedCount: 0,
        truncated: false,
        lastScanAt: null,
        lastError: null,
        createdAt: timestamp,
        createdBy: actorUser(actor),
        updatedAt: timestamp,
      };
      runTx(() => {
        state.workflowSources.push(source);
        appendEvent({
          invocationId: null,
          type: "workflow_source_created",
          level: "info",
          message: "Workflow memory source authorized.",
          data: { sourceId: source.id, projectId, actorTeamId: source.ownerTeamId },
        });
      });
      return { status: 201, body: { source } };
    } catch (error) {
      return errorResult(error);
    }
  }

  function revokeSource({ sourceId, expectedRevision } = {}, actor = null) {
    const source = findSource(sourceId, actor);
    if (!source) return { status: 404, body: { error: "workflow_source_not_found" } };
    if (expectedRevision !== source.revision) {
      return {
        status: 409,
        body: { error: "workflow_source_revision_conflict", currentRevision: source.revision },
      };
    }
    runTx(() => {
      if (activeScans.has(source.id)) cancelledScans.add(source.id);
      source.state = "revoked";
      source.scanState = "idle";
      source.revision += 1;
      source.updatedAt = now();
      appendEvent({
        invocationId: null,
        type: "workflow_source_revoked",
        level: "warning",
        message: "Workflow memory source access revoked.",
        data: { sourceId: source.id, projectId: source.projectId },
      });
    });
    return { status: 200, body: { source } };
  }

  function deleteSourceLearning({ sourceId, expectedRevision, confirmed = false } = {}, actor = null) {
    const source = findSource(sourceId, actor);
    if (!source) return { status: 404, body: { error: "workflow_source_not_found" } };
    if (expectedRevision !== source.revision) {
      return {
        status: 409,
        body: { error: "workflow_source_revision_conflict", currentRevision: source.revision },
      };
    }
    if (source.state !== "revoked") {
      return { status: 409, body: { error: "workflow_source_must_be_revoked_before_delete" } };
    }
    if (confirmed !== true) {
      return { status: 400, body: { error: "workflow_source_delete_confirmation_required" } };
    }
    const sourceIdMatches = (item) => item.sourceId === source.id;
    const counts = {
      scanJobs: state.workflowScanJobs.filter(sourceIdMatches).length,
      intakeObservations: state.workflowIntakeObservations.filter(sourceIdMatches).length,
      intakeReceipts: state.workflowIntakeReceipts.filter(sourceIdMatches).length,
      embeddingRecords: state.workflowEmbeddingIndex.filter(sourceIdMatches).length,
      artifacts: state.workflowArtifacts.filter(sourceIdMatches).length,
      cases: state.deliveryCases.filter(sourceIdMatches).length,
      profiles: state.workflowProfiles.filter(sourceIdMatches).length,
      profileDrafts: state.workflowProfileDrafts.filter(sourceIdMatches).length,
      runs: state.workflowRuns.filter(sourceIdMatches).length,
      businessDocumentClassifications: state.businessDocumentClassifications.filter(sourceIdMatches).length,
      businessDocumentAnalysisJobs: state.businessDocumentAnalysisJobs.filter(sourceIdMatches).length,
      businessEntities: state.businessEntities.filter(sourceIdMatches).length,
      businessCaseCandidates: state.businessCaseCandidates.filter(sourceIdMatches).length,
      businessCases: state.businessCases.filter(sourceIdMatches).length,
      routineDiscoveryCandidates: state.routineDiscoveryCandidates.filter(sourceIdMatches).length,
      routineDefinitions: state.routineDefinitions.filter(sourceIdMatches).length,
      routineRuns: state.routineRuns.filter(sourceIdMatches).length,
      ledgerDefinitions: state.ledgerDefinitions.filter(sourceIdMatches).length,
      adaptivePolicies: state.workflowAdaptivePolicies.filter(sourceIdMatches).length,
      adaptiveFeedback: state.workflowAdaptiveFeedback.filter(sourceIdMatches).length,
      adaptiveMonitors: state.workflowAdaptiveMonitors.filter(sourceIdMatches).length,
      adaptiveOutcomes: state.workflowAdaptiveOutcomes.filter(sourceIdMatches).length,
      adaptiveLearningDrafts: state.workflowAdaptiveLearningDrafts.filter(sourceIdMatches).length,
      adaptiveRules: state.workflowAdaptiveRules.filter(sourceIdMatches).length,
      adaptiveNotifications: state.workflowAdaptiveNotifications.filter(sourceIdMatches).length,
    };
    runTx(() => {
      state.workflowScanJobs.splice(
        0,
        state.workflowScanJobs.length,
        ...state.workflowScanJobs.filter((item) => !sourceIdMatches(item)),
      );
      state.workflowIntakeObservations.splice(
        0,
        state.workflowIntakeObservations.length,
        ...state.workflowIntakeObservations.filter((item) => !sourceIdMatches(item)),
      );
      state.workflowIntakeReceipts.splice(
        0,
        state.workflowIntakeReceipts.length,
        ...state.workflowIntakeReceipts.filter((item) => !sourceIdMatches(item)),
      );
      state.workflowEmbeddingIndex.splice(
        0,
        state.workflowEmbeddingIndex.length,
        ...state.workflowEmbeddingIndex.filter((item) => !sourceIdMatches(item)),
      );
      state.workflowArtifacts.splice(
        0,
        state.workflowArtifacts.length,
        ...state.workflowArtifacts.filter((item) => !sourceIdMatches(item)),
      );
      state.deliveryCases.splice(
        0,
        state.deliveryCases.length,
        ...state.deliveryCases.filter((item) => !sourceIdMatches(item)),
      );
      state.workflowProfiles.splice(
        0,
        state.workflowProfiles.length,
        ...state.workflowProfiles.filter((item) => !sourceIdMatches(item)),
      );
      state.workflowProfileDrafts.splice(
        0,
        state.workflowProfileDrafts.length,
        ...state.workflowProfileDrafts.filter((item) => !sourceIdMatches(item)),
      );
      state.workflowRuns.splice(
        0,
        state.workflowRuns.length,
        ...state.workflowRuns.filter((item) => !sourceIdMatches(item)),
      );
      for (const key of [
        "businessDocumentClassifications",
        "businessDocumentAnalysisJobs",
        "businessEntities",
        "businessCaseCandidates",
        "businessCases",
        "routineDiscoveryCandidates",
        "routineDefinitions",
        "routineRuns",
        "ledgerDefinitions",
        "workflowAdaptivePolicies",
        "workflowAdaptiveFeedback",
        "workflowAdaptiveMonitors",
        "workflowAdaptiveOutcomes",
        "workflowAdaptiveLearningDrafts",
        "workflowAdaptiveRules",
        "workflowAdaptiveNotifications",
      ]) {
        state[key].splice(
          0,
          state[key].length,
          ...state[key].filter((item) => !sourceIdMatches(item)),
        );
      }
      state.workflowSources.splice(
        0,
        state.workflowSources.length,
        ...state.workflowSources.filter((item) => item.id !== source.id),
      );
      appendEvent({
        invocationId: null,
        type: "workflow_source_learning_deleted",
        level: "warning",
        message: "Workflow memory derived data deleted; original files were untouched.",
        data: { sourceId: source.id, projectId: source.projectId, counts },
      });
    });
    return {
      status: 200,
      body: { deleted: true, sourceId: source.id, counts, originalFilesDeleted: false },
    };
  }


  return { createSource, deleteSourceLearning, listSources, revokeSource };
}
