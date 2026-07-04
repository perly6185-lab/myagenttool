import { resolve, sep } from "node:path";

// A local managed terminal is the broadest execution surface on the bridge (an
// interactive shell). Its cwd must stay inside a registered project or worktree
// root so a session can't be opened at an arbitrary path on the host. (Remote
// SSH-relay terminals run on the remote target, not the bridge, so they use the
// target's own workspace root and are out of scope here.)
export function approvedLocalTerminalRoots(state) {
  const projectRoots = (state?.projects ?? []).map((project) => project?.path).filter(Boolean);
  const worktreeRoots = (state?.worktrees ?? []).map((worktree) => worktree?.path ?? worktree?.worktreePath).filter(Boolean);
  return [...new Set([...projectRoots, ...worktreeRoots].map((path) => resolve(String(path))))];
}

export function terminalCwdWithinRoots(cwd, roots) {
  const target = resolve(String(cwd));
  return roots.some((root) => {
    const r = resolve(String(root));
    return target === r || target.startsWith(r + sep);
  });
}

export function createTerminalRuntimeCapability({ now = defaultNow } = {}) {
  const platform = process.platform;
  const isWindows = platform === "win32";
  const shells = isWindows ? ["powershell", "cmd", "pwsh", "wsl", "git-bash"] : ["bash", "zsh", "sh"];
  return {
    deviceId: "dev_local_001",
    status: "managed_pty_supported",
    localPty: {
      available: true,
      reason: "Desktop Bridge supports node-pty managed terminal sessions",
      phase: "Phase E",
    },
    ssh: {
      available: true,
      reason: "SSH target registry and safety preflight are available; remote relay PTY is not enabled",
      phase: "Phase G",
      targetRegistry: true,
      remoteRelayAvailable: false,
    },
    relay: {
      available: true,
      reason: "Remote relay protocol is available through managed SSH stdio bootstrap",
      phase: "Phase H",
      transport: "ssh_stdio_relay",
    },
    supportedShells: shells,
    defaultShell: isWindows ? "powershell" : "bash",
    contract: "docs/engineering/MANAGED_TERMINAL_JOIN_CONTRACT.md",
    updatedAt: now(),
  };
}

