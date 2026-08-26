import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkGoalUserSummary, workGoalUserSummaryReply } from "../src/services/work-goal-user-summary.mjs";

test("ordinary goal summary combines progress, quality, latest change and one next step", () => {
  const summary = buildWorkGoalUserSummary({
    goal: { id: "goal_1", title: "完成文章和视频", status: "active" },
    tasks: [
      { id: "article", workItemId: "wi_article", taskTitle: "文章", status: "succeeded" },
      { id: "video", workItemId: "wi_video", taskTitle: "视频", status: "running" },
      { id: "publish", workItemId: "wi_publish", taskTitle: "发布视频", status: "waiting_upstream" },
    ],
    workItems: [{ id: "wi_article", resultVerification: { status: "failed" } }],
    latestChange: { id: "change_1", status: "applied", changes: [{ action: "modify" }, { action: "pause" }] },
  });
  assert.deepEqual(summary.progress, { total: 3, completed: 1, cancelled: 0, failed: 0, running: 1, waiting: 1, needsUser: 0, percent: 33 });
  assert.equal(summary.quality.failed, 1);
  assert.match(summary.nextStep, /文章/);
  assert.deepEqual(summary.nextAction, { kind: "repair_result", workItemId: "wi_article", label: "查看并返工" });
  const reply = workGoalUserSummaryReply(summary, { tasks: [{ taskTitle: "文章", status: "已完成" }] });
  assert.match(reply, /最近调整：已应用：修改 1 项、暂停 1 项/);
  assert.match(reply, /不能当作合格交付/);
});

test("business and software tasks use the same goal summary without a fixed workflow", () => {
  for (const title of ["完成客户方案", "完成软件修复"]) {
    const summary = buildWorkGoalUserSummary({
      goal: { id: title, title },
      tasks: [{ id: "one", title: "独立任务", status: "review" }],
    });
    assert.equal(summary.progress.needsUser, 1);
    assert.match(summary.nextStep, /独立任务/);
    assert.deepEqual(summary.nextAction, { kind: "open_task", workItemId: "one", label: "去处理" });
  }
});

test("a blocked failed result remains visible in the shared ordinary summary", () => {
  const summary = buildWorkGoalUserSummary({
    goal: { id: "goal_repair", title: "完成客户方案" },
    tasks: [{ id: "wi_doc", title: "客户方案", status: "blocked" }],
    workItems: [{ id: "wi_doc", resultVerification: { status: "failed" } }],
  });
  assert.equal(summary.quality.failed, 1);
  assert.equal(summary.nextAction.kind, "repair_result");
  assert.equal(summary.nextAction.workItemId, "wi_doc");
});
