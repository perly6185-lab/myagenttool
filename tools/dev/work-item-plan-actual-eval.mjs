import { projectWorkItemPlanActual } from "../../apps/server/src/services/work-item-plan-actual.mjs";

const passedVerification = { verification: { status: "passed", command: "check", exitCode: 0, evidenceCount: 1 }, impact: { status: "prepared" } };

function contract(overrides = {}) {
  return {
    goal: "完成任务",
    expectedOutput: "result.md",
    method: { kind: "custom", definitionId: null, familyId: null, version: null, name: null },
    action: { accessMode: "write", operation: "update" },
    delivery: { destination: "task" },
    verificationSop: ["执行检查"],
    ...overrides,
  };
}

function scenario({
  id,
  domain,
  expectedStatus,
  expectedReason = null,
  intent = contract(),
  run = {},
  outcome = { status: "available", fileEntries: [{ name: "result.md" }] },
  executionReview = passedVerification,
  contextSummary = { delivery: { destination: "task", status: null } },
}) {
  return {
    id, domain, expectedStatus, expectedReason,
    input: {
      item: { id: `wi_${id}`, title: intent.goal, executionIntentContractSnapshot: intent },
      latestRun: {
        id: `aur_${id}`, status: "done",
        executionContract: { intentContract: intent, dataContextSnapshot: { sourceCount: 0, sources: [] } },
        ...run,
      },
      outcome,
      executionReview,
      contextSummary,
    },
  };
}

const cases = [
  scenario({
    id: "development_verified_change", domain: "development", expectedStatus: "matched",
    intent: contract({ goal: "修复登录回归", expectedOutput: "修复代码", action: { accessMode: "write", operation: "update" } }),
    outcome: { status: "available", fileEntries: [{ name: "auth-service.ts" }, { name: "auth-service.test.ts" }] },
  }),
  scenario({
    id: "office_workbook_update", domain: "office", expectedStatus: "matched",
    intent: contract({ goal: "更新客户台账", expectedOutput: "客户台账.xlsx", action: { accessMode: "write", operation: "update" } }),
    outcome: { status: "available", fileEntries: [{ name: "客户台账.xlsx" }] },
    executionReview: { ...passedVerification, impact: { status: "applied" } },
  }),
  scenario({
    id: "wrong_workbook_format", domain: "office", expectedStatus: "attention", expectedReason: "output_format_mismatch",
    intent: contract({ expectedOutput: "客户台账.xlsx", action: { accessMode: "read_only", operation: "read" } }),
    outcome: { status: "available", fileEntries: [{ name: "客户台账.csv" }] },
    executionReview: { ...passedVerification, impact: { status: "none" } },
  }),
  scenario({
    id: "read_only_created_pr", domain: "development", expectedStatus: "attention", expectedReason: "read_only_scope_was_written",
    intent: contract({ expectedOutput: "分析报告", action: { accessMode: "read_only", operation: "read" } }),
    run: { status: "pr_open", localDelivery: { prNumber: 18, prUrl: "https://example.test/pull/18" } },
    outcome: { status: "available", fileEntries: [{ name: "analysis.md" }] },
    executionReview: { ...passedVerification, impact: { status: "proposed" } },
  }),
  scenario({
    id: "material_version_drift", domain: "office", expectedStatus: "attention", expectedReason: "material_snapshot_changed",
    intent: contract({ expectedOutput: "result.md", action: { accessMode: "read_only", operation: "read" } }),
    run: {
      executionContract: {
        intentContract: contract({ expectedOutput: "result.md", action: { accessMode: "read_only", operation: "read" } }),
        dataContextSnapshot: { digest: "declared-v1", sourceCount: 1, sources: [{ name: "报价单.xlsx" }] },
      },
      inputMaterialization: {
        receipts: [{ status: "ready" }],
        executionContextSnapshot: { declarationDigest: "declared-v2" },
      },
    },
    executionReview: { ...passedVerification, impact: { status: "none" } },
  }),
  scenario({
    id: "missing_material_receipt", domain: "office", expectedStatus: "unverified", expectedReason: "material_use_not_proven",
    run: {
      executionContract: {
        intentContract: contract(),
        dataContextSnapshot: { digest: "declared-v1", sourceCount: 1, sources: [{ name: "订单.xlsx" }] },
      },
    },
  }),
  scenario({
    id: "channel_delivery_failed", domain: "office", expectedStatus: "attention", expectedReason: "channel_delivery_failed",
    intent: contract({ delivery: { destination: "channel" }, action: { accessMode: "read_only", operation: "read" } }),
    executionReview: { ...passedVerification, impact: { status: "none" } },
    contextSummary: { delivery: { destination: "channel", status: "failed_terminal" } },
  }),
  scenario({
    id: "office_batch_rolled_back", domain: "office", expectedStatus: "attention", expectedReason: "planned_write_rolled_back",
    intent: contract({ goal: "更新客户台账", expectedOutput: "客户台账.xlsx", action: { accessMode: "write", operation: "update" } }),
    outcome: { status: "available", fileEntries: [{ name: "客户台账.xlsx" }] },
    executionReview: { ...passedVerification, impact: { status: "rolled_back" } },
  }),
  scenario({
    id: "active_run", domain: "development", expectedStatus: "pending",
    run: { status: "running" },
    outcome: { status: "pending", fileEntries: [] },
    executionReview: { verification: { status: "pending" }, impact: { status: "none" } },
  }),
];

const rows = cases.map((entry) => {
  const actual = projectWorkItemPlanActual(entry.input);
  const reasonFound = !entry.expectedReason
    || actual.checks.some((check) => check.reasonCode === entry.expectedReason);
  const statusCorrect = actual.status === entry.expectedStatus;
  const falseDeviation = entry.expectedStatus !== "attention" && actual.deviations.length > 0;
  return {
    id: entry.id,
    domain: entry.domain,
    expectedStatus: entry.expectedStatus,
    actualStatus: actual.status,
    expectedReason: entry.expectedReason,
    reasonFound,
    statusCorrect,
    falseDeviation,
    passed: statusCorrect && reasonFound && !falseDeviation,
  };
});

const summary = {
  schemaVersion: 1,
  caseCount: rows.length,
  domainCoverage: [...new Set(rows.map((row) => row.domain))],
  statusAccuracy: rows.filter((row) => row.statusCorrect).length / rows.length,
  reasonRecall: rows.filter((row) => !row.expectedReason || row.reasonFound).length / rows.length,
  falseDeviationRate: rows.filter((row) => row.falseDeviation).length / rows.length,
  passed: rows.every((row) => row.passed),
};

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify({ summary, cases: rows }, null, 2)}\n`);
} else {
  console.log(`Plan/actual evaluation: ${rows.filter((row) => row.passed).length}/${rows.length} passed`);
  console.log(`Status accuracy: ${(summary.statusAccuracy * 100).toFixed(1)}%`);
  console.log(`Reason recall: ${(summary.reasonRecall * 100).toFixed(1)}%`);
  console.log(`False-deviation rate: ${(summary.falseDeviationRate * 100).toFixed(1)}%`);
  for (const row of rows.filter((candidate) => !candidate.passed)) {
    console.log(`FAIL ${row.id}: expected ${row.expectedStatus}/${row.expectedReason ?? "-"}, got ${row.actualStatus}`);
  }
}

if (!summary.passed) process.exitCode = 1;
