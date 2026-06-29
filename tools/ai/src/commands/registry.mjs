import {
  LOOP_DEFAULT_LEASE_MS,
  LOOP_ENQUEUEABLE_STATES,
  LOOP_RESUMABLE_STATES,
  appendLoopEvent,
  applyLoopHumanGate,
  claimLoopRun,
  compareLoopRegistries,
  createLoopHumanGate,
  findLoopRegistryEntry,
  formatLoopRegistryCheck,
  formatLoopRun,
  heartbeatLoopRun,
  normalizeLoopQueuePriority,
  optionalPositiveInteger,
  readLoopEvents,
  readLoopRegistry,
  rebuildLoopRegistryFromEvents,
  releaseLoopRun,
  requireLoopRegistryEntry,
  timeoutExpiredLoopRuns,
  updateLoopRun,
  writeLoopRegistry,
} from "../loop/registry.mjs";

const loopRegistryCommandsContext = {
  fail: null,
  option: null,
};

export function configureLoopRegistryCommandsContext(context) {
  loopRegistryCommandsContext.fail = context.fail;
  loopRegistryCommandsContext.option = context.option;
}

function requireLoopRegistryCommandsDependency(name) {
  const dependency = loopRegistryCommandsContext[name];
  if (!dependency) throw new Error("Loop registry command dependency has not been configured: " + name);
  return dependency;
}

function fail(...args) {
  return requireLoopRegistryCommandsDependency("fail")(...args);
}

function option(...args) {
  return requireLoopRegistryCommandsDependency("option")(...args);
}

export function loopList(args) {
  const registry = readLoopRegistry();
  const entries = [...registry.runs].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  if (args.includes("--json")) {
    console.log(`${JSON.stringify({ ...registry, runs: entries }, null, 2)}\n`.trimEnd());
    return;
  }

  if (entries.length === 0) {
    console.log("No loop runs recorded.");
    return;
  }

  console.log("Run ID | State | Issue | Adapter | Updated");
  console.log("--- | --- | --- | --- | ---");
  for (const entry of entries) {
    console.log(`${entry.runId} | ${entry.state} | #${entry.issue} | ${entry.adapter} | ${entry.updatedAt}`);
  }
}

export function loopShow(args) {
  const runId = option(args, "--run") ?? option(args, "--run-id");
  if (!runId) fail("Missing --run.");
  const entry = findLoopRegistryEntry(runId);
  if (!entry) fail(`Loop run not found: ${runId}`);
  const events = readLoopEvents(entry);

  if (args.includes("--json")) {
    console.log(`${JSON.stringify({ run: entry, events }, null, 2)}\n`.trimEnd());
    return;
  }

  console.log(formatLoopRun(entry, events));
}

export function loopCancel(args) {
  const entry = requireLoopRegistryEntry(args);
  const reason = option(args, "--reason") ?? "No reason provided.";
  const force = args.includes("--force");

  if (entry.state === "cancelled") {
    console.log(`Loop run already cancelled: ${entry.runId}`);
    return;
  }
  if (entry.state === "completed" && !force) {
    fail("Cannot cancel a completed loop run without --force.");
  }
  if (entry.state === "failed" && !force) {
    fail("Cannot cancel a failed loop run without --force. Use loop-resume or loop-retry.");
  }

  appendLoopEvent(entry, "loop_cancel_requested", entry.state, "Loop cancellation requested.", { reason, force });
  const cancelled = updateLoopRun(entry, {
    state: "cancelled",
    workerId: null,
    heartbeatAt: null,
    leaseExpiresAt: null,
    timeoutAt: null,
    queuePriority: null,
    lastError: reason,
  }, "Loop run cancelled.");
  appendLoopEvent(cancelled, "loop_cancelled", "cancelled", "Loop run cancelled.", { reason, force });
  console.log(`Loop run cancelled: ${entry.runId}`);
}

export function loopResume(args) {
  const entry = requireLoopRegistryEntry(args);
  const reason = option(args, "--reason") ?? "No reason provided.";
  if (!LOOP_RESUMABLE_STATES.includes(entry.state)) {
    fail(`Cannot resume loop run from state ${entry.state}. Resumable states: ${LOOP_RESUMABLE_STATES.join(", ")}.`);
  }

  appendLoopEvent(entry, "loop_resume_requested", entry.state, "Loop resume requested.", { reason });
  updateLoopRun(entry, {
    state: "planned",
    workerId: null,
    heartbeatAt: null,
    leaseExpiresAt: null,
    timeoutAt: null,
    queuePriority: null,
    lastError: null,
  }, "Loop run marked ready to continue.");
  console.log(`Loop run marked ready to continue: ${entry.runId}`);
}


