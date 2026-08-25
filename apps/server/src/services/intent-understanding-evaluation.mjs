import { planDiscreteTasks } from "./discrete-task-planner.mjs";
import { validateTaskPlan } from "./task-plan-contract.mjs";

export const INTENT_EVALUATION_BASE_CASES = [
  {
    id: "creator-coding-to-content",
    text: "把今天编码的工作整理为文章和图片，文章发布到公众号，图片发布到小红书",
    expectedKinds: ["coding_digest", "content_article", "content_image", "platform_adaptation", "wechat_draft_sync", "content_publish", "platform_adaptation", "content_publish"],
  },
  {
    id: "creator-ambiguous-content-platform-mapping",
    text: "把今天编码的工作整理为文章、图片，发布到公众号和小红书",
    expectedKinds: ["coding_digest", "content_article", "content_image"],
    expectedClarification: "publication_content_mapping",
  },
  {
    id: "creator-independent-derivatives",
    text: "基于这些资料写深度文章、做漫画和口播",
    domain: "content",
    expectedKinds: ["content_article", "content_comic", "content_voiceover"],
    independent: true,
  },
  {
    id: "creator-ambiguous-platform",
    text: "写好文章后发布到对应平台",
    expectedClarification: "platform_targets",
    expectedKinds: ["content_article"],
  },
  {
    id: "software-change-lifecycle",
    text: "分析问题、实现修复、跑测试，之后部署上线",
    domain: "development",
    expectedKinds: ["software_analysis", "software_implementation", "software_verification", "software_deployment"],
  },
  {
    id: "business-customer-followup",
    text: "完成客户调研，准备方案，再发送邮件给客户",
    domain: "business",
    expectedKinds: ["business_research", "business_document", "business_communication"],
  },
  {
    id: "creator-no-publication",
    text: "写一篇文章，不要发小红书，只发布到公众号",
    expectedKinds: ["content_article", "platform_adaptation", "wechat_draft_sync", "content_publish"],
    forbiddenPlatform: "xiaohongshu",
  },
  { id: "source-only", text: "", domain: "content", expectedKinds: [], expectedClarification: null },
];

