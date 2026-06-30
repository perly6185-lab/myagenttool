import { Terminal } from "/vendor/xterm/lib/xterm.mjs";
import { FitAddon } from "/vendor/xterm-addon-fit/lib/addon-fit.mjs";

export function createTerminalSurface({
  els,
  emptyMiniCard,
  onTerminalInput,
  shortTime,
}) {
  const terminalView = createTerminalView(onTerminalInput);

  function renderTerminalSurface(state) {
    const capability = state?.terminalRuntimeCapability ?? null;
    const session = latestTerminalSession(state);
    const evidence = terminalEvidenceForSession(state, session);
    els.terminalRuntimeStatus.textContent = capability?.localPty?.available
      ? "Managed local PTY available"
      : capability?.localPty?.reason ?? "Managed runtime capability not reported";
    els.terminalShellSummary.textContent = session
      ? `${session.shell} · ${session.status}`
      : `Default ${capability?.defaultShell ?? "unknown"} · attach unavailable`;
    els.terminalCwdSummary.textContent = session?.cwd ?? "No managed cwd registered";
    els.terminalSshSummary.textContent = terminalSshSummary(state, capability);
    els.terminalSessionSummary.textContent = session
      ? `${session.terminalSessionId} · ${session.runtimeKind} · ${session.status}`
      : "No terminal session registered";
    const linkedCodex = session?.ownerCodexSessionId
      ? state?.codexSessions?.find((item) => item.id === session.ownerCodexSessionId)
      : null;
    els.terminalCodexSummary.textContent = linkedCodex
      ? `${linkedCodex.id} · ${linkedCodex.sessionMode} · ${linkedCodex.status}`
      : "No Codex session linked";
    els.terminalEvidenceSummary.textContent = evidence.length
      ? `${evidence.length} terminal evidence record(s), summary-first`
      : "No terminal evidence";
    els.terminalPolicySummary.textContent = session
      ? `${session.policyProfile}; ${session.approvalPolicy}; ${session.networkPolicy}`
      : "Do not present unmanaged terminal output as managed proof";
    els.createTerminalSessionButton.disabled = false;
    els.resizeTerminalButton.disabled = session?.status !== "attached";
    els.closeTerminalSessionButton.disabled = !session || ["closed", "exited"].includes(session.status);
    renderTerminalEmulator(session, evidence);
    renderTerminalProgress(state, session, evidence);
  }

  function fitTerminalView() {
    try {
      terminalView.fit.fit();
    } catch {
      // The terminal can be hidden during mode switches; it will fit on the next render.
    }
  }

  function terminalSize() {
    return { cols: terminalView.terminal.cols, rows: terminalView.terminal.rows };
  }

  function renderTerminalEmulator(session, evidence) {
    if (!terminalView.opened) {
      terminalView.terminal.open(els.terminalOutputPreview);
      terminalView.opened = true;
      queueMicrotask(() => fitTerminalView());
    }

    if (!session) {
      if (terminalView.sessionId !== null) {
        terminalView.terminal.reset();
        terminalView.renderedEvidenceIds.clear();
        terminalView.sessionId = null;
      }
      if (terminalView.renderedEvidenceIds.size === 0) {
        terminalView.terminal.write("Managed terminal output appears here after you attach a managed PTY.\r\n");
        terminalView.renderedEvidenceIds.add("empty");
      }
      return;
    }

    if (terminalView.sessionId !== session.terminalSessionId) {
      terminalView.terminal.reset();
      terminalView.renderedEvidenceIds.clear();
      terminalView.sessionId = session.terminalSessionId;
    }

    const outputRecords = [...evidence]
      .filter((record) => record.type === "terminal_output_chunk")
      .sort((a, b) => Date.parse(a.createdAt ?? 0) - Date.parse(b.createdAt ?? 0));
    for (const record of outputRecords) {
      if (terminalView.renderedEvidenceIds.has(record.id)) continue;
      terminalView.terminal.write(String(record.data?.outputPreview ?? ""));
      terminalView.renderedEvidenceIds.add(record.id);
    }
    fitTerminalView();
  }

  function renderTerminalProgress(state, session, evidence) {
    const actions = (state?.terminalBridgeActions ?? [])
      .filter((action) => !session || action.terminalSessionId === session.terminalSessionId)
      .map((action) => ({
        at: action.completedAt ?? action.dispatchedAt ?? action.createdAt,
        label: terminalActionLabel(action),
        detail: `${action.actionType} · ${action.status}`
      }));
    const events = (state?.events ?? [])
      .filter((event) => !session || event.data?.terminalSessionId === session.terminalSessionId)
      .map((event) => ({
        at: event.createdAt,
        label: terminalEventLabel(event.type),
        detail: event.message
      }));
    const evidenceItems = evidence
      .filter((record) => ["terminal_input", "terminal_resize", "terminal_session_start", "terminal_exit", "terminal_policy_event"].includes(record.type))
      .map((record) => ({
        at: record.createdAt,
        label: terminalEvidenceLabel(record.type),
        detail: record.data?.inputSummary ?? record.summary
      }));
    const items = [...actions, ...events, ...evidenceItems]
      .filter((item) => item.at)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, 10);
    els.terminalProgressList.replaceChildren(
      ...(items.length ? items.map((item) => terminalProgressItem(item, shortTime)) : [emptyMiniCard("No managed terminal operation has run yet.")])
    );
  }

  return {
    fitTerminalView,
    latestCodexSession,
    latestSshTarget,
    latestTerminalSession,
    renderSshTargets: (state) => renderSshTargets(state, els),
    renderTerminalSurface,
    terminalSize,
  };
}