export function loopGateRequest(args) {
  const entry = requireLoopRegistryEntry(args);
  const reason = option(args, "--reason");
  const scope = option(args, "--scope");
  const requestedAction = option(args, "--requested-action") ?? option(args, "--action");
  if (!reason) fail("Missing --reason.");
  if (!scope) fail("Missing --scope.");
  if (!requestedAction) fail("Missing --requested-action.");

  const gate = createLoopHumanGate({
    reason,
    scope,
    requestedAction,
    risk: option(args, "--risk") ?? "medium",
    requestedBy: option(args, "--by") ?? null,
    expiresAt: option(args, "--expires-at") ?? null,
    evidence: option(args, "--evidence") ?? null,
  });
  applyLoopHumanGate(entry, gate, "Human gate requested.");
  console.log(`Human gate requested for loop run: ${entry.runId}`);
}

export function loopGateApprove(args) {
  const entry = requireLoopRegistryEntry(args);
  const by = option(args, "--by");
  if (!by) fail("Missing --by.");
  if (!entry.humanGate || entry.humanGate.state !== "requested") {
    fail("No requested human gate is active for this loop run.");
  }

  const now = new Date().toISOString();
  const gate = {
    ...entry.humanGate,
    state: "approved",
    approvedBy: by,
    approvedAt: now,
    expiresAt: option(args, "--expires-at") ?? entry.humanGate.expiresAt,
    evidence: option(args, "--evidence") ?? entry.humanGate.evidence,
  };
  appendLoopEvent(entry, "loop_human_gate_approved", entry.state, "Human gate approved.", { gateId: gate.gateId, approvedBy: by, evidence: gate.evidence });
  updateLoopRun(entry, { state: "planned", humanGate: gate, humanApproval: by, lastError: null }, "Human gate approved; loop marked ready.");
  console.log(`Human gate approved for loop run: ${entry.runId}`);
}

export function loopGateReject(args) {
  const entry = requireLoopRegistryEntry(args);
  const by = option(args, "--by");
  const reason = option(args, "--reason");
  if (!by) fail("Missing --by.");
  if (!reason) fail("Missing --reason.");
  if (!entry.humanGate || entry.humanGate.state !== "requested") {
    fail("No requested human gate is active for this loop run.");
  }

  const now = new Date().toISOString();
  const gate = {
    ...entry.humanGate,
    state: "rejected",
    rejectedBy: by,
    rejectedAt: now,
    evidence: reason,
  };
  appendLoopEvent(entry, "loop_human_gate_rejected", entry.state, "Human gate rejected.", { gateId: gate.gateId, rejectedBy: by, reason });
  updateLoopRun(entry, { state: "awaiting_human", humanGate: gate, lastError: reason }, "Human gate rejected.");
  console.log(`Human gate rejected for loop run: ${entry.runId}`);
}

export function loopEnqueue(args) {
  const entry = requireLoopRegistryEntry(args);
  const priority = normalizeLoopQueuePriority(option(args, "--priority") ?? "normal");
  const timeoutMs = optionalPositiveInteger(args, "--timeout-ms");
  if (!LOOP_ENQUEUEABLE_STATES.includes(entry.state)) {
    fail(`Cannot enqueue loop run from state ${entry.state}. Enqueueable states: ${LOOP_ENQUEUEABLE_STATES.join(", ")}.`);
  }
  if (entry.state === "queued") {
    if (args.includes("--json")) {
      console.log(JSON.stringify({ run: entry }, null, 2));
      return;
    }
    console.log(`Loop run already queued: ${entry.runId}`);
    return;
  }

  const now = new Date().toISOString();
  const timeoutAt = timeoutMs ? new Date(Date.now() + timeoutMs).toISOString() : null;
  const updates = {
    state: "queued",
    workerId: null,
    heartbeatAt: null,
    leaseExpiresAt: null,
    timeoutAt,
    queuePriority: priority,
    lastError: null,
    updatedAt: now,
  };
  appendLoopEvent(entry, "loop_enqueued", "queued", "Loop run enqueued.", {
    priority,
    timeoutAt,
    timeoutMs: timeoutMs ?? null,
    from: entry.state,
  });
  const queued = updateLoopRun(entry, updates, "Loop run enqueued.");
  if (args.includes("--json")) {
    console.log(JSON.stringify({ run: queued }, null, 2));
    return;
  }
  console.log(`Loop run enqueued: ${queued.runId} (${priority})`);
}