// Distinct, out-of-distribution utterances are kept separate from punctuation
// variants. These exercise ordinary negation, deferral, conditional intent and
// cross-role language so a green score cannot be earned by memorizing seven
// demo sentences.
export const INTENT_EVALUATION_REAL_CASES = [
  { id: "real-defer-video", text: "先把文章写出来，视频稍后再说", expectedKinds: ["content_article"], tags: ["defer"] },
  { id: "real-no-customer-send", text: "整理客户方案，但先不要发送邮件", expectedKinds: ["business_document"], tags: ["negation", "business"] },
  { id: "real-conditional-article", text: "先看看资料讲什么，觉得合适再写文章", expectedKinds: ["knowledge_analysis", "content_article"], tags: ["conditional", "content"] },
  { id: "real-link-analysis", text: "帮我分析一下这个链接里的内容", expectedKinds: ["knowledge_analysis"], tags: ["content"] },
  { id: "real-fix-and-test", text: "把这个 bug 修好并跑测试", expectedKinds: ["software_implementation", "software_verification"], tags: ["development"] },
  { id: "real-root-cause-only", text: "看看当前系统为什么报错，先别改", expectedKinds: ["software_analysis"], tags: ["negation", "development"] },
  { id: "real-client-research-proposal", text: "整理客户资料，然后基于调研做客户方案", expectedKinds: ["business_research", "business_document"], tags: ["business"] },
  { id: "real-contract-points", text: "提炼合同要点，形成内部汇报", expectedKinds: ["business_research", "business_document"], tags: ["business"] },
  { id: "real-bare-publish", text: "把文章发布", expectedKinds: [], expectedClarification: "platform_targets", tags: ["clarification", "content", "existing-input"] },
  { id: "real-wechat-draft", text: "把文章保存到公众号草稿箱", expectedKinds: ["platform_adaptation", "wechat_draft_sync"], tags: ["content", "existing-input"] },
  { id: "real-write-only", text: "写一篇文章，暂时不发布", expectedKinds: ["content_article"], tags: ["defer", "content"] },
  { id: "real-parallel-creative", text: "根据资料写文章并做三张配图", expectedKinds: ["content_article", "content_image"], tags: ["content"] },
  { id: "real-deploy-only", text: "把已经测试通过的版本部署上线", domain: "development", expectedKinds: ["software_deployment"], tags: ["development", "existing-input"] },
  { id: "real-schedule", text: "安排会议讨论下周合作方案", domain: "business", expectedKinds: ["business_scheduling"], tags: ["business", "context-only"] },
  { id: "real-email-draft", text: "起草一封客户跟进邮件，不要发", domain: "business", expectedKinds: ["business_document"], tags: ["negation", "business"] },
  { id: "real-email-send", text: "准备客户跟进邮件，然后发送邮件给客户", domain: "business", expectedKinds: ["business_document", "business_communication"], tags: ["business"] },
  { id: "real-image-only", text: "做五张配图，文章已经有了", domain: "content", expectedKinds: ["content_image"], tags: ["content", "existing-input"] },
  { id: "real-platform-alternative", text: "文章发布到公众号或者知乎", expectedKinds: ["content_article"], expectedClarification: "platform_choice", tags: ["clarification", "content"] },
  { id: "real-all-platforms", text: "写文章和做图片，全部内容都发布到公众号和小红书", expectedKinds: ["content_article", "content_image", "platform_adaptation", "wechat_draft_sync", "content_publish", "platform_adaptation", "content_publish"], tags: ["content"] },
  { id: "real-no-task", text: "这个先放一放，不用处理", expectedKinds: [], expectedClarification: null, tags: ["defer"] },
  { id: "natural-negated-article", text: "不要写文章，只做三张配图", expectedKinds: ["content_image"], tags: ["natural", "negation", "content"] },
  { id: "natural-conditional-image", text: "先分析资料，合适的话再做三张配图", expectedKinds: ["knowledge_analysis", "content_image"], expectedDependencies: { content_image: ["knowledge_analysis"] }, expectedGates: { content_image: "upstream_review_required" }, tags: ["natural", "conditional", "content"] },
  { id: "natural-publish-mapping", text: "文章发公众号，图片发小红书", expectedKinds: ["content_article", "content_image", "platform_adaptation", "wechat_draft_sync", "content_publish", "platform_adaptation", "content_publish"], tags: ["natural", "content"] },
  { id: "natural-defer-test-deploy", text: "修复 bug，测试先不用跑，部署也先别做", expectedKinds: ["software_implementation"], tags: ["natural", "negation", "development"] },
  { id: "natural-root-cause", text: "先排查为什么报错，不要改代码", expectedKinds: ["software_analysis"], tags: ["natural", "negation", "development"] },
  { id: "natural-mail-send", text: "整理客户资料，做报价方案，然后邮件发给客户", expectedKinds: ["business_research", "business_document", "business_communication"], expectedDependencies: { business_document: ["business_research"], business_communication: ["business_document"] }, tags: ["natural", "business"] },
  { id: "natural-send-quote", text: "帮我把报价发给王总", expectedKinds: ["business_communication"], tags: ["natural", "business"] },
  { id: "natural-schedule", text: "帮我约王总下周二下午开会", expectedKinds: ["business_scheduling"], tags: ["natural", "business"] },
  { id: "natural-defer-schedule", text: "给客户发邮件，会议下周再约", expectedKinds: ["business_communication"], tags: ["natural", "defer", "business"] },
  { id: "natural-excel-send", text: "把客户名单整理成 Excel 再发给销售", expectedKinds: ["business_document", "business_communication"], expectedDependencies: { business_communication: ["business_document"] }, tags: ["natural", "business"] },
  { id: "natural-cross-domain-result", text: "分析这个项目，然后把分析结果整理成文章", expectedKinds: ["software_analysis", "content_article"], expectedDependencies: { content_article: ["software_analysis"] }, tags: ["natural", "development", "content"] },
];

