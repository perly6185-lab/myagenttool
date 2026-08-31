import assert from "node:assert/strict";
import { test } from "node:test";

import { createHostHealthMonitorService } from "../src/services/host-health-monitor.mjs";

function harness({ credential = { ok: true, credential: { privateKey: "SECRET" } }, diagnostics = [] } = {}) {
  let sequence = 0;
  let time = Date.parse("2026-08-29T00:00:00.000Z");
  let diagnosticIndex = 0;
  const state = {
    sshTargets: [], hostHealthPolicies: [], hostHealthSnapshots: [], hostHealthIncidents: [],
  };
  const events = [];
  let verificationCalls = 0;
  const service = createHostHealthMonitorService({
    state,
    now: () => new Date(time).toISOString(),
    nextId: (prefix) => `${prefix}_${++sequence}`,
    appendEvent: (event) => events.push(event),
    persistStateSoon: () => {},
    resolveCredential: async () => credential,
    verifySshHostConnection: async (target) => {
      verificationCalls += 1;
      target.connectionStatus = "ready";
      target.lastConnectionError = null;
      target.capabilities = { sftp: true };
      return { ok: true, target, verification: { capabilities: target.capabilities } };
    },
    runSshHostDiagnosticRun: async () => diagnostics[Math.min(diagnosticIndex++, diagnostics.length - 1)] ?? healthyDiagnostic(),
  });
  const target = {
    id: "ssh_target_1", ownerTeamId: "team_a", createdByUserId: "usr_a", authMethod: "private_key_ref",
    credentialRef: "credential://ssh/ssh_target_1", knownHostFingerprint: "SHA256:pinned", trustStatus: "pinned",
    connectionStatus: "ready", agentForwarding: false,
  };
  state.sshTargets.push(target);
  return { state, events, service, target, actor: { teamId: "team_a", userId: "usr_a" }, verificationCalls: () => verificationCalls, advance: (ms) => { time += ms; } };
}

function diagnostic(severity, finding = "disk_capacity_warning") {
  const issue = ["warning", "critical"].includes(severity);
  return { ok: true, run: {
    id: `hdr_${severity}_${finding}`,
    summary: { severity, finding: issue ? "host_warnings_found" : "host_no_obvious_issue" },
    steps: [{
      action: "disk_usage", status: "completed",
      summary: { version: 1, severity, finding, impact: issue ? "file_operations_may_fail" : "no_issue_detected", nextAction: issue ? "free_device_space" : "no_action_needed", facts: [] },
    }],
  } };
}

function healthyDiagnostic() {
  return diagnostic("healthy", "disk_capacity_healthy");
}

test("opens one deduplicated incident only after two matching snapshots and stores no raw credential or command output", async () => {
  const h = harness({ diagnostics: [diagnostic("warning"), diagnostic("warning"), diagnostic("warning")] });
  await h.service.checkNow(h.target, h.actor);
  assert.equal(h.service.listOverview(h.target, h.actor).incidents.length, 0);
  await h.service.checkNow(h.target, h.actor);
  await h.service.checkNow(h.target, h.actor);

  const overview = h.service.listOverview(h.target, h.actor);
  assert.equal(overview.incidents.length, 1);
  assert.equal(overview.incidents[0].status, "open");
  assert.equal(overview.incidents[0].occurrenceCount, 3);
  assert.equal(h.events.filter((event) => event.type === "ssh.host_health_incident.opened").length, 1);
  const persisted = JSON.stringify({ snapshots: h.state.hostHealthSnapshots, incidents: h.state.hostHealthIncidents });
  assert.equal(persisted.includes("SECRET"), false);
  assert.equal(persisted.includes("df -h"), false);
  assert.equal(persisted.includes("/dev/sda"), false);
});

test("recovers an open incident only after two healthy confirmations of the same check", async () => {
  const h = harness({ diagnostics: [diagnostic("critical"), diagnostic("critical"), healthyDiagnostic(), healthyDiagnostic()] });
  await h.service.checkNow(h.target, h.actor);
  await h.service.checkNow(h.target, h.actor);
  assert.equal(h.service.listOverview(h.target, h.actor).openIncidentCount, 1);
  await h.service.checkNow(h.target, h.actor);
  assert.equal(h.service.listOverview(h.target, h.actor).openIncidentCount, 1);
  await h.service.checkNow(h.target, h.actor);

  const overview = h.service.listOverview(h.target, h.actor);
  assert.equal(overview.openIncidentCount, 0);
  assert.equal(overview.incidents[0].status, "recovered");
  assert.equal(h.events.filter((event) => event.type === "ssh.host_health_incident.recovered").length, 1);
});