export function createTerminalService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon,
  summarizeText,
  uniqueStrings,
  codexSessionForInvocation,
}) {
  function createSshTarget(body = {}) {
    const host = normalizeSshHost(body.host);
    const port = normalizeSshPort(body.port);
    const user = normalizeSshUser(body.user);
    const authMethod = normalizeSshAuthMethod(body.authMethod);
    const knownHostPolicy = normalizeKnownHostPolicy(body.knownHostPolicy);
    const workspaceRoot = normalizeSshWorkspaceRoot(body.workspaceRoot);
    const target = {
      id: nextId("ssh_target"),
      name: summarizeText(body.name ?? `${user}@${host}:${port}`, 80),
      createdByUserId: body.createdByUserId ?? "usr_local",
      ownerTeamId: body.ownerTeamId ?? "team_local",
      host,
      port,
      user,
      authMethod,
      credentialRef: normalizeSshCredentialRef(body, authMethod),
      credentialStorage: "external_reference_only",
      knownHostPolicy,
      knownHostFingerprint: normalizeKnownHostFingerprint(body.knownHostFingerprint),
      workspaceRoot,
      platformHint: normalizeSshPlatformHint(body.platformHint),
      agentForwarding: normalizeBoolean(body.agentForwarding, false),
      keySelection: normalizeSshKeySelection(body.keySelection),
      status: "registered",
      trustStatus: sshTrustStatus(knownHostPolicy, body.knownHostFingerprint),
      remoteRelayEnabled: false,
      evidencePolicy: "not_managed_terminal_evidence_until_relay_registered",
      riskSummary: sshTargetRiskSummary({ authMethod, knownHostPolicy, agentForwarding: body.agentForwarding, keySelection: body.keySelection }),
      redactionRules: sshCredentialRedactionRules(authMethod),
      createdAt: now(),
      updatedAt: now(),
      lastTestId: null,
    };
    state.sshTargets.unshift(target);
    appendEvent({
      invocationId: null,
      type: "ssh.target.registered",
      level: "info",
      message: "SSH runtime target registered for safety preflight.",
      data: {
        targetId: target.id,
        host: target.host,
        port: target.port,
        user: target.user,
        authMethod: target.authMethod,
        knownHostPolicy: target.knownHostPolicy,
        workspaceRoot: target.workspaceRoot,
        remoteRelayEnabled: target.remoteRelayEnabled,
      },
    });
    persistStateSoon();
    return target;
  }

  function createSshConnectionTest(target, body = {}) {
    const checks = sshPreflightChecks(target, body);
    const blocking = checks.filter((check) => check.severity === "block");
    const warning = checks.filter((check) => check.severity === "warn");
    const report = {
      id: nextId("ssh_test"),
      targetId: target.id,
      ownerTeamId: target.ownerTeamId ?? "team_local",
      status: blocking.length > 0 ? "blocked" : warning.length > 0 ? "needs_review" : "ready_for_manual_test",
      auth: {
        method: target.authMethod,
        credentialStorage: target.credentialStorage,
        credentialRef: target.credentialRef,
        plaintextStored: false,
      },
      hostVerification: {
        policy: target.knownHostPolicy,
        trustStatus: target.trustStatus,
        fingerprint: target.knownHostFingerprint ?? null,
      },
      platform: {
        localPlatform: state.device.platform,
        remotePlatformHint: target.platformHint,
        workspaceRoot: target.workspaceRoot,
      },
      agentForwarding: {
        enabled: target.agentForwarding,
        risk: target.agentForwarding ? "Can expose signing capability to a remote host. Require explicit admin approval." : "Disabled by default.",
      },
      keySelection: {
        mode: target.keySelection,
        risk: target.keySelection === "ssh_agent_default" ? "Default SSH agent identity may be ambiguous." : "Explicit credential reference required.",
      },
      remoteRelayEnabled: false,
      checks,
      summary: sshConnectionTestSummary(blocking, warning),
      createdAt: now(),
    };
    state.sshConnectionTests.unshift(report);
    target.lastTestId = report.id;
    target.status = report.status;
    target.updatedAt = now();
    appendEvent({
      invocationId: null,
      type: "ssh.target.test",
      level: report.status === "blocked" ? "warn" : "info",
      message: report.summary,
      data: {
        targetId: target.id,
        reportId: report.id,
        status: report.status,
        checks: checks.map((check) => `${check.id}:${check.status}`),
      },
    });
    persistStateSoon();
    return report;
  }

  function createManagedTerminalSession(body = {}) {
    const capability = state.terminalRuntimeCapability;
    const runtimeKind = normalizeTerminalRuntimeKind(body.runtimeKind);
    const sshTarget = runtimeKind === "remote_ssh_relay" ? latestReadySshTarget(body.targetId, body.ownerTeamId) : null;
    if (runtimeKind === "remote_ssh_relay" && !sshTarget) {
      throw new Error("Remote relay terminal sessions require a ready SSH target preflight.");
    }
    const shell = runtimeKind === "remote_ssh_relay"
      ? normalizeRemoteTerminalShell(body.shell, sshTarget)
      : normalizeTerminalShell(body.shell, capability.defaultShell);
    const cwd = runtimeKind === "remote_ssh_relay"
      ? normalizeTerminalCwd(body.cwd ?? sshTarget.workspaceRoot)
      : normalizeTerminalCwd(body.cwd);
    // Confine a CLIENT-SUPPLIED local terminal cwd to a registered project/
    // worktree root — a client must not open an interactive shell at an
    // arbitrary path on the bridge host. The default (no cwd → the bridge's own
    // working directory) is the trusted fallback and is not confined.
    const requestedCwd = body.cwd != null && String(body.cwd).trim() ? String(body.cwd) : null;
    if (runtimeKind !== "remote_ssh_relay" && requestedCwd) {
      const roots = approvedLocalTerminalRoots(state);
      if (roots.length > 0 && !terminalCwdWithinRoots(cwd, roots)) {
        throw new Error("A local terminal working directory must be inside a registered project or worktree root.");
      }
    }
    const runtimeAvailable = runtimeKind === "remote_ssh_relay" ? capability.relay.available : capability.localPty.available;
    const session = {
      terminalSessionId: nextId("term"),
      ownerInvocationId: String(body.ownerInvocationId ?? "manual_terminal_surface"),
      ownerCodexSessionId: normalizeTerminalCodexSessionId(body.ownerCodexSessionId, body.ownerInvocationId),
      deviceId: state.device.id,
      userId: body.userId ?? "usr_local",
      ownerTeamId: body.ownerTeamId ?? teamIdForUser(body.userId),
      repoPath: cwd,
      cwd,
      shell,
      runtimeKind,
      targetId: sshTarget?.id ?? "local",
      remoteHost: sshTarget?.host ?? null,
      remoteUser: sshTarget?.user ?? null,
      remoteRelayTransport: runtimeKind === "remote_ssh_relay" ? "ssh_stdio_relay" : null,
      relayVersion: runtimeKind === "remote_ssh_relay" ? "0.1.0" : null,
      status: runtimeAvailable ? "attaching" : "unavailable",
      policyProfile: "managed-terminal-default",
      approvalPolicy: "ask_before_risky_tools",
      sandboxMode: "workspace_write",
      networkPolicy: runtimeKind === "remote_ssh_relay" ? "ssh_target_only" : "restricted",
      startedAt: now(),
      lastSeenAt: now(),
      exitedAt: null,
      exitCode: null,
      evidenceIds: [],
    };
    state.terminalSessions.unshift(session);
    persistStateSoon();
    const action = runtimeAvailable
      ? queueTerminalBridgeAction(session, "create", { shell, cwd, cols: Number(body.cols ?? 100), rows: Number(body.rows ?? 30), target: sshTarget })
      : null;
    recordTerminalEvidence(session, "terminal_session_start", runtimeAvailable ? "Managed terminal session create requested." : "Managed terminal session registered but runtime is unavailable.", {
      shell,
      cwd,
      runtimeKind: session.runtimeKind,
      remoteHost: session.remoteHost,
      remoteUser: session.remoteUser,
      remoteRelayTransport: session.remoteRelayTransport,
      relayVersion: session.relayVersion,
      policyProfile: session.policyProfile,
      capabilityStatus: capability.status,
      capabilityReason: runtimeKind === "remote_ssh_relay" ? capability.relay.reason : capability.localPty.reason,
      actionId: action?.id ?? null,
    });
    appendEvent({
      invocationId: null,
      type: runtimeAvailable ? "terminal.session.create" : "terminal.runtime.warning",
      level: runtimeAvailable ? "info" : "warn",
      message: runtimeAvailable ? "Managed terminal session create requested." : "Managed terminal runtime is not connected yet.",
      data: {
        terminalSessionId: session.terminalSessionId,
        shell,
        cwd,
        runtimeKind,
        targetId: session.targetId,
        remoteHost: session.remoteHost,
        status: session.status,
        reason: runtimeKind === "remote_ssh_relay" ? capability.relay.reason : capability.localPty.reason,
      },
    });
    return session;
  }

  function normalizeTerminalCodexSessionId(ownerCodexSessionId, ownerInvocationId) {
    if (ownerCodexSessionId && state.codexSessions.some((item) => item.id === String(ownerCodexSessionId))) {
      return String(ownerCodexSessionId);
    }
    if (ownerInvocationId) {
      return codexSessionForInvocation(String(ownerInvocationId))?.id ?? null;
    }
    return state.codexSessions[0]?.id ?? null;
  }

  function closeManagedTerminalSession(session) {
    session.status = session.status === "attached" ? "detached" : "closed";
    session.exitedAt = now();
    session.lastSeenAt = now();
    session.exitCode = null;
    recordTerminalEvidence(session, "terminal_exit", "Managed terminal session closed from Web Console.", {
      status: session.status,
      exitCode: session.exitCode,
    });
    appendEvent({
      invocationId: session.ownerInvocationId === "manual_terminal_surface" ? null : session.ownerInvocationId,
      type: "terminal.close",
      level: "info",
      message: "Managed terminal session closed.",
      data: { terminalSessionId: session.terminalSessionId, status: session.status },
    });
    persistStateSoon();
  }

  function teamIdForUser(userId) {
    return state.users.find((user) => user.id === userId)?.teamId ?? "team_local";
  }

  function queueTerminalBridgeAction(session, actionType, payload = {}) {
    const action = {
      id: nextId("term_act"),
      terminalSessionId: session.terminalSessionId,
      actionType,
      payload,
      status: "queued",
      createdAt: now(),
      dispatchedAt: null,
      completedAt: null,
    };
    state.terminalBridgeActions.push(action);
    session.lastSeenAt = now();
    persistStateSoon();
    return action;
  }

  function nextTerminalBridgeAction() {
    const action = state.terminalBridgeActions.find((item) => item.status === "queued");
    if (!action) return null;
    action.status = "dispatched";
    action.dispatchedAt = now();
    const session = state.terminalSessions.find((item) => item.terminalSessionId === action.terminalSessionId);
    persistStateSoon();
    return {
      ...action,
      session,
    };
  }

  function completeTerminalBridgeAction(actionId) {
    const action = state.terminalBridgeActions.find((item) => item.id === actionId);
    if (!action) return;
    action.status = "completed";
    action.completedAt = now();
    persistStateSoon();
  }

  function recordTerminalBridgeEvent(body = {}) {
    const session = state.terminalSessions.find((item) => item.terminalSessionId === body.terminalSessionId);
    if (!session) return { ok: false, error: "terminal_session_not_found" };
    const eventType = String(body.type ?? "");
    if (body.actionId) completeTerminalBridgeAction(String(body.actionId));
    session.lastSeenAt = now();

    if (eventType === "terminal.session.attached") {
      session.status = "attached";
      recordTerminalEvidence(session, "terminal_session_start", "Managed terminal PTY attached.", {
        shell: session.shell,
        cwd: session.cwd,
        runtimeKind: session.runtimeKind,
        remoteHost: session.remoteHost,
        remoteUser: session.remoteUser,
        relayVersion: session.relayVersion,
        policyProfile: session.policyProfile,
      });
    } else if (eventType === "terminal.output.chunk") {
      recordTerminalEvidence(session, "terminal_output_chunk", summarizeText(String(body.summary ?? "Terminal output received."), 200), {
        stream: body.stream ?? "stdout",
        byteCount: Number(body.byteCount ?? String(body.output ?? "").length),
        outputPreview: summarizeText(String(body.output ?? ""), 500),
        runtimeKind: session.runtimeKind,
        remoteHost: session.remoteHost,
        remoteUser: session.remoteUser,
        relayVersion: session.relayVersion,
      });
    } else if (eventType === "terminal.resize") {
      recordTerminalEvidence(session, "terminal_resize", "Managed terminal resized.", {
        cols: Number(body.cols ?? 0),
        rows: Number(body.rows ?? 0),
        runtimeKind: session.runtimeKind,
        remoteHost: session.remoteHost,
        remoteUser: session.remoteUser,
      });
    } else if (eventType === "terminal.exit") {
      session.status = "exited";
      session.exitedAt = now();
      session.exitCode = Number.isFinite(Number(body.exitCode)) ? Number(body.exitCode) : null;
      recordTerminalEvidence(session, "terminal_exit", `Managed terminal exited${session.exitCode === null ? "" : ` with code ${session.exitCode}`}.`, {
        exitCode: session.exitCode,
        runtimeKind: session.runtimeKind,
        remoteHost: session.remoteHost,
        remoteUser: session.remoteUser,
        relayVersion: session.relayVersion,
      });
    } else if (eventType === "terminal.close") {
      closeManagedTerminalSession(session);
    } else if (eventType === "terminal.runtime.warning") {
      session.status = session.status === "attaching" ? "error" : session.status;
      recordTerminalEvidence(session, "terminal_policy_event", String(body.summary ?? "Managed terminal runtime warning."), {
        warning: body.summary ?? body.error ?? "runtime warning",
      });
    }

    appendEvent({
      invocationId: session.ownerInvocationId === "manual_terminal_surface" ? null : session.ownerInvocationId,
      type: eventType || "terminal.runtime.warning",
      level: eventType === "terminal.runtime.warning" ? "warn" : "info",
      message: String(body.summary ?? terminalEventSummary(eventType)),
      data: {
        terminalSessionId: session.terminalSessionId,
        actionId: body.actionId ?? null,
        status: session.status,
      },
    });
    return { ok: true, session };
  }

  function recordTerminalEvidence(session, type, summary, data = {}) {
    const evidence = {
      id: nextId("tev"),
      terminalSessionId: session.terminalSessionId,
      ownerInvocationId: session.ownerInvocationId,
      ownerCodexSessionId: session.ownerCodexSessionId,
      type,
      source: "managed_terminal_runtime",
      redactionState: "summary_only",
      marker: "managed_terminal",
      repoPath: session.repoPath,
      summary,
      detail: summary,
      data,
      createdAt: now(),
    };
    state.terminalEvidenceRecords.unshift(evidence);
    session.evidenceIds = uniqueStrings([...(session.evidenceIds ?? []), evidence.id]);
    persistStateSoon();
    return evidence;
  }

  function normalizeTerminalShell(value, fallback) {
    const requested = String(value ?? fallback ?? "").trim().toLowerCase();
    const supported = state.terminalRuntimeCapability.supportedShells;
    return supported.includes(requested) ? requested : fallback;
  }

  function latestReadySshTarget(targetId, ownerTeamId = null) {
    const target = targetId
      ? state.sshTargets.find((item) => item.id === String(targetId))
      : state.sshTargets.find((item) => sshTargetVisibleToTeam(item, ownerTeamId));
    if (!target) return null;
    if (!sshTargetVisibleToTeam(target, ownerTeamId)) return null;
    const report = state.sshConnectionTests.find((item) => item.targetId === target.id);
    if (report?.status !== "ready_for_manual_test") return null;
    return target;
  }

  function sshTargetVisibleToTeam(target, ownerTeamId) {
    return !ownerTeamId || (target.ownerTeamId ?? "team_local") === ownerTeamId;
  }

  return {
    createManagedTerminalSession,
    createSshConnectionTest,
    createSshTarget,
    nextTerminalBridgeAction,
    queueTerminalBridgeAction,
    recordTerminalBridgeEvent,
    recordTerminalEvidence,
  };
}

