import assert from "node:assert/strict";
import { test } from "node:test";
import { projectWorkItemPlanActual } from "../src/services/work-item-plan-actual.mjs";

function intent(overrides = {}) {
  return {
    goal: "更新客户台账",
    expectedOutput: "客户台账.xlsx",
    method: { kind: "template", definitionId: "rtd_1", familyId: "family_1", version: 2, name: "客户更新" },
    action: { accessMode: "write", operation: "update" },
    delivery: { destination: "task" },
    verificationSop: ["运行检查"],
    ...overrides,
  };
}

function review(overrides = {}) {
  return {
    verification: { status: "passed", command: "pnpm test", exitCode: 0, evidenceCount: 1 },
    impact: { status: "prepared" },
    ...overrides,
  };
}

function availableOutcome(files = ["客户台账.xlsx"]) {
  return { status: "available", fileEntries: files.map((name) => ({ name })) };
}

test("plan/actual reconciliation proves a matching result from frozen receipts", () => {
  const contract = intent();
  const result = projectWorkItemPlanActual({
    item: { id: "wi_1", title: "更新客户台账", executionIntentContractSnapshot: contract },
    latestRun: {
      id: "aur_1", status: "done",
      executionContract: {
        intentContract: contract,
        dataContextSnapshot: { digest: "context-v1", sourceCount: 1, sources: [{ name: "客户台账" }] },
      },
      inputMaterialization: {
        receipts: [{ referenceId: "wrr_1", status: "ready" }],
        executionContextSnapshot: { declarationDigest: "context-v1" },
      },
    },
    outcome: availableOutcome(),
    executionReview: review(),
    contextSummary: { delivery: { destination: "task", status: null } },
  });

  assert.equal(result.status, "matched");
  assert.equal(result.checks.every((check) => check.status === "matched"), true);
  assert.equal(result.actual.materializedCount, 1);
  assert.match(result.digest, /^[a-f0-9]{64}$/);
});

test("plan/actual reconciliation detects a requested output format mismatch", () => {
  const contract = intent({ action: { accessMode: "read_only", operation: "read" } });
  const result = projectWorkItemPlanActual({
    item: { id: "wi_2", executionIntentContractSnapshot: contract },
    latestRun: { id: "aur_2", status: "done", executionContract: { intentContract: contract, dataContextSnapshot: { sourceCount: 0, sources: [] } } },
    outcome: availableOutcome(["客户台账.csv"]),
    executionReview: review({ impact: { status: "none" } }),
    contextSummary: { delivery: { destination: "task" } },
  });

  assert.equal(result.status, "attention");
  assert.equal(result.checks.find((check) => check.key === "output").reasonCode, "output_format_mismatch");
  assert.equal(result.deviations[0].correctionTarget, "template");
});

test("plan/actual reconciliation detects a write across a read-only boundary", () => {
  const contract = intent({ expectedOutput: "分析报告", action: { accessMode: "read_only", operation: "read" } });
  const result = projectWorkItemPlanActual({
    item: { id: "wi_3", executionIntentContractSnapshot: contract },
    latestRun: {
      id: "aur_3", status: "pr_open",
      executionContract: { intentContract: contract, dataContextSnapshot: { sourceCount: 0, sources: [] } },
      localDelivery: { prNumber: 42, prUrl: "https://example.test/pull/42" },
    },
    outcome: availableOutcome(["report.md"]),
    executionReview: review({ impact: { status: "proposed" } }),
    contextSummary: { delivery: { destination: "task" } },
  });

  assert.equal(result.status, "attention");
  const action = result.checks.find((check) => check.key === "action");
  assert.equal(action.status, "mismatch");
  assert.equal(action.reasonCode, "read_only_scope_was_written");
});

test("terminal runs with missing receipts remain unverified instead of being called matched", () => {
  const contract = intent({ expectedOutput: "处理结果" });
  const result = projectWorkItemPlanActual({
    item: { id: "wi_4", executionIntentContractSnapshot: contract },
    latestRun: {
      id: "aur_4", status: "done",
      executionContract: {
        intentContract: contract,
        dataContextSnapshot: { digest: "context-v1", sourceCount: 1, sources: [{ name: "输入文件" }] },
      },
    },
    outcome: availableOutcome(["result.md"]),
    executionReview: review({ verification: { status: "not_configured" }, impact: { status: "unknown" } }),
    contextSummary: { delivery: { destination: "task" } },
  });

  assert.equal(result.status, "unverified");
  assert.equal(result.checks.find((check) => check.key === "materials").status, "unknown");
  assert.equal(result.checks.find((check) => check.key === "verification").status, "unknown");
  assert.equal(result.deviations.length, 0);
});

test("active runs expose collection progress without premature deviation warnings", () => {
  const contract = intent({ action: { accessMode: "read_only", operation: "read" } });
  const result = projectWorkItemPlanActual({
    item: { id: "wi_5", executionIntentContractSnapshot: contract },
    latestRun: { id: "aur_5", status: "running", executionContract: { intentContract: contract, dataContextSnapshot: { sourceCount: 0, sources: [] } } },
    outcome: { status: "pending", fileEntries: [] },
    executionReview: review({ verification: { status: "pending" }, impact: { status: "none" } }),
    contextSummary: { delivery: { destination: "task" } },
  });

  assert.equal(result.status, "pending");
  assert.equal(result.deviations.length, 0);
  assert.equal(result.checks.find((check) => check.key === "output").status, "pending");
});

test("a rolled-back planned write is an explicit outcome deviation", () => {
  const contract = intent({ expectedOutput: "客户台账.xlsx" });
  const result = projectWorkItemPlanActual({
    item: { id: "wi_6", executionIntentContractSnapshot: contract },
    latestRun: { id: "aur_6", status: "done", executionContract: { intentContract: contract, dataContextSnapshot: { sourceCount: 0, sources: [] } } },
    outcome: availableOutcome(),
    executionReview: review({ impact: { status: "rolled_back" } }),
    contextSummary: { delivery: { destination: "task" } },
  });

  assert.equal(result.status, "attention");
  assert.equal(result.checks.find((check) => check.key === "action").reasonCode, "planned_write_rolled_back");
});
