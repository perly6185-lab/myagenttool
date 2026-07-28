import assert from "node:assert/strict";
import { test } from "node:test";
import { actOnOperationalAlert, reconcileOperationalHealth } from "../src/services/operational-health.mjs";

test("operational health triggers, acknowledges, silences, and recovers alerts", () => {
  let at = "2026-07-24T00:00:00.000Z";
  const state = {
    projects: [],
    autoRuns: [],
    invocations: [],
    webPerformanceMetrics: [],
    eventStreamMetrics: { byTeam: {
      team_a: {
        activeConnections: 0, connections: 10, disconnects: 5, reconnects: 2,
        eventsSent: 2, eventLatencyTotalMs: 100, eventLatencyMaxMs: 80,
      },
    } },
    operationalAlerts: [],
  };
  let health = reconcileOperationalHealth(state, { teamId: "team_a", now: () => at });
  const alert = health.alerts.find((row) => row.key === "stream_disconnect_rate");
  assert.equal(alert.status, "open");

  assert.equal(actOnOperationalAlert(state, {
    teamId: "team_a", alertId: alert.id, action: "acknowledge", actorId: "usr_a", now: () => at,
  }).status, "acknowledged");
  assert.equal(actOnOperationalAlert(state, {
    teamId: "team_a", alertId: alert.id, action: "silence", silenceMinutes: 30, actorId: "usr_a", now: () => at,
  }).status, "silenced");

  state.eventStreamMetrics.byTeam.team_a.disconnects = 0;
  at = "2026-07-24T01:00:00.000Z";
  health = reconcileOperationalHealth(state, { teamId: "team_a", now: () => at });
  assert.equal(health.alerts.find((row) => row.id === alert.id).status, "recovered");
  assert.equal(health.alerts.find((row) => row.id === alert.id).recoveredAt, at);
});

test("operational alert actions cannot cross team boundaries", () => {
  const state = { operationalAlerts: [{ id: "a", teamId: "team_a" }] };
  assert.equal(actOnOperationalAlert(state, {
    teamId: "team_b", alertId: "a", action: "acknowledge", actorId: "usr_b", now: () => new Date().toISOString(),
  }), null);
});

test("operational health proactively reports stuck tasks, offline providers, and credentials", () => {
  const state = {
    projects: [], invocations: [], webPerformanceMetrics: [], operationalAlerts: [],
    eventStreamMetrics: { byTeam: { team_a: {} } },
    autoRuns: [{ id: "run_1", status: "failed", errorCode: "stuck" }],
    agents: [{ id: "agent_1", status: "active", health: { status: "unhealthy" } }],
    applications: [{ id: "app_1", localReadiness: { state: "login_required" } }],
  };
  const health = reconcileOperationalHealth(state, { teamId: "team_a", now: () => "2026-07-25T00:00:00.000Z" });
  assert.deepEqual(
    health.alerts.filter((row) => row.status === "open").map((row) => row.key).sort(),
    ["credential_expired", "provider_offline", "task_stuck"],
  );
});
