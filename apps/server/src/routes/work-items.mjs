export async function handleWorkItemRoutes({
  req, res, url, sendJson, readJson, actor,
  listWorkItems, getWorkItem, createWorkItem, updateWorkItem, bulkUpdateWorkItems, transitionWorkItem,
  listActivity, listComments, createComment, updateComment, deleteComment,
  createWorktree, startAutoRun, recordExecutionBinding,
  claimWorkItem, releaseWorkItemClaim,
}) {
  if (!url.pathname.startsWith("/api/work-items")) return false;

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
