import { createHmac, timingSafeEqual } from "node:crypto";

export async function handleWorkItemRoutes({
  req, res, url, sendJson, readJson, actor,
  listWorkItems, listAttention, getWorkItem, createWorkItem, updateWorkItem, bulkUpdateWorkItems, transitionWorkItem,
  listActivity, listComments, createComment, updateComment, deleteComment,
  createWorktree, startAutoRun, beginExecution, abortExecution, recordExecutionBinding,
  createAutoRunBatch, listAutoRunBatches,
  promoteWorktreeToBase, promoteWorktreeToPullRequest, beginDelivery, failDelivery, completeDelivery,
  claimWorkItem, releaseWorkItemClaim,
  bindGithubIssue, syncGithubIssue,
  bindExternalIssue, syncExternalIssue, listExternalProviders,
  fetchExternalIssue, pushExternalIssue,
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
  retryWorkItemAlert,
}) {
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
    const result = ingestGithubWebhook({
      deliveryId: req.headers["x-github-delivery"],
      event: req.headers["x-github-event"],
      payload,
    });
    sendJson(res, result.status, result.body);
    return true;
  }
  if (!url.pathname.startsWith("/api/work-items")) return false;

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

  if (url.pathname === "/api/work-items/bulk" && req.method === "PATCH") {
    const result = bulkUpdateWorkItems(await readJson(req), actor);
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

  const claimMatch = url.pathname.match(/^\/api\/work-items\/([^/]+)\/(claim|release-claim)$/);
  if (claimMatch && req.method === "POST") {
    const workItemId = decodeURIComponent(claimMatch[1]);
    const body = await readJson(req);
    const result = claimMatch[2] === "claim"
      ? claimWorkItem({ workItemId, ...body }, actor)
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
    if (githubMatch[2] === "link") {
      const issueNumber = Number(body?.issueNumber ?? body?.remote?.number);
      const remote = body?.remote ?? await fetchGithubIssue({ projectId: item.projectId, issueNumber });
      const result = remote
        ? bindGithubIssue({ workItemId, expectedRevision: body?.expectedRevision, remote }, actor)
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
    const item = detail.body.workItem;
    const body = await readJson(req);
    const kind = executionMatch[2] === "worktrees" ? "worktree" : "auto_run";
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
    const name = body?.name ?? `local-${item.localNumber}-${slug}`;
    const link = { type: "local_issue", number: item.localNumber, title: item.title, url: null, state: item.state };
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
      const issueBody = [
        item.body,
        item.acceptanceCriteria?.length ? `Acceptance criteria:\n${item.acceptanceCriteria.map((value) => `- ${value}`).join("\n")}` : "",
      ].filter(Boolean).join("\n\n");
      const result = await startAutoRun({
        projectId: item.projectId, link, name, baseBranch: body?.baseBranch,
        agentId: body?.agentId, actor, issueBody,
        executionChainId: item.id,
        terminalId: item.terminalId,
        autonomyProfile: item.planningProjects?.some((project) => project.autonomyProfile === "cautious")
          ? "cautious"
          : item.planningProjects?.some((project) => project.autonomyProfile === "high")
            ? "high"
            : "standard",
      });
      const recorded = recordExecutionBinding({
        workItemId, kind: "auto_run", targetId: result.autoRun.id, worktreeId: result.worktree?.id ?? result.autoRun.worktreeId,
        operationId,
      }, actor);
      if (!recorded.ok) throw new Error(recorded.body?.error ?? "work_item_execution_binding_failed");
      sendJson(res, 201, result);
    } catch (error) {
      abortExecution({
        workItemId,
        operationId,
        reason: error instanceof Error ? error.message : String(error),
      }, actor);
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
