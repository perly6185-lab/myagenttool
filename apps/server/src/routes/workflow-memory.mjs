/*
 * Requirement-to-delivery workflow memory routes (Epic #1547).
 *
 * The service owns tenancy, containment, revision, and lifecycle checks. Routes
 * only decode the bounded HTTP shape and preserve identical 404 behavior for a
 * missing or foreign resource.
 */
export async function handleWorkflowMemoryRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  actor,
  listSources,
  createSource,
  scanSource,
  cancelScan,
  revokeSource,
  deleteSourceLearning,
  listArtifacts,
  confirmArtifact,
  retryArtifactExtraction,
  setArtifactExclusion,
  indexSourceEmbeddings,
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

  if (url.pathname === "/api/workflow-memory/sources") {
    let result;
    if (req.method === "GET") result = listSources(actor);
    else if (req.method === "POST") result = createSource(await readJson(req), actor);
    else return false;
    sendJson(res, result.status, result.body);
    return true;
  }

  const sourceAction = url.pathname.match(
    /^\/api\/workflow-memory\/sources\/([^/]+)\/(scan|cancel-scan|revoke|delete-learning-data|pair-proposals|index-embeddings)$/,
  );
  if (sourceAction) {
    const sourceId = decodeURIComponent(sourceAction[1]);
    const action = sourceAction[2];
    let result;
    if (action === "scan" && req.method === "POST") {
      result = await scanSource({ sourceId }, actor);
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
    } else {
      return false;
    }
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
