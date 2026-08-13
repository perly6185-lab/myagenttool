import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkItemAutoRunUnderstandingService,
  workItemTemplateInstructions,
} from "../src/services/work-item-auto-run-understanding.mjs";

test("formats a pinned My template as frozen run instructions", () => {
  const instructions = workItemTemplateInstructions({
    myTemplateBinding: {
      name: "客户询价报价",
      version: 2,
      expectedOutput: "报价单 Excel",
      snapshot: {
        templateContract: {
          inputSummary: "设备技术协议 PDF",
          outputFileName: "采购清单.xlsx",
          outputColumns: ["品牌/厂家", "型号", "报价单价"],
          fieldMappings: [
            { column: "型号", source: "设备型号", confidence: "supported" },
            { column: "报价单价", source: "报价单价", confidence: "needs_confirmation" },
          ],
          uncertainFields: ["报价单价"],
        },
        steps: [
          { key: "extract", label: "提取询价项目" },
          { key: "generate", label: "生成报价单" },
        ],
      },
    },
  });
  assert.match(instructions, /客户询价报价 v2/);
  assert.match(instructions, /Expected output: 报价单 Excel/);
  assert.match(instructions, /1\. 提取询价项目/);
  assert.match(instructions, /2\. 生成报价单/);
  assert.match(instructions, /Typical input: 设备技术协议 PDF/);
  assert.match(instructions, /品牌\/厂家 \| 型号 \| 报价单价/);
  assert.match(instructions, /Do not invent values.*报价单价/);
  assert.match(instructions, /compare every output column name and Unicode text value exactly/);
  assert.match(instructions, /user-visible original filename/);
  assert.match(instructions, /documented deliverables\/output directory/);
  assert.equal(workItemTemplateInstructions({}), "");
});

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
    executionBindings: [{ kind: "auto_run", targetId: "aur_1" }],
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
  const state = { autoRuns: [autoRun], workItems: [workItem] };
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

test("an unbound reserved Run is never reconciled into execution", async () => {
  const { service, workItem, calls } = fixture();
  workItem.executionBindings = [];

  const result = await service.reconcile();
  assert.equal(result.checked, 0);
  assert.equal(calls.prepare, 0);
  assert.equal(calls.start, 0);
});
