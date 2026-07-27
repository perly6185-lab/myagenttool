import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveGuidedReadiness } from "../src/services/guided-readiness.mjs";

const readyDevice = { id: "dev_1", status: "online", unlinkState: "linked" };
const project = { id: "prj_1" };
const agent = { id: "agt_1", status: "available", health: { status: "healthy" } };

test("guided readiness advances from computer to workspace to execution", () => {
  const computer = deriveGuidedReadiness();
  assert.equal(computer.currentStep, "computer");
  assert.equal(computer.status, "action_required");
  assert.deepEqual(computer.steps.map((step) => step.state), ["current", "pending", "pending"]);

  const workspace = deriveGuidedReadiness({ device: readyDevice });
  assert.equal(workspace.currentStep, "workspace");
  assert.equal(workspace.completedCount, 1);

  const execution = deriveGuidedReadiness({ device: readyDevice, projects: [project] });
  assert.equal(execution.currentStep, "execution");
  assert.equal(execution.completedCount, 2);

  const ready = deriveGuidedReadiness({ device: readyDevice, projects: [project], agents: [agent] });
  assert.equal(ready.status, "ready");
  assert.equal(ready.completedCount, 3);
});

test("guided readiness distinguishes approval, install, login, failure, and cancellation", () => {
  const base = { device: readyDevice, projects: [project] };
  assert.equal(deriveGuidedReadiness({
    ...base,
    applications: [{ localReadiness: { state: "not_installed" } }],
  }).status, "waiting_for_approval");
  const installing = deriveGuidedReadiness({
    ...base,
    applicationInstallRuns: [{ id: "air_1", deviceId: "dev_1", status: "running", updatedAt: "2026-07-27T01:00:00Z" }],
  });
  assert.equal(installing.status, "installing");
  assert.equal(installing.runId, null);
  assert.equal(installing.operationRunId, "air_1");
  assert.equal(deriveGuidedReadiness({
    ...base,
    applications: [{ localReadiness: { state: "login_required" } }],
  }).status, "login_required");
  assert.equal(deriveGuidedReadiness({
    ...base,
    applicationInstallRuns: [{ id: "air_2", deviceId: "dev_1", status: "failed", result: { classification: "probe_failed" }, updatedAt: "2026-07-27T02:00:00Z" }],
  }).status, "failed");
  assert.equal(deriveGuidedReadiness({
    ...base,
    applicationInstallRuns: [{ id: "air_3", deviceId: "dev_1", status: "cancelled", updatedAt: "2026-07-27T03:00:00Z" }],
  }).status, "cancelled");
});

test("a recovered ready execution capability wins over an older failed install", () => {
  const state = deriveGuidedReadiness({
    device: readyDevice,
    projects: [project],
    agents: [agent],
    applicationInstallRuns: [{ id: "air_old", deviceId: "dev_1", status: "failed", updatedAt: "2026-07-26T00:00:00Z" }],
  });
  assert.equal(state.status, "ready");
  assert.equal(state.currentStep, "complete");
});

test("a durable guide run preserves identity and cancellation without overriding ready facts", () => {
  const run = {
    id: "gsr_1",
    status: "cancelled",
    createdAt: "2026-07-27T00:00:00Z",
    updatedAt: "2026-07-27T00:01:00Z",
  };
  const cancelled = deriveGuidedReadiness({ run });
  assert.equal(cancelled.runId, "gsr_1");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.reason, "setup_cancelled");
  assert.equal(cancelled.steps[0].state, "cancelled");

  const ready = deriveGuidedReadiness({
    run,
    device: readyDevice,
    projects: [project],
    agents: [agent],
  });
  assert.equal(ready.status, "ready");
  assert.equal(ready.runId, "gsr_1");
});