function defaultNow() {
  return new Date().toISOString();
}

function normalizeTerminalCwd(value) {
  const cwd = String(value ?? process.cwd()).trim();
  return cwd || process.cwd();
}

function normalizeTerminalRuntimeKind(value) {
  const runtimeKind = String(value ?? "local_pty").trim();
  return ["local_pty", "remote_ssh_relay"].includes(runtimeKind) ? runtimeKind : "local_pty";
}

function normalizeRemoteTerminalShell(value, target) {
  const shell = String(value ?? "").trim();
  if (shell) return shell.replace(/[^\w./-]/g, "").slice(0, 80) || "bash";
  if (target?.platformHint === "windows") return "powershell";
  return "bash";
}

function normalizeSshHost(value) {
  const host = String(value ?? "").trim();
  if (!host) {
    throw new Error("SSH host is required.");
  }
  if (/[\s/@]/.test(host)) {
    throw new Error("SSH host must be a host name or IP address, not a full command.");
  }
  return host;
}

function normalizeSshPort(value) {
  const port = Number(value ?? 22);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SSH port must be between 1 and 65535.");
  }
  return port;
}

function normalizeSshUser(value) {
  const user = String(value ?? "").trim();
  if (!user) {
    throw new Error("SSH user is required.");
  }
  if (/[\s@]/.test(user)) {
    throw new Error("SSH user must not contain spaces or host separators.");
  }
  return user;
}