// Held-out professional jobs are independent business situations, not wording
// variants of the creator/software/business demos above.
export const INTENT_EVALUATION_HELD_OUT_CASES = [
  { id: "heldout-hr", text: "筛选这批简历，挑出合适候选人并安排面试", expectedKinds: ["hr_candidate_screening", "hr_interview_scheduling"], expectedDependencies: { hr_interview_scheduling: ["hr_candidate_screening"] }, tags: ["held-out", "hr"] },
  { id: "heldout-finance", text: "核对本月发票和银行流水，整理差异后发起付款申请", expectedKinds: ["finance_reconciliation", "finance_payment_request"], expectedDependencies: { finance_payment_request: ["finance_reconciliation"] }, tags: ["held-out", "finance"] },
  { id: "heldout-legal", text: "审查这份合同的法律风险并给出修订稿", expectedKinds: ["legal_contract_review", "legal_document_revision"], expectedDependencies: { legal_document_revision: ["legal_contract_review"] }, tags: ["held-out", "legal"] },
  { id: "heldout-support", text: "把这批客诉分类，形成客户回复方案", expectedKinds: ["support_case_triage", "support_response_draft"], expectedDependencies: { support_response_draft: ["support_case_triage"] }, tags: ["held-out", "support"] },
  { id: "heldout-procurement", text: "对比三家供应商报价，然后提交采购审批", expectedKinds: ["procurement_quote_comparison", "procurement_approval_request"], expectedDependencies: { procurement_approval_request: ["procurement_quote_comparison"] }, tags: ["held-out", "procurement"] },
  { id: "heldout-sales", text: "更新销售线索表并跟进重点商机", expectedKinds: ["sales_pipeline_update", "sales_followup"], expectedDependencies: { sales_followup: ["sales_pipeline_update"] }, tags: ["held-out", "sales"] },
  { id: "heldout-operations", text: "复盘项目延期原因并整理成PPT", expectedKinds: ["operations_retrospective", "presentation_creation"], expectedDependencies: { presentation_creation: ["operations_retrospective"] }, tags: ["held-out", "operations"] },
  { id: "heldout-localization", text: "把产品手册翻译成英文并保持原有结构", expectedKinds: ["document_translation"], tags: ["held-out", "localization"] },
  { id: "heldout-data", text: "分析Excel里的销售数据，生成图表和建议", expectedKinds: ["data_analysis", "data_visualization"], expectedDependencies: { data_visualization: ["data_analysis"] }, tags: ["held-out", "data"] },
];

export const INTENT_EVALUATION_PROFESSIONAL_NATURAL_CASES = [
  { id: "professional-natural-hr", text: "把简历过一遍，列出合适人选后约面试", expectedKinds: ["hr_candidate_screening", "hr_interview_scheduling"], tags: ["professional-natural", "hr"] },
  { id: "professional-natural-finance", text: "检查本月发票与流水是否一致，再走付款", expectedKinds: ["finance_reconciliation", "finance_payment_request"], tags: ["professional-natural", "finance"] },
  { id: "professional-natural-legal", text: "看下协议里有什么风险，改一版", expectedKinds: ["legal_contract_review", "legal_document_revision"], tags: ["professional-natural", "legal"] },
  { id: "professional-natural-support", text: "按类型和紧急程度整理工单，再给客户回信", expectedKinds: ["support_case_triage", "support_response_draft"], tags: ["professional-natural", "support"] },
  { id: "professional-natural-procurement", text: "比较三家报价，选好后走采购流程", expectedKinds: ["procurement_quote_comparison", "procurement_approval_request"], tags: ["professional-natural", "procurement"] },
  { id: "professional-natural-sales", text: "把商机补上负责人和下一步，然后催重点客户", expectedKinds: ["sales_pipeline_update", "sales_followup"], tags: ["professional-natural", "sales"] },
  { id: "professional-natural-operations", text: "总结这次活动的问题，做成汇报材料", expectedKinds: ["operations_retrospective", "presentation_creation"], tags: ["professional-natural", "operations"] },
  { id: "professional-natural-localization", text: "这份使用说明中文转英文", expectedKinds: ["document_translation"], tags: ["professional-natural", "localization"] },
  { id: "professional-natural-data", text: "看看Q2营收趋势，做个图表", expectedKinds: ["data_analysis", "data_visualization"], tags: ["professional-natural", "data"] },
  { id: "professional-shorthand-hr", text: "过一下这批CV，合适的约来聊", expectedKinds: ["hr_candidate_screening", "hr_interview_scheduling"], tags: ["professional-natural", "shorthand", "hr"] },
  { id: "professional-shorthand-finance", text: "把账对了，没问题就走款", expectedKinds: ["finance_reconciliation", "finance_payment_request"], tags: ["professional-natural", "shorthand", "finance"] },
  { id: "professional-shorthand-legal", text: "协议排雷，顺手改一版", expectedKinds: ["legal_contract_review", "legal_document_revision"], tags: ["professional-natural", "shorthand", "legal"] },
  { id: "professional-shorthand-support", text: "工单排优先级并回信", expectedKinds: ["support_case_triage", "support_response_draft"], tags: ["professional-natural", "shorthand", "support"] },
  { id: "professional-shorthand-procurement", text: "三家比价后走采买", expectedKinds: ["procurement_quote_comparison", "procurement_approval_request"], tags: ["professional-natural", "shorthand", "procurement"] },
  { id: "professional-shorthand-sales", text: "CRM机会补齐，重点客户催一下", expectedKinds: ["sales_pipeline_update", "sales_followup"], tags: ["professional-natural", "shorthand", "sales"] },
  { id: "professional-shorthand-operations", text: "项目踩坑总结做个deck", expectedKinds: ["operations_retrospective", "presentation_creation"], tags: ["professional-natural", "shorthand", "operations"] },
  { id: "professional-shorthand-localization", text: "说明转英文，格式别动", expectedKinds: ["document_translation"], tags: ["professional-natural", "shorthand", "localization"] },
  { id: "professional-shorthand-data", text: "Q2营收看趋势出图", expectedKinds: ["data_analysis", "data_visualization"], tags: ["professional-natural", "shorthand", "data"] },
];