function latestTerminalSession(state) {
  return state?.terminalSessions?.[0] ?? null;
}

function latestSshTarget(state) {
  return state?.sshTargets?.[0] ?? null;
}

function latestSshTestForTarget(state, target) {
  if (!target) return state?.sshConnectionTests?.[0] ?? null;
  return state?.sshConnectionTests?.find((item) => item.targetId === target.id) ?? null;
}

function terminalSshSummary(state, capability) {
  const target = latestSshTarget(state);
  const test = latestSshTestForTarget(state, target);
  if (!capability?.ssh?.available) {
    return capability?.ssh?.reason ?? "SSH connector not reported";
  }
  if (!target) {
    return "SSH target registry available; no target registered";
  }
  const relay = target.remoteRelayEnabled ? "relay enabled" : "relay disabled";
  return `${target.user}@${target.host}:${target.port} · ${test?.status ?? target.status} · ${relay}`;
}

function latestCodexSession(state) {
  return state?.codexSessions?.[0] ?? null;
}

function terminalEvidenceForSession(state, session) {
  const records = state?.terminalEvidenceRecords ?? [];
  if (!session) return records.slice(0, 8);
  return records.filter((record) => record.terminalSessionId === session.terminalSessionId);
}

function createTerminalView(onTerminalInput) {
  const terminal = new Terminal({
    cursorBlink: true,
    convertEol: false,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
    fontSize: 13,
    theme: {
      background: "#0f1714",
      foreground: "#e4f5e9",
      cursor: "#e4f5e9"
    }
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  let opened = false;
  let sessionId = null;
  const renderedEvidenceIds = new Set();

  terminal.onData(onTerminalInput);

  return { terminal, fit, opened, sessionId, renderedEvidenceIds };
}

function terminalProgressItem(item, shortTime) {
  const row = document.createElement("article");
  row.className = "terminal-progress-item";
  const time = document.createElement("span");
  time.textContent = shortTime(item.at);
  const copy = document.createElement("div");
  const label = document.createElement("strong");
  label.textContent = item.label;
  const detail = document.createElement("p");
  detail.textContent = item.detail;
  copy.append(label, detail);
  row.append(time, copy);
  return row;
}

function terminalActionLabel(action) {
  const labels = {
    create: "Attach requested",
    input: "Input queued",
    resize: "Resize queued",
    close: "Close queued"
  };
  return labels[action.actionType] ?? "Terminal action";
}

function terminalEventLabel(type) {
  const labels = {
    "terminal.session.create": "Session registered",
    "terminal.session.attached": "PTY attached",
    "terminal.input.submit": "Input submitted",
    "terminal.output.chunk": "Output received",
    "terminal.resize": "Terminal resized",
    "terminal.exit": "Terminal exited",
    "terminal.close": "Terminal closed",
    "terminal.runtime.warning": "Runtime warning"
  };
  return labels[type] ?? "Terminal event";
}

function terminalEvidenceLabel(type) {
  const labels = {
    terminal_session_start: "Session evidence",
    terminal_input: "Input evidence",
    terminal_resize: "Resize evidence",
    terminal_exit: "Exit evidence",
    terminal_policy_event: "Policy evidence"
  };
  return labels[type] ?? "Evidence recorded";
}

function renderSshTargets(state, els) {
  const target = latestSshTarget(state);
  const report = latestSshTestForTarget(state, target);
  els.sshTargetLatest.textContent = target
    ? `${target.user}@${target.host}:${target.port} · ${target.status}`
    : "No SSH target registered";
  els.sshTargetTrust.textContent = target
    ? `${target.knownHostPolicy} · ${target.trustStatus}`
    : "No host trust policy recorded";
  els.sshTargetCredential.textContent = target
    ? `${target.authMethod} · ${target.credentialStorage} · ${target.credentialRef}`
    : "No credential reference recorded";
  els.sshTargetRelay.textContent = target?.remoteRelayEnabled
    ? "Remote relay enabled"
    : "Remote relay not enabled";
  els.sshTargetTestReport.textContent = report ? sshTestReportText(report) : "SSH preflight results appear here.";
}

function sshTestReportText(report) {
  const checks = (report.checks ?? [])
    .map((check) => `- ${check.label}: ${check.status} (${check.detail})`)
    .join("\n");
  return [
    `${report.status}: ${report.summary}`,
    checks,
    `Next: ${report.nextAction ?? "No next action recorded."}`
  ].filter(Boolean).join("\n");
}
