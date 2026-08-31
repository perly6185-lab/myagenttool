import assert from "node:assert/strict";
import test from "node:test";

import { createHostOperationsCaseService } from "../src/services/host-operations-cases.mjs";

function harness() {
  const state = { hostOperationsCases: [], hostDiagnosticRuns: [], hostHealthIncidents: [] };
  const target = { id: "ssh_target_1", ownerTeamId: "team_1", createdByUserId: "usr_1", revision: 4 };
  const actor = { teamId: "team_1", userId: "usr_1" };
  let sequence = 0;
  let diagnosticCalls = 0;
  const events = [];
  const service = () => createHostOperationsCaseService({
    state,
    now: () => `2026-08-31T00:00:${String(sequence++).padStart(2, "0")}.000Z`,
    nextId: (prefix) => `${prefix}_${sequence++}`,
    appendEvent: (event) => events.push(event),
    persistStateSoon: () => {},
    runSshHostDiagnosticRun: async (currentTarget, input) => {
      diagnosticCalls += 1;
      const run = {
        id: `hdr_${diagnosticCalls}`,
        ownerTeamId: currentTarget.ownerTeamId,
        createdByUserId: actor.userId,
        sshTargetId: currentTarget.id,
        targetRevision: currentTarget.revision,
        version: 1,
        intent: input.includes("网站") ? "website" : "health",
        understanding: { version: 1, goal: "restore", domain: input.includes("网站") ? "website" : "device", symptom: "unavailable", desiredOutcome: "restore_availability", requestedChange: "none", handling: "read_only_diagnosis", confidence: "high" },
        risk: "read_only",
        steps: [{ action: "failed_services", status: "completed", summary: { version: 1, severity: "warning", finding: "failed_services_found", impact: "service_availability_may_be_affected", nextAction: "review_failed_services", facts: [] } }],
        summary: { version: 1, severity: "warning", finding: "host_warnings_found", impact: "host_attention_recommended", nextAction: "review_warning_findings", facts: [] },
        primaryAction: "failed_services",
        createdAt: "2026-08-31T00:00:10.000Z",
      };
      state.hostDiagnosticRuns.push(run);
      return { ok: true, run };
    },
  });
  return { state, target, actor, events, service, calls: () => diagnosticCalls };
}

test("persists a bounded host operations case and reuses the same structured intent", async () => {
  const h = harness();
  h.state.hostHealthIncidents.push({ id: "hhi_1", ownerTeamId: "team_1", createdByUserId: "usr_1", sshTargetId: h.target.id, status: "open" });
  const first = await h.service().continueCase(h.target, { input: "网站打不开", incidentId: "hhi_1" }, h.actor);
  assert.equal(first.ok, true);
  assert.equal(first.reused, false);
  assert.equal(first.case.status, "diagnosed");
  assert.equal(first.case.nextStep, "check_managed_website");
  assert.equal(first.case.deviceChanged, false);
  assert.equal(first.case.latestRun.id, "hdr_1");
  assert.equal(JSON.stringify(h.state.hostOperationsCases).includes("网站打不开"), false);

  const repeated = await h.service().continueCase(h.target, { input: "网站打不开", incidentId: "hhi_1" }, h.actor);
  assert.equal(repeated.ok, true);
  assert.equal(repeated.reused, true);
  assert.equal(repeated.case.id, first.case.id);
  assert.equal(h.calls(), 1);

  const restored = h.service().listCases(h.target, h.actor);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].latestRun.id, "hdr_1");
  assert.equal(restored[0].timeline.at(-1).kind, "diagnosis_completed");
});

test("hides cases across users and starts a new case after the host revision changes", async () => {
  const h = harness();
  const first = await h.service().continueCase(h.target, { input: "全面检查这台设备" }, h.actor);
  assert.equal(first.ok, true);
  assert.deepEqual(h.service().listCases(h.target, { teamId: "team_1", userId: "usr_2" }), []);

  h.target.revision = 5;
  const next = await h.service().continueCase(h.target, { input: "全面检查这台设备" }, h.actor);
  assert.equal(next.ok, true);
  assert.notEqual(next.case.id, first.case.id);
  assert.equal(h.calls(), 2);
  const previous = h.state.hostOperationsCases.find((item) => item.id === first.case.id);
  assert.equal(previous.status, "needs_help");
  assert.equal(previous.nextStep, "recheck_device_identity");
});

test("rejects foreign health incidents without creating or running a case", async () => {
  const h = harness();
  h.state.hostHealthIncidents.push({ id: "hhi_foreign", ownerTeamId: "team_2", createdByUserId: "usr_2", sshTargetId: h.target.id, status: "open" });
  const result = await h.service().continueCase(h.target, { input: "网站打不开", incidentId: "hhi_foreign" }, h.actor);
  assert.deepEqual(result, { ok: false, status: 404, error: "host_health_incident_not_found" });
  assert.equal(h.calls(), 0);
  assert.equal(h.state.hostOperationsCases.length, 0);
});

test("links the existing governed remediation and records whether the device changed", async () => {
  const h = harness();
  const service = h.service();
  const diagnosis = await service.continueCase(h.target, { input: "网站打不开" }, h.actor);
  const planned = service.syncRemediation(h.target, { id: "hrp_1", diagnosticRunId: diagnosis.run.id, status: "planned", result: null }, h.actor);
  assert.equal(planned.status, "awaiting_confirmation");
  assert.equal(planned.nextStep, "confirm_governed_action");
  assert.equal(planned.deviceChanged, false);

  const completed = service.syncRemediation(h.target, { id: "hrp_1", diagnosticRunId: diagnosis.run.id, status: "completed", result: { changeAttempted: true } }, h.actor);
  assert.equal(completed.status, "recovered");
  assert.equal(completed.nextStep, "case_complete");
  assert.equal(completed.deviceChanged, true);
  assert.equal(completed.timeline.at(-1).kind, "remediation_completed");
});
