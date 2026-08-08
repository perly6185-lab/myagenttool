import assert from "node:assert/strict";
import test from "node:test";

import { createWorkItemAutoRunUnderstandingService } from "../src/services/work-item-auto-run-understanding.mjs";

function fixture({ decisionPath = "develop", existingPlan = null, capacityOnce = false } = {}) {
  const workItem = {
    id: "wi_1",
    ownerTeamId: "team_a",
    projectId: "prj_a",
    title: "Background understanding",
    body: "Implement the requested behavior after the execution contract is ready.",
    revision: 2,
    acceptanceCriteria: [],
    verificationSop: [],
    executionContractConfirmedAt: null,
    executionContractSource: null,
    terminalId: "dev_a",
  };
  const autoRun = {
    id: "aur_1",
    status: "materializing",
    phase: "understanding",
    projectId: "prj_a",
    teamId: "team_a",
    requestedBy: "usr_a",
    agentId: "agt_codex_cli",
    terminalId: "dev_a",
    localIssueId: workItem.id,
    executionChainId: workItem.id,
    autonomyProfile: "standard",
    link: { type: "local_issue", number: 1, title: workItem.title, state: "open", url: null },
    decision: {
      path: decisionPath,
      clarifyingQuestions: decisionPath === "clarify" ? ["Which behavior should be used?"] : [],
    },
    executionPlan: existingPlan ?? { status: "analyzing" },
    launchContext: { name: "local-1-background-understanding", baseBranch: null, taskMaterialWorkItemId: workItem.id },
    worktreeId: null,
    invocationId: null,
  };
  const state = { autoRuns: [autoRun] };
  const calls = { prepare: 0, attach: 0, start: 0, fail: 0, defer: 0, projectContext: null, contextSummary: null };
  const scheduled = [];
  const service = createWorkItemAutoRunUnderstandingService({
    state,
    getWorkItem: () => ({ ok: true, body: { workItem } }),
    decideReservedAutoRun: async (_id, options) => {
      calls.projectContext = options.projectContext;
      calls.contextSummary = options.contextSummary;
      autoRun.understandingContext = options.contextSummary;
      return { autoRun, decision: autoRun.decision, replayed: true };
    },
    prepareExecutionContract: ({ confirm }) => {
      calls.prepare += 1;
      workItem.acceptanceCriteria = ["The requested behavior is observable."];
      workItem.verificationSop = ["Run the focused test."];
      workItem.executionContractConfirmedAt = confirm ? "2026-08-07T01:00:00.000Z" : null;
      workItem.executionContractSource = "assisted";
      workItem.revision += 1;
      return {
        ok: true,
        body: {
          workItem,
          draft: { risks: [], evidence: { generator: "test" }, suggestedRoute: decisionPath },
        },
      };
    },
    attachAutoRunExecutionPlan: (_id, plan) => {
      calls.attach += 1;
      autoRun.executionPlan = {
        ...plan,
        status: decisionPath === "clarify" ? "needs_input" : "ready",
        confirmedAt: decisionPath === "clarify" ? null : plan.confirmedAt,
      };
      if (decisionPath === "clarify") {
        autoRun.status = "needs_input";
        autoRun.phase = "waiting_for_input";
      } else {
        autoRun.phase = "planning";
        autoRun.executionContract = { id: "contract_1", confirmedAt: plan.confirmedAt };
      }
      return { autoRun, executionPlan: autoRun.executionPlan };
    },
    startAutoRun: async (input) => {
      calls.start += 1;
      if (capacityOnce && calls.start === 1) throw new Error("At capacity: 1/1 auto-runs active.");
      assert.equal(input.existingAutoRunId, autoRun.id);
      autoRun.worktreeId = "wtr_1";
      autoRun.invocationId = "inv_1";
      autoRun.phase = "implementing";
      autoRun.status = "running";
      return { autoRun, worktree: { id: "wtr_1" }, invocation: { id: "inv_1" } };
    },
    failAutoRunUnderstanding: () => { calls.fail += 1; },
    deferAutoRunUnderstanding: () => {
      calls.defer += 1;
      autoRun.status = "waiting_capacity";
      autoRun.phase = "planning";
    },
    schedule: (callback) => scheduled.push(callback),
  });
  return { service, state, autoRun, workItem, calls, scheduled };
}

test("enqueue returns immediately and advances the persisted Run in background", async () => {
  const { service, autoRun, calls, scheduled } = fixture();
  assert.equal(service.enqueue(autoRun.id), true);
  assert.equal(autoRun.phase, "understanding");
  assert.equal(autoRun.worktreeId, null);
  assert.equal(calls.prepare, 0);
  assert.equal(scheduled.length, 1);

  await scheduled.shift()();
  assert.equal(calls.prepare, 1);
  assert.equal(calls.attach, 1);
  assert.equal(calls.start, 1);
  assert.equal(autoRun.phase, "implementing");
  assert.equal(autoRun.worktreeId, "wtr_1");
  assert.equal(calls.projectContext.digest.length, 64);
  assert.equal(calls.contextSummary.digest, calls.projectContext.digest);
  assert.equal("documents" in calls.contextSummary, false);
  assert.equal(autoRun.executionPlan.contextSummary.digest, calls.projectContext.digest);
});

test("restart reconciliation resumes an unfinished understanding Run", async () => {
  const { service, autoRun, calls } = fixture();
  const result = await service.reconcile();
  assert.equal(result.checked, 1);
  assert.equal(result.resumed, 1);
  assert.equal(result.failed, 0);
  assert.equal(calls.start, 1);
  assert.equal(autoRun.invocationId, "inv_1");
});

test("background clarification prepares a draft and waits without materializing", async () => {
  const { service, autoRun, workItem, calls } = fixture({ decisionPath: "clarify" });
  const result = await service.processRun(autoRun.id);
  assert.equal(result.waitingForInput, true);
  assert.equal(calls.prepare, 1);
  assert.equal(calls.attach, 1);
  assert.equal(calls.start, 0);
  assert.equal(autoRun.status, "needs_input");
  assert.equal(autoRun.worktreeId, null);
  assert.equal(workItem.executionContractConfirmedAt, null);
});

test("capacity pressure parks the durable Run and a later sweep resumes it", async () => {
  const { service, autoRun, calls } = fixture({ capacityOnce: true });
  const first = await service.processRun(autoRun.id);
  assert.equal(first.waitingCapacity, true);
  assert.equal(autoRun.status, "waiting_capacity");
  assert.equal(calls.defer, 1);
  assert.equal(calls.fail, 0);

  const recovered = await service.reconcile();
  assert.equal(recovered.checked, 1);
  assert.equal(recovered.failed, 0);
  assert.equal(calls.start, 2);
  assert.equal(autoRun.status, "running");
  assert.equal(autoRun.invocationId, "inv_1");
});