test("recovers a repeated connection incident after two successful connected checks", async () => {
  const unavailable = { ok: false, status: 502, error: "ssh_connection_timeout" };
  const h = harness({ diagnostics: [unavailable, unavailable, healthyDiagnostic(), healthyDiagnostic()] });
  await h.service.checkNow(h.target, h.actor);
  await h.service.checkNow(h.target, h.actor);
  assert.equal(h.service.listOverview(h.target, h.actor).openIncidentCount, 1);
  await h.service.checkNow(h.target, h.actor);
  assert.equal(h.service.listOverview(h.target, h.actor).openIncidentCount, 1);
  await h.service.checkNow(h.target, h.actor);
  assert.equal(h.service.listOverview(h.target, h.actor).openIncidentCount, 0);
  assert.equal(h.service.listOverview(h.target, h.actor).incidents[0].status, "recovered");
});

test("treats an unavailable desktop credential as paused monitoring instead of an offline incident", async () => {
  const h = harness({ credential: { ok: false, error: "ssh_credential_unavailable" } });
  const result = await h.service.checkNow(h.target, h.actor);
  assert.equal(result.snapshot.status, "paused");
  assert.equal(result.snapshot.reason, "sign_in_required");
  assert.equal(h.state.hostHealthIncidents.length, 0);
  assert.equal(h.target.connectionStatus, "ready");
});

test("keeps health history tenant and user scoped", async () => {
  const h = harness();
  await h.service.checkNow(h.target, h.actor);
  assert.equal(h.service.listOverview(h.target, { teamId: "team_a", userId: "usr_b" }).snapshots.length, 0);
  const otherTarget = { ...h.target, id: "ssh_target_2", ownerTeamId: "team_b", createdByUserId: "usr_b" };
  assert.equal(h.service.listOverview(otherTarget, { teamId: "team_b", userId: "usr_b" }).snapshots.length, 0);
});

test("re-verifies SSH and SFTP before clearing a previously unavailable device state", async () => {
  const h = harness();
  h.target.connectionStatus = "error";
  h.target.lastConnectionError = { code: "ssh_connection_timeout", at: "2026-08-28T00:00:00.000Z" };
  h.target.capabilities = null;

  const result = await h.service.checkNow(h.target, h.actor);
  assert.equal(result.snapshot.status, "healthy");
  assert.equal(h.verificationCalls(), 1);
  assert.equal(h.target.connectionStatus, "ready");
  assert.equal(h.target.lastConnectionError, null);
  assert.deepEqual(h.target.capabilities, { sftp: true });
});

test("scheduled monitoring rolls forward, checks once when due, and does not duplicate the same sweep", async () => {
  const h = harness();
  const configured = h.service.setPolicy(h.target, { enabled: true, cadence: "every_6_hours" }, h.actor);
  assert.equal(configured.ok, true);
  assert.equal((await h.service.sweepDue()).checked, 0);
  h.advance(6 * 60 * 60 * 1_000);
  assert.equal((await h.service.sweepDue()).checked, 1);
  assert.equal((await h.service.sweepDue()).checked, 0);
  assert.equal(h.state.hostHealthSnapshots[0].source, "scheduled");
  assert.equal(h.service.listOverview(h.target, h.actor).policy.lastRunStatus, "healthy");
});

test("rejects an unsupported cadence and disables future monitoring without deleting history", async () => {
  const h = harness();
  await h.service.checkNow(h.target, h.actor);
  assert.equal(h.service.setPolicy(h.target, { enabled: true, cadence: "every_minute" }, h.actor).error, "host_health_cadence_invalid");
  const disabled = h.service.setPolicy(h.target, { enabled: false, cadence: "daily" }, h.actor);
  assert.equal(disabled.policy.enabled, false);
  assert.equal(disabled.policy.nextRunAt, null);
  assert.equal(h.service.listOverview(h.target, h.actor).snapshots.length, 1);
});
