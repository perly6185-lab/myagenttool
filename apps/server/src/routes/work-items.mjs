import { createHmac, timingSafeEqual } from "node:crypto";

export async function handleWorkItemRoutes({
  req, res, url, sendJson, readJson, actor,
  listWorkItems, listAttention, getWorkItem, createWorkItem, updateWorkItem, bulkUpdateWorkItems, transitionWorkItem,
  listActivity, listComments, createComment, updateComment, deleteComment,
  createWorktree, startAutoRun, recordExecutionBinding,
  claimWorkItem, releaseWorkItemClaim,
  bindGithubIssue, syncGithubIssue,
  fetchGithubIssue, pushGithubIssue,
  recordVerification,
  ingestGithubWebhook,
  replayGithubWebhook,
  recordGithubWebhookFailure,
  updateAttention,
  githubSyncDiagnostics,
}) {
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
    const slug = String(item.title ?? "work").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "work";
    const name = body?.name ?? `local-${item.localNumber}-${slug}`;
    const link = { type: "local_issue", number: item.localNumber, title: item.title, url: null, state: item.state };
    try {
      if (executionMatch[2] === "worktrees") {
        const result = createWorktree({
          projectId: item.projectId, name, branchName: body?.branchName ?? name,
          baseBranch: body?.baseBranch, agentId: body?.agentId, link,
        });
        recordExecutionBinding({
          workItemId, kind: "worktree", targetId: result.worktree.id, worktreeId: result.worktree.id,
        }, actor);
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
      });
      recordExecutionBinding({
        workItemId, kind: "auto_run", targetId: result.autoRun.id, worktreeId: result.worktree?.id ?? result.autoRun.worktreeId,
      }, actor);
      sendJson(res, 201, result);
    } catch (error) {
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