export const INTENT_EVALUATION_PROFESSIONAL_BOUNDARY_CASES = [
  { id: "professional-negation-hr", text: "只筛选简历，不安排面试", expectedKinds: ["hr_candidate_screening"], forbiddenKinds: ["hr_interview_scheduling"], tags: ["professional-boundary", "negation"] },
  { id: "professional-negation-finance", text: "先核对发票和流水，付款申请暂不做", expectedKinds: ["finance_reconciliation"], forbiddenKinds: ["finance_payment_request", "finance_payment_request_draft"], tags: ["professional-boundary", "negation"] },
  { id: "professional-negation-legal", text: "合同只审风险，不要修改", expectedKinds: ["legal_contract_review"], forbiddenKinds: ["legal_document_revision"], tags: ["professional-boundary", "negation"] },
  { id: "professional-negation-support", text: "客诉只分类，先别回复客户", expectedKinds: ["support_case_triage"], forbiddenKinds: ["support_response_draft", "business_communication"], tags: ["professional-boundary", "negation"] },
  { id: "professional-negation-procurement", text: "供应商先比价，不提交采购审批", expectedKinds: ["procurement_quote_comparison"], forbiddenKinds: ["procurement_approval_request", "procurement_approval_draft"], tags: ["professional-boundary", "negation"] },
  { id: "professional-negation-sales", text: "更新商机表，暂时不联系客户", expectedKinds: ["sales_pipeline_update"], forbiddenKinds: ["sales_followup", "business_communication"], tags: ["professional-boundary", "negation"] },
  { id: "professional-existing-legal", text: "合同已经审完，按审查意见修订", expectedKinds: ["legal_document_revision"], tags: ["professional-boundary", "professional-existing"] },
  { id: "professional-existing-data", text: "销售数据分析已经完成，只生成图表", expectedKinds: ["data_visualization"], tags: ["professional-boundary", "professional-existing"] },
  { id: "professional-existing-finance", text: "根据对账差异准备付款申请，但先别提交", expectedKinds: ["finance_payment_request_draft"], expectedGates: { finance_payment_request_draft: null }, forbiddenKinds: ["finance_reconciliation", "finance_payment_request"], tags: ["professional-boundary", "professional-existing"] },
  { id: "professional-clarify-contract", text: "帮我处理一下这批合同", expectedKinds: [], expectedClarification: "professional_action", tags: ["professional-boundary", "clarification"] },
  { id: "professional-clarify-customer", text: "把客户的事情处理好", expectedKinds: [], expectedClarification: "professional_action", tags: ["professional-boundary", "clarification"] },
  { id: "professional-clarify-numbers", text: "看看这些数字", expectedKinds: [], expectedClarification: "professional_action", tags: ["professional-boundary", "clarification"] },
  { id: "professional-multi-hr", text: "分别筛选北京和上海两批简历", expectedKinds: ["hr_candidate_screening", "hr_candidate_screening"], tags: ["professional-boundary", "multi-instance"] },
  { id: "professional-multi-translation", text: "把中文和日文两份手册分别翻译成英文", expectedKinds: ["document_translation", "document_translation"], tags: ["professional-boundary", "multi-instance"] },
  { id: "professional-cross-domain", text: "审合同、分析销售数据并做图，再复盘项目做PPT", expectedKinds: ["legal_contract_review", "operations_retrospective", "presentation_creation", "data_analysis", "data_visualization"], tags: ["professional-boundary", "cross-domain"] },
  { id: "professional-cross-domain-negation", text: "筛选简历，面试先别安排；顺便分析销售数据做图", expectedKinds: ["hr_candidate_screening", "data_analysis", "data_visualization"], forbiddenKinds: ["hr_interview_scheduling", "content_image"], tags: ["professional-boundary", "cross-domain", "negation"] },
  { id: "professional-publish-public", text: "写一篇文章并公开发布到公众号", expectedKinds: ["content_article", "platform_adaptation", "wechat_draft_sync", "content_publish"], forbiddenKinds: ["software_implementation"], tags: ["professional-boundary", "publishing-safety"] },
  { id: "professional-publish-account", text: "把现成文章发到公司的第二个公众号", expectedKinds: [], expectedClarification: "account_choice", tags: ["professional-boundary", "publishing-safety", "clarification"] },
  { id: "professional-publish-target-role", text: "先写公众号文章，审核通过后发到小红书", expectedKinds: ["content_article", "platform_adaptation", "content_publish"], expectedPlatforms: ["xiaohongshu"], tags: ["professional-boundary", "publishing-safety"] },
  { id: "professional-publish-existing-draft", text: "把现成文章同步到公众号草稿箱，不要公开发布", expectedKinds: ["platform_adaptation", "wechat_draft_sync"], forbiddenKinds: ["content_article", "software_implementation", "content_publish"], tags: ["professional-boundary", "publishing-safety", "professional-existing", "negation"] },
  { id: "professional-draft-payment", text: "准备付款申请，但先别提交", expectedKinds: ["finance_payment_request_draft"], expectedGates: { finance_payment_request_draft: null }, forbiddenKinds: ["finance_payment_request"], tags: ["professional-boundary", "side-effect-boundary"] },
  { id: "professional-draft-procurement", text: "起草采购申请，暂时不送审", expectedKinds: ["procurement_approval_draft"], expectedGates: { procurement_approval_draft: null }, forbiddenKinds: ["procurement_approval_request"], tags: ["professional-boundary", "side-effect-boundary"] },
  { id: "professional-draft-submit-payment", text: "先准备付款申请，再提交付款申请", expectedKinds: ["finance_payment_request_draft", "finance_payment_request"], tags: ["professional-boundary", "side-effect-boundary"] },
  { id: "professional-draft-submit-procurement", text: "先起草采购申请，再送审采购申请", expectedKinds: ["procurement_approval_draft", "procurement_approval_request"], tags: ["professional-boundary", "side-effect-boundary"] },
  { id: "professional-multi-data-regions", text: "把北京和上海两份销售数据分别分析一下", expectedKinds: ["data_analysis", "data_analysis"], tags: ["professional-boundary", "multi-instance", "data"] },
  { id: "professional-multi-legal-contracts", text: "A合同和B合同分别审查风险", expectedKinds: ["legal_contract_review", "legal_contract_review"], tags: ["professional-boundary", "multi-instance", "legal"] },
  { id: "professional-multi-sales-customers", text: "分别跟进甲公司和乙公司两个客户", expectedKinds: ["sales_followup", "sales_followup"], tags: ["professional-boundary", "multi-instance", "sales"] },
  { id: "professional-multi-three-languages", text: "把中文、日文和韩文三份说明分别翻成英文", expectedKinds: ["document_translation", "document_translation", "document_translation"], tags: ["professional-boundary", "multi-instance", "localization"] },
  { id: "professional-shorthand-payment-form", text: "先别走款，付款申请单给我准备一份", expectedKinds: ["finance_payment_request_draft"], tags: ["professional-boundary", "side-effect-boundary", "negation"] },
  { id: "professional-shorthand-procurement-form", text: "三家报价比一下，申请单先准备好，今天不要送审", expectedKinds: ["procurement_quote_comparison", "procurement_approval_draft"], tags: ["professional-boundary", "side-effect-boundary", "negation"] },
  { id: "professional-existing-sales-chart", text: "销售分析报告已有，出三张趋势图", expectedKinds: ["data_visualization"], tags: ["professional-boundary", "professional-existing", "data"] },
  { id: "professional-shorthand-support-reply", text: "客户投诉比较急，分下优先级，再给我一版回复", expectedKinds: ["support_case_triage", "support_response_draft"], tags: ["professional-boundary", "support"] },
  { id: "professional-cross-domain-colloquial", text: "法务合同审一下，财务对账一下，最后做个汇报PPT", expectedKinds: ["finance_reconciliation", "legal_contract_review", "presentation_creation"], tags: ["professional-boundary", "cross-domain"] },
];

