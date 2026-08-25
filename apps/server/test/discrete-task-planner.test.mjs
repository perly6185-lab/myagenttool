import test from "node:test";
import assert from "node:assert/strict";
import { planDiscreteTasks, proposeNextTasks, publicationAssignmentsIn } from "../src/services/discrete-task-planner.mjs";

test("a saved source produces proposals, not hidden downstream tasks", () => {
  const result = planDiscreteTasks({
    text: "",
    domain: "content",
    materials: [{ contentId: "lc_article", title: "参考文章" }],
  });
  assert.equal(result.tasks.length, 0);
  assert.ok(result.proposals.some((proposal) => proposal.kind === "knowledge_analysis"));
  assert.ok(result.proposals.every((proposal) => proposal.createsTask === false));
  assert.ok(result.proposals.every((proposal) => !proposal.kind.includes("publish")));
});

test("one explicit intent keeps parallel deliverables independent", () => {
  const result = planDiscreteTasks({
    text: "基于这些资料写一篇深度文章，同时做漫画和口播",
    domain: "content",
    intentId: "intent_content_1",
    materials: [{ contentId: "lc_article", title: "参考文章" }],
  });
  assert.deepEqual(result.tasks.map((task) => task.kind), [
    "content_article", "content_comic", "content_voiceover",
  ]);
  assert.ok(result.tasks.every((task) => task.intentId === "intent_content_1"));
  assert.ok(result.tasks.every((task) => task.requires.length === 0));
  assert.ok(result.tasks.every((task) => task.sourceContentIds[0] === "lc_article"));
});

test("task basket edits re-plan without the removed creative output", () => {
  const result = planDiscreteTasks({
    text: "基于这些资料写深度文章、做漫画和口播",
    domain: "content",
    excludeKinds: ["content_comic"],
  });
  assert.deepEqual(result.tasks.map((task) => task.kind), ["content_article", "content_voiceover"]);
});

test("external effects remain separate approval-gated tasks", () => {
  const content = planDiscreteTasks({ text: "把成品发布到公众号", domain: "content" });
  assert.deepEqual(content.tasks.map((task) => task.kind), ["platform_adaptation", "wechat_draft_sync", "content_publish"]);
  assert.equal(content.tasks[1].gate, "external_effect_approval");
  assert.equal(content.tasks[2].gate, "approved_output_required");
  assert.equal(content.tasks[2].approvalRequired, true);
  assert.deepEqual(content.tasks[2].requires, [content.tasks[0].key, content.tasks[1].key]);
  assert.deepEqual(content.tasks[0].artifactContract.produces, ["wechat_article_package"]);
  assert.deepEqual(content.tasks[1].artifactContract.produces, ["wechat_draft_receipt"]);

  const development = planDiscreteTasks({ text: "实现功能、跑测试，之后部署上线", domain: "development" });
  assert.deepEqual(development.tasks.map((task) => task.kind), [
    "software_implementation", "software_verification", "software_deployment",
  ]);
  assert.equal(development.tasks.at(-1).approvalRequired, true);
  assert.deepEqual(development.tasks.find((task) => task.kind === "software_implementation").artifactContract.verification.requiredKinds, ["test", "build"]);
});

test("content task contracts carry the right measurable quality checks", () => {
  const result = planDiscreteTasks({ text: "写一篇深度文章，同时做漫画、口播和视频", domain: "content" });
  const qualityByKind = new Map(result.tasks.map((task) => [task.kind, task.artifactContract.requirements[0].quality]));
  assert.deepEqual(qualityByKind.get("content_article"), { minChars: 800, minSections: 3 });
  assert.deepEqual(qualityByKind.get("content_comic"), { minPages: 4 });
  assert.deepEqual(qualityByKind.get("content_voiceover"), { minDurationSeconds: 30 });
  assert.deepEqual(qualityByKind.get("content_video"), { minWidth: 1280, minHeight: 720 });
});

