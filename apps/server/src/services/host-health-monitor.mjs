import { makeRunTx } from "../runtime/store/run-tx.mjs";

const MAX_SNAPSHOTS_PER_USER_HOST = 100;
const MAX_INCIDENTS_PER_USER_HOST = 50;
const OPEN_CONFIRMATIONS = 2;
const RECOVERY_CONFIRMATIONS = 2;
const CADENCE_MS = Object.freeze({ every_6_hours: 6 * 60 * 60 * 1_000, daily: 24 * 60 * 60 * 1_000 });
const CREDENTIAL_ERRORS = new Set(["ssh_credential_unavailable", "ssh_credential_invalid", "ssh_agent_unavailable"]);
const CONNECTION_ERRORS = new Set(["ssh_connection_failed", "ssh_connection_refused", "ssh_host_unreachable", "ssh_host_unresolvable", "ssh_connection_timeout"]);

export function createHostHealthMonitorService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon,
  resolveCredential,
  verifySshHostConnection,
  runSshHostDiagnosticRun,
  store,
}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  const inFlight = new Map();
  state.hostHealthPolicies ??= [];
  state.hostHealthSnapshots ??= [];
  state.hostHealthIncidents ??= [];

  function listOverview(target, actor) {
    const ownership = ownerKey(target, actor);
    const policy = state.hostHealthPolicies.find((item) => owned(item, ownership)) ?? defaultPolicy(target, actor);
    const snapshots = state.hostHealthSnapshots.filter((item) => owned(item, ownership))
      .sort(newestFirst)
      .slice(0, 20);
    const allIncidents = state.hostHealthIncidents.filter((item) => owned(item, ownership) && item.status !== "observing");
    const incidents = allIncidents
      .sort((left, right) => String(right.lastSeenAt ?? right.recoveredAt ?? right.openedAt).localeCompare(String(left.lastSeenAt ?? left.recoveredAt ?? left.openedAt)))
      .slice(0, 20);
    return {
      policy: publicPolicy(policy),
      latestSnapshot: snapshots[0] ?? null,
      snapshots,
      incidents,
      openIncidentCount: allIncidents.filter((item) => item.status === "open").length,
    };
  }

  function setPolicy(target, body, actor) {
    const enabled = body?.enabled === true;
    const cadence = normalizeCadence(body?.cadence);
    if (!cadence) return { ok: false, status: 400, error: "host_health_cadence_invalid" };
    const ownership = ownerKey(target, actor);
    let policy;
    runTx(() => {
      policy = state.hostHealthPolicies.find((item) => owned(item, ownership));
      const timestamp = now();
      if (!policy) {
        policy = {
          id: nextId("hhp"),
          ...ownership,
          enabled,
          cadence,
          nextRunAt: enabled ? nextTime(timestamp, cadence) : null,
          lastRunAt: null,
          lastRunStatus: null,
          revision: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        state.hostHealthPolicies.push(policy);
      } else {
        policy.enabled = enabled;
        policy.cadence = cadence;
        policy.nextRunAt = enabled ? nextTime(timestamp, cadence) : null;
        policy.revision = Number(policy.revision ?? 0) + 1;
        policy.updatedAt = timestamp;
      }
      appendEvent({
        invocationId: null,
        type: enabled ? "ssh.host_health_monitoring.enabled" : "ssh.host_health_monitoring.disabled",
        level: "info",
        message: enabled ? "Read-only host health monitoring was enabled." : "Host health monitoring was disabled.",
        data: { targetId: target.id, requestedBy: ownership.createdByUserId, cadence },
      });
    });
    return { ok: true, policy: publicPolicy(policy) };
  }

  async function checkNow(target, actor, { source = "manual" } = {}) {
    const ownership = ownerKey(target, actor);
    const key = `${ownership.ownerTeamId}:${ownership.createdByUserId}:${target.id}`;
    if (inFlight.has(key)) return inFlight.get(key);
    const pending = performCheck(target, actor, source).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
    return pending;
  }

  async function performCheck(target, actor, source) {
    const pausedReason = await monitoringPauseReason(target);
    if (pausedReason) {
      const snapshot = recordSnapshot(target, actor, {
        source,
        status: "paused",
        reason: pausedReason,
        severity: "unknown",
        findings: [],
        checkedActions: [],
      });
      updatePolicyAfterRun(target, actor, snapshot);
      return { ok: true, snapshot, incidentsChanged: [] };
    }

    if (target.connectionStatus !== "ready") {
      const verification = await verifySshHostConnection(target);
      if (!verification.ok) return recordCheckFailure(target, actor, source, verification.error);
    }

    const diagnostic = await runSshHostDiagnosticRun(target, "全面检查这台设备", actor);
    if (!diagnostic.ok) {
      return recordCheckFailure(target, actor, source, diagnostic.error);
    }

    const checkedActions = ["connection", ...diagnostic.run.steps.filter((step) => step.status === "completed").map((step) => step.action)];
    const findings = diagnostic.run.steps.flatMap((step) => {
      if (step.status !== "completed" || !step.summary || !["warning", "critical"].includes(step.summary.severity)) return [];
      return [{
        key: `${step.action}:${step.summary.finding}`,
        action: step.action,
        severity: step.summary.severity,
        finding: step.summary.finding,
        impact: step.summary.impact,
        nextAction: step.summary.nextAction,
      }];
    });
    const severity = diagnostic.run.summary.severity;
    const snapshot = recordSnapshot(target, actor, {
      source,
      status: ["warning", "critical"].includes(severity) ? "needs_attention" : severity === "healthy" ? "healthy" : "unknown",
      reason: findings.length ? "findings_detected" : severity === "healthy" ? "no_obvious_issue" : "check_incomplete",
      severity,
      findings,
      checkedActions,
      diagnosticRunId: diagnostic.run.id,
    });
    const incidentsChanged = reconcileIncidents(target, actor, snapshot);
    updatePolicyAfterRun(target, actor, snapshot);
    return { ok: true, snapshot, incidentsChanged };
  }

  function recordCheckFailure(target, actor, source, error) {
    if (CREDENTIAL_ERRORS.has(error)) {
      const snapshot = recordSnapshot(target, actor, {
        source, status: "paused", reason: "sign_in_required", severity: "unknown", findings: [], checkedActions: [],
      });
      updatePolicyAfterRun(target, actor, snapshot);
      return { ok: true, snapshot, incidentsChanged: [] };
    }
    const connectionFailure = CONNECTION_ERRORS.has(error);
    const finding = connectionFailure ? {
      key: "connection:device_unreachable",
      action: "connection",
      severity: "critical",
      finding: "device_unreachable",
      impact: "device_state_unavailable",
      nextAction: "check_device_connection",
    } : null;
    const snapshot = recordSnapshot(target, actor, {
      source,
      status: connectionFailure ? "needs_attention" : "unknown",
      reason: connectionFailure ? "device_unreachable" : "check_incomplete",
      severity: connectionFailure ? "critical" : "unknown",
      findings: finding ? [finding] : [],
      checkedActions: connectionFailure ? ["connection"] : [],
    });
    const incidentsChanged = connectionFailure ? reconcileIncidents(target, actor, snapshot) : [];
    updatePolicyAfterRun(target, actor, snapshot);
    return { ok: true, snapshot, incidentsChanged };
  }

  async function sweepDue() {
    const timestamp = now();
    const due = state.hostHealthPolicies.filter((policy) => policy.enabled && policy.nextRunAt && policy.nextRunAt <= timestamp);
    const results = [];
    for (const policy of due) {
      const target = state.sshTargets.find((item) => item.id === policy.sshTargetId && (item.ownerTeamId ?? "team_local") === policy.ownerTeamId);
      runTx(() => {
        policy.cadence = normalizeCadence(policy.cadence) ?? "daily";
        policy.nextRunAt = nextTime(timestamp, policy.cadence);
        policy.updatedAt = timestamp;
        policy.revision = Number(policy.revision ?? 0) + 1;
      });
      if (!target) continue;
      try {
        results.push(await checkNow(target, { teamId: policy.ownerTeamId, userId: policy.createdByUserId }, { source: "scheduled" }));
      } catch {
        // A failed sweep is retried at the next cadence; never busy-loop or mutate the host.
      }
    }
    return { checked: results.length, due: due.length };
  }

  async function monitoringPauseReason(target) {
    if (target.connectionStatus === "disabled") return "setup_required";
    if (target.agentForwarding) return "setup_required";
    if (!target.knownHostFingerprint || target.trustStatus !== "pinned") return "setup_required";
    if (target.authMethod === "ssh_agent") return process.env.SSH_AUTH_SOCK ? null : "sign_in_required";
    const resolved = await resolveCredential(target.credentialRef);
    return resolved?.ok ? null : "sign_in_required";
  }

  function recordSnapshot(target, actor, input) {
    const ownership = ownerKey(target, actor);
    const snapshot = {
      id: nextId("hhs"),
      ...ownership,
      version: 1,
      source: input.source,
      status: input.status,
      reason: input.reason,
      severity: input.severity,
      findings: input.findings.map((finding) => ({ ...finding })),
      checkedActions: [...new Set(input.checkedActions)],
      diagnosticRunId: input.diagnosticRunId ?? null,
      checkedAt: now(),
    };
    runTx(() => {
      state.hostHealthSnapshots.push(snapshot);
      trimOwned(state.hostHealthSnapshots, ownership, MAX_SNAPSHOTS_PER_USER_HOST, "checkedAt");
      appendEvent({
        invocationId: null,
        type: "ssh.host_health_snapshot.recorded",
        level: snapshot.severity === "critical" ? "error" : snapshot.severity === "warning" ? "warning" : "info",
        message: "A structured read-only host health snapshot was recorded.",
        data: { targetId: target.id, snapshotId: snapshot.id, source: snapshot.source, status: snapshot.status, severity: snapshot.severity, findingCount: snapshot.findings.length },
      });
    });
    return snapshot;
  }

  function reconcileIncidents(target, actor, snapshot) {
    if (!["healthy", "needs_attention"].includes(snapshot.status)) return [];
    const ownership = ownerKey(target, actor);
    const changes = [];
    runTx(() => {
      const active = state.hostHealthIncidents.filter((item) => owned(item, ownership) && item.status !== "recovered");
      const findings = new Map(snapshot.findings.map((finding) => [finding.key, finding]));
      for (const finding of findings.values()) {
        let incident = active.find((item) => item.key === finding.key);
        if (!incident) {
          incident = {
            id: nextId("hhi"),
            ...ownership,
            key: finding.key,
            action: finding.action,
            severity: finding.severity,
            finding: finding.finding,
            impact: finding.impact,
            nextAction: finding.nextAction,
            status: "observing",
            consecutiveFindings: 1,
            consecutiveHealthy: 0,
            occurrenceCount: 1,
            firstSeenAt: snapshot.checkedAt,
            lastSeenAt: snapshot.checkedAt,
            openedAt: null,
            recoveredAt: null,
          };
          state.hostHealthIncidents.push(incident);
          active.push(incident);
        } else {
          incident.consecutiveFindings += 1;
          incident.consecutiveHealthy = 0;
          incident.occurrenceCount += 1;
          incident.lastSeenAt = snapshot.checkedAt;
          incident.severity = finding.severity;
          incident.finding = finding.finding;
          incident.impact = finding.impact;
          incident.nextAction = finding.nextAction;
        }
        if (incident.status === "observing" && incident.consecutiveFindings >= OPEN_CONFIRMATIONS) {
          incident.status = "open";
          incident.openedAt = snapshot.checkedAt;
          changes.push({ type: "opened", incident });
          appendEvent({ invocationId: null, type: "ssh.host_health_incident.opened", level: incident.severity === "critical" ? "error" : "warning", message: "A repeated host health finding opened an incident.", data: { targetId: target.id, incidentId: incident.id, key: incident.key, severity: incident.severity } });
        }
      }

      for (const incident of active) {
        if (findings.has(incident.key) || !snapshot.checkedActions.includes(incident.action)) continue;
        incident.consecutiveFindings = 0;
        incident.consecutiveHealthy += 1;
        if (incident.status === "observing") {
          incident.status = "recovered";
          incident.recoveredAt = snapshot.checkedAt;
        } else if (incident.consecutiveHealthy >= RECOVERY_CONFIRMATIONS) {
          incident.status = "recovered";
          incident.recoveredAt = snapshot.checkedAt;
          changes.push({ type: "recovered", incident });
          appendEvent({ invocationId: null, type: "ssh.host_health_incident.recovered", level: "info", message: "A host health incident was confirmed recovered.", data: { targetId: target.id, incidentId: incident.id, key: incident.key } });
        }
      }
      trimOwned(state.hostHealthIncidents, ownership, MAX_INCIDENTS_PER_USER_HOST, "lastSeenAt");
    });
    return changes.map(({ type, incident }) => ({ type, incident }));
  }

  function updatePolicyAfterRun(target, actor, snapshot) {
    const ownership = ownerKey(target, actor);
    runTx(() => {
      const policy = state.hostHealthPolicies.find((item) => owned(item, ownership));
      if (!policy) return;
      policy.lastRunAt = snapshot.checkedAt;
      policy.lastRunStatus = snapshot.status;
      if (policy.enabled && (!policy.nextRunAt || policy.nextRunAt <= snapshot.checkedAt)) policy.nextRunAt = nextTime(snapshot.checkedAt, policy.cadence);
      policy.updatedAt = snapshot.checkedAt;
    });
  }

  return { checkNow, listOverview, setPolicy, sweepDue };
}