const BENCHMARK_PREFIXES = ["", "请", "请帮我", "我希望", "接下来", "麻烦", "现在"];
const BENCHMARK_SUFFIXES = ["", "，谢谢", "，按这个目标处理", "。"];

// A checked-in 200-turn replay corpus. Variants deliberately change ordinary
// chat framing and punctuation while preserving the requested task boundary;
// this catches parsers that only work for one demo sentence without turning
// the benchmark into a fixed end-to-end workflow.
export const INTENT_EVALUATION_CASES = [
  ...INTENT_EVALUATION_BASE_CASES.filter((fixture) => fixture.text).flatMap((fixture) =>
    BENCHMARK_PREFIXES.flatMap((prefix, prefixIndex) => BENCHMARK_SUFFIXES.map((suffix, suffixIndex) => ({
      ...fixture,
      id: `${fixture.id}:p${prefixIndex}:s${suffixIndex}`,
      text: `${prefix}${fixture.text}${suffix}`,
    })))),
  ...["", "好的", "收到", "先这样"].map((text, index) => ({
    id: `no-task-control-${index}`,
    text,
    domain: "content",
    expectedKinds: [],
    expectedClarification: null,
  })),
  ...INTENT_EVALUATION_REAL_CASES,
  ...INTENT_EVALUATION_HELD_OUT_CASES,
  ...INTENT_EVALUATION_PROFESSIONAL_NATURAL_CASES,
  ...INTENT_EVALUATION_PROFESSIONAL_BOUNDARY_CASES,
];

