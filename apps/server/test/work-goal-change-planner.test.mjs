import assert from "node:assert/strict";
import test from "node:test";

import {
  planWorkGoalChange,
  workGoalChangeAction,
  workGoalChangeReply,
} from "../src/services/work-goal-change-planner.mjs";

const goal = { id: "goal_dynamic", title: "完成一组真实工作" };

function task(id, kind, title, platform = null, dependencyIds = []) {
  return { id, workItemId: `wi_${id}`, taskKind: kind, taskTitle: title, status: "queued", platformTarget: platform, dependencyIds };
}

test("content adjustments affect only named tasks and preview the untouched work", () => {
  const result = planWorkGoalChange({
    text: "文章改成1500字，图片不动",
    goal,
    tasks: [
      task("article", "content_article", "文章创作"),
      task("image", "content_image", "图片创作"),
      task("video", "content_video", "视频创作"),
    ],
  });

  assert.equal(result.matched, true);
  assert.deepEqual(result.changes.map((change) => [change.action, change.taskKind]), [
    ["modify", "content_article"],
    ["preserve", "content_image"],
  ]);
  assert.deepEqual(result.unchanged.map((item) => item.id), ["image", "video"]);
  assert.match(workGoalChangeReply(result), /文章改成1500字/);
  assert.match(workGoalChangeReply(result), /其余 2 个任务保持不变/);
  assert.match(workGoalChangeReply(result), /确认调整/);
});

test("publication can be rebound per platform without changing another platform", () => {
  const wechat = { id: "wechat_official", label: "公众号" };
  const xhs = { id: "xiaohongshu", label: "小红书" };
  const result = planWorkGoalChange({
    text: "小红书改发视频，公众号还是文章",
    goal,
    tasks: [
      task("article", "content_article", "文章创作"),
      task("video", "content_video", "视频创作"),
      task("wx-adapt", "platform_adaptation", "公众号内容适配", wechat),
      task("wx-publish", "content_publish", "发布到公众号", wechat),
      task("xhs-adapt", "platform_adaptation", "小红书内容适配", xhs),
      task("xhs-publish", "content_publish", "发布到小红书", xhs),
    ],
  });

  assert.equal(result.matched, true);
  const rebind = result.changes.find((change) => change.action === "rebind");
  assert.equal(rebind.platform.id, "xiaohongshu");
  assert.equal(rebind.taskKind, "content_video");
  assert.deepEqual(rebind.targetIds, ["xhs-adapt", "xhs-publish"]);
  assert.ok(result.changes.some((change) => change.action === "preserve" && change.label.includes("公众号")));
  assert.ok(result.unchanged.some((item) => item.id === "wx-publish"));
});

test("software changes preserve verification while pausing deployment", () => {
  const result = planWorkGoalChange({
    text: "部署先暂停，测试继续",
    goal,
    tasks: [
      task("implementation", "software_implementation", "软件实现"),
      task("verification", "software_verification", "软件验证", null, ["wi_implementation"]),
      task("deployment", "software_deployment", "部署发布", null, ["wi_verification"]),
    ],
  });

  assert.deepEqual(result.changes.map((change) => [change.action, change.taskKind]), [
    ["pause", "software_deployment"],
    ["preserve", "software_verification"],
  ]);
  assert.ok(result.unchanged.some((item) => item.id === "implementation"));
});

test("office validation wording cannot add a software verification task to a work goal", () => {
  const office = planWorkGoalChange({
    text: "另外验证一下 Excel 公式和单元格格式",
    goal,
    tasks: [task("document", "business_document", "客户统计表")],
  });
  assert.equal(office.matched, false);
  assert.ok(!office.changes.some((change) => change.taskKind === "software_verification"));

  const development = planWorkGoalChange({
    text: "另外补一个代码回归测试",
    goal,
    tasks: [task("implementation", "software_implementation", "软件实现")],
  });
  assert.equal(development.matched, true);
  assert.ok(development.changes.some((change) =>
    change.action === "add" && change.taskKind === "software_verification"));
});

test("a source modification previews every real downstream impact", () => {
  const result = planWorkGoalChange({
    text: "文章改成1500字，图片不动",
    goal,
    tasks: [
      task("article", "content_article", "文章创作"),
      task("image", "content_image", "图片创作"),
      task("adapt", "platform_adaptation", "公众号内容适配", { id: "wechat_official", label: "公众号" }, ["wi_article"]),
      task("publish", "content_publish", "发布到公众号", { id: "wechat_official", label: "公众号" }, ["wi_adapt"]),
    ],
  });

  assert.deepEqual(result.downstream.map((item) => item.id), ["adapt", "publish"]);
  assert.deepEqual(result.unchanged.map((item) => item.id), ["image"]);
  assert.match(workGoalChangeReply(result), /连带影响/);
  assert.match(workGoalChangeReply(result), /公众号内容适配/);
});

test("business follow-up can add research while preventing external communication", () => {
  const result = planWorkGoalChange({
    text: "方案继续做，但不要发送；另外核对客户付款记录",
    goal,
    tasks: [
      task("document", "business_document", "客户方案"),
      task("communication", "business_communication", "发送给客户"),
    ],
  });

  assert.ok(result.changes.some((change) => change.action === "preserve" && change.taskKind === "business_document"));
  assert.ok(result.changes.some((change) => change.action === "cancel" && change.taskKind === "business_communication"));
  assert.ok(result.changes.some((change) => change.action === "add" && change.taskKind === "business_research"));
});

test("ordinary questions do not enter the change flow", () => {
  const result = planWorkGoalChange({
    text: "现在做到哪了？",
    goal,
    tasks: [task("article", "content_article", "文章创作")],
  });
  assert.equal(result.matched, false);
  assert.equal(workGoalChangeAction("确认调整"), "confirm");
  assert.equal(workGoalChangeAction("取消调整"), "cancel");
});
