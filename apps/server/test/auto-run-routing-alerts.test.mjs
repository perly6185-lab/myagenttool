import assert from "node:assert/strict";
import { test } from "node:test";

import { createServerRuntimeServices, enrichAlertOwnership } from "../src/runtime/service-composer.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";

const now = () => "2026-07-24T12:00:00.000Z";

function harness() {
  const created = createServerState({ defaultProjectPath: process.cwd(), now });
  const { state, defaultProject } = created;
  state.projects = [
    { ...defaultProject, id: "prj_a", ownerTeamId: "team_a" },
    { ...defaultProject, id: "prj_b", ownerTeamId: "team_b" },
  ];
  state.autoRunSettings = {
    routingThresholds: { minSamples: 1, fallbackRate: 0.2, lowConfidenceRate: 0.25, latencyP90Ms: 5000 },
  };
  state.autoRuns = [
    { id: "aur_a", projectId: "prj_a", teamId: "team_a", status: "running", decision: { path: "develop", via: "fallback" } },
    { id: "aur_b", projectId: "prj_b", teamId: "team_b", status: "running", decision: { path: "develop", via: "fallback" } },
  ];
  const built = createServerRuntimeServices({
    namespace: "test",
    protocolVersion: "0.0.0",
    state,
    defaultProject: state.projects[0],
    defaultProjectPath: process.cwd(),
    persistenceEnabled: false,
    stateStorePath: "/tmp/unused-routing-alerts.json",
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });
  return { state, sweep: built.httpDependencies.sweepAutoRunSloAlerts };
}

test("resolved entity ownership overrides conflicting caller-provided alert scope", () => {
  const state = {
    projects: [
      { id: "prj_a", ownerTeamId: "team_a" },
      { id: "prj_b", ownerTeamId: "team_b" },
    ],
    autoRuns: [{ id: "aur_a", projectId: "prj_a", teamId: "stale_team" }],
    workItems: [],
  };
  const alert = enrichAlertOwnership(state, {
    kind: "budget",
    data: { autoRunId: "aur_a", projectId: "prj_b", teamId: "team_b" },
  });
  assert.equal(alert.data.projectId, "prj_a");
  assert.equal(alert.data.teamId, "team_a");
});

test("routing alerts are isolated and deduplicated per team and project", () => {
  const { state, sweep } = harness();
  assert.deepEqual(sweep(), { alerted: true, kind: "routing_health" });
  const alerts = state.alertOutbox.filter((row) => row.alert.kind === "auto_run_routing_health");
  assert.equal(alerts.length, 2);
  assert.deepEqual(
    alerts.map((row) => [row.alert.data.teamId, row.alert.data.projectId]).sort(),
    [["team_a", "prj_a"], ["team_b", "prj_b"]],
  );
  assert.equal(Object.keys(state.autoRunRoutingAlert.signatures).length, 2);

  sweep();
  assert.equal(state.alertOutbox.filter((row) => row.alert.kind === "auto_run_routing_health").length, 2);

  for (const run of state.autoRuns) run.decision = { path: "develop", via: "agent", confidence: 0.9 };
  sweep();
  const recovered = state.alertOutbox.filter((row) => row.alert.kind === "auto_run_routing_health_recovered");
  assert.equal(recovered.length, 2);
  assert.deepEqual(recovered.map((row) => row.alert.data.projectId).sort(), ["prj_a", "prj_b"]);
});

test("SLO alerts are isolated and deduplicated per team and project", () => {
  const { state, sweep } = harness();
  for (const run of state.autoRuns) {
    run.status = "failed";
    run.decision = { path: "develop", via: "agent", confidence: 0.9 };
  }
  sweep();
  const alerts = state.alertOutbox.filter((row) => row.alert.kind === "auto_run_slo_below");
  assert.equal(alerts.length, 2);
  assert.deepEqual(
    alerts.map((row) => [row.alert.data.teamId, row.alert.data.projectId]).sort(),
    [["team_a", "prj_a"], ["team_b", "prj_b"]],
  );
  assert.equal(Object.keys(state.autoRunSloAlert.signatures).length, 2);

  sweep();
  assert.equal(state.alertOutbox.filter((row) => row.alert.kind === "auto_run_slo_below").length, 2);

  for (const run of state.autoRuns) {
    run.status = "pr_open";
    run.createdAt = "2026-07-24T11:59:30.000Z";
    run.updatedAt = now();
  }
  sweep();
  const recovered = state.alertOutbox.filter((row) => row.alert.kind === "auto_run_slo_recovered");
  assert.equal(recovered.length, 2);
  assert.deepEqual(recovered.map((row) => row.alert.data.projectId).sort(), ["prj_a", "prj_b"]);
});

test("SLO window uses the latest outcome time for a long-running job", () => {
  const { state, sweep } = harness();
  state.autoRuns = [{
    id: "aur_long",
    projectId: "prj_a",
    teamId: "team_a",
    status: "failed",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: now(),
    decision: { path: "develop", via: "agent", confidence: 0.9 },
  }];
  sweep();
  const alerts = state.alertOutbox.filter((row) => row.alert.kind === "auto_run_slo_below");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].alert.data.projectId, "prj_a");
});

test("routing alerts re-fire when an existing signal materially worsens", () => {
  const { state, sweep } = harness();
  state.autoRunSettings.routingThresholds.minSamples = 5;
  state.autoRuns = Array.from({ length: 5 }, (_, index) => ({
    id: `aur_${index}`,
    projectId: "prj_a",
    teamId: "team_a",
    status: "running",
    decision: { path: "develop", via: index === 0 ? "fallback" : "agent", confidence: 0.9 },
  }));
  sweep();
  assert.equal(state.alertOutbox.filter((row) => row.alert.kind === "auto_run_routing_health").length, 1);
  sweep();
  assert.equal(state.alertOutbox.filter((row) => row.alert.kind === "auto_run_routing_health").length, 1);

  state.autoRuns[1].decision.via = "fallback";
  sweep();
  const alerts = state.alertOutbox.filter((row) => row.alert.kind === "auto_run_routing_health");
  assert.equal(alerts.length, 2);
  assert.equal(alerts[0].alert.data.worsened, true);
});
