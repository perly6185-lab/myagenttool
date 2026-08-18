/*
 * Requirement-to-delivery workflow memory routes (Epic #1547).
 *
 * The service owns tenancy, containment, revision, and lifecycle checks. Routes
 * only decode the bounded HTTP shape and preserve identical 404 behavior for a
 * missing or foreign resource.
 */

const MAX_TEMPLATE_LEARNING_UPLOAD_BYTES = 24 * 1024 * 1024;

async function readBoundedBinary(req, limit = MAX_TEMPLATE_LEARNING_UPLOAD_BYTES) {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > limit) return { error: "template_learning_file_size_invalid" };
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) return { error: "template_learning_file_size_invalid" };
    chunks.push(chunk);
  }
  return { bytes: Buffer.concat(chunks, total) };
}

export async function handleWorkflowMemoryRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  actor,
  listSources,
  createSource,
  listTemplateLearningTasks,
  createTemplateLearningTask,
  stageTemplateLearningFile,
  startTemplateLearningTask,
  completeTemplateLearningTask,
  scanSource,
  scanIncrementalIntake,
  listIntakeObservations,
  inspectInquiryIntake,
  acceptInquiryIntake,
  cancelScan,
  revokeSource,
  deleteSourceLearning,
  listArtifacts,
  confirmArtifact,
  retryArtifactExtraction,
  getOcrReadiness,
  ocrArtifact,
  getOcrStatus,
  cancelOcrArtifact,
  setArtifactExclusion,
  indexSourceEmbeddings,
  analyzeBusinessDocuments,
  cancelBusinessAnalysis,
  analyzeBusinessDocument,
  listBusinessDocumentClassifications,
  listBusinessDocumentAnalysisJobs,
  confirmBusinessDocumentClassification,
  discoverBusinessCases,
  listBusinessCaseCandidates,
  reviewBusinessCaseCandidate,
  discoverBusinessRoutine,
  listBusinessRoutineCandidates,
  createRoutineDraft,
  listBusinessRoutineDefinitions,
  updateBusinessRoutineDefinition,
  createBusinessRoutineDefinitionVersion,
  publishBusinessRoutineDefinition,
  transitionBusinessRoutineDefinition,
  createLedgerDefinition,
  listLedgerDefinitions,
  activateLedgerDefinition,
  disableLedgerDefinition,
  previewLedgerUpsert,
  commitLedgerUpsertPreview,
  listLedgerUpsertPreviews,
  listLedgerMutations,
  collectBusinessPilotEvidence,
  verifyBusinessPilotEvidence,
  getBusinessPilotWorkbench,
  saveBusinessPilotWorkbench,
  prepareBusinessPilotWorkbench,
  createBusinessPilotGapIssues,
  submitBusinessPilotReview,
  updateBusinessPilotRollout,
  collectBusinessPilotWorkbench,
  getBusinessPilotCollection,
  compareBusinessPilotCollections,
  exportBusinessPilotCollection,
  revokeBusinessPilotCollection,
  getWorkflowAdaptiveWorkbench,
  getWorkflowMemoryInsights,
  updateWorkflowAdaptivePolicy,
  updateWorkflowAdaptiveMonitor,
  updateWorkflowAdaptiveAutomation,
  runWorkflowAdaptiveMonitorNow,
  syncWorkflowAdaptiveOutcomes,
  listWorkflowAdaptiveLearning,
  generateWorkflowAdaptiveLearningDraft,
  evaluateWorkflowAdaptiveLearning,
  recordWorkflowAdaptiveShadowPreference,
  previewWorkflowAdaptiveLearningPublication,
  listWorkflowAdaptiveNotifications,
  readWorkflowAdaptiveNotification,
  publishWorkflowAdaptiveLearningDraft,
  rollbackWorkflowAdaptiveLearningRule,
  materializeWorkflowAdaptiveSuggestion,
  reconcileWorkflowAdaptiveWork,
  recordWorkflowAdaptiveFeedback,
  materializeRoutineIssue,
  getRoutineWorkItemExecution,
  listRoutineWorkQueue,
  startRoutineWorkItem,
  executeRoutineStep,
  confirmQuotationInputs,
  bindRoutineLedger,
  requestRoutineStepReview,
  resumeRoutineRecovery,
  completeRoutineStep,
  retryRoutineStep,
  decideRoutineApproval,
  decideRoutineCondition,
  cancelRoutineWorkItem,
  pairProposals,
  listCases,
  createCase,
  changeCaseState,
  deriveProfile,
  reviseProfile,
  listProfiles,
  listProfileDrafts,
  createProfileDraft,
  publishProfileDraft,
  listInbox,
  matchProfiles,
  findSimilarCases,
  evaluateRetrieval,
  inspectRequirement,
  listRuns,
  createRun,
  executeRun,
  cancelRunExecution,
  retryRunExecution,
  cleanupRunAttemptWorktree,
  selectRunAttempt,
  validateRun,
  recordRunFeedback,
  previewRunPublication,
  publishRunOutputs,
}) {
  if (!url.pathname.startsWith("/api/workflow-memory")) return false;

  if (url.pathname === "/api/workflow-memory/template-learning") {
    if (req.method === "GET") {
      const result = listTemplateLearningTasks({}, actor);
      sendJson(res, result.status, result.body);
      return true;
    }
    if (req.method === "POST") {
      const result = createTemplateLearningTask(await readJson(req), actor);
      sendJson(res, result.status, result.body);
      return true;
    }
  }

  const templateLearningFileMatch = url.pathname.match(
    /^\/api\/workflow-memory\/template-learning\/([^/]+)\/files$/,
  );
  if (templateLearningFileMatch && req.method === "POST") {
    const body = await readBoundedBinary(req);
    if (body.error) {
      sendJson(res, 413, { error: body.error, maxBytes: MAX_TEMPLATE_LEARNING_UPLOAD_BYTES });
      return true;
    }
    const result = stageTemplateLearningFile({
      taskId: decodeURIComponent(templateLearningFileMatch[1]),
      caseId: url.searchParams.get("caseId"),
      role: url.searchParams.get("role"),
      filename: url.searchParams.get("filename"),
      contentType: req.headers["content-type"],
      bytes: body.bytes,
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const templateLearningStartMatch = url.pathname.match(
    /^\/api\/workflow-memory\/template-learning\/([^/]+)\/start$/,
  );
  if (templateLearningStartMatch && req.method === "POST") {
    const body = await readJson(req);
    const result = await startTemplateLearningTask({
      taskId: decodeURIComponent(templateLearningStartMatch[1]),
      background: true,
      allowCloudOcr: body.allowCloudOcr === true,
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/template-learning/complete" && req.method === "POST") {
    const result = completeTemplateLearningTask(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/insights" && req.method === "GET") {
    const result = getWorkflowMemoryInsights({
      projectId: url.searchParams.get("projectId"),
      sourceId: url.searchParams.get("sourceId"),
      routineDefinitionId: url.searchParams.get("routineDefinitionId"),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/adaptive-workbench"
    && req.method === "GET") {
    const result = getWorkflowAdaptiveWorkbench({
      projectId: url.searchParams.get("projectId"),
      sourceId: url.searchParams.get("sourceId"),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/adaptive-workbench/policy"
    && req.method === "PUT") {
    const result = updateWorkflowAdaptivePolicy(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/adaptive-workbench/monitor"
    && req.method === "PUT") {
    const result = updateWorkflowAdaptiveMonitor(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/adaptive-workbench/automation"
    && req.method === "PUT") {
    const result = updateWorkflowAdaptiveAutomation(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/adaptive-workbench/monitor/run"
    && req.method === "POST") {
    const result = await runWorkflowAdaptiveMonitorNow(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/adaptive-workbench/outcomes/sync"
    && req.method === "POST") {
    const result = syncWorkflowAdaptiveOutcomes(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/adaptive-workbench/learning") {
    const input = req.method === "GET" ? {
      projectId: url.searchParams.get("projectId"),
      sourceId: url.searchParams.get("sourceId"),
    } : await readJson(req);
    const result = req.method === "GET"
      ? listWorkflowAdaptiveLearning(input, actor)
      : req.method === "POST"
        ? generateWorkflowAdaptiveLearningDraft(input, actor)
        : null;
    if (!result) return false;
    sendJson(res, result.status, result.body);
    return true;
  }

  const adaptiveLearningAction = url.pathname.match(
    /^\/api\/workflow-memory\/adaptive-workbench\/learning\/(drafts|rules)\/([^/]+)\/(publish|rollback)$/,
  );
  if (adaptiveLearningAction && req.method === "POST") {
    const input = {
      ...(await readJson(req)),
      [adaptiveLearningAction[1] === "drafts" ? "draftId" : "ruleId"]:
        decodeURIComponent(adaptiveLearningAction[2]),
    };
    const result = adaptiveLearningAction[3] === "publish"
      ? publishWorkflowAdaptiveLearningDraft(input, actor)
      : rollbackWorkflowAdaptiveLearningRule(input, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const adaptiveShadowPreference = url.pathname.match(
    /^\/api\/workflow-memory\/adaptive-workbench\/learning\/drafts\/([^/]+)\/shadow\/([^/]+)\/preference$/,
  );
  if (adaptiveShadowPreference && req.method === "POST") {
    const result = recordWorkflowAdaptiveShadowPreference({
      ...(await readJson(req)),
      draftId: decodeURIComponent(adaptiveShadowPreference[1]),
      suggestionId: decodeURIComponent(adaptiveShadowPreference[2]),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const adaptivePublicationPreview = url.pathname.match(
    /^\/api\/workflow-memory\/adaptive-workbench\/learning\/drafts\/([^/]+)\/publication-preview$/,
  );
  if (adaptivePublicationPreview && req.method === "POST") {
    const result = previewWorkflowAdaptiveLearningPublication({
      ...(await readJson(req)),
      draftId: decodeURIComponent(adaptivePublicationPreview[1]),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/adaptive-workbench/evaluate"
    && req.method === "POST") {
    const result = evaluateWorkflowAdaptiveLearning(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/adaptive-workbench/notifications"
    && req.method === "GET") {
    const result = listWorkflowAdaptiveNotifications({
      projectId: url.searchParams.get("projectId"),
      sourceId: url.searchParams.get("sourceId"),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const adaptiveNotification = url.pathname.match(
    /^\/api\/workflow-memory\/adaptive-workbench\/notifications\/([^/]+)\/read$/,
  );
  if (adaptiveNotification && req.method === "POST") {
    const result = readWorkflowAdaptiveNotification({
      notificationId: decodeURIComponent(adaptiveNotification[1]),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/adaptive-workbench/reconcile"
    && req.method === "POST") {
    const result = await reconcileWorkflowAdaptiveWork(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const adaptiveSuggestion = url.pathname.match(
    /^\/api\/workflow-memory\/adaptive-workbench\/suggestions\/([^/]+)\/(materialize|feedback)$/,
  );
  if (adaptiveSuggestion && req.method === "POST") {
    const input = {
      ...(await readJson(req)),
      suggestionId: decodeURIComponent(adaptiveSuggestion[1]),
    };
    const result = adaptiveSuggestion[2] === "materialize"
      ? materializeWorkflowAdaptiveSuggestion(input, actor)
      : recordWorkflowAdaptiveFeedback(input, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/commercial-pilot/evidence"
    && req.method === "POST") {
    const result = collectBusinessPilotEvidence(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/commercial-pilot/evidence/verify"
    && req.method === "POST") {
    const result = verifyBusinessPilotEvidence(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/commercial-pilot/workbench"
    && req.method === "GET") {
    const result = getBusinessPilotWorkbench({
      projectId: url.searchParams.get("projectId"),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/commercial-pilot/workbench"
    && req.method === "PUT") {
    const result = saveBusinessPilotWorkbench(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/commercial-pilot/workbench/collect"
    && req.method === "POST") {
    const result = collectBusinessPilotWorkbench(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/commercial-pilot/workbench/prepare"
    && req.method === "POST") {
    const result = prepareBusinessPilotWorkbench(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/commercial-pilot/workbench/gap-issues"
    && req.method === "POST") {
    const result = createBusinessPilotGapIssues(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const pilotReview = url.pathname.match(
    /^\/api\/workflow-memory\/commercial-pilot\/workbench\/reviews\/([^/]+)$/,
  );
  if (pilotReview && req.method === "POST") {
    const result = submitBusinessPilotReview({
      ...(await readJson(req)),
      dimension: decodeURIComponent(pilotReview[1]),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/commercial-pilot/rollout"
    && req.method === "PUT") {
    const result = updateBusinessPilotRollout(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/commercial-pilot/collections/compare"
    && req.method === "POST") {
    const result = compareBusinessPilotCollections(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const pilotCollectionAction = url.pathname.match(
    /^\/api\/workflow-memory\/commercial-pilot\/collections\/([^/]+)(?:\/(export|revoke))?$/,
  );
  if (pilotCollectionAction) {
    const collectionId = decodeURIComponent(pilotCollectionAction[1]);
    const action = pilotCollectionAction[2] ?? "detail";
    let result;
    if (action === "detail" && req.method === "GET") {
      result = getBusinessPilotCollection({
        projectId: url.searchParams.get("projectId"),
        collectionId,
      }, actor);
    } else if (action === "export" && req.method === "GET") {
      result = exportBusinessPilotCollection({
        projectId: url.searchParams.get("projectId"),
        collectionId,
        format: url.searchParams.get("format") ?? "markdown",
      }, actor);
    } else if (action === "revoke" && req.method === "POST") {
      result = revokeBusinessPilotCollection({
        ...(await readJson(req)),
        collectionId,
      }, actor);
    } else {
      return false;
    }
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/sources") {
    let result;
    if (req.method === "GET") result = listSources(actor);
    else if (req.method === "POST") result = createSource(await readJson(req), actor);
    else return false;
    sendJson(res, result.status, result.body);
    return true;
  }

  const sourceAction = url.pathname.match(
    /^\/api\/workflow-memory\/sources\/([^/]+)\/(scan|scan-intake|cancel-scan|revoke|delete-learning-data|pair-proposals|index-embeddings|analyze-business-documents|cancel-business-analysis|discover-business-cases|discover-business-routine)$/,
  );
  if (sourceAction) {
    const sourceId = decodeURIComponent(sourceAction[1]);
    const action = sourceAction[2];
    let result;
    if (action === "scan" && req.method === "POST") {
      result = await scanSource({ sourceId }, actor);
    } else if (action === "scan-intake" && req.method === "POST") {
      result = await scanIncrementalIntake({ sourceId }, actor);
      if (result.status === 200) {
        const artifactIds = [...new Set((result.body.observations ?? [])
          .filter((row) => row.state === "ready" && row.artifactId)
          .map((row) => row.artifactId))].slice(0, 10);
        const analysisResults = await Promise.all(artifactIds.map((artifactId) =>
          analyzeBusinessDocument({ artifactId }, actor)));
        result.body.adaptiveAnalysis = {
          attempted: artifactIds.length,
          classified: analysisResults.filter((row) => [200, 201].includes(row.status)).length,
          failed: analysisResults.filter((row) => ![200, 201].includes(row.status)).length,
          capped: artifactIds.length === 10
            && (result.body.observations ?? []).filter((row) => row.state === "ready").length > 10,
        };
        result.body.adaptiveWork = (await reconcileWorkflowAdaptiveWork({
          projectId: result.body.source.projectId,
          sourceId,
        }, actor)).body;
      }
    } else if (action === "cancel-scan" && req.method === "POST") {
      result = cancelScan({ sourceId }, actor);
    } else if (action === "revoke" && req.method === "POST") {
      const body = await readJson(req);
      result = revokeSource({ sourceId, expectedRevision: body?.expectedRevision }, actor);
    } else if (action === "delete-learning-data" && req.method === "POST") {
      const body = await readJson(req);
      result = deleteSourceLearning({
        sourceId,
        expectedRevision: body?.expectedRevision,
        confirmed: body?.confirmed,
      }, actor);
    } else if (action === "pair-proposals" && req.method === "GET") {
      result = pairProposals({ sourceId }, actor);
    } else if (action === "index-embeddings" && req.method === "POST") {
      result = await indexSourceEmbeddings({ sourceId }, actor);
    } else if (action === "analyze-business-documents" && req.method === "POST") {
      result = await analyzeBusinessDocuments({ sourceId }, actor);
    } else if (action === "cancel-business-analysis" && req.method === "POST") {
      result = cancelBusinessAnalysis({ sourceId }, actor);
    } else if (action === "discover-business-cases" && req.method === "POST") {
      result = discoverBusinessCases({ sourceId }, actor);
    } else if (action === "discover-business-routine" && req.method === "POST") {
      result = discoverBusinessRoutine({ sourceId }, actor);
    } else {
      return false;
    }
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/intake-observations" && req.method === "GET") {
    const result = listIntakeObservations({
      sourceId: url.searchParams.get("sourceId"),
      state: url.searchParams.get("state"),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const intakeObservationAction = url.pathname.match(
    /^\/api\/workflow-memory\/intake-observations\/([^/]+)\/(inspect|accept)$/,
  );
  if (intakeObservationAction && req.method === "POST") {
    const body = await readJson(req);
    const observationId = decodeURIComponent(intakeObservationAction[1]);
    const result = intakeObservationAction[2] === "inspect"
      ? await inspectInquiryIntake({
        observationId,
        supportingObservationIds: body?.supportingObservationIds,
        supportingObservationRoles: body?.supportingObservationRoles,
      }, actor)
      : await acceptInquiryIntake({
        observationId,
        expectedRevision: body?.expectedRevision,
        idempotencyKey: body?.idempotencyKey,
        routineDefinitionId: body?.routineDefinitionId,
        confirmed: body?.confirmed,
        fieldCorrections: body?.fieldCorrections,
        excludedFieldKeys: body?.excludedFieldKeys,
        supportingObservationIds: body?.supportingObservationIds,
        supportingObservationRoles: body?.supportingObservationRoles,
      }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/artifacts" && req.method === "GET") {
    const result = listArtifacts({
      sourceId: url.searchParams.get("sourceId"),
      role: url.searchParams.get("role"),
      availability: url.searchParams.get("availability"),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/business-document-classifications"
    && req.method === "GET") {
    const result = listBusinessDocumentClassifications({
      sourceId: url.searchParams.get("sourceId"),
      confirmationState: url.searchParams.get("confirmationState"),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/business-document-analysis-jobs"
    && req.method === "GET") {
    const result = listBusinessDocumentAnalysisJobs({
      sourceId: url.searchParams.get("sourceId"),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/business-case-candidates"
    && req.method === "GET") {
    const result = listBusinessCaseCandidates({
      sourceId: url.searchParams.get("sourceId"),
      state: url.searchParams.get("state"),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/business-routine-candidates"
    && req.method === "GET") {
    const result = listBusinessRoutineCandidates({
      sourceId: url.searchParams.get("sourceId"),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/business-routine-definitions"
    && req.method === "GET") {
    const result = listBusinessRoutineDefinitions({
      sourceId: url.searchParams.get("sourceId"),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/ledger-definitions") {
    let result;
    if (req.method === "GET") {
      result = listLedgerDefinitions({ sourceId: url.searchParams.get("sourceId") }, actor);
    } else if (req.method === "POST") {
      const body = await readJson(req);
      result = createLedgerDefinition({
        projectId: body?.projectId,
        sourceId: body?.sourceId,
        name: body?.name,
        documentType: body?.documentType,
        format: body?.format,
        relativePath: body?.relativePath,
        sheet: body?.sheet,
        table: body?.table,
        headerRow: body?.headerRow,
        businessKeyField: body?.businessKeyField,
        fallbackBusinessKeyFields: body?.fallbackBusinessKeyFields,
        fieldMappings: body?.fieldMappings,
        requiredFields: body?.requiredFields,
        formattingPolicy: body?.formattingPolicy,
        writePolicy: body?.writePolicy,
      }, actor);
    } else return false;
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/ledger-mutations" && req.method === "GET") {
    const result = listLedgerMutations({
      ledgerDefinitionId: url.searchParams.get("ledgerDefinitionId"),
      routineRunId: url.searchParams.get("routineRunId"),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/ledger-upsert-previews" && req.method === "GET") {
    const states = url.searchParams.get("states")
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const result = await listLedgerUpsertPreviews({
      ledgerDefinitionId: url.searchParams.get("ledgerDefinitionId"),
      routineRunId: url.searchParams.get("routineRunId"),
      states,
      limit: url.searchParams.get("limit"),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const ledgerDefinitionAction = url.pathname.match(
    /^\/api\/workflow-memory\/ledger-definitions\/([^/]+)\/(activate|disable|preview-upsert)$/,
  );
  if (ledgerDefinitionAction && req.method === "POST") {
    const body = await readJson(req);
    const ledgerDefinitionId = decodeURIComponent(ledgerDefinitionAction[1]);
    let result;
    if (ledgerDefinitionAction[2] === "activate") {
      result = await activateLedgerDefinition({
        ledgerDefinitionId,
        expectedRevision: body?.expectedRevision,
      }, actor);
    } else if (ledgerDefinitionAction[2] === "disable") {
      result = disableLedgerDefinition({
        ledgerDefinitionId,
        expectedRevision: body?.expectedRevision,
      }, actor);
    } else {
      result = await previewLedgerUpsert({
        ledgerDefinitionId,
        businessKey: body?.businessKey,
        fields: body?.fields,
        sourceEvidence: body?.sourceEvidence,
        routineRunId: body?.routineRunId,
        routineStepKey: body?.routineStepKey,
      }, actor);
    }
    sendJson(res, result.status, result.body);
    return true;
  }

  const ledgerPreviewCommit = url.pathname.match(
    /^\/api\/workflow-memory\/ledger-upsert-previews\/([^/]+)\/commit$/,
  );
  if (ledgerPreviewCommit && req.method === "POST") {
    const body = await readJson(req);
    const result = await commitLedgerUpsertPreview({
      previewId: decodeURIComponent(ledgerPreviewCommit[1]),
      expectedRevision: body?.expectedRevision,
      approved: body?.approved,
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const artifactBusinessAnalysis = url.pathname.match(
    /^\/api\/workflow-memory\/artifacts\/([^/]+)\/analyze-business-document$/,
  );
  if (artifactBusinessAnalysis && req.method === "POST") {
    const result = await analyzeBusinessDocument({
      artifactId: decodeURIComponent(artifactBusinessAnalysis[1]),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const businessClassificationConfirm = url.pathname.match(
    /^\/api\/workflow-memory\/business-document-classifications\/([^/]+)\/confirm$/,
  );
  if (businessClassificationConfirm && req.method === "POST") {
    const body = await readJson(req);
    const result = confirmBusinessDocumentClassification({
      classificationId: decodeURIComponent(businessClassificationConfirm[1]),
      expectedRevision: body?.expectedRevision,
      documentType: body?.documentType,
      fieldCorrections: body?.fieldCorrections,
      excludedFieldKeys: body?.excludedFieldKeys,
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const businessCaseCandidateReview = url.pathname.match(
    /^\/api\/workflow-memory\/business-case-candidates\/([^/]+)\/review$/,
  );
  if (businessCaseCandidateReview && req.method === "POST") {
    const body = await readJson(req);
    const result = reviewBusinessCaseCandidate({
      candidateId: decodeURIComponent(businessCaseCandidateReview[1]),
      expectedRevision: body?.expectedRevision,
      action: body?.action,
      artifactIds: body?.artifactIds,
      correctionReason: body?.correctionReason,
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const routineCandidateDraft = url.pathname.match(
    /^\/api\/workflow-memory\/business-routine-candidates\/([^/]+)\/create-draft$/,
  );
  if (routineCandidateDraft && req.method === "POST") {
    const result = createRoutineDraft({
      discoveryCandidateId: decodeURIComponent(routineCandidateDraft[1]),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const routineIssueMaterialization = url.pathname.match(
    /^\/api\/workflow-memory\/business-cases\/([^/]+)\/materialize-routine$/,
  );
  if (routineIssueMaterialization && req.method === "POST") {
    const body = await readJson(req);
    const result = materializeRoutineIssue({
      businessCaseId: decodeURIComponent(routineIssueMaterialization[1]),
      routineDefinitionId: body?.routineDefinitionId,
      triggerArtifactIds: body?.triggerArtifactIds,
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/routine-work-queue" && req.method === "GET") {
    const result = listRoutineWorkQueue({
      projectId: url.searchParams.get("projectId"),
      sourceId: url.searchParams.get("sourceId"),
      includeCompleted: url.searchParams.get("includeCompleted") === "1",
      limit: url.searchParams.get("limit"),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const routineWorkItem = url.pathname.match(
    /^\/api\/workflow-memory\/routine-work-items\/([^/]+)$/,
  );
  if (routineWorkItem && req.method === "GET") {
    const result = getRoutineWorkItemExecution({
      workItemId: decodeURIComponent(routineWorkItem[1]),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const routineWorkItemAction = url.pathname.match(
    /^\/api\/workflow-memory\/routine-work-items\/([^/]+)\/(start|cancel|resume)$/,
  );
  if (routineWorkItemAction && req.method === "POST") {
    const body = await readJson(req);
    const input = {
      workItemId: decodeURIComponent(routineWorkItemAction[1]),
      expectedRevision: body?.expectedRevision,
      idempotencyKey: body?.idempotencyKey,
    };
    const result = routineWorkItemAction[2] === "start"
      ? startRoutineWorkItem(input, actor)
      : routineWorkItemAction[2] === "resume"
        ? resumeRoutineRecovery(input, actor)
        : cancelRoutineWorkItem(input, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const routineStepAction = url.pathname.match(
    /^\/api\/workflow-memory\/routine-work-items\/([^/]+)\/steps\/([^/]+)\/(execute|quotation-inputs|ledger-binding|review-request|complete|retry|approval|condition)$/,
  );
  if (routineStepAction && req.method === "POST") {
    const body = await readJson(req);
    const input = {
      workItemId: decodeURIComponent(routineStepAction[1]),
      stepKey: decodeURIComponent(routineStepAction[2]),
      expectedRevision: body?.expectedRevision,
      idempotencyKey: body?.idempotencyKey,
    };
    let result;
    if (routineStepAction[3] === "execute") {
      result = executeRoutineStep(input, actor);
    } else if (routineStepAction[3] === "quotation-inputs") {
      result = confirmQuotationInputs({
        ...input,
        templateArtifactId: body?.templateArtifactId,
        answers: body?.answers,
        confirmed: body?.confirmed,
      }, actor);
    } else if (routineStepAction[3] === "ledger-binding") {
      result = bindRoutineLedger({
        ...input,
        ledgerDefinitionId: body?.ledgerDefinitionId,
      }, actor);
    } else if (routineStepAction[3] === "review-request") {
      result = requestRoutineStepReview(input, actor);
    } else if (routineStepAction[3] === "complete") {
      result = completeRoutineStep({
        ...input,
        succeeded: body?.succeeded,
        errorCode: body?.errorCode,
        outputRefs: body?.outputRefs,
      }, actor);
    } else if (routineStepAction[3] === "retry") {
      result = retryRoutineStep(input, actor);
    } else if (routineStepAction[3] === "approval") {
      result = decideRoutineApproval({ ...input, approved: body?.approved }, actor);
    } else {
      result = decideRoutineCondition({
        ...input,
        outcome: body?.outcome,
        triggerArtifactIds: body?.triggerArtifactIds,
      }, actor);
    }
    sendJson(res, result.status, result.body);
    return true;
  }

  const routineDefinitionAction = url.pathname.match(
    /^\/api\/workflow-memory\/business-routine-definitions\/([^/]+)\/(update|publish|new-version|disable)$/,
  );
  if (routineDefinitionAction && req.method === "POST") {
    const body = await readJson(req);
    const routineDefinitionId = decodeURIComponent(routineDefinitionAction[1]);
    const action = routineDefinitionAction[2];
    let result;
    if (action === "update") {
      result = updateBusinessRoutineDefinition({
        routineDefinitionId,
        expectedRevision: body?.expectedRevision,
        name: body?.name,
        description: body?.description,
        triggerDocumentTypes: body?.triggerDocumentTypes,
        steps: body?.steps,
      }, actor);
    } else if (action === "publish") {
      result = publishBusinessRoutineDefinition({
        routineDefinitionId,
        expectedRevision: body?.expectedRevision,
        confirmed: body?.confirmed,
      }, actor);
    } else if (action === "new-version") {
      result = createBusinessRoutineDefinitionVersion({
        routineDefinitionId,
        expectedRevision: body?.expectedRevision,
      }, actor);
    } else {
      result = transitionBusinessRoutineDefinition({
        routineDefinitionId,
        expectedRevision: body?.expectedRevision,
        action: "disable",
      }, actor);
    }
    sendJson(res, result.status, result.body);
    return true;
  }

  const artifactConfirm = url.pathname.match(
    /^\/api\/workflow-memory\/artifacts\/([^/]+)\/confirm$/,
  );
  if (artifactConfirm && req.method === "POST") {
    const body = await readJson(req);
    const result = confirmArtifact({
      artifactId: decodeURIComponent(artifactConfirm[1]),
      role: body?.role,
      expectedRevision: body?.expectedRevision,
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/ocr-readiness" && req.method === "GET") {
    const result = getOcrReadiness({}, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const artifactOcr = url.pathname.match(
    /^\/api\/workflow-memory\/artifacts\/([^/]+)\/ocr$/,
  );
  if (artifactOcr && req.method === "POST") {
    const body = await readJson(req);
    const result = await ocrArtifact({
      artifactId: decodeURIComponent(artifactOcr[1]),
      expectedRevision: body?.expectedRevision,
      confirmed: body?.confirmed,
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (artifactOcr && req.method === "GET") {
    const result = getOcrStatus({
      artifactId: decodeURIComponent(artifactOcr[1]),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (artifactOcr && req.method === "DELETE") {
    const result = cancelOcrArtifact({
      artifactId: decodeURIComponent(artifactOcr[1]),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const artifactRetryExtraction = url.pathname.match(
    /^\/api\/workflow-memory\/artifacts\/([^/]+)\/retry-extraction$/,
  );
  if (artifactRetryExtraction && req.method === "POST") {
    const body = await readJson(req);
    const result = await retryArtifactExtraction({
      artifactId: decodeURIComponent(artifactRetryExtraction[1]),
      expectedRevision: body?.expectedRevision,
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const artifactExclusion = url.pathname.match(
    /^\/api\/workflow-memory\/artifacts\/([^/]+)\/(exclude|include)$/,
  );
  if (artifactExclusion && req.method === "POST") {
    const body = await readJson(req);
    const result = setArtifactExclusion({
      artifactId: decodeURIComponent(artifactExclusion[1]),
      expectedRevision: body?.expectedRevision,
      excluded: artifactExclusion[2] === "exclude",
      reason: body?.reason,
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/cases") {
    let result;
    if (req.method === "GET") {
      result = listCases({ sourceId: url.searchParams.get("sourceId") }, actor);
    } else if (req.method === "POST") {
      result = createCase(await readJson(req), actor);
    } else {
      return false;
    }
    sendJson(res, result.status, result.body);
    return true;
  }

  const caseAction = url.pathname.match(
    /^\/api\/workflow-memory\/cases\/([^/]+)\/(archive|restore)$/,
  );
  if (caseAction && req.method === "POST") {
    const body = await readJson(req);
    const result = changeCaseState({
      caseId: decodeURIComponent(caseAction[1]),
      action: caseAction[2],
      expectedRevision: body?.expectedRevision,
      reason: body?.reason,
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/profiles") {
    let result;
    if (req.method === "GET") result = listProfiles(actor);
    else if (req.method === "POST") result = deriveProfile(await readJson(req), actor);
    else return false;
    sendJson(res, result.status, result.body);
    return true;
  }

  const profileRevision = url.pathname.match(
    /^\/api\/workflow-memory\/profiles\/([^/]+)\/revisions$/,
  );
  if (profileRevision && req.method === "POST") {
    const body = await readJson(req);
    const result = reviseProfile({
      profileId: decodeURIComponent(profileRevision[1]),
      expectedRevision: body?.expectedRevision,
      name: body?.name,
      state: body?.state,
      requirementSpec: body?.requirementSpec,
      outcomeSpec: body?.outcomeSpec,
      transformationMap: body?.transformationMap,
      taskRecipe: body?.taskRecipe,
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/profile-drafts" && req.method === "GET") {
    const result = listProfileDrafts({
      profileId: url.searchParams.get("profileId"),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const profileDraftCreate = url.pathname.match(
    /^\/api\/workflow-memory\/profiles\/([^/]+)\/drafts$/,
  );
  if (profileDraftCreate && req.method === "POST") {
    const body = await readJson(req);
    const result = createProfileDraft({
      profileId: decodeURIComponent(profileDraftCreate[1]),
      expectedRevision: body?.expectedRevision,
      name: body?.name,
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const profileDraftPublish = url.pathname.match(
    /^\/api\/workflow-memory\/profile-drafts\/([^/]+)\/publish$/,
  );
  if (profileDraftPublish && req.method === "POST") {
    const body = await readJson(req);
    const result = publishProfileDraft({
      draftId: decodeURIComponent(profileDraftPublish[1]),
      expectedRevision: body?.expectedRevision,
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/inbox" && req.method === "GET") {
    const result = listInbox({ sourceId: url.searchParams.get("sourceId") }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/retrieval-evaluation" && req.method === "GET") {
    const result = evaluateRetrieval({ sourceId: url.searchParams.get("sourceId") }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const inboxAction = url.pathname.match(
    /^\/api\/workflow-memory\/inbox\/([^/]+)\/(matches|inspect|similar-cases)$/,
  );
  if (inboxAction) {
    const artifactId = decodeURIComponent(inboxAction[1]);
    const action = inboxAction[2];
    let result;
    if (action === "matches" && req.method === "GET") {
      result = matchProfiles({ artifactId }, actor);
    } else if (action === "similar-cases" && req.method === "GET") {
      result = findSimilarCases({
        artifactId,
        limit: url.searchParams.get("limit"),
      }, actor);
    } else if (action === "inspect" && req.method === "GET") {
      result = inspectRequirement({
        artifactId,
        profileId: url.searchParams.get("profileId"),
      }, actor);
    } else {
      return false;
    }
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/workflow-memory/runs") {
    let result;
    if (req.method === "GET") result = listRuns(actor);
    else if (req.method === "POST") result = createRun(await readJson(req), actor);
    else return false;
    sendJson(res, result.status, result.body);
    return true;
  }

  const attemptCleanup = url.pathname.match(
    /^\/api\/workflow-memory\/runs\/([^/]+)\/attempts\/(\d+)\/cleanup$/,
  );
  if (attemptCleanup && req.method === "POST") {
    const body = await readJson(req);
    const result = await cleanupRunAttemptWorktree({
      runId: decodeURIComponent(attemptCleanup[1]),
      attemptNumber: Number(attemptCleanup[2]),
      expectedRevision: body?.expectedRevision,
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const attemptSelect = url.pathname.match(
    /^\/api\/workflow-memory\/runs\/([^/]+)\/attempts\/(\d+)\/select$/,
  );
  if (attemptSelect && req.method === "POST") {
    const body = await readJson(req);
    const result = selectRunAttempt({
      runId: decodeURIComponent(attemptSelect[1]),
      attemptNumber: Number(attemptSelect[2]),
      expectedRevision: body?.expectedRevision,
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const runAction = url.pathname.match(
    /^\/api\/workflow-memory\/runs\/([^/]+)\/(execute|cancel-execution|retry-execution|validate|feedback|publication-preview|publish)$/,
  );
  if (runAction && req.method === "POST") {
    const runId = decodeURIComponent(runAction[1]);
    const action = runAction[2];
    const body = await readJson(req);
    let result;
    if (action === "execute") {
      result = await executeRun({
        runId,
        expectedRevision: body?.expectedRevision,
        agentId: body?.agentId,
        baseBranch: body?.baseBranch,
      }, actor);
    } else if (action === "cancel-execution") {
      result = await cancelRunExecution({
        runId,
        expectedRevision: body?.expectedRevision,
      }, actor);
    } else if (action === "retry-execution") {
      result = await retryRunExecution({
        runId,
        expectedRevision: body?.expectedRevision,
      }, actor);
    } else if (action === "validate") {
      result = await validateRun({ runId, expectedRevision: body?.expectedRevision }, actor);
    } else if (action === "publication-preview") {
      result = await previewRunPublication({
        runId,
        expectedRevision: body?.expectedRevision,
      }, actor);
    } else if (action === "publish") {
      result = await publishRunOutputs({
        runId,
        expectedRevision: body?.expectedRevision,
        publicationId: body?.publicationId,
        confirmed: body?.confirmed,
      }, actor);
    } else {
      result = await recordRunFeedback({
        runId,
        expectedRevision: body?.expectedRevision,
        feedback: body?.feedback,
        note: body?.note,
        reasonCode: body?.reasonCode,
      }, actor);
    }
    sendJson(res, result.status, result.body);
    return true;
  }

  return false;
}