function ownerKey(target, actor) {
  return {
    ownerTeamId: target.ownerTeamId ?? actor?.teamId ?? "team_local",
    createdByUserId: actor?.userId ?? target.createdByUserId ?? "usr_local",
    sshTargetId: target.id,
  };
}

function owned(item, ownership) {
  return item.ownerTeamId === ownership.ownerTeamId && item.createdByUserId === ownership.createdByUserId && item.sshTargetId === ownership.sshTargetId;
}

function defaultPolicy(target, actor) {
  return { id: null, ...ownerKey(target, actor), enabled: false, cadence: "daily", nextRunAt: null, lastRunAt: null, lastRunStatus: null, revision: 0 };
}

function publicPolicy(policy) {
  return { enabled: policy.enabled, cadence: policy.cadence, nextRunAt: policy.nextRunAt, lastRunAt: policy.lastRunAt, lastRunStatus: policy.lastRunStatus, revision: policy.revision };
}

function normalizeCadence(value) {
  const cadence = String(value ?? "daily");
  return Object.hasOwn(CADENCE_MS, cadence) ? cadence : null;
}

function nextTime(timestamp, cadence) {
  return new Date(new Date(timestamp).getTime() + CADENCE_MS[cadence]).toISOString();
}

function newestFirst(left, right) {
  return String(right.checkedAt).localeCompare(String(left.checkedAt));
}

function trimOwned(collection, ownership, limit, timestampKey) {
  const ownedItems = collection.filter((item) => owned(item, ownership)).sort((left, right) => String(right[timestampKey] ?? "").localeCompare(String(left[timestampKey] ?? "")));
  const retired = new Set(ownedItems.slice(limit).map((item) => item.id));
  for (let index = collection.length - 1; index >= 0; index -= 1) {
    if (retired.has(collection[index].id)) collection.splice(index, 1);
  }
}