function normalizeSshAuthMethod(value) {
  const method = String(value ?? "ssh_agent").trim();
  return ["ssh_agent", "private_key_ref", "password_ref", "managed_identity"].includes(method) ? method : "ssh_agent";
}

function normalizeKnownHostPolicy(value) {
  const policy = String(value ?? "strict").trim();
  return ["strict", "pinned_fingerprint", "manual_review"].includes(policy) ? policy : "strict";
}

function normalizeSshWorkspaceRoot(value) {
  const root = String(value ?? "").trim();
  if (!root) {
    throw new Error("SSH workspace root is required.");
  }
  if (root.includes("\0")) {
    throw new Error("SSH workspace root contains an invalid character.");
  }
  return root;
}

function normalizeSshCredentialRef(body, authMethod) {
  const raw = String(body.credentialRef ?? body.keyRef ?? body.passwordRef ?? "").trim();
  if (authMethod === "ssh_agent") {
    return raw || "ssh-agent:default";
  }
  if (!raw) {
    return "external-secret:unconfigured";
  }
  return raw.replace(/[^a-zA-Z0-9:_./-]/g, "_").slice(0, 120);
}

function normalizeKnownHostFingerprint(value) {
  const fingerprint = String(value ?? "").trim();
  if (!fingerprint) return null;
  return fingerprint.replace(/\s+/g, "").slice(0, 160);
}

