import { createHmac, timingSafeEqual } from "node:crypto";

function externalIssuePolicyFor(state, projectId) {
  const policy = state?.projects?.find((project) => project.id === projectId)?.externalIssuePolicy ?? {};
  return {
    intakeEnabled: policy.intakeEnabled !== false,
    writebackEnabled: policy.writebackEnabled !== false,
    autoExecutionEnabled: policy.autoExecutionEnabled === true,
    emergencyStop: policy.emergencyStop === true,
  };
}

function externalOperationBlocked(policy, operation) {
  if (policy.emergencyStop) return "external_issue_emergency_stop";
  if (operation === "intake" && !policy.intakeEnabled) return "external_issue_intake_disabled";
  if (operation === "writeback" && !policy.writebackEnabled) return "external_issue_writeback_disabled";
  return null;
}

function externalBindingEmergencyStopped(state, provider, repository, issueNumber) {
  return (state?.workItems ?? []).some((item) =>
    (item.externalBindings ?? []).some((binding) =>
      (binding.provider === provider || binding.kind === `${provider}_issue`)
      && binding.number === Number(issueNumber)
      && (!repository || !binding.repository || binding.repository === repository))
    && externalIssuePolicyFor(state, item.projectId).emergencyStop);
}

export async function handleWorkItemRoutes({
  req, res, url, sendJson, readJson, actor, state,
  listWorkItems, getHomeWorkbench, listAttention, getWorkItem, createWorkItem, createWorkItemFromExternal, updateWorkItem, recordWorkItemProgress, bulkUpdateWorkItems, transitionWorkItem,
  listReportDrafts, getReportDraft, generateReportDraft, updateReportDraft, confirmReportDraft, discardReportDraft,
  listReportDeliveries, getReportDelivery, previewReportDelivery, sendReportDelivery,
  listActivity, listComments, createComment, updateComment, deleteComment,
  createWorktree, enqueueAutoRunUnderstanding, reserveAutoRun, failAutoRunUnderstanding,
  startAutoRun, beginExecution, abortExecution, recordExecutionBinding,
  createAutoRunBatch, listAutoRunBatches,
  previewAutoScheduler,
  promoteWorktreeToBase, promoteWorktreeToPullRequest, beginDelivery, failDelivery, completeDelivery,
  claimWorkItem, releaseWorkItemClaim, assignWorkItemToSelf,
  bindGithubIssue, syncGithubIssue,
  bindExternalIssue, syncExternalIssue, listExternalProviders, getExternalIssueFunnel,
  fetchExternalIssue, listExternalIssues, pushExternalIssue,
  fetchGithubIssue, pushGithubIssue,
  recordVerification,
  recordAssetOperation,
  startApplicationExecution,
  requestApplicationExecutionApproval,
  ingestGithubWebhook,
  replayGithubWebhook,
  recordGithubWebhookFailure,
  ingestExternalWebhook, replayExternalWebhook, recordExternalWebhookFailure,
  updateAttention,
  githubSyncDiagnostics,
  suggestWorkItemDraft,
  previewIntentTaskPlan,
  commitIntentTaskPlan,
  prepareLedgerPostingPlan,
  commitLedgerPostingPlan,
  getLedgerPostingPlan,
  createResultRepairTask,
  listMyTemplateRoutingFeedback,
  removeMyTemplateRoutingFeedback,
  previewMyTemplateDraft,
  listMyTemplateDrafts,
  reviewMyTemplateDraft,
  listSimilarMyTemplateWorkItems,
  createMyTemplateDraft,
  addMyTemplateLearningCase,
  activateMyTemplateDraft,
  listMyTemplateOutcomeFeedback,
  recordMyTemplateOutcomeFeedback,
  resumeMyTemplateGovernanceObservation,
  prepareExecutionContract,
  retryWorkItemAlert,
  inspectArticleImport,
  startArticleImport,
  listArticleImports,
  getArticleImport,
  cancelArticleImport,
  analyzeArticleImport,
  findSimilarArticleImports,
  createArticleDerivative,
  listArticleDerivatives,
  getArticleDerivative,
  addMaterials,
  removeMaterial,
  restoreMaterial,
  addContentReference,
  removeContentReference,
  captureDataContextSnapshot,
}) {
  if (url.pathname === "/api/work-item-auto-scheduler" && req.method === "GET") {
    sendJson(res, 200, previewAutoScheduler({ teamId: actor?.teamId ?? null }));
    return true;
  }
  if (url.pathname === "/api/work-item-auto-run-batches") {
    if (req.method === "GET") {
      const result = listAutoRunBatches({}, actor);
      sendJson(res, result.status, result.body);
      return true;
    }
    if (req.method === "POST") {
      const body = await readJson(req);
      const result = await createAutoRunBatch({
        workItemIds: body?.workItemIds,
        maxConcurrent: body?.maxConcurrent,
        agentId: body?.agentId,
        idempotencyKey: body?.idempotencyKey,
      }, actor);
      sendJson(res, result.status, result.body);
      return true;
    }
  }

  const externalWebhookMatch = url.pathname.match(/^\/api\/webhooks\/(gitlab|gitea)\/work-items$/);
  if (externalWebhookMatch && req.method === "POST") {
    const provider = externalWebhookMatch[1];
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const secret = String(process.env[`MYAGENTTOOL_${provider.toUpperCase()}_WEBHOOK_SECRET`] ?? "");
    const supplied = String(provider === "gitlab"
      ? req.headers["x-gitlab-token"]
      : req.headers["x-gitea-signature"] ?? "");
    const expected = provider === "gitlab"
      ? secret
      : secret ? createHmac("sha256", secret).update(raw).digest("hex") : "";
    const valid = secret && supplied.length === expected.length
      && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
    const deliveryId = req.headers[provider === "gitlab" ? "x-gitlab-event-uuid" : "x-gitea-delivery"];
    const event = req.headers[provider === "gitlab" ? "x-gitlab-event" : "x-gitea-event"];
    if (!valid) {
      recordExternalWebhookFailure({ provider, deliveryId, event, reason: "invalid_signature" });
      sendJson(res, 401, { error: "invalid_external_webhook_signature", provider });
      return true;
    }
    let payload;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      recordExternalWebhookFailure({ provider, deliveryId, event, reason: "invalid_json" });
      sendJson(res, 400, { error: "invalid_json" });
      return true;
    }
    const issue = provider === "gitlab" ? payload.object_attributes : payload.issue;
    const repository = provider === "gitlab"
      ? payload.project?.path_with_namespace
      : payload.repository?.full_name;
    const snapshot = issue ? {
      number: issue.iid ?? issue.number,
      title: issue.title,
      body: issue.description ?? issue.body ?? "",
      state: issue.state === "closed" ? "closed" : "open",
      labels: (issue.labels ?? payload.labels ?? []).map((label) => label?.title ?? label?.name ?? label),
      milestone: issue.milestone?.title ?? "",
      assigneeIds: (issue.assignees ?? (issue.assignee ? [issue.assignee] : []))
        .map((assignee) => assignee?.username ?? assignee?.login).filter(Boolean),
      url: issue.url ?? issue.web_url ?? issue.html_url,
      repository,
      updatedAt: issue.updated_at,
    } : null;
    if (snapshot && externalBindingEmergencyStopped(state, provider, repository, snapshot.number)) {
      sendJson(res, 202, { accepted: true, ignored: true, reason: "external_issue_emergency_stop", provider });
      return true;
    }
    const result = ingestExternalWebhook({ provider, deliveryId, event, snapshot });
    sendJson(res, result.status, result.body);
    return true;
  }
  if (url.pathname === "/api/webhooks/github/work-items" && req.method === "POST") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const secret = String(process.env.MYAGENTTOOL_GITHUB_WEBHOOK_SECRET ?? "");
    const supplied = String(req.headers["x-hub-signature-256"] ?? "");
    const expected = secret ? `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}` : "";
    const valid = secret && supplied.length === expected.length
      && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
    if (!valid) {
      recordGithubWebhookFailure({
        deliveryId: req.headers["x-github-delivery"],
        event: req.headers["x-github-event"],
        reason: "invalid_signature",
      });
      sendJson(res, 401, { error: "invalid_github_webhook_signature" });
      return true;
    }
    let payload;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      recordGithubWebhookFailure({
        deliveryId: req.headers["x-github-delivery"],
        event: req.headers["x-github-event"],
        reason: "invalid_json",
      });
      sendJson(res, 400, { error: "invalid_json" });
      return true;
    }
    if (externalBindingEmergencyStopped(state, "github", payload.repository?.full_name, payload.issue?.number)) {
      sendJson(res, 202, { accepted: true, ignored: true, reason: "external_issue_emergency_stop", provider: "github" });
      return true;
    }
    const result = ingestGithubWebhook({
      deliveryId: req.headers["x-github-delivery"],
      event: req.headers["x-github-event"],
      payload,
    });
    sendJson(res, result.status, result.body);
    return true;
  }
  if (!url.pathname.startsWith("/api/work-items")) return false;

  if (url.pathname === "/api/work-items/article-imports/inspect" && req.method === "POST") {
    const result = await inspectArticleImport(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const articleAnalysisMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/article-imports\/([^/]+)\/analysis$/);
  if (articleAnalysisMatch && req.method === "POST") {
    const result = await analyzeArticleImport({
      workItemId: decodeURIComponent(articleAnalysisMatch[1]),
      jobId: decodeURIComponent(articleAnalysisMatch[2]),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const similarArticlesMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/article-imports\/([^/]+)\/similar$/);
  if (similarArticlesMatch && req.method === "GET") {
    const result = await findSimilarArticleImports({
      workItemId: decodeURIComponent(similarArticlesMatch[1]),
      jobId: decodeURIComponent(similarArticlesMatch[2]),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const articleDerivativesMatch = url.pathname.match(
    /^\/api\/work-items\/([^/]+)\/article-imports\/([^/]+)\/derivatives(?:\/([^/]+))?$/,
  );
  if (articleDerivativesMatch) {
    const workItemId = decodeURIComponent(articleDerivativesMatch[1]);
    const jobId = decodeURIComponent(articleDerivativesMatch[2]);
    const derivativeId = articleDerivativesMatch[3]
      ? decodeURIComponent(articleDerivativesMatch[3])
      : null;
    let result;
    if (req.method === "POST" && !derivativeId) {
      result = await createArticleDerivative({
        workItemId,
        jobId,
        ...(await readJson(req)),
      }, actor);
    } else if (req.method === "GET" && !derivativeId) {
      result = await listArticleDerivatives({ workItemId, jobId }, actor);
    } else if (req.method === "GET" && derivativeId) {
      result = await getArticleDerivative({ workItemId, jobId, derivativeId }, actor);
    } else {
      return false;
    }
    sendJson(res, result.status, result.body);
    return true;
  }

  const articleImportMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/article-imports(?:\/([^/]+))?$/);
  if (articleImportMatch) {
    const workItemId = decodeURIComponent(articleImportMatch[1]);
    const jobId = articleImportMatch[2] ? decodeURIComponent(articleImportMatch[2]) : null;
    let result;
    if (req.method === "POST" && !jobId) {
      result = startArticleImport({ workItemId, ...(await readJson(req)) }, actor);
    } else if (req.method === "GET" && !jobId) {
      result = listArticleImports({ workItemId }, actor);
    } else if (req.method === "GET" && jobId) {
      result = getArticleImport({ workItemId, jobId }, actor);
    } else if (req.method === "DELETE" && jobId) {
      result = cancelArticleImport({ workItemId, jobId }, actor);
    } else {
      return false;
    }
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/work-items/providers" && req.method === "GET") {
    const result = listExternalProviders(actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/work-items/assist/draft" && req.method === "POST") {
    const result = suggestWorkItemDraft(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/work-items/assist/intent-plan" && req.method === "POST") {
    const result = previewIntentTaskPlan(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/work-items/assist/intent-plan/commit" && req.method === "POST") {
    const result = commitIntentTaskPlan(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/work-items/my-template-learning" && req.method === "GET") {
    const result = listMyTemplateRoutingFeedback({
      projectId: url.searchParams.get("projectId"),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const myTemplateLearningMatch = url.pathname.match(/^\/api\/work-items\/my-template-learning\/([^/]+)$/);
  if (myTemplateLearningMatch && req.method === "DELETE") {
    const result = removeMyTemplateRoutingFeedback({
      feedbackId: decodeURIComponent(myTemplateLearningMatch[1]),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/work-items/my-template-outcomes" && req.method === "GET") {
    const result = listMyTemplateOutcomeFeedback({
      projectId: url.searchParams.get("projectId"),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/work-items/my-template-drafts" && req.method === "GET") {
    const result = listMyTemplateDrafts({ projectId: url.searchParams.get("projectId") }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const similarMyTemplateWorkItemsMatch = url.pathname.match(
    /^\/api\/work-items\/my-template-drafts\/([^/]+)\/similar-work-items$/,
  );
  if (similarMyTemplateWorkItemsMatch && req.method === "GET") {
    const result = listSimilarMyTemplateWorkItems({
      draftId: decodeURIComponent(similarMyTemplateWorkItemsMatch[1]),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const myTemplateDraftReviewMatch = url.pathname.match(
    /^\/api\/work-items\/my-template-drafts\/([^/]+)\/review$/,
  );
  if (myTemplateDraftReviewMatch && req.method === "GET") {
    const result = reviewMyTemplateDraft({
      draftId: decodeURIComponent(myTemplateDraftReviewMatch[1]),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const myTemplateDraftActivationMatch = url.pathname.match(
    /^\/api\/work-items\/my-template-drafts\/([^/]+)\/activate$/,
  );
  if (myTemplateDraftActivationMatch && req.method === "POST") {
    const result = activateMyTemplateDraft({
      draftId: decodeURIComponent(myTemplateDraftActivationMatch[1]),
      ...(await readJson(req)),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const myTemplateLearningCasesMatch = url.pathname.match(
    /^\/api\/work-items\/my-template-drafts\/([^/]+)\/cases$/,
  );
  if (myTemplateLearningCasesMatch && req.method === "POST") {
    const result = addMyTemplateLearningCase({
      draftId: decodeURIComponent(myTemplateLearningCasesMatch[1]),
      ...(await readJson(req)),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const myTemplateDraftMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/my-template-draft$/);
  if (myTemplateDraftMatch && req.method === "GET") {
    const result = previewMyTemplateDraft({ workItemId: decodeURIComponent(myTemplateDraftMatch[1]) }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (myTemplateDraftMatch && req.method === "POST") {
    const result = createMyTemplateDraft({
      workItemId: decodeURIComponent(myTemplateDraftMatch[1]),
      ...(await readJson(req)),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const myTemplateGovernanceResumeMatch = url.pathname.match(
    /^\/api\/work-items\/my-template-governance\/([^/]+)\/resume-observation$/,
  );
  if (myTemplateGovernanceResumeMatch && req.method === "POST") {
    const result = resumeMyTemplateGovernanceObservation({
      familyId: decodeURIComponent(myTemplateGovernanceResumeMatch[1]),
      ...(await readJson(req)),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const myTemplateOutcomeMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/my-template-outcome-feedback$/);
  if (myTemplateOutcomeMatch && req.method === "POST") {
    const result = recordMyTemplateOutcomeFeedback({
      workItemId: decodeURIComponent(myTemplateOutcomeMatch[1]),
      ...(await readJson(req)),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/work-items/attention" && req.method === "GET") {
    const result = listAttention(Object.fromEntries(url.searchParams), actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (url.pathname === "/api/work-items/github/diagnostics" && req.method === "GET") {
    const result = githubSyncDiagnostics(actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  const replayMatch = url.pathname.match(/^\/api\/work-items\/github\/deliveries\/([^/]+)\/replay$/);
  if (replayMatch && req.method === "POST") {
    const result = replayGithubWebhook({ deliveryId: decodeURIComponent(replayMatch[1]) }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  const externalReplayMatch = url.pathname.match(/^\/api\/work-items\/(gitlab|gitea)\/deliveries\/([^/]+)\/replay$/);
  if (externalReplayMatch && req.method === "POST") {
    const result = replayExternalWebhook({
      provider: externalReplayMatch[1], deliveryId: decodeURIComponent(externalReplayMatch[2]),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (url.pathname === "/api/work-items/attention/actions" && req.method === "POST") {
    const result = updateAttention(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/work-items/home-workbench" && req.method === "GET") {
    const result = getHomeWorkbench(Object.fromEntries(url.searchParams), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/work-items/bulk" && req.method === "PATCH") {
    const result = bulkUpdateWorkItems(await readJson(req), actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const reportDeliveryMatch = url.pathname.match(
    /^\/api\/work-items\/([^/]+)\/report-drafts\/([^/]+)\/deliveries(?:\/([^/]+)(?:\/(send))?)?$/,
  );
  if (reportDeliveryMatch) {
    const workItemId = decodeURIComponent(reportDeliveryMatch[1]);
    const draftId = decodeURIComponent(reportDeliveryMatch[2]);
    const deliveryId = reportDeliveryMatch[3] ? decodeURIComponent(reportDeliveryMatch[3]) : null;
    const command = reportDeliveryMatch[4] ?? null;
    let result;
    if (req.method === "GET" && !deliveryId) {
      result = listReportDeliveries({ workItemId, draftId }, actor);
    } else if (req.method === "POST" && !deliveryId) {
      result = previewReportDelivery({ workItemId, draftId, ...(await readJson(req)) }, actor);
    } else if (req.method === "GET" && deliveryId && !command) {
      result = getReportDelivery({ workItemId, draftId, deliveryId }, actor);
    } else if (req.method === "POST" && deliveryId && command === "send") {
      result = sendReportDelivery({ workItemId, draftId, deliveryId, ...(await readJson(req)) }, actor);
    } else {
      result = { status: 405, body: { error: "method_not_allowed" } };
    }
    sendJson(res, result.status, result.body);
    return true;
  }

  const reportDraftMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/report-drafts(?:\/([^/]+)(?:\/(confirm|discard))?)?$/);
  if (reportDraftMatch) {
    const workItemId = decodeURIComponent(reportDraftMatch[1]);
    const draftId = reportDraftMatch[2] ? decodeURIComponent(reportDraftMatch[2]) : null;
    const command = reportDraftMatch[3] ?? null;
    let result;
    if (req.method === "GET" && !draftId) {
      result = listReportDrafts({ workItemId }, actor);
    } else if (req.method === "POST" && !draftId) {
      result = generateReportDraft({ workItemId, ...(await readJson(req)) }, actor);
    } else if (req.method === "GET" && draftId && !command) {
      result = getReportDraft({ workItemId, draftId }, actor);
    } else if (req.method === "PATCH" && draftId && !command) {
      result = updateReportDraft({ workItemId, draftId, ...(await readJson(req)) }, actor);
    } else if (req.method === "POST" && draftId && command === "confirm") {
      result = confirmReportDraft({ workItemId, draftId, ...(await readJson(req)) }, actor);
    } else if (req.method === "POST" && draftId && command === "discard") {
      result = discardReportDraft({ workItemId, draftId, ...(await readJson(req)) }, actor);
    } else {
      return false;
    }
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/work-items") {
    if (req.method === "GET") {
      const result = listWorkItems(Object.fromEntries(url.searchParams), actor);
      sendJson(res, result.status, result.body);
      return true;
    }
    if (req.method === "POST") {
      const result = createWorkItem(await readJson(req), actor);
      sendJson(res, result.status, result.body);
      return true;
    }
    return false;
  }

  if (url.pathname === "/api/work-items/external-funnel" && req.method === "GET") {
    const result = getExternalIssueFunnel({ projectId: url.searchParams.get("projectId") ?? undefined }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/work-items/external-issues" && req.method === "GET") {
    const provider = String(url.searchParams.get("provider") ?? "").toLowerCase();
    const projectId = String(url.searchParams.get("projectId") ?? "");
    const repository = String(url.searchParams.get("repository") ?? "").trim();
    const project = state?.projects?.find((candidate) => candidate.id === projectId
      && (actor?.teamId == null || (candidate.ownerTeamId ?? "team_local") === actor.teamId));
    if (!project) {
      sendJson(res, 404, { error: "project_not_found" });
      return true;
    }
    if (!["gitlab", "gitea"].includes(provider) || !repository) {
      sendJson(res, 400, { error: "invalid_provider_repository_or_issue", provider });
      return true;
    }
    const intakeBlock = externalOperationBlocked(externalIssuePolicyFor(state, projectId), "intake");
    if (intakeBlock) {
      sendJson(res, 409, { error: intakeBlock, provider, projectId });
      return true;
    }
    const result = await listExternalIssues({
      provider,
      repository,
      query: url.searchParams.get("q") ?? "",
      page: Number(url.searchParams.get("page") ?? 1),
      perPage: Number(url.searchParams.get("limit") ?? 20),
    });
    sendJson(res, result.ok ? 200 : result.error === "provider_credentials_not_configured" ? 503 : 502, result);
    return true;
  }

  // External issues enter the development system through this intake path.
  // The endpoint snapshots the remote issue first, creates the Local Issue
  // with that content, and records the provider/repository/number relation in
  // the same service boundary. It never starts a worktree or an Agent.
  if (url.pathname === "/api/work-items/from-external" && req.method === "POST") {
    const body = await readJson(req);
    const provider = String(body?.provider ?? "").toLowerCase();
    const projectId = String(body?.projectId ?? "");
    const issueNumber = Number(body?.issueNumber ?? body?.remote?.number);
    if (!["github", "gitlab", "gitea"].includes(provider)) {
      sendJson(res, 400, { error: "unsupported_external_provider", provider });
      return true;
    }
    if (!projectId) {
      sendJson(res, 400, { error: "invalid_external_issue_project", provider });
      return true;
    }
    const intakeBlock = externalOperationBlocked(externalIssuePolicyFor(state, projectId), "intake");
    if (intakeBlock) {
      sendJson(res, 409, { error: intakeBlock, provider, projectId });
      return true;
    }
    if (!Number.isInteger(issueNumber) || issueNumber < 1) {
      sendJson(res, 400, { error: "invalid_external_issue_number", provider });
      return true;
    }
    if (!body?.remote && provider !== "github" && !String(body?.repository ?? "").trim()) {
      sendJson(res, 400, { error: "invalid_provider_repository_or_issue", provider });
      return true;
    }
    const remote = body?.remote ?? (provider === "github"
      ? await fetchGithubIssue({ projectId, issueNumber })
      : await fetchExternalIssue({ provider, repository: body?.repository, issueNumber }));
    if (!remote || remote.ok === false) {
      sendJson(res, remote?.error === "provider_credentials_not_configured" ? 503 : 502, {
        error: remote?.error ?? "external_issue_fetch_failed", provider,
      });
      return true;
    }
    const result = createWorkItemFromExternal({
      ...body,
      projectId,
      provider,
      remote,
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const dataContextMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/data-context$/);
  if (dataContextMatch && (req.method === "GET" || req.method === "POST")) {
    const workItemId = decodeURIComponent(dataContextMatch[1]);
    const result = req.method === "GET"
      ? getWorkItem({ workItemId }, actor)
      : captureDataContextSnapshot({ workItemId, ...(await readJson(req)) }, actor);
    if (req.method === "GET" && result.ok) {
      sendJson(res, result.status, { dataContext: result.body.workItem.dataContext });
    } else {
      sendJson(res, result.status, result.body);
    }
    return true;
  }

  const resultRepairMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/result-repair$/);
  if (resultRepairMatch && req.method === "POST") {
    const result = createResultRepairTask({
      workItemId: decodeURIComponent(resultRepairMatch[1]),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const restoreMaterialMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/materials\/([^/]+)\/restore$/);
  if (restoreMaterialMatch && req.method === "POST") {
    const result = restoreMaterial({
      workItemId: decodeURIComponent(restoreMaterialMatch[1]),
      assetId: decodeURIComponent(restoreMaterialMatch[2]),
      ...(await readJson(req)),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const materialsMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/materials(?:\/([^/]+))?$/);
  if (materialsMatch && req.method === "POST" && !materialsMatch[2]) {
    const result = addMaterials({ workItemId: decodeURIComponent(materialsMatch[1]), ...(await readJson(req)) }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const contentReferenceMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/content-references(?:\/([^/]+))?$/);
  if (contentReferenceMatch && req.method === "POST" && !contentReferenceMatch[2]) {
    const result = await addContentReference({
      workItemId: decodeURIComponent(contentReferenceMatch[1]),
      ...(await readJson(req)),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (contentReferenceMatch && req.method === "DELETE" && contentReferenceMatch[2]) {
    const result = removeContentReference({
      workItemId: decodeURIComponent(contentReferenceMatch[1]),
      referenceId: decodeURIComponent(contentReferenceMatch[2]),
      ...(await readJson(req)),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (materialsMatch && req.method === "DELETE" && materialsMatch[2]) {
    const result = removeMaterial({
      workItemId: decodeURIComponent(materialsMatch[1]),
      assetId: decodeURIComponent(materialsMatch[2]),
      ...(await readJson(req)),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const claimMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/(claim|release-claim|assign-to-me)$/);
  if (claimMatch && req.method === "POST") {
    const workItemId = decodeURIComponent(claimMatch[1]);
    const body = await readJson(req);
    const result = claimMatch[2] === "claim"
      ? claimWorkItem({ workItemId, ...body }, actor)
      : claimMatch[2] === "assign-to-me"
        ? assignWorkItemToSelf({ workItemId, ...body }, actor)
        : releaseWorkItemClaim({ workItemId, ...body }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const alertRetryMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/alerts\/([^/]+)\/retry$/);
  if (alertRetryMatch && req.method === "POST") {
    const result = retryWorkItemAlert({
      workItemId: decodeURIComponent(alertRetryMatch[1]),
      alertId: decodeURIComponent(alertRetryMatch[2]),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const externalBindingsMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/external-bindings$/);
  if (externalBindingsMatch && req.method === "POST") {
    const workItemId = decodeURIComponent(externalBindingsMatch[1]);
    const detail = getWorkItem({ workItemId }, actor);
    if (!detail.ok) {
      sendJson(res, detail.status, detail.body);
      return true;
    }
    const intakeBlock = externalOperationBlocked(externalIssuePolicyFor(state, detail.body.workItem.projectId), "intake");
    if (intakeBlock) {
      sendJson(res, 409, { error: intakeBlock, projectId: detail.body.workItem.projectId });
      return true;
    }
    const body = await readJson(req);
    const provider = String(body?.provider ?? "").toLowerCase();
    const remote = body?.remote ?? (provider && body?.repository && body?.issueNumber
      ? await fetchExternalIssue({ provider, repository: body.repository, issueNumber: body.issueNumber })
      : null);
    if (!remote || remote.ok === false) {
      sendJson(res, remote?.error === "provider_credentials_not_configured" ? 503 : 502, {
        error: remote?.error ?? "external_issue_fetch_failed", provider,
      });
      return true;
    }
    const result = bindExternalIssue({
      workItemId,
      ...body, remote,
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  const externalSyncMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/external-bindings\/([^/]+)\/sync$/);
  if (externalSyncMatch && req.method === "POST") {
    const body = await readJson(req);
    const provider = decodeURIComponent(externalSyncMatch[2]).toLowerCase();
    const detail = getWorkItem({ workItemId: decodeURIComponent(externalSyncMatch[1]) }, actor);
    if (!detail.ok) {
      sendJson(res, detail.status, detail.body);
      return true;
    }
    const externalPolicy = externalIssuePolicyFor(state, detail.body.workItem.projectId);
    const syncOperation = ["push", "resolve_local"].includes(body?.direction) ? "writeback" : "sync";
    const syncBlock = externalOperationBlocked(externalPolicy, syncOperation);
    if (syncBlock) {
      sendJson(res, 409, { error: syncBlock, provider, projectId: detail.body.workItem.projectId });
      return true;
    }
    const binding = detail.body.workItem.externalBindings?.find((candidate) => candidate.provider === provider || candidate.kind === `${provider}_issue`);
    let remote = body?.remote;
    if (!remote && binding && ["pull", "push", "resolve_local"].includes(body?.direction)) {
      const fetched = await fetchExternalIssue({ provider, repository: binding.repository, issueNumber: binding.number });
      if (fetched?.ok === false) {
        sendJson(res, fetched.error === "provider_credentials_not_configured" ? 503 : 502, { error: fetched.error, provider });
        return true;
      }
      remote = fetched;
    }
    if (body?.direction === "pull" || body?.direction === "resolve_remote") {
      const result = syncExternalIssue({
        workItemId: decodeURIComponent(externalSyncMatch[1]), provider, ...body, remote,
      }, actor);
      sendJson(res, result.status, result.body);
      return true;
    }
    const prepared = body?.direction === "resolve_local"
      ? syncExternalIssue({
        workItemId: decodeURIComponent(externalSyncMatch[1]), provider,
        expectedRevision: body?.expectedRevision, direction: "resolve_local",
      }, actor)
      : (() => {
        const reconciled = syncExternalIssue({
          workItemId: decodeURIComponent(externalSyncMatch[1]), provider,
          expectedRevision: body?.expectedRevision, direction: "pull", remote,
        }, actor);
        return reconciled.ok ? syncExternalIssue({
        workItemId: decodeURIComponent(externalSyncMatch[1]), provider,
        expectedRevision: reconciled.body.workItem.revision, direction: body?.direction,
        }, actor) : reconciled;
      })();
    if (!prepared.ok || prepared.body.action !== "push_required") {
      sendJson(res, prepared.status, prepared.body);
      return true;
    }
    const pushed = await pushExternalIssue({
      provider, repository: binding.repository, issueNumber: binding.number, payload: prepared.body.payload,
    });
    if (!pushed.ok) {
      sendJson(res, pushed.error === "provider_credentials_not_configured" ? 503 : 502, { error: pushed.error, provider });
      return true;
    }
    const result = syncExternalIssue({
      workItemId: decodeURIComponent(externalSyncMatch[1]),
      provider, expectedRevision: prepared.body.workItem.revision, direction: "push",
      pushedRemoteUpdatedAt: pushed.issue.updatedAt,
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const githubMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/github\/(link|sync)$/);
  if (githubMatch && req.method === "POST") {
    const workItemId = decodeURIComponent(githubMatch[1]);
    const body = await readJson(req);
    const detail = getWorkItem({ workItemId }, actor);
    if (!detail.ok) {
      sendJson(res, detail.status, detail.body);
      return true;
    }
    const item = detail.body.workItem;
    const githubOperation = githubMatch[2] === "link"
      ? "intake"
      : ["push", "resolve_local"].includes(body?.direction) ? "writeback" : "sync";
    const githubBlock = externalOperationBlocked(externalIssuePolicyFor(state, item.projectId), githubOperation);
    if (githubBlock) {
      sendJson(res, 409, { error: githubBlock, provider: "github", projectId: item.projectId });
      return true;
    }
    if (githubMatch[2] === "link") {
      const issueNumber = Number(body?.issueNumber ?? body?.remote?.number);
      const remote = body?.remote ?? await fetchGithubIssue({ projectId: item.projectId, issueNumber });
      const result = remote
        ? bindGithubIssue({
          workItemId,
          expectedRevision: body?.expectedRevision,
          relation: body?.relation,
          isPrimary: body?.isPrimary,
          syncPolicy: body?.syncPolicy,
          remote,
        }, actor)
        : { status: 502, body: { error: "github_issue_fetch_failed" } };
      sendJson(res, result.status, result.body);
      return true;
    }
    const binding = item.externalBindings?.find((candidate) => candidate.kind === "github_issue");
    if (!binding) {
      sendJson(res, 409, { error: "github_issue_not_bound" });
      return true;
    }
    let result;
    if (body?.direction === "pull") {
      const remote = body?.remote ?? await fetchGithubIssue({ projectId: item.projectId, issueNumber: binding.number });
      result = remote
        ? syncGithubIssue({ workItemId, expectedRevision: body?.expectedRevision, direction: "pull", remote }, actor)
        : { status: 502, body: { error: "github_issue_fetch_failed" } };
    } else if (["push", "resolve_local"].includes(body?.direction)) {
      const remote = body?.remote ?? await fetchGithubIssue({ projectId: item.projectId, issueNumber: binding.number });
      if (!remote) {
        result = { status: 502, body: { error: "github_issue_fetch_failed" } };
      } else {
        const reconciled = body.direction === "push"
          ? syncGithubIssue({
            workItemId, expectedRevision: body?.expectedRevision, direction: "pull", remote,
          }, actor)
          : null;
        const prepared = reconciled && !reconciled.ok
          ? reconciled
          : syncGithubIssue({
            workItemId,
            expectedRevision: reconciled?.body.workItem?.revision ?? body?.expectedRevision,
            direction: body.direction,
          }, actor);
        if (!prepared.ok || prepared.body.action !== "push_required") {
          result = prepared;
        } else {
          const pushed = await pushGithubIssue({
            projectId: item.projectId, issueNumber: binding.number, payload: prepared.body.payload, remote,
          });
          if (!pushed.ok) {
            result = { status: 502, body: { error: "github_issue_push_failed", message: pushed.error } };
          } else {
            const confirmed = await fetchGithubIssue({ projectId: item.projectId, issueNumber: binding.number });
            result = confirmed
              ? syncGithubIssue({
                workItemId,
                expectedRevision: prepared.body.workItem?.revision ?? body?.expectedRevision,
                direction: "push",
                pushedRemoteUpdatedAt: confirmed.updatedAt,
              }, actor)
              : { status: 502, body: { error: "github_issue_confirmation_failed" } };
          }
        }
      }
    } else {
      result = syncGithubIssue({ workItemId, ...body }, actor);
    }
    sendJson(res, result.status, result.body);
    return true;
  }

  const verificationMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/verifications$/);
  if (verificationMatch && req.method === "POST") {
    const result = recordVerification({
      workItemId: decodeURIComponent(verificationMatch[1]), ...(await readJson(req)),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const assetOperationMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/asset-operations$/);
  if (assetOperationMatch && req.method === "POST") {
    const result = recordAssetOperation({
      workItemId: decodeURIComponent(assetOperationMatch[1]), ...(await readJson(req)),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const applicationExecutionMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/application-invocations$/);
  if (applicationExecutionMatch && req.method === "POST") {
    const result = startApplicationExecution({
      workItemId: decodeURIComponent(applicationExecutionMatch[1]), ...(await readJson(req)),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const applicationApprovalMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/application-approval$/);
  if (applicationApprovalMatch && req.method === "POST") {
    const result = requestApplicationExecutionApproval({
      workItemId: decodeURIComponent(applicationApprovalMatch[1]), ...(await readJson(req)),
    }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const deliveryMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/delivery\/(local|pull-request)$/);
  if (deliveryMatch && req.method === "POST") {
    const workItemId = decodeURIComponent(deliveryMatch[1]);
    const detail = getWorkItem({ workItemId }, actor);
    if (!detail.ok) {
      sendJson(res, detail.status, detail.body);
      return true;
    }
    const body = await readJson(req);
    const item = detail.body.workItem;
    if (!Number.isInteger(body?.expectedRevision)) {
      sendJson(res, 400, { error: "expected_revision_required" });
      return true;
    }
    if (body.expectedRevision !== item.revision) {
      sendJson(res, 409, { error: "work_item_revision_conflict", currentRevision: item.revision });
      return true;
    }
    if (!item.completionGate?.ready) {
      sendJson(res, 409, { error: "work_item_acceptance_incomplete", ...item.completionGate });
      return true;
    }
    if (!item.executionContractGate?.ready) {
      sendJson(res, 409, { error: "work_item_execution_contract_required", ...item.executionContractGate });
      return true;
    }
    const autoRun = detail.body.observability?.latestRun ?? null;
    const worktreeId = autoRun?.localDelivery?.worktreeId ?? null;
    if (!worktreeId || autoRun?.status !== "done" || autoRun.localDelivery?.deliveredAt) {
      sendJson(res, 409, { error: "work_item_delivery_not_ready" });
      return true;
    }
    const mode = deliveryMatch[2] === "local" ? "local_merge" : "pull_request";
    const admission = beginDelivery({
      workItemId,
      expectedRevision: body.expectedRevision,
      mode,
      autoRunId: autoRun.id,
    }, actor);
    if (!admission.ok) {
      sendJson(res, admission.status, admission.body);
      return true;
    }
    const operationId = admission.body.operation.id;
    try {
      const result = mode === "local_merge"
        ? await promoteWorktreeToBase(worktreeId)
        : await promoteWorktreeToPullRequest(worktreeId, {
          title: item.title,
          body: `Delivers ${item.localRef}.\n\n${item.body ?? ""}`.trim(),
          base: body?.baseBranch,
        });
      const completed = completeDelivery({
        workItemId,
        mode,
        autoRunId: autoRun.id,
        operationId,
        result,
      }, actor);
      if (!completed.ok) {
        failDelivery({ workItemId, operationId, error: completed.body?.error ?? "delivery_commit_failed" }, actor);
      }
      sendJson(res, completed.status, completed.body);
    } catch (error) {
      failDelivery({
        workItemId,
        operationId,
        error: error instanceof Error ? error.message : String(error),
      }, actor);
      sendJson(res, 409, {
        error: "work_item_delivery_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  const executionMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/(worktrees|auto-runs)$/);
  if (executionMatch && req.method === "POST") {
    const workItemId = decodeURIComponent(executionMatch[1]);
    const detail = getWorkItem({ workItemId }, actor);
    if (!detail.ok) {
      sendJson(res, detail.status, detail.body);
      return true;
    }
    let item = detail.body.workItem;
    const body = await readJson(req);
    const kind = executionMatch[2] === "worktrees" ? "worktree" : "auto_run";
    if (kind === "auto_run" && (!item.plannedDate || item.waitingOn !== "ai")) {
      const timezoneOffset = Number(body?.timezoneOffset ?? 0);
      if (!Number.isInteger(timezoneOffset) || timezoneOffset < -840 || timezoneOffset > 840) {
        sendJson(res, 400, { error: "invalid_terminal_timezone_offset" });
        return true;
      }
      const localToday = new Date(Date.now() - timezoneOffset * 60_000).toISOString().slice(0, 10);
      const scheduled = updateWorkItem({
        workItemId,
        expectedRevision: item.revision,
        ...(!item.plannedDate ? { plannedDate: localToday } : {}),
        ...(item.waitingOn !== "ai" ? { waitingOn: "ai" } : {}),
      }, actor);
      if (!scheduled.ok) {
        sendJson(res, scheduled.status, scheduled.body);
        return true;
      }
      item = scheduled.body.workItem;
    }
    const admission = beginExecution({
      workItemId,
      kind,
      agentId: body?.agentId,
    }, actor);
    if (!admission.ok) {
      sendJson(res, admission.status, admission.body);
      return true;
    }
    const operationId = admission.body.operation.id;
    const slug = String(item.title ?? "work").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "work";
    const name = body?.name ?? `local-${item.localNumber}-${slug}${kind === "auto_run" ? `-autorun-${Number(item.revision) || 0}` : ""}`;
    const link = { type: "local_issue", number: item.localNumber, title: item.title, url: null, state: item.state };
    let reservedAutoRun = null;
    let executionBindingRecorded = false;
    try {
      if (executionMatch[2] === "worktrees") {
        const result = createWorktree({
          projectId: item.projectId, name, branchName: body?.branchName ?? name,
          baseBranch: body?.baseBranch, agentId: body?.agentId, link,
        });
        const recorded = recordExecutionBinding({
          workItemId, kind: "worktree", targetId: result.worktree.id, worktreeId: result.worktree.id,
          operationId,
        }, actor);
        if (!recorded.ok) throw new Error(recorded.body?.error ?? "work_item_execution_binding_failed");
        sendJson(res, 201, result);
        return true;
      }
      // Persist the Run before drafting or checking its execution contract. At
      // this point there is deliberately no worktree and therefore no writable
      // execution environment.
      const reserved = await reserveAutoRun({
        projectId: item.projectId, link, localIssueId: item.id, name, baseBranch: body?.baseBranch,
        agentId: body?.agentId, actor, issueBody: item.body,
        executionChainId: item.id,
        taskMaterialWorkItemId: item.id,
        terminalId: item.terminalId,
        autonomyProfile: item.planningProjects?.some((project) => project.autonomyProfile === "cautious")
          ? "cautious"
          : item.planningProjects?.some((project) => project.autonomyProfile === "high")
            ? "high"
            : "standard",
      });
      reservedAutoRun = reserved.autoRun;
      const recorded = recordExecutionBinding({
        workItemId, kind: "auto_run", targetId: reserved.autoRun.id, worktreeId: null,
        operationId,
      }, actor);
      if (!recorded.ok) throw new Error(recorded.body?.error ?? "work_item_execution_binding_failed");
      executionBindingRecorded = true;
      item = recorded.body.workItem;
      enqueueAutoRunUnderstanding(reserved.autoRun.id);
      sendJson(res, 202, { autoRun: reserved.autoRun, worktree: null, invocation: null });
    } catch (error) {
      if (reservedAutoRun) failAutoRunUnderstanding(reservedAutoRun.id, error);
      if (!executionBindingRecorded) {
        abortExecution({
          workItemId,
          operationId,
          reason: error instanceof Error ? error.message : String(error),
        }, actor);
      }
      sendJson(res, 400, { error: "work_item_execution_failed", message: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  const commentMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/comments(?:\/([^/]+))?$/);
  if (commentMatch) {
    const workItemId = decodeURIComponent(commentMatch[1]);
    const commentId = commentMatch[2] ? decodeURIComponent(commentMatch[2]) : null;
    if (req.method === "GET" && !commentId) {
      const result = listComments({ workItemId }, actor);
      sendJson(res, result.status, result.body);
      return true;
    }
    if (req.method === "POST" && !commentId) {
      const result = createComment({ workItemId, ...(await readJson(req)) }, actor);
      sendJson(res, result.status, result.body);
      return true;
    }
    if (req.method === "PATCH" && commentId) {
      const result = updateComment({ workItemId, commentId, ...(await readJson(req)) }, actor);
      sendJson(res, result.status, result.body);
      return true;
    }
    if (req.method === "DELETE" && commentId) {
      const result = deleteComment({ workItemId, commentId, ...(await readJson(req)) }, actor);
      sendJson(res, result.status, result.body);
      return true;
    }
    return false;
  }

  const progressMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/progress$/);
  if (progressMatch && req.method === "POST") {
    const workItemId = decodeURIComponent(progressMatch[1]);
    const result = recordWorkItemProgress({ workItemId, ...(await readJson(req)) }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }

  const ledgerPostingPlanMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/ledger-posting-plan(?:\/(commit))?$/);
  if (ledgerPostingPlanMatch) {
    const workItemId = decodeURIComponent(ledgerPostingPlanMatch[1]);
    const command = ledgerPostingPlanMatch[2] ?? null;
    const body = req.method === "POST" ? await readJson(req) : {};
    let result;
    if (req.method === "GET" && !command) {
      result = getLedgerPostingPlan({ workItemId }, actor);
    } else if (req.method === "POST" && !command) {
      result = prepareLedgerPostingPlan({ workItemId, ...body }, actor);
    } else if (req.method === "POST" && command === "commit") {
      result = await commitLedgerPostingPlan({ workItemId, ...body }, actor);
    } else {
      return false;
    }
    sendJson(res, result.status, result.body);
    return true;
  }

  const match = url.pathname.match(/^\/api\/work-items\/([^/]+)(?:\/(close|reopen|archive|restore|activity))?$/);
  if (!match) return false;
  const workItemId = decodeURIComponent(match[1]);
  const action = match[2];
  if (req.method === "GET" && action === "activity") {
    const result = listActivity({ workItemId }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (req.method === "GET" && !action) {
    const result = getWorkItem({ workItemId }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (req.method === "PATCH" && !action) {
    const result = updateWorkItem({ workItemId, ...(await readJson(req)) }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  if (req.method === "POST" && action && action !== "activity") {
    const result = transitionWorkItem({ workItemId, action, ...(await readJson(req)) }, actor);
    sendJson(res, result.status, result.body);
    return true;
  }
  return false;
}
