/**
 * Professional task definitions are data, not a fixed workflow. Each entry
 * describes one independently executable job and its inspectable output.
 * Relationships are added only when the user's statement requests both jobs.
 */
export const PROFESSIONAL_TASK_DEFINITIONS = Object.freeze([
  { kind: "hr_candidate_screening", domain: "hr", label: "候选人筛选", outcome: "形成带筛选依据的候选人名单", pattern: /(?:筛选|评估|挑选).{0,12}(?:简历|候选人)|(?:简历|候选人).{0,12}(?:筛选|评估|挑选)/i, produces: ["candidate_shortlist"] },
  { kind: "hr_interview_scheduling", domain: "hr", label: "面试安排", outcome: "形成候选人、面试人和时间明确的面试安排", pattern: /(?:安排|预约|邀约).{0,12}面试|面试.{0,8}(?:安排|邀约)/i, externalEffect: true, produces: ["interview_schedule_receipt"] },
  { kind: "finance_reconciliation", domain: "finance", label: "财务对账", outcome: "形成差异明确且可复核的对账报告", pattern: /(?:财务|发票|账单|流水|收支|应收|应付).{0,16}(?:对账|核对)|(?:对账|核对).{0,16}(?:财务|发票|账单|流水|收支|应收|应付)/i, produces: ["reconciliation_report"] },
  { kind: "finance_payment_request", domain: "finance", label: "付款申请", outcome: "形成金额、对象和依据明确的付款申请", pattern: /(?:提交|发起|准备|创建|整理)?.{0,8}(?:付款|支付|报销)(?:申请|审批单)|(?:付款|支付)审批/i, externalEffect: true, produces: ["payment_request_receipt"] },
  { kind: "legal_contract_review", domain: "legal", label: "合同审查", outcome: "形成条款风险和修改建议明确的合同审查报告", pattern: /(?:审查|审核|检查|识别|分析).{0,12}合同|合同.{0,12}(?:审查|审核|风险|问题条款)/i, produces: ["contract_review"] },
  { kind: "legal_document_revision", domain: "legal", label: "合同修订", outcome: "形成保留修订依据的合同修改稿", pattern: /(?:修改|修订|改写|完善).{0,12}合同|合同.{0,12}(?:修改稿|修订稿|改写)/i, produces: ["legal_document"] },
  { kind: "support_case_triage", domain: "support", label: "客诉分类", outcome: "形成问题类别、优先级和责任方向明确的客诉清单", pattern: /(?:客诉|投诉|工单).{0,12}(?:分类|分级|归类|梳理)|(?:分类|分级).{0,8}(?:客诉|投诉|工单)/i, produces: ["support_triage"] },
  { kind: "support_response_draft", domain: "support", label: "客户回复方案", outcome: "形成针对问题且可审核的客户回复草稿", pattern: /(?:客诉|投诉|工单).{0,16}(?:回复方案|回复草稿|处理方案)|(?:起草|准备|形成).{0,12}(?:客户回复|客诉回复)/i, produces: ["customer_response_draft"] },
  { kind: "procurement_quote_comparison", domain: "procurement", label: "供应商报价对比", outcome: "形成价格、交付和风险可比较的供应商评估表", pattern: /(?:供应商|采购).{0,16}(?:报价对比|报价比较|比价|评估)|(?:对比|比较).{0,12}供应商报价/i, produces: ["procurement_comparison"] },
  { kind: "procurement_approval_request", domain: "procurement", label: "采购审批", outcome: "形成对象、金额和推荐依据明确的采购审批申请", pattern: /(?:发起|提交|准备|创建)?.{0,8}(?:采购审批|采购申请|采购单)/i, externalEffect: true, produces: ["procurement_request_receipt"] },
  { kind: "sales_pipeline_update", domain: "sales", label: "销售线索整理", outcome: "形成阶段、负责人和下一步明确的销售线索表", pattern: /(?:整理|更新|维护|补全).{0,12}(?:销售线索|商机|客户线索)|(?:销售线索|商机).{0,12}(?:表格|清单|更新|整理)/i, produces: ["sales_pipeline"] },
  { kind: "sales_followup", domain: "sales", label: "销售跟进", outcome: "完成有对象和目的的销售跟进并保留回执", pattern: /(?:跟进|联系).{0,12}(?:销售线索|商机|潜在客户)|(?:销售线索|商机).{0,12}(?:跟进|联系)/i, externalEffect: true, produces: ["sales_followup_receipt"] },
  { kind: "operations_retrospective", domain: "operations", label: "项目复盘", outcome: "形成事实、原因和改进动作明确的项目复盘", pattern: /(?:项目|进度|延期|事故|活动).{0,12}(?:复盘|回顾|原因总结)|(?:复盘|回顾).{0,12}(?:项目|延期|事故|活动)/i, produces: ["retrospective_report"] },
  { kind: "presentation_creation", domain: "operations", label: "演示文稿", outcome: "形成结构完整且可演示的幻灯片", pattern: /(?:制作|生成|整理|做成|输出).{0,12}(?:PPT|幻灯片|演示文稿)|(?:PPT|幻灯片|演示文稿).{0,8}(?:制作|整理|汇报)/i, produces: ["presentation_deck"] },
  { kind: "document_translation", domain: "localization", label: "文档翻译", outcome: "形成术语一致并保留原结构的译文", pattern: /(?:翻译|译成|本地化).{0,16}(?:手册|文档|说明书|资料)|(?:手册|文档|说明书).{0,12}(?:翻译|译成)/i, produces: ["translated_document"] },
  { kind: "data_analysis", domain: "data", label: "数据分析", outcome: "形成口径、发现和建议可复核的数据分析报告", pattern: /(?:分析|统计|洞察).{0,16}(?:Excel|表格|销售数据|经营数据|业务数据)|(?:Excel|表格|销售数据|经营数据|业务数据).{0,16}(?:分析|统计|洞察)/i, produces: ["data_analysis_report"] },
  { kind: "data_visualization", domain: "data", label: "数据可视化", outcome: "形成与数据口径一致的图表包", pattern: /(?:生成|制作|绘制|输出|做).{0,10}(?:图表|数据看板|可视化)|(?:图表|数据看板|可视化).{0,8}(?:生成|制作|输出)/i, produces: ["data_visualization_package"] },
]);