test("an unspecified publishing destination asks before creating a publish task", () => {
  const result = planDiscreteTasks({ text: "把今天编码的工作整理为文章、图片，发布到对应平台" });
  assert.equal(result.clarification.kind, "platform_targets");
  assert.deepEqual(result.tasks.map((task) => task.kind), ["coding_digest", "content_article", "content_image"]);
  assert.ok(!result.tasks.some((task) => task.kind === "content_publish"));
});

test("business work uses the same atomic planning contract", () => {
  const result = planDiscreteTasks({ text: "完成市场调研，准备方案，再发送邮件给客户", domain: "business" });
  assert.deepEqual(result.tasks.map((task) => task.kind), [
    "business_research", "business_document", "business_communication",
  ]);
  assert.equal(result.tasks.at(-1).approvalRequired, true);
  assert.ok(proposeNextTasks({ domain: "business" }).every((proposal) => proposal.createsTask === false));
});

test("professional registry plans independent company jobs with typed handoffs", () => {
  const samples = [
    ["筛选这批简历并安排面试", ["hr_candidate_screening", "hr_interview_scheduling"]],
    ["核对发票和银行流水，然后发起付款申请", ["finance_reconciliation", "finance_payment_request"]],
    ["审查合同风险并给出修订稿", ["legal_contract_review", "legal_document_revision"]],
    ["对比供应商报价并提交采购审批", ["procurement_quote_comparison", "procurement_approval_request"]],
    ["分析Excel里的销售数据并生成图表", ["data_analysis", "data_visualization"]],
  ];
  for (const [text, kinds] of samples) {
    const plan = planDiscreteTasks({ text });
    assert.deepEqual(plan.tasks.map((task) => task.kind), kinds, text);
    assert.deepEqual(plan.tasks[1].requires, [plan.tasks[0].key], text);
    assert.equal(plan.tasks[1].artifactContract.consumes.length, 1, text);
  }
});

test("a duplicate professional task kind can be removed by its stable task key only", () => {
  const plan = planDiscreteTasks({
    text: "写文章，全部发布到公众号和小红书",
    excludeTaskKeys: ["platform_adaptation:xiaohongshu"],
  });
  assert.ok(plan.tasks.some((task) => task.key === "platform_adaptation:wechat_official"));
  assert.ok(!plan.tasks.some((task) => task.key === "platform_adaptation:xiaohongshu"));
});

test("ambiguous multi-output publication asks for mapping instead of coupling every output", () => {
  const result = planDiscreteTasks({
    text: "把今天编码的工作整理为文章、图片，发布到公众号和小红书",
    intentId: "goal_daily_coding",
  });
  assert.deepEqual(result.tasks.map((task) => task.kind), [
    "coding_digest",
    "content_article",
    "content_image",
  ]);
  assert.ok(!result.tasks.some((task) => task.kind === "software_implementation"));
  assert.deepEqual(result.tasks.find((task) => task.kind === "content_article").requires, ["coding_digest"]);
  assert.deepEqual(result.tasks.find((task) => task.kind === "content_image").requires, ["coding_digest"]);
  assert.equal(result.clarification.kind, "publication_content_mapping");
  assert.deepEqual(result.goal.platforms.map((platform) => platform.id), ["wechat_official", "xiaohongshu"]);
});

test("an explicit output-to-platform mapping creates only the stated hard dependencies", () => {
  const text = "把今天编码的工作整理为文章、图片；文章发布到公众号，图片发布到小红书";
  const platforms = [{ id: "wechat_official", label: "公众号" }, { id: "xiaohongshu", label: "小红书" }];
  const assignments = publicationAssignmentsIn(text, {
    platforms,
    contentKinds: ["content_article", "content_image"],
  });
  const result = planDiscreteTasks({ text, platformTargets: platforms, publicationAssignments: assignments });
  const wechat = result.tasks.find((task) => task.kind === "platform_adaptation" && task.platform.id === "wechat_official");
  const xiaohongshu = result.tasks.find((task) => task.kind === "platform_adaptation" && task.platform.id === "xiaohongshu");
  assert.deepEqual(wechat.requires, ["content_article"]);
  assert.deepEqual(wechat.artifactContract.consumes, ["article_draft"]);
  assert.deepEqual(xiaohongshu.requires, ["content_image"]);
  assert.deepEqual(xiaohongshu.artifactContract.consumes, ["image_set"]);
  assert.equal(result.clarification, null);
});

