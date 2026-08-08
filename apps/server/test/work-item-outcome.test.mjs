import assert from "node:assert/strict";
import test from "node:test";
import { projectWorkItemOutcome } from "../src/services/work-item-outcome.mjs";

test("projects report-only and delivery runs into the same user outcome", () => {
  const reportOutcome = projectWorkItemOutcome({
    item: { outputAssets: [] },
    latestRun: {
      status: "report_posted",
      updatedAt: "2026-08-08T12:49:03.984Z",
      report: "# 文章总结\n\n## 核心主题（一句话）\n\n确定性工作流让 AI 更安全地进入生产。\n\n### 1. 生产工程更重要\n\n### 2. AI 应可降级\n\n- 融资数字尚未独立核验。",
    },
    invocationSummary: "结果见 [REPORT.md](D:\\worktree\\summary\\REPORT.md)",
  });
  assert.equal(reportOutcome.status, "available");
  assert.equal(reportOutcome.summary, "确定性工作流让 AI 更安全地进入生产。");
  assert.deepEqual(reportOutcome.highlights, ["生产工程更重要", "AI 应可降级"]);
  assert.match(reportOutcome.warnings[0], /尚未独立核验/);
  assert.deepEqual(reportOutcome.files, ["D:/worktree/summary/REPORT.md"]);

  const deliveryOutcome = projectWorkItemOutcome({
    item: { outputAssets: [{ path: "deliverables/result.md" }] },
    latestRun: { status: "done", updatedAt: "2026-08-08T10:00:00.000Z" },
    deliveryReport: {
      summary: "已完成技术协议评审。\n\n- 已核对关键参数\n- 已整理询价风险",
      verification: { passed: true, verified: true, summary: "Checks passed." },
      changedFiles: ["deliverables/result.md"],
      completedAt: "2026-08-08T09:59:00.000Z",
    },
  });
  assert.equal(deliveryOutcome.status, "available");
  assert.equal(deliveryOutcome.summary, "已完成技术协议评审。");
  assert.deepEqual(deliveryOutcome.highlights, ["已核对关键参数", "已整理询价风险"]);
  assert.deepEqual(deliveryOutcome.files, ["deliverables/result.md"]);
  assert.equal(deliveryOutcome.verification.verified, true);
});

test("marks a terminal run without a readable result as missing", () => {
  const outcome = projectWorkItemOutcome({
    item: {},
    latestRun: { status: "report_posted", updatedAt: "2026-08-08T10:00:00.000Z" },
  });
  assert.equal(outcome.status, "missing");
  assert.equal(outcome.fullReport, null);
});