function normalizeSshPlatformHint(value) {
  const hint = String(value ?? "unknown").trim().toLowerCase();
  return ["linux", "macos", "windows", "unknown"].includes(hint) ? hint : "unknown";
}

function normalizeSshKeySelection(value) {
  const selection = String(value ?? "ssh_agent_default").trim();
  return ["ssh_agent_default", "explicit_key_ref", "managed_identity"].includes(selection) ? selection : "ssh_agent_default";
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (["true", "yes", "1", "on"].includes(value.toLowerCase())) return true;
    if (["false", "no", "0", "off"].includes(value.toLowerCase())) return false;
  }
  return fallback;
}

function sshTrustStatus(knownHostPolicy, fingerprint) {
  if (knownHostPolicy === "pinned_fingerprint" && fingerprint) return "pinned";
  if (knownHostPolicy === "strict") return "known_hosts_required";
  return "manual_review_required";
}

function sshCredentialRedactionRules(authMethod) {
  return {
    plaintextPrivateKey: "never_store",
    password: "never_store",
    credentialRef: "identifier_only",
    logs: "host_user_port_only",
    authMethod,
  };
}

function sshTargetRiskSummary({ authMethod, knownHostPolicy, agentForwarding, keySelection }) {
  const risks = [];
  if (knownHostPolicy === "manual_review") risks.push("host trust requires manual review");
  if (normalizeBoolean(agentForwarding, false)) risks.push("agent forwarding can expose signing capability");
  if (keySelection === "ssh_agent_default") risks.push("default SSH agent key selection may be ambiguous");
  if (authMethod === "password_ref") risks.push("password credential must stay in an external secret store");
  return risks.length ? risks.join("; ") : "strict host verification and external credential reference required";
}