test("ordinary shorthand can explicitly map every selected output to every selected platform", () => {
  const platforms = [{ id: "wechat_official", label: "公众号" }, { id: "xiaohongshu", label: "小红书" }];
  const assignments = publicationAssignmentsIn("全部都发", {
    platforms,
    contentKinds: ["content_article", "content_image"],
  });
  assert.deepEqual(assignments.map((assignment) => ({
    platform: assignment.platform.id,
    contentKinds: assignment.contentKinds,
  })), [
    { platform: "wechat_official", contentKinds: ["content_article", "content_image"] },
    { platform: "xiaohongshu", contentKinds: ["content_article", "content_image"] },
  ]);
});

test("parallel article and image outputs stay independent unless the user links them", () => {
  const independent = planDiscreteTasks({ text: "基于资料写文章和图片", domain: "content" });
  assert.deepEqual(independent.tasks.find((task) => task.kind === "content_image").requires, []);
  const linked = planDiscreteTasks({ text: "基于资料写文章并为文章配图", domain: "content" });
  assert.deepEqual(linked.tasks.find((task) => task.kind === "content_image").requires, ["content_article"]);
});

test("saving to the WeChat draft box is not interpreted as public publishing", () => {
  const result = planDiscreteTasks({ text: "把这篇文章同步到公众号草稿箱", domain: "content" });
  assert.deepEqual(result.tasks.map((task) => task.kind), ["content_article", "platform_adaptation", "wechat_draft_sync"]);
  assert.ok(!result.tasks.some((task) => task.kind === "content_publish"));
  assert.equal(result.tasks.at(-1).approvalRequired, true);
});

test("negated platforms are excluded from publication planning", () => {
  const result = planDiscreteTasks({ text: "写文章，不要发小红书，只发布到公众号" });
  assert.deepEqual(result.goal.platforms.map((platform) => platform.id), ["wechat_official"]);
  assert.equal(result.tasks.filter((task) => task.kind === "content_publish").length, 1);
  assert.equal(result.tasks.find((task) => task.kind === "content_publish").platform.id, "wechat_official");
});

test("alternative platforms ask for one explicit choice", () => {
  const result = planDiscreteTasks({ text: "写好文章后发布到公众号或小红书" });
  assert.equal(result.clarification.kind, "platform_choice");
  assert.deepEqual(result.clarification.options.map((platform) => platform.id), ["wechat_official", "xiaohongshu"]);
  assert.ok(!result.tasks.some((task) => task.kind === "content_publish"));
});

test("conditional creation waits for upstream review", () => {
  const result = planDiscreteTasks({ text: "先写文章，文章确认后再做图片" });
  const image = result.tasks.find((task) => task.kind === "content_image");
  assert.deepEqual(image.requires, ["content_article"]);
  assert.equal(image.gate, "upstream_review_required");
  assert.equal(image.approvalRequired, true);
});

test("requested image quantity becomes a structured artifact requirement", () => {
  const result = planDiscreteTasks({ text: "写一篇文章并做3张配图" });
  const image = result.tasks.find((task) => task.kind === "content_image");
  assert.deepEqual(image.artifactContract.requirements[0], {
    kind: "image_set",
    minCount: 3,
    extensions: [".png", ".jpg", ".jpeg", ".webp", ".gif"],
    families: ["image"],
  });
});

