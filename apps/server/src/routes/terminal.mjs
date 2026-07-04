import { LOCAL_TEAM_ID } from "../runtime/auth.mjs";

export async function handleTerminalRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  actor,
  state,
  createSshTarget,
  createSshConnectionTest,
  createManagedTerminalSession,
  queueTerminalBridgeAction,
  nextTerminalBridgeAction,
  recordTerminalBridgeEvent,
  recordTerminalEvidence,
  requireBridgeCredential,
  summarizeText,
}) {
  if (req.method === "GET" && url.pathname === "/api/terminal/capability") {
    sendJson(res, 200, state.terminalRuntimeCapability);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/ssh-targets") {
    const body = await readJson(req);
    let target;
    try {
      target = createSshTarget({ ...body, createdByUserId: actor?.userId, ownerTeamId: actor?.teamId });
    } catch (error) {
      sendJson(res, 400, {
        error: "invalid_ssh_target",
        message: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
    sendJson(res, 201, { target, capability: state.terminalRuntimeCapability });
    return true;
  }

  const sshTestMatch = url.pathname.match(/^\/api\/ssh-targets\/([^/]+)\/test$/);
  if (req.method === "POST" && sshTestMatch) {
    const targetId = decodeURIComponent(sshTestMatch[1]);
    const target = findVisibleSshTarget(state, actor, targetId);
    if (!target) {
      sendJson(res, 404, { error: "ssh_target_not_found" });
      return true;
    }
    const body = await readJson(req);
    const report = createSshConnectionTest(target, body);
    sendJson(res, 202, { report, target });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/terminal/sessions") {
    const body = await readJson(req);
    let session;
    try {
      session = createManagedTerminalSession({ ...body, userId: actor?.userId, ownerTeamId: actor?.teamId });
    } catch (error) {
      sendJson(res, 400, {
        error: "invalid_terminal_session",
        message: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
    sendJson(res, 201, { session, capability: state.terminalRuntimeCapability });
    return true;
  }

  const inputMatch = url.pathname.match(/^\/api\/terminal\/sessions\/([^/]+)\/input$/);
  if (req.method === "POST" && inputMatch) {
    const session = findVisibleTerminalSession(state, actor, decodeURIComponent(inputMatch[1]));
    if (!session) {
      sendJson(res, 404, { error: "terminal_session_not_found" });
      return true;
    }
    const body = await readJson(req);
    const action = queueTerminalBridgeAction(session, "input", { input: String(body.input ?? "") });
    recordTerminalEvidence(session, "terminal_input", "Terminal input submitted through managed surface.", {
      inputSummary: summarizeText(String(body.input ?? ""), 160),
      actionId: action.id,
    });
    sendJson(res, 202, { action, session });
    return true;
  }

  const resizeMatch = url.pathname.match(/^\/api\/terminal\/sessions\/([^/]+)\/resize$/);
  if (req.method === "POST" && resizeMatch) {
    const session = findVisibleTerminalSession(state, actor, decodeURIComponent(resizeMatch[1]));
    if (!session) {
      sendJson(res, 404, { error: "terminal_session_not_found" });
      return true;
    }
    const body = await readJson(req);
    const action = queueTerminalBridgeAction(session, "resize", {
      cols: Number(body.cols ?? 100),
      rows: Number(body.rows ?? 30),
    });
    recordTerminalEvidence(session, "terminal_resize", "Terminal resize submitted through managed surface.", {
      cols: action.payload.cols,
      rows: action.payload.rows,
      actionId: action.id,
    });
    sendJson(res, 202, { action, session });
    return true;
  }

  const closeMatch = url.pathname.match(/^\/api\/terminal\/sessions\/([^/]+)\/close$/);
  if (req.method === "POST" && closeMatch) {
    const session = findVisibleTerminalSession(state, actor, decodeURIComponent(closeMatch[1]));
    if (!session) {
      sendJson(res, 404, { error: "terminal_session_not_found" });
      return true;
    }
    const action = queueTerminalBridgeAction(session, "close", {});
    sendJson(res, 202, { action, session });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/bridge/terminal-next") {
    if (!requireBridgeCredential({ req, res, sendJson })) {
      return true;
    }
    const action = nextTerminalBridgeAction();
    sendJson(res, action ? 200 : 204, action);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/bridge/terminal-events") {
    if (!requireBridgeCredential({ req, res, sendJson })) {
      return true;
    }
    const body = await readJson(req);
    const result = recordTerminalBridgeEvent(body);
    if (!result.ok) {
      sendJson(res, 400, { error: result.error });
      return true;
    }
    sendJson(res, 200, { ok: true, session: result.session });
    return true;
  }

  return false;
}

function findVisibleTerminalSession(state, actor, terminalSessionId) {
  const session = state.terminalSessions.find((item) => item.terminalSessionId === terminalSessionId);
  if (!session) return null;
  return terminalSessionVisible(state, actor, session) ? session : null;
}

function terminalSessionVisible(state, actor, session) {
  if (!actor?.teamId) return true;
  return terminalSessionTeamId(state, session) === actor.teamId;
}

function terminalSessionTeamId(state, session) {
  if (session.ownerTeamId) return session.ownerTeamId;
  const owner = state.users.find((user) => user.id === session.userId);
  return owner?.teamId ?? LOCAL_TEAM_ID;
}

function findVisibleSshTarget(state, actor, targetId) {
  const target = state.sshTargets.find((item) => item.id === targetId);
  if (!target) return null;
  return sshTargetVisible(actor, target) ? target : null;
}

function sshTargetVisible(actor, target) {
  if (!actor?.teamId) return true;
  return (target.ownerTeamId ?? LOCAL_TEAM_ID) === actor.teamId;
}
