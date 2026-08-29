import { LOCAL_TEAM_ID } from "../runtime/auth.mjs";
import { MAX_HOST_UPLOAD_BYTES } from "../services/host-files.mjs";

export async function handleTerminalRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  actor,
  state,
  confirmSshHostFingerprint,
  createSshTarget,
  createSshConnectionTest,
  observeSshHostFingerprint,
  updateSshTarget,
  verifySshHostConnection,
  listHostFileScopes,
  suggestHostFileScopes,
  createHostFileScope,
  updateHostFileScope,
  listHostFileEntries,
  searchHostFiles,
  previewHostFile,
  listHostFileTransfers,
  uploadHostFile,
  downloadHostFile,
  listHostTlsActivationProfiles,
  createHostTlsActivationProfile,
  createManagedTerminalSession,
  queueTerminalBridgeAction,
  nextTerminalBridgeAction,
  recordTerminalBridgeEvent,
  recordTerminalEvidence,
  planSshHostDiagnostic,
  runSshHostDiagnostic,
  requireBridgeCredential,
  summarizeText,
}) {
  if (req.method === "GET" && url.pathname === "/api/terminal/capability") {
    sendJson(res, 200, state.terminalRuntimeCapability);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/hosts") {
    const hosts = state.sshTargets.filter((target) => sshTargetVisible(actor, target) && myHostTarget(target));
    sendJson(res, 200, { hosts, count: hosts.length });
    return true;
  }

  if (req.method === "POST" && ["/api/ssh-targets", "/api/hosts"].includes(url.pathname)) {
    const body = await readJson(req);
    let target;
    try {
      target = createSshTarget({
        ...body,
        ...(url.pathname === "/api/hosts" && body.purposes == null && body.purpose == null ? { purposes: ["file_transfer"] } : {}),
        createdByUserId: actor?.userId,
        ownerTeamId: actor?.teamId,
      });
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

  const hostMatch = url.pathname.match(/^\/api\/hosts\/([^/]+)$/);
  if (req.method === "GET" && hostMatch) {
    const target = findVisibleSshTarget(state, actor, decodeURIComponent(hostMatch[1]));
    if (!target) sendJson(res, 404, { error: "ssh_target_not_found" });
    else sendJson(res, 200, { host: target });
    return true;
  }
  if (req.method === "PATCH" && hostMatch) {
    const target = findVisibleSshTarget(state, actor, decodeURIComponent(hostMatch[1]));
    if (!target) {
      sendJson(res, 404, { error: "ssh_target_not_found" });
      return true;
    }
    try {
      const result = updateSshTarget(target, await readJson(req));
      sendJson(res, result.ok ? 200 : result.status, result.ok ? { host: result.target } : { error: result.error, ...(result.currentRevision ? { currentRevision: result.currentRevision } : {}) });
    } catch (error) {
      sendJson(res, 400, { error: "invalid_ssh_target", message: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  const observeFingerprintMatch = url.pathname.match(/^\/api\/hosts\/([^/]+)\/observe-fingerprint$/);
  if (req.method === "POST" && observeFingerprintMatch) {
    const target = findVisibleSshTarget(state, actor, decodeURIComponent(observeFingerprintMatch[1]));
    if (!target) {
      sendJson(res, 404, { error: "ssh_target_not_found" });
      return true;
    }
    const result = await observeSshHostFingerprint(target);
    sendJson(res, result.ok ? 200 : result.status, result.ok ? { host: result.target, observation: result.observation } : { error: result.error, host: result.target });
    return true;
  }

  const confirmFingerprintMatch = url.pathname.match(/^\/api\/hosts\/([^/]+)\/confirm-fingerprint$/);
  if (req.method === "POST" && confirmFingerprintMatch) {
    const target = findVisibleSshTarget(state, actor, decodeURIComponent(confirmFingerprintMatch[1]));
    if (!target) {
      sendJson(res, 404, { error: "ssh_target_not_found" });
      return true;
    }
    const result = confirmSshHostFingerprint(target, await readJson(req));
    sendJson(res, result.ok ? 200 : result.status, result.ok ? { host: result.target } : { error: result.error, ...(result.currentRevision ? { currentRevision: result.currentRevision } : {}) });
    return true;
  }

  const verifyHostMatch = url.pathname.match(/^\/api\/hosts\/([^/]+)\/verify$/);
  if (req.method === "POST" && verifyHostMatch) {
    const target = findVisibleSshTarget(state, actor, decodeURIComponent(verifyHostMatch[1]));
    if (!target) {
      sendJson(res, 404, { error: "ssh_target_not_found" });
      return true;
    }
    const result = await verifySshHostConnection(target);
    sendJson(res, result.ok ? 200 : result.status, result.ok ? { host: result.target, verification: result.verification } : { error: result.error, host: result.target });
    return true;
  }

  const hostScopesMatch = url.pathname.match(/^\/api\/hosts\/([^/]+)\/file-scopes$/);
  if (hostScopesMatch && ["GET", "POST"].includes(req.method)) {
    const target = findVisibleSshTarget(state, actor, decodeURIComponent(hostScopesMatch[1]));
    if (!target) {
      sendJson(res, 404, { error: "ssh_target_not_found" });
      return true;
    }
    if (req.method === "GET") {
      const scopes = listHostFileScopes(target);
      sendJson(res, 200, { scopes, count: scopes.length });
      return true;
    }
    const result = await createHostFileScope(target, await readJson(req), actor);
    sendJson(res, result.ok ? (result.reused ? 200 : 201) : result.status, result.ok ? { scope: result.scope, reused: result.reused } : { error: result.error });
    return true;
  }

  const hostScopeSuggestionsMatch = url.pathname.match(/^\/api\/hosts\/([^/]+)\/file-scope-suggestions$/);
  if (req.method === "GET" && hostScopeSuggestionsMatch) {
    const target = findVisibleSshTarget(state, actor, decodeURIComponent(hostScopeSuggestionsMatch[1]));
    if (!target) {
      sendJson(res, 404, { error: "ssh_target_not_found" });
      return true;
    }
    const result = await suggestHostFileScopes(target);
    sendJson(res, result.ok ? 200 : result.status, result.ok ? { suggestions: result.suggestions, count: result.count } : { error: result.error });
    return true;
  }

  const hostTlsProfilesMatch = url.pathname.match(/^\/api\/hosts\/([^/]+)\/tls-activation-profiles$/);
  if (hostTlsProfilesMatch && ["GET", "POST"].includes(req.method)) {
    const target = findVisibleSshTarget(state, actor, decodeURIComponent(hostTlsProfilesMatch[1]));
    if (!target) {
      sendJson(res, 404, { error: "ssh_target_not_found" });
      return true;
    }
    if (req.method === "GET") {
      const profiles = listHostTlsActivationProfiles(target);
      sendJson(res, 200, { profiles, count: profiles.length });
      return true;
    }
    const result = await createHostTlsActivationProfile(target, await readJson(req), actor);
    sendJson(res, result.ok ? 201 : result.status, result.ok ? { profile: result.profile } : { error: result.error });
    return true;
  }

  const hostScopeMatch = url.pathname.match(/^\/api\/hosts\/([^/]+)\/file-scopes\/([^/]+)$/);
  if (req.method === "PATCH" && hostScopeMatch) {
    const target = findVisibleSshTarget(state, actor, decodeURIComponent(hostScopeMatch[1]));
    const scope = target ? findVisibleHostFileScope(state, actor, decodeURIComponent(hostScopeMatch[2])) : null;
    if (!target || !scope || scope.sshTargetId !== target.id) {
      sendJson(res, 404, { error: "host_file_scope_not_found" });
      return true;
    }
    const result = await updateHostFileScope(target, scope, await readJson(req));
    sendJson(res, result.ok ? 200 : result.status, result.ok ? { scope: result.scope } : { error: result.error, ...(result.currentRevision ? { currentRevision: result.currentRevision } : {}) });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/host-file-scopes") {
    const purpose = String(url.searchParams.get("purpose") ?? "").trim();
    const scopes = state.hostFileScopes
      .filter((scope) => findVisibleHostFileScope(state, actor, scope.id) === scope)
      .filter((scope) => !purpose || scope.purpose === purpose)
      .map((scope) => {
        const host = findVisibleSshTarget(state, actor, scope.sshTargetId);
        if (!host || !myHostTarget(host)) return null;
        return {
          ...scope,
          host: {
            id: host.id,
            name: host.name,
            host: host.host,
            connectionStatus: host.connectionStatus,
            capabilities: host.capabilities,
          },
        };
      })
      .filter(Boolean);
    sendJson(res, 200, { scopes, count: scopes.length });
    return true;
  }

  const scopeEntriesMatch = url.pathname.match(/^\/api\/host-file-scopes\/([^/]+)\/entries$/);
  if (req.method === "GET" && scopeEntriesMatch) {
    const scope = findVisibleHostFileScope(state, actor, decodeURIComponent(scopeEntriesMatch[1]));
    const target = scope ? findVisibleSshTarget(state, actor, scope.sshTargetId) : null;
    if (!scope || !target) {
      sendJson(res, 404, { error: "host_file_scope_not_found" });
      return true;
    }
    const result = await listHostFileEntries(target, scope, url.searchParams.get("path") ?? "");
    sendJson(res, result.ok ? 200 : result.status, result.ok
      ? { scope: result.scope, path: result.path, entries: result.entries, count: result.count }
      : { error: result.error });
    return true;
  }

  const scopeSearchMatch = url.pathname.match(/^\/api\/host-file-scopes\/([^/]+)\/search$/);
  if (req.method === "POST" && scopeSearchMatch) {
    const scope = findVisibleHostFileScope(state, actor, decodeURIComponent(scopeSearchMatch[1]));
    const target = scope ? findVisibleSshTarget(state, actor, scope.sshTargetId) : null;
    if (!scope || !target) {
      sendJson(res, 404, { error: "host_file_scope_not_found" });
      return true;
    }
    const result = await searchHostFiles(target, scope, await readJson(req), actor);
    sendJson(res, result.ok ? 200 : result.status, result.ok
      ? { scopeId: result.scopeId, scopeRevision: result.scopeRevision, results: result.results, count: result.count, contentSearchEnabled: result.contentSearchEnabled, boundaries: result.boundaries }
      : { error: result.error, ...(result.currentRevision ? { currentRevision: result.currentRevision } : {}) });
    return true;
  }

  const scopePreviewMatch = url.pathname.match(/^\/api\/host-file-scopes\/([^/]+)\/preview$/);
  if (req.method === "POST" && scopePreviewMatch) {
    const scope = findVisibleHostFileScope(state, actor, decodeURIComponent(scopePreviewMatch[1]));
    const target = scope ? findVisibleSshTarget(state, actor, scope.sshTargetId) : null;
    if (!scope || !target) {
      sendJson(res, 404, { error: "host_file_scope_not_found" });
      return true;
    }
    const result = await previewHostFile(target, scope, await readJson(req), actor);
    if (!result.ok) {
      sendJson(res, result.status, { error: result.error, ...(result.currentRevision ? { currentRevision: result.currentRevision } : {}) });
      return true;
    }
    res.writeHead(200, {
      "Content-Type": result.contentType,
      "Content-Length": String(result.bytes.length),
      "Cache-Control": "no-store",
      "Content-Security-Policy": "sandbox",
      "X-Content-Type-Options": "nosniff",
      "X-Host-Preview-Kind": result.kind,
    });
    res.end(result.bytes);
    return true;
  }

  const hostTransfersMatch = url.pathname.match(/^\/api\/hosts\/([^/]+)\/file-transfers$/);
  if (req.method === "GET" && hostTransfersMatch) {
    const target = findVisibleSshTarget(state, actor, decodeURIComponent(hostTransfersMatch[1]));
    if (!target) {
      sendJson(res, 404, { error: "ssh_target_not_found" });
      return true;
    }
    const transfers = listHostFileTransfers(target);
    sendJson(res, 200, { transfers, count: transfers.length });
    return true;
  }

  const scopeUploadMatch = url.pathname.match(/^\/api\/host-file-scopes\/([^/]+)\/transfers\/upload$/);
  if (req.method === "POST" && scopeUploadMatch) {
    const scope = findVisibleHostFileScope(state, actor, decodeURIComponent(scopeUploadMatch[1]));
    const target = scope ? findVisibleSshTarget(state, actor, scope.sshTargetId) : null;
    if (!scope || !target) {
      sendJson(res, 404, { error: "host_file_scope_not_found" });
      return true;
    }
    if (String(req.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase() !== "application/octet-stream") {
      sendJson(res, 415, { error: "host_file_upload_content_type_invalid" });
      return true;
    }
    let bytes;
    try {
      bytes = await readBoundedBody(req, MAX_HOST_UPLOAD_BYTES);
    } catch (error) {
      sendJson(res, error?.status ?? 400, { error: error?.code ?? "host_file_upload_invalid" });
      return true;
    }
    const result = await uploadHostFile(target, scope, bytes, {
      directory: url.searchParams.get("directory") ?? "",
      filename: url.searchParams.get("filename") ?? "",
      conflictPolicy: url.searchParams.get("conflictPolicy") ?? "deny",
      confirmed: req.headers["x-transfer-confirmed"] === "true",
      overwriteConfirmed: req.headers["x-overwrite-confirmed"] === "true",
      retryOf: url.searchParams.get("retryOf") ?? null,
    }, actor);
    sendJson(res, result.ok ? 201 : result.status, result.ok ? { task: result.task } : { error: result.error, ...(result.task ? { task: result.task } : {}) });
    return true;
  }

  const scopeDownloadMatch = url.pathname.match(/^\/api\/host-file-scopes\/([^/]+)\/transfers\/download$/);
  if (req.method === "POST" && scopeDownloadMatch) {
    const scope = findVisibleHostFileScope(state, actor, decodeURIComponent(scopeDownloadMatch[1]));
    const target = scope ? findVisibleSshTarget(state, actor, scope.sshTargetId) : null;
    if (!scope || !target) {
      sendJson(res, 404, { error: "host_file_scope_not_found" });
      return true;
    }
    const body = await readJson(req);
    const result = await downloadHostFile(target, scope, body, actor);
    if (!result.ok) {
      sendJson(res, result.status, { error: result.error, ...(result.task ? { task: result.task } : {}) });
      return true;
    }
    const encodedName = encodeURIComponent(result.fileName).replace(/'/g, "%27");
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(result.bytes.length),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Host-Transfer-Id": result.task.id,
    });
    res.end(result.bytes);
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

  const hostDiagnosticMatch = url.pathname.match(/^\/api\/hosts\/([^/]+)\/diagnostics$/);
  if (req.method === "POST" && hostDiagnosticMatch) {
    const target = findVisibleSshTarget(state, actor, decodeURIComponent(hostDiagnosticMatch[1]));
    if (!target) {
      sendJson(res, 404, { error: "ssh_target_not_found" });
      return true;
    }
    const body = await readJson(req);
    if (body.confirmed !== true) {
      sendJson(res, 400, { error: "ssh_diagnostic_confirmation_required" });
      return true;
    }
    const result = await runSshHostDiagnostic(target, body.action, actor, body.parameters ?? {});
    sendJson(res, result.ok ? 200 : result.status, result.ok ? { result } : { error: result.error });
    return true;
  }

  const hostAssistantPlanMatch = url.pathname.match(/^\/api\/hosts\/([^/]+)\/assistant\/plan$/);
  if (req.method === "POST" && hostAssistantPlanMatch) {
    const target = findVisibleSshTarget(state, actor, decodeURIComponent(hostAssistantPlanMatch[1]));
    if (!target) {
      sendJson(res, 404, { error: "ssh_target_not_found" });
      return true;
    }
    const body = await readJson(req);
    const result = planSshHostDiagnostic(body.input);
    sendJson(res, result.ok ? 200 : result.status, result.ok ? { plan: result } : { error: result.error });
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

async function readBoundedBody(req, maxBytes) {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw Object.assign(new Error("upload_too_large"), { code: "host_file_upload_size_invalid", status: 413 });
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error("upload_too_large"), { code: "host_file_upload_size_invalid", status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
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

function myHostTarget(target) {
  return Array.isArray(target?.purposes) && target.purposes.some((purpose) => ["file_transfer", "site_publish", "tls_certificate"].includes(purpose));
}

function findVisibleHostFileScope(state, actor, scopeId) {
  const scope = state.hostFileScopes.find((item) => item.id === scopeId);
  if (!scope) return null;
  if (!actor?.teamId) return scope;
  return (scope.ownerTeamId ?? LOCAL_TEAM_ID) === actor.teamId ? scope : null;
}

function sshTargetVisible(actor, target) {
  if (!actor?.teamId) return true;
  return (target.ownerTeamId ?? LOCAL_TEAM_ID) === actor.teamId;
}