const DEPENDENCY_RULES = [
  ["hr_candidate_screening", "hr_interview_scheduling", "candidate_shortlist"],
  ["finance_reconciliation", "finance_payment_request", "reconciliation_report"],
  ["legal_contract_review", "legal_document_revision", "contract_review"],
  ["support_case_triage", "support_response_draft", "support_triage"],
  ["procurement_quote_comparison", "procurement_approval_request", "procurement_comparison"],
  ["sales_pipeline_update", "sales_followup", "sales_pipeline"],
  ["operations_retrospective", "presentation_creation", "retrospective_report"],
  ["data_analysis", "data_visualization", "data_analysis_report"],
];

export function connectProfessionalTasks(tasks) {
  const byKind = new Map(tasks.map((task) => [task.kind, task]));
  for (const [sourceKind, targetKind, artifactKind] of DEPENDENCY_RULES) {
    const source = byKind.get(sourceKind);
    const target = byKind.get(targetKind);
    if (!source || !target) continue;
    target.requires = [...new Set([...(target.requires ?? []), source.key])];
    target.artifactContract.consumes = [...new Set([...(target.artifactContract?.consumes ?? []), artifactKind])];
  }
  return tasks;
}

export function resolveProfessionalTaskOverlaps(tasks, statement = "") {
  const kinds = new Set(tasks.map((task) => task.kind));
  const remove = new Set();
  if (kinds.has("support_response_draft") && /(?:客诉|投诉|工单)/i.test(statement)) remove.add("business_document");
  if (kinds.has("data_visualization") && /(?:图表|数据看板|可视化)/i.test(statement)
    && !/(?:配图|插图|封面图|图文图片)/i.test(statement)) remove.add("content_image");
  if (!remove.size) return tasks;
  for (let index = tasks.length - 1; index >= 0; index -= 1) {
    if (remove.has(tasks[index].kind)) tasks.splice(index, 1);
  }
  return tasks;
}