export function loopClaim(args) {
  const workerId = option(args, "--worker");
  if (!workerId) fail("Missing --worker.");
  const runId = option(args, "--run") ?? option(args, "--run-id") ?? null;
  const leaseMs = optionalPositiveInteger(args, "--lease-ms") ?? LOOP_DEFAULT_LEASE_MS;
  const claimed = claimLoopRun({ workerId, runId, leaseMs });
  if (!claimed) {
    if (args.includes("--json")) {
      console.log(JSON.stringify({ run: null }, null, 2));
      return;
    }
    console.log(runId ? `Loop run is not claimable: ${runId}` : "No queued loop runs available.");
    return;
  }

  appendLoopEvent(claimed, "loop_claimed", "claimed", "Loop run claimed.", {
    workerId,
    leaseMs,
    heartbeatAt: claimed.heartbeatAt,
    leaseExpiresAt: claimed.leaseExpiresAt,
    from: "queued",
  });
  appendLoopEvent(claimed, "loop_state_changed", "claimed", "Loop run claimed.", { from: "queued", to: "claimed" });
  if (args.includes("--json")) {
    console.log(JSON.stringify({ run: claimed }, null, 2));
    return;
  }
  console.log(`Loop run claimed: ${claimed.runId} by ${workerId}`);
}

export function loopHeartbeat(args) {
  const runId = option(args, "--run") ?? option(args, "--run-id");
  const workerId = option(args, "--worker");
  if (!runId) fail("Missing --run.");
  if (!workerId) fail("Missing --worker.");
  const leaseMs = optionalPositiveInteger(args, "--lease-ms") ?? LOOP_DEFAULT_LEASE_MS;
  const heartbeat = heartbeatLoopRun({ runId, workerId, leaseMs });
  appendLoopEvent(heartbeat, "loop_heartbeat", "claimed", "Loop worker heartbeat recorded.", {
    workerId,
    leaseMs,
    heartbeatAt: heartbeat.heartbeatAt,
    leaseExpiresAt: heartbeat.leaseExpiresAt,
  });
  if (args.includes("--json")) {
    console.log(JSON.stringify({ run: heartbeat }, null, 2));
    return;
  }
  console.log(`Loop heartbeat recorded: ${heartbeat.runId} by ${workerId}`);
}

export function loopRelease(args) {
  const runId = option(args, "--run") ?? option(args, "--run-id");
  const workerId = option(args, "--worker");
  const toState = option(args, "--to") ?? "queued";
  const reason = option(args, "--reason") ?? "Worker released claim.";
  if (!runId) fail("Missing --run.");
  if (!workerId) fail("Missing --worker.");
  if (!["queued", "planned"].includes(toState)) {
    fail("Invalid --to. Expected queued or planned.");
  }
  const released = releaseLoopRun({ runId, workerId, toState, reason });
  appendLoopEvent(released, "loop_released", toState, "Loop worker claim released.", {
    workerId,
    toState,
    reason,
  });
  appendLoopEvent(released, "loop_state_changed", toState, "Loop worker claim released.", { from: "claimed", to: toState });
  if (args.includes("--json")) {
    console.log(JSON.stringify({ run: released }, null, 2));
    return;
  }
  console.log(`Loop run released: ${released.runId} -> ${toState}`);
}

export function loopTimeoutCheck(args) {
  const timedOut = timeoutExpiredLoopRuns();
  for (const entry of timedOut) {
    appendLoopEvent(entry, "loop_timed_out", "timed_out", entry.lastError ?? "Loop worker lease timed out.", {
      workerId: entry.workerId,
      heartbeatAt: entry.heartbeatAt,
      leaseExpiresAt: entry.leaseExpiresAt,
    });
    appendLoopEvent(entry, "loop_state_changed", "timed_out", "Loop worker lease timed out.", { from: "claimed", to: "timed_out" });
  }
  if (args.includes("--json")) {
    console.log(JSON.stringify({ timedOut }, null, 2));
    return;
  }
  if (timedOut.length === 0) {
    console.log("No loop runs timed out.");
    return;
  }
  console.log(`Timed out ${timedOut.length} loop run(s):`);
  for (const entry of timedOut) {
    console.log(`- ${entry.runId}`);
  }
}


export function loopRegistryCheck(args) {
  const registry = readLoopRegistry();
  const rebuilt = rebuildLoopRegistryFromEvents();
  const result = compareLoopRegistries(registry, rebuilt);
  if (args.includes("--json")) {
    console.log(`${JSON.stringify(result, null, 2)}\n`.trimEnd());
  } else {
    console.log(formatLoopRegistryCheck(result));
  }
  if (!result.ok) {
    fail("Loop registry projection drift detected. Run pnpm ai:loop-registry-rebuild to refresh registry.json.");
  }
}

export function loopRegistryRebuild(args) {
  const rebuilt = rebuildLoopRegistryFromEvents();
  writeLoopRegistry(rebuilt);
  if (args.includes("--json")) {
    console.log(`${JSON.stringify(rebuilt, null, 2)}\n`.trimEnd());
    return;
  }
  console.log(`Loop registry rebuilt with ${rebuilt.runs.length} run(s).`);
}