test("ordinary negation and deferral exclude work that the user did not commit", () => {
  const content = planDiscreteTasks({ text: "公众号发文章，小红书发图片，视频暂时不做" });
  assert.ok(!content.tasks.some((task) => task.kind === "content_video"));

  const deferred = planDiscreteTasks({ text: "先做文章，图片稍后再说", domain: "content" });
  assert.deepEqual(deferred.tasks.map((task) => task.kind), ["content_article"]);

  const development = planDiscreteTasks({ text: "修掉登录问题并跑测试，但先不要部署", domain: "development" });
  assert.deepEqual(development.tasks.map((task) => task.kind), [
    "software_implementation", "software_verification",
  ]);
  assert.deepEqual(development.tasks[1].requires, ["software_implementation"]);
  assert.deepEqual(development.tasks[1].artifactContract.consumes, ["software_change"]);

  const business = planDiscreteTasks({ text: "给客户发邮件，会议下周再约", domain: "business" });
  assert.deepEqual(business.tasks.map((task) => task.kind), ["business_communication"]);
});

test("conditional intent creates a review gate instead of pretending the future task is unconditional", () => {
  const result = planDiscreteTasks({
    text: "先看看这个链接讲了什么，觉得合适再写文章",
    domain: "content",
  });
  assert.deepEqual(result.tasks.map((task) => task.kind), ["knowledge_analysis", "content_article"]);
  assert.deepEqual(result.tasks[1].requires, ["knowledge_analysis"]);
  assert.equal(result.tasks[1].gate, "upstream_review_required");
  assert.equal(result.tasks[1].approvalRequired, true);
});

test("ordinary software and business wording produces real artifact handoffs", () => {
  const software = planDiscreteTasks({
    text: "分析这个仓库为什么变慢，修好后跑测试，测试通过后部署",
    domain: "development",
  });
  assert.deepEqual(software.tasks.map((task) => task.kind), [
    "software_analysis", "software_implementation", "software_verification", "software_deployment",
  ]);
  assert.deepEqual(software.tasks[1].requires, ["software_analysis"]);
  assert.deepEqual(software.tasks[2].requires, ["software_implementation"]);
  assert.deepEqual(software.tasks[3].requires, ["software_verification"]);

  const business = planDiscreteTasks({
    text: "提炼合同要点，再出一版报价方案，先别发客户",
    domain: "business",
  });
  assert.deepEqual(business.tasks.map((task) => task.kind), ["business_research", "business_document"]);
  assert.deepEqual(business.tasks[1].requires, ["business_research"]);

  const draft = planDiscreteTasks({
    text: "整理客户资料并给销售写一封跟进邮件，邮件只要草稿",
    domain: "business",
  });
  assert.deepEqual(draft.tasks.map((task) => task.kind), ["business_research", "business_document"]);
  assert.ok(!draft.tasks.some((task) => task.kind === "business_communication"));
});

test("bare publication language asks for a target and never publishes conditionally by itself", () => {
  const result = planDiscreteTasks({ text: "今晚把文章发布，但如果封面没准备好就先不要发" });
  assert.equal(result.clarification?.kind, "platform_targets");
  assert.ok(!result.tasks.some((task) => task.kind === "content_publish"));
});

test("existing outputs and discussion topics remain context instead of becoming duplicate tasks", () => {
  const image = planDiscreteTasks({
    text: "做五张配图，文章已经有了",
    domain: "content",
  });
  assert.deepEqual(image.tasks.map((task) => task.kind), ["content_image"]);

  const deploy = planDiscreteTasks({
    text: "把已经测试通过的版本部署上线",
    domain: "development",
  });
  assert.deepEqual(deploy.tasks.map((task) => task.kind), ["software_deployment"]);

  const meeting = planDiscreteTasks({
    text: "安排会议讨论下周合作方案",
    domain: "business",
  });
  assert.deepEqual(meeting.tasks.map((task) => task.kind), ["business_scheduling"]);
});