export function evaluateIntentUnderstanding(cases = INTENT_EVALUATION_CASES, planner = planDiscreteTasks) {
  const results = cases.map((fixture) => {
    const plan = planner({ text: fixture.text, domain: fixture.domain });
    const contract = validateTaskPlan(plan, { requireTasks: false });
    const actualKinds = plan.tasks.map((task) => task.kind);
    const expectedKinds = fixture.expectedKinds ?? [];
    const taskByKey = new Map(plan.tasks.map((task) => [task.key, task]));
    const dependencyKinds = Object.fromEntries(plan.tasks.map((task) => [task.kind,
      (task.requires ?? []).map((key) => taskByKey.get(key)?.kind ?? key)]));
    const dependenciesMatch = Object.entries(fixture.expectedDependencies ?? {}).every(([kind, expected]) =>
      JSON.stringify(dependencyKinds[kind] ?? []) === JSON.stringify(expected));
    const gatesMatch = Object.entries(fixture.expectedGates ?? {}).every(([kind, expected]) =>
      plan.tasks.find((task) => task.kind === kind)?.gate === expected);
    const actualPlatforms = plan.tasks.filter((task) => task.kind === "content_publish").map((task) => task.platform?.id ?? null);
    const platformsMatch = !fixture.expectedPlatforms
      || JSON.stringify(actualPlatforms) === JSON.stringify(fixture.expectedPlatforms);
    const forbiddenKinds = fixture.forbiddenKinds ?? [];
    const forbiddenMatch = !actualKinds.some((kind) => forbiddenKinds.includes(kind));
    const pass = contract.ok
      && JSON.stringify(actualKinds) === JSON.stringify(expectedKinds)
      && dependenciesMatch
      && gatesMatch
      && platformsMatch
      && forbiddenMatch
      && (plan.clarification?.kind ?? null) === (fixture.expectedClarification ?? null)
      && (!fixture.independent || plan.tasks.every((task) => task.requires.length === 0))
      && (!fixture.forbiddenPlatform || !plan.tasks.some((task) => task.platform?.id === fixture.forbiddenPlatform));
    return { id: fixture.id, pass, actualKinds, expectedKinds, dependencyKinds, actualPlatforms, clarification: plan.clarification?.kind ?? null, contractErrors: contract.errors };
  });
  const passed = results.filter((result) => result.pass).length;
  const noTaskCases = results.filter((result) => result.expectedKinds.length === 0);
  const clarificationCases = results.filter((result) => cases.find((fixture) => fixture.id === result.id)?.expectedClarification);
  const unintendedTaskCount = noTaskCases.filter((result) => result.actualKinds.length > 0).length;
  const clarificationPassed = clarificationCases.filter((result) => result.pass).length;
  const forbiddenCases = results.filter((result) => (cases.find((fixture) => fixture.id === result.id)?.forbiddenKinds ?? []).length);
  const harmfulCases = forbiddenCases.filter((result) => {
    const fixture = cases.find((candidate) => candidate.id === result.id);
    return result.actualKinds.some((kind) => fixture.forbiddenKinds.includes(kind));
  });
  const metrics = {
    taskBoundaryAccuracy: results.length ? passed / results.length : 1,
    unintendedTaskRate: noTaskCases.length ? unintendedTaskCount / noTaskCases.length : 0,
    clarificationAccuracy: clarificationCases.length ? clarificationPassed / clarificationCases.length : 1,
    distinctUtteranceCount: new Set(cases.map((fixture) => fixture.text.trim()).filter(Boolean)).size,
    taskKindCoverage: new Set(results.flatMap((result) => result.actualKinds)).size,
    negationAccuracy: taggedAccuracy(cases, results, "negation"),
    crossDomainAccuracy: taggedAccuracy(cases, results, "cross-domain"),
    naturalExpressionAccuracy: taggedAccuracy(cases, results, "natural"),
    heldOutProfessionalAccuracy: taggedAccuracy(cases, results, "held-out"),
    professionalNaturalAccuracy: taggedAccuracy(cases, results, "professional-natural"),
    professionalBoundaryAccuracy: taggedAccuracy(cases, results, "professional-boundary"),
    professionalExistingAccuracy: taggedAccuracy(cases, results, "professional-existing"),
    multiInstanceAccuracy: taggedAccuracy(cases, results, "multi-instance"),
    publishingSafetyAccuracy: taggedAccuracy(cases, results, "publishing-safety"),
    harmfulForbiddenTaskRate: forbiddenCases.length ? harmfulCases.length / forbiddenCases.length : 0,
  };
  return {
    total: results.length,
    passed,
    failed: results.filter((result) => !result.pass),
    metrics,
    releaseReady: metrics.taskBoundaryAccuracy >= 0.95
      && metrics.unintendedTaskRate <= 0.01
      && metrics.clarificationAccuracy >= 0.95
      && metrics.heldOutProfessionalAccuracy >= 0.9
      && metrics.professionalNaturalAccuracy >= 0.9
      && metrics.professionalBoundaryAccuracy >= 0.95
      && metrics.professionalExistingAccuracy >= 0.95
      && metrics.multiInstanceAccuracy >= 0.9
      && metrics.publishingSafetyAccuracy >= 0.95
      && metrics.harmfulForbiddenTaskRate === 0,
    results,
  };
}

function taggedAccuracy(cases, results, ...tags) {
  const ids = new Set(cases.filter((fixture) => tags.some((tag) => fixture.tags?.includes(tag))).map((fixture) => fixture.id));
  const selected = results.filter((result) => ids.has(result.id));
  return selected.length ? selected.filter((result) => result.pass).length / selected.length : 1;
}