function sshPreflightChecks(target, body = {}) {
  const checks = [
    {
      id: "host",
      label: "Host and port",
      status: target.host && target.port ? "passed" : "failed",
      severity: target.host && target.port ? "info" : "block",
      detail: `${target.host}:${target.port}`,
    },
    {
      id: "auth",
      label: "Credential handling",
      status: target.credentialRef === "external-secret:unconfigured" ? "failed" : "passed",
      severity: target.credentialRef === "external-secret:unconfigured" ? "block" : "info",
      detail: `${target.authMethod}; ${target.credentialStorage}; no plaintext secret stored`,
    },
    {
      id: "host_verification",
      label: "Host verification",
      status: target.knownHostPolicy === "manual_review" ? "needs_review" : "passed",
      severity: target.knownHostPolicy === "manual_review" ? "warn" : "info",
      detail: target.knownHostFingerprint ? `fingerprint ${target.knownHostFingerprint}` : target.trustStatus,
    },
    {
      id: "workspace_root",
      label: "Workspace root",
      status: target.workspaceRoot ? "passed" : "failed",
      severity: target.workspaceRoot ? "info" : "block",
      detail: target.workspaceRoot || "missing",
    },
    {
      id: "agent_forwarding",
      label: "Agent forwarding",
      status: target.agentForwarding ? "needs_review" : "passed",
      severity: target.agentForwarding ? "warn" : "info",
      detail: target.agentForwarding ? "enabled; require admin approval" : "disabled",
    },
    {
      id: "remote_relay",
      label: "Remote relay",
      status: "not_enabled",
      severity: "info",
      detail: "Phase G does not enable remote PTY or managed evidence relay",
    },
  ];
  if (body?.expectLiveConnection === true) {
    checks.push({
      id: "live_connection",
      label: "Live connection",
      status: "not_attempted",
      severity: "warn",
      detail: "Live SSH handshake is reserved for a reviewed connector implementation.",
    });
  }
  return checks;
}

function sshConnectionTestSummary(blocking, warning) {
  if (blocking.length > 0) {
    return `SSH target preflight blocked by ${blocking.map((check) => check.label).join(", ")}.`;
  }
  if (warning.length > 0) {
    return `SSH target preflight needs review for ${warning.map((check) => check.label).join(", ")}.`;
  }
  return "SSH target preflight passed; remote relay remains disabled until Phase H.";
}

function terminalEventSummary(type) {
  switch (type) {
    case "terminal.session.attached":
      return "Managed terminal PTY attached.";
    case "terminal.output.chunk":
      return "Managed terminal output received.";
    case "terminal.resize":
      return "Managed terminal resized.";
    case "terminal.exit":
      return "Managed terminal exited.";
    case "terminal.close":
      return "Managed terminal closed.";
    default:
      return "Managed terminal runtime event.";
  }
}
