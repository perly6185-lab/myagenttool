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

test("office and professional quality checks do not become software verification tasks", () => {
  const samples = [
    ["用 officecli 更新 sales.xlsx，并验证公式和单元格格式", []],
    ["整理 Excel 客户表格并测试公式是否正确", ["business_document"]],
    ["制作季度汇报 PPT，并验证每页排版无误", ["presentation_creation"]],
    ["核对发票和银行流水，并验证金额一致", ["finance_reconciliation"]],
    ["审查合同风险，并验证条款编号连续", ["legal_contract_review"]],
    ["写一篇文章并验证文中的链接有效", ["content_article"]],
    ["Create the report with officecli and verify the spreadsheet formulas", []],
    ["Use office CLI to update the workbook, then run a validation", []],
  ];

  for (const [text, expectedKinds] of samples) {
    const plan = planDiscreteTasks({ text });
    assert.deepEqual(plan.tasks.map((task) => task.kind), expectedKinds, text);
    assert.ok(!plan.tasks.some((task) => task.kind === "software_verification"), text);
    assert.ok(plan.tasks.every((task) => task.artifactContract.verification == null), text);
  }
});

test("explicit software test requests still produce software verification", () => {
  const samples = [
    ["跑一下测试", ["software_verification"]],
    ["运行 pnpm test 验证代码改动", ["software_verification"]],
    ["修改代码修复登录 bug，并跑回归测试", ["software_implementation", "software_verification"]],
    ["Run the API integration tests", ["software_verification"]],
    ["验证登录功能是否正常", ["software_verification"]],
  ];

  for (const [text, expectedKinds] of samples) {
    const plan = planDiscreteTasks({ text });
    assert.deepEqual(plan.tasks.map((task) => task.kind), expectedKinds, text);
    const verification = plan.tasks.find((task) => task.kind === "software_verification");
    assert.deepEqual(verification.artifactContract.verification.requiredKinds, ["test", "build"], text);
  }
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
  assert.deepEqual(result.tasks.map((task) => task.kind), ["platform_adaptation", "wechat_draft_sync"]);
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

test("professional intent understands ordinary language and company shorthand", () => {
  const samples = [
    ["帮我过一遍这批CV，把合适的人约来聊聊", ["hr_candidate_screening", "hr_interview_scheduling"]],
    ["把本月账对一下，没问题就走付款", ["finance_reconciliation", "finance_payment_request"]],
    ["看看这份协议哪些条款有坑，按建议改一版", ["legal_contract_review", "legal_document_revision"]],
    ["工单按紧急程度排一下，再给客户回信", ["support_case_triage", "support_response_draft"]],
    ["三家报价选一家，走采购流程", ["procurement_quote_comparison", "procurement_approval_request"]],
    ["把CRM里的机会补齐，再催一下重点客户", ["sales_pipeline_update", "sales_followup"]],
    ["总结这次项目踩坑，做个汇报 deck", ["operations_retrospective", "presentation_creation"]],
    ["这份使用说明从中文转成英文，版式别动", ["document_translation"]],
    ["看看Q2营收趋势，画几张图", ["data_analysis", "data_visualization"]],
  ];
  for (const [text, expectedKinds] of samples) {
    assert.deepEqual(planDiscreteTasks({ text }).tasks.map((task) => task.kind), expectedKinds, text);
  }
});

test("professional negation never creates an unwanted external-effect task", () => {
  const samples = [
    ["只筛选简历，不安排面试", ["hr_candidate_screening"]],
    ["先核对发票和流水，付款申请暂不做", ["finance_reconciliation"]],
    ["合同只审风险，不要修改", ["legal_contract_review"]],
    ["客诉只分类，先别回复客户", ["support_case_triage"]],
    ["供应商先比价，不提交采购审批", ["procurement_quote_comparison"]],
    ["更新商机表，暂时不联系客户", ["sales_pipeline_update"]],
  ];
  for (const [text, expectedKinds] of samples) {
    assert.deepEqual(planDiscreteTasks({ text }).tasks.map((task) => task.kind), expectedKinds, text);
  }
});

test("existing professional results are inputs instead of duplicate upstream tasks", () => {
  assert.deepEqual(
    planDiscreteTasks({ text: "合同已经审完，按审查意见修订" }).tasks.map((task) => task.kind),
    ["legal_document_revision"],
  );
  assert.deepEqual(
    planDiscreteTasks({ text: "销售数据分析已经完成，只生成图表" }).tasks.map((task) => task.kind),
    ["data_visualization"],
  );
});

test("same professional task kind keeps separate scopes and stable keys", () => {
  const screening = planDiscreteTasks({ text: "分别筛选北京和上海两批简历" });
  assert.deepEqual(screening.tasks.map((task) => task.kind), ["hr_candidate_screening", "hr_candidate_screening"]);
  assert.deepEqual(screening.tasks.map((task) => task.instanceScope), ["北京", "上海"]);
  assert.equal(new Set(screening.tasks.map((task) => task.key)).size, 2);

  const translation = planDiscreteTasks({ text: "把中文和日文两份手册分别翻译成英文" });
  assert.deepEqual(translation.tasks.map((task) => task.kind), ["document_translation", "document_translation"]);
  assert.deepEqual(translation.tasks.map((task) => task.instanceScope), ["中文", "日文"]);

  const data = planDiscreteTasks({ text: "把北京和上海两份销售数据分别分析一下" });
  assert.deepEqual(data.tasks.map((task) => task.kind), ["data_analysis", "data_analysis"]);
  assert.deepEqual(data.tasks.map((task) => task.instanceScope), ["北京", "上海"]);

  const legal = planDiscreteTasks({ text: "A合同和B合同分别审查风险" });
  assert.deepEqual(legal.tasks.map((task) => task.kind), ["legal_contract_review", "legal_contract_review"]);
  assert.deepEqual(legal.tasks.map((task) => task.instanceScope), ["A合同", "B合同"]);

  const sales = planDiscreteTasks({ text: "分别跟进甲公司和乙公司两个客户" });
  assert.deepEqual(sales.tasks.map((task) => task.kind), ["sales_followup", "sales_followup"]);
  assert.deepEqual(sales.tasks.map((task) => task.instanceScope), ["甲公司", "乙公司"]);

  const threeLanguages = planDiscreteTasks({ text: "把中文、日文和韩文三份说明分别翻成英文" });
  assert.deepEqual(threeLanguages.tasks.map((task) => task.instanceScope), ["中文", "日文", "韩文"]);
});

test("professional shorthand keeps preparation, submission, analysis, and presentation boundaries", () => {
  const samples = [
    ["先别走款，付款申请单给我准备一份", ["finance_payment_request_draft"]],
    ["对账已经做完，准备申请并提交付款", ["finance_payment_request_draft", "finance_payment_request"]],
    ["三家报价比一下，申请单先准备好，今天不要送审", ["procurement_quote_comparison", "procurement_approval_draft"]],
    ["销售分析报告已有，出三张趋势图", ["data_visualization"]],
    ["客户投诉比较急，分下优先级，再给我一版回复", ["support_case_triage", "support_response_draft"]],
    ["法务合同审一下，财务对账一下，最后做个汇报PPT", ["finance_reconciliation", "legal_contract_review", "presentation_creation"]],
    ["这个月营收咋样，顺手出个图", ["data_analysis", "data_visualization"]],
    ["把客户资料梳理清楚", ["business_research"]],
    ["合同不用审了，按现有意见直接改一版", ["legal_document_revision"]],
  ];
  for (const [text, expectedKinds] of samples) {
    assert.deepEqual(planDiscreteTasks({ text }).tasks.map((task) => task.kind), expectedKinds, text);
  }
});

test("professional ambiguity asks one useful question instead of silently returning no work", () => {
  for (const text of ["帮我处理一下这批合同", "把客户的事情处理好", "看看这些数字"]) {
    const plan = planDiscreteTasks({ text });
    assert.deepEqual(plan.tasks, [], text);
    assert.equal(plan.clarification?.kind, "professional_action", text);
  }
});

test("professional clarification does not intercept a concrete file mutation", () => {
  const plan = planDiscreteTasks({
    text: "回款已到账，请确认回款：把 receivables.csv 里的 AR-3001 的 回款状态改成 已回款",
  });
  assert.equal(plan.clarification, null);
  assert.deepEqual(plan.tasks, []);
});

test("publication wording does not leak into software work and account selection blocks side effects", () => {
  const publish = planDiscreteTasks({ text: "写一篇文章并公开发布到公众号" });
  assert.deepEqual(publish.tasks.map((task) => task.kind), [
    "content_article", "platform_adaptation", "wechat_draft_sync", "content_publish",
  ]);
  assert.ok(!publish.tasks.some((task) => task.kind === "software_implementation"));

  const xiaohongshuOnly = planDiscreteTasks({ text: "先写公众号文章，审核通过后发到小红书" });
  assert.deepEqual(xiaohongshuOnly.tasks.filter((task) => task.kind === "content_publish")
    .map((task) => task.platform.id), ["xiaohongshu"]);

  const account = planDiscreteTasks({ text: "把现成文章发到公司的第二个公众号" });
  assert.deepEqual(account.tasks, []);
  assert.equal(account.clarification?.kind, "account_choice");
});

test("preparing financial approvals stays separate from submitting them", () => {
  const payment = planDiscreteTasks({ text: "根据对账差异准备付款申请，但先别提交" });
  assert.deepEqual(payment.tasks.map((task) => task.kind), ["finance_payment_request_draft"]);
  assert.equal(payment.tasks[0].approvalRequired, false);
  assert.equal(payment.tasks[0].gate, null);

  const procurement = planDiscreteTasks({ text: "根据比价结果起草采购申请，暂时不送审" });
  assert.deepEqual(procurement.tasks.map((task) => task.kind), ["procurement_approval_draft"]);
  assert.equal(procurement.tasks[0].approvalRequired, false);

  const paymentBoth = planDiscreteTasks({ text: "先准备付款申请，再提交付款申请" });
  assert.deepEqual(paymentBoth.tasks.map((task) => task.kind), ["finance_payment_request_draft", "finance_payment_request"]);
  assert.deepEqual(paymentBoth.tasks[1].requires, [paymentBoth.tasks[0].key]);
  assert.deepEqual(paymentBoth.tasks[1].artifactContract.consumes, ["payment_request_draft"]);

  const procurementBoth = planDiscreteTasks({ text: "先起草采购申请，再送审采购申请" });
  assert.deepEqual(procurementBoth.tasks.map((task) => task.kind), ["procurement_approval_draft", "procurement_approval_request"]);
  assert.deepEqual(procurementBoth.tasks[1].requires, [procurementBoth.tasks[0].key]);
  assert.deepEqual(procurementBoth.tasks[1].artifactContract.consumes, ["procurement_request_draft"]);
});
