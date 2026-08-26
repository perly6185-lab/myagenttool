/**
 * Professional task definitions are data, not a fixed workflow. Each entry
 * describes one independently executable job and its inspectable output.
 * Relationships are added only when the user's statement requests both jobs.
 */
export const PROFESSIONAL_TASK_DEFINITIONS = Object.freeze([
  { kind: "hr_candidate_screening", domain: "hr", label: "候选人筛选", outcome: "形成带筛选依据的候选人名单", pattern: /(?:筛选|评估|挑选|初筛|过(?:一遍|一下)|看(?:一遍|一下)).{0,16}(?:简历|候选人|人选|CV)|(?:简历|候选人|人选|CV).{0,16}(?:筛选|评估|挑选|初筛|过(?:一遍|一下)|看(?:一遍|一下)|列出|找出)/i, produces: ["candidate_shortlist"] },
  { kind: "hr_interview_scheduling", domain: "hr", label: "面试安排", outcome: "形成候选人、面试人和时间明确的面试安排", pattern: /(?:安排|预约|邀约|约).{0,12}(?:面试|面聊|来聊)|(?:面试|面聊).{0,8}(?:安排|邀约|预约)|(?:合适|入选).{0,8}(?:候选人|人选|人)?(?:约来聊|约面|安排面试)/i, externalEffect: true, produces: ["interview_schedule_receipt"] },
  { kind: "finance_reconciliation", domain: "finance", label: "财务对账", outcome: "形成差异明确且可复核的对账报告", pattern: /(?:财务|发票|账单|流水|收支|应收|应付|账).{0,16}(?:对账|核对|对(?:一遍|一下|了)|是否一致)|(?:对(?:一遍|一下)?账|核对).{0,16}(?:财务|发票|账单|流水|收支|应收|应付|账)|对账/i, produces: ["reconciliation_report"] },
  { kind: "finance_payment_request_draft", domain: "finance", label: "付款申请草稿", outcome: "形成金额、对象和依据明确但尚未提交的付款申请草稿", pattern: /(?:准备|创建|起草).{0,8}(?:付款|支付|报销)(?:申请|申请单|审批单)|整理(?:一份|这份|该份)?(?:付款|支付|报销)(?:申请|申请单|审批单)|(?:付款|支付|报销)(?:申请|申请单|审批单).{0,10}(?:准备|创建|起草|整理)(?:一份|好)?/i, produces: ["payment_request_draft"] },
  { kind: "finance_payment_request", domain: "finance", label: "提交付款申请", outcome: "提交金额、对象和依据明确的付款申请并保留回执", pattern: /(?:提交|发起|送审|走).{0,8}(?:付款|支付|报销)(?:申请|审批单|审批|流程)?|(?:付款|支付)(?:审批|送审)|走(?:款|付款)/i, externalEffect: true, produces: ["payment_request_receipt"] },
  { kind: "legal_contract_review", domain: "legal", label: "合同审查", outcome: "形成条款风险和修改建议明确的合同审查报告", pattern: /(?:审查|审核|检查|识别|分析|看(?:看|下)?|排雷|审(?:一下|一遍)?).{0,12}(?:合同|协议)|(?:合同|协议).{0,16}(?:审查|审核|审(?:一下|一遍)?|风险|问题条款|条款.{0,4}(?:有坑|问题)|有坑|排雷)/i, produces: ["contract_review"] },
  { kind: "legal_document_revision", domain: "legal", label: "合同修订", outcome: "形成保留修订依据的合同修改稿", pattern: /(?:修改|修订|改写|完善|改).{0,12}(?:合同|协议)|(?:合同|协议).{0,40}(?:修改稿|修订稿|改写|修改|修订|改一版)/i, produces: ["legal_document"] },
  { kind: "support_case_triage", domain: "support", label: "客诉分类", outcome: "形成问题类别、优先级和责任方向明确的客诉清单", pattern: /(?:客诉|投诉|工单).{0,16}(?:分类|分级|归类|梳理|优先级|紧急程度|排一下|排序)|(?:分类|分级|整理|梳理|排序).{0,12}(?:客诉|投诉|工单)/i, produces: ["support_triage"] },
  { kind: "support_response_draft", domain: "support", label: "客户回复方案", outcome: "形成针对问题且可审核的客户回复草稿", pattern: /(?:客诉|投诉|工单).{0,20}(?:回复方案|回复草稿|处理方案|回信|回复客户)|(?:起草|准备|形成|给|出).{0,12}(?:一版|一份)?(?:客户回复|客诉回复|回复稿|回复方案|回信)|(?:分级|分类|优先级|紧急程度).{0,20}(?:给|出|准备).{0,8}(?:一版|一份)?回复/i, produces: ["customer_response_draft"] },
  { kind: "procurement_quote_comparison", domain: "procurement", label: "供应商报价对比", outcome: "形成价格、交付和风险可比较的供应商评估表", pattern: /(?:供应商|采购|报价).{0,16}(?:报价对比|报价比较|比价|评估|比较|比一下|选一家)|(?:对比|比较|比价|比一下).{0,16}(?:供应商|报价)|(?:三家|多家).{0,8}(?:报价.{0,8}(?:选|比较|对比|比一下)|比价)/i, produces: ["procurement_comparison"] },
  { kind: "procurement_approval_draft", domain: "procurement", label: "采购申请草稿", outcome: "形成对象、金额和推荐依据明确但尚未提交的采购申请草稿", pattern: /(?:准备|创建|起草).{0,8}(?:采购审批|采购申请|采购单)|整理(?:一份|这份|该份)?(?:采购审批|采购申请|采购单)/i, produces: ["procurement_request_draft"] },
  { kind: "procurement_approval_request", domain: "procurement", label: "提交采购审批", outcome: "提交对象、金额和推荐依据明确的采购审批并保留回执", pattern: /(?:发起|提交|送审|走).{0,8}(?:采购审批|采购申请|采购单|采购流程|采买)|(?:采购审批|采购申请).{0,6}(?:提交|送审)/i, externalEffect: true, produces: ["procurement_request_receipt"] },
  { kind: "sales_pipeline_update", domain: "sales", label: "销售线索整理", outcome: "形成阶段、负责人和下一步明确的销售线索表", pattern: /(?:整理|更新|维护|补全|补齐).{0,16}(?:销售线索|商机|客户线索|CRM|机会)|(?:销售线索|商机|CRM|机会).{0,16}(?:表格|清单|更新|整理|补齐|负责人|下一步)/i, produces: ["sales_pipeline"] },
  { kind: "sales_followup", domain: "sales", label: "销售跟进", outcome: "完成有对象和目的的销售跟进并保留回执", pattern: /(?:跟进|联系|催).{0,16}(?:销售线索|商机|潜在客户|重点客户|客户)|(?:销售线索|商机|潜在客户|重点客户).{0,16}(?:跟进|联系|催)/i, externalEffect: true, produces: ["sales_followup_receipt"] },
  { kind: "operations_retrospective", domain: "operations", label: "项目复盘", outcome: "形成事实、原因和改进动作明确的项目复盘", pattern: /(?:项目|进度|延期|事故|活动|踩坑).{0,16}(?:复盘|回顾|原因总结|问题总结|踩坑|问题)|(?:复盘|回顾|总结).{0,12}(?:项目|延期|事故|活动|踩坑)/i, produces: ["retrospective_report"] },
  { kind: "presentation_creation", domain: "operations", label: "演示文稿", outcome: "形成结构完整且可演示的幻灯片", pattern: /(?:制作|生成|整理|做成|输出|做).{0,12}(?:PPT|幻灯片|演示文稿|汇报材料|deck)|(?:PPT|幻灯片|演示文稿|汇报材料|deck).{0,8}(?:制作|整理|汇报)/i, produces: ["presentation_deck"] },
  { kind: "document_translation", domain: "localization", label: "文档翻译", outcome: "形成术语一致并保留原结构的译文", pattern: /(?:翻译|翻成|译成|本地化|转成|转为|转).{0,16}(?:手册|文档|说明书|使用说明|资料|英文|日文|中文)|(?:手册|文档|说明书|使用说明|资料|说明).{0,20}(?:翻译|翻成|译成|转成|转为|转)/i, produces: ["translated_document"] },
  { kind: "data_analysis", domain: "data", label: "数据分析", outcome: "形成口径、发现和建议可复核的数据分析报告", pattern: /(?:分析|统计|洞察|看看).{0,16}(?:Excel|表格|销售数据|经营数据|业务数据|营收|指标)(?:.{0,8}趋势)?|(?:Excel|表格|销售数据|经营数据|业务数据|营收|指标).{0,16}(?:分析|统计|洞察|趋势|看趋势|咋样|怎么样)/i, produces: ["data_analysis_report"] },
  { kind: "data_visualization", domain: "data", label: "数据可视化", outcome: "形成与数据口径一致的图表包", pattern: /(?:生成|制作|绘制|输出|做|出|画).{0,10}(?:[一二三四五六七八九十两\d]{0,3}张?)?(?:趋势图|图表|数据看板|可视化)|(?:图表|趋势图|数据看板|可视化).{0,8}(?:生成|制作|输出)|(?:数据|营收|指标|趋势|分析报告).{0,20}(?:做|出|画).{0,6}图|(?:做图|出图|画图).{0,12}(?:数据|营收|指标|趋势)/i, produces: ["data_visualization_package"] },
]);

const DEPENDENCY_RULES = [
  ["hr_candidate_screening", "hr_interview_scheduling", "candidate_shortlist"],
  ["finance_reconciliation", "finance_payment_request_draft", "reconciliation_report"],
  ["finance_reconciliation", "finance_payment_request", "reconciliation_report"],
  ["finance_payment_request_draft", "finance_payment_request", "payment_request_draft"],
  ["legal_contract_review", "legal_document_revision", "contract_review"],
  ["support_case_triage", "support_response_draft", "support_triage"],
  ["procurement_quote_comparison", "procurement_approval_draft", "procurement_comparison"],
  ["procurement_quote_comparison", "procurement_approval_request", "procurement_comparison"],
  ["procurement_approval_draft", "procurement_approval_request", "procurement_request_draft"],
  ["sales_pipeline_update", "sales_followup", "sales_pipeline"],
  ["operations_retrospective", "presentation_creation", "retrospective_report"],
  ["data_analysis", "data_visualization", "data_analysis_report"],
];

export function connectProfessionalTasks(tasks) {
  const byKind = new Map();
  for (const task of tasks) byKind.set(task.kind, [...(byKind.get(task.kind) ?? []), task]);
  for (const [sourceKind, targetKind, artifactKind] of DEPENDENCY_RULES) {
    const sources = byKind.get(sourceKind) ?? [];
    const targets = byKind.get(targetKind) ?? [];
    if (!sources.length || !targets.length) continue;
    for (const target of targets) {
      const source = sources.find((candidate) => candidate.instanceScope && candidate.instanceScope === target.instanceScope)
        ?? (sources.length === 1 ? sources[0] : null);
      if (!source) continue;
      target.requires = [...new Set([...(target.requires ?? []), source.key])];
      target.artifactContract.consumes = [...new Set([...(target.artifactContract?.consumes ?? []), artifactKind])];
    }
  }
  return tasks;
}

export function professionalTaskInstanceScopes(statement, kind) {
  const value = String(statement ?? "");
  const patterns = PROFESSIONAL_INSTANCE_SCOPE_PATTERNS[kind] ?? [];
  for (const pattern of patterns) {
    const scopes = splitScopes(value.match(pattern)?.[1]);
    if (scopes.length > 1) return scopes;
  }
  return [];
}

function splitScopes(value) {
  if (!value) return [];
  const scopes = String(value).split(/\s*(?:、|，|,|和|与|及|以及)\s*/)
    .map((scope) => scope
      .replace(/^(?:请|帮我|麻烦|把|将|这|那|分别|各自|筛选|分析|统计|审查|审核|检查|跟进|联系|催)/, "")
      .replace(/(?:两|三|四|五|六|七|八|九|十|多|\d+)(?:份|批|个|组)?(?:简历|候选人|合同|协议|客户|商机|销售数据|经营数据|业务数据|数据|手册|文档|说明书|使用说明|资料|说明)?$/, "")
      .trim())
    .filter((scope) => scope && scope.length <= 24);
  return scopes.length > 1 && scopes.length <= 8 ? [...new Set(scopes)] : [];
}

const COUNT_WORD = "(?:两|三|四|五|六|七|八|九|十|多|\\d+)";
const PROFESSIONAL_INSTANCE_SCOPE_PATTERNS = Object.freeze({
  hr_candidate_screening: [
    new RegExp(`(?:分别|各自)?(?:筛选|评估|挑选|初筛)?\\s*([^，。；]{1,80}?)${COUNT_WORD}批(?:简历|候选人)`, "i"),
  ],
  legal_contract_review: [
    /(?:把|将)?([^，。；]{1,80}?)(?:分别|各自)(?:审查|审核|检查|排雷|审)/i,
    new RegExp(`(?:分别|各自)(?:审查|审核|检查|排雷|审)?\\s*([^，。；]{1,80}?)${COUNT_WORD}份?(?:合同|协议)`, "i"),
  ],
  legal_document_revision: [
    /(?:把|将)?([^，。；]{1,80}?)(?:分别|各自)(?:修改|修订|改写|改)/i,
  ],
  support_case_triage: [
    new RegExp(`(?:分别|各自)?(?:分类|分级|梳理)?\\s*([^，。；]{1,80}?)${COUNT_WORD}(?:批|组|个)(?:客诉|投诉|工单)`, "i"),
  ],
  procurement_quote_comparison: [
    new RegExp(`(?:分别|各自)?(?:对比|比较|评估|比价)?\\s*([^，。；]{1,80}?)${COUNT_WORD}(?:家|组|份)(?:供应商|报价)`, "i"),
  ],
  sales_followup: [
    new RegExp(`(?:分别|各自)(?:跟进|联系|催)\\s*([^，。；]{1,80}?)(?:${COUNT_WORD}个)?(?:客户|商机)(?:[，。；]|$)`, "i"),
    /(?:把|将)?([^，。；]{1,80}?)(?:分别|各自)(?:跟进|联系|催)/i,
  ],
  document_translation: [
    new RegExp(`(?:把|将)?([^，。；]{1,80}?)${COUNT_WORD}份(?:手册|文档|说明书|使用说明|资料|说明).{0,16}(?:分别|各自)?(?:翻译|翻成|译成|转成|转为)`, "i"),
  ],
  data_analysis: [
    new RegExp(`(?:把|将)?([^，。；]{1,80}?)${COUNT_WORD}份(?:销售|经营|业务)?数据(?:分别|各自)?(?:分析|统计|看趋势)`, "i"),
    /(?:把|将)?([^，。；]{1,80}?)(?:分别|各自)(?:分析|统计|看趋势)/i,
  ],
  data_visualization: [
    new RegExp(`(?:把|将)?([^，。；]{1,80}?)${COUNT_WORD}份(?:销售|经营|业务)?数据(?:分别|各自)?(?:做图|出图|画图|可视化)`, "i"),
  ],
});

export function resolveProfessionalTaskOverlaps(tasks, statement = "") {
  const kinds = new Set(tasks.map((task) => task.kind));
  const remove = new Set();
  if (kinds.has("support_response_draft") && /(?:客诉|投诉|工单)/i.test(statement)) remove.add("business_document");
  if (kinds.has("data_visualization") && /(?:图表|数据看板|可视化|(?:数据|营收|指标|趋势).{0,12}(?:做图|出图|画图)|(?:做图|出图|画图).{0,12}(?:数据|营收|指标|趋势))/i.test(statement)
    && !/(?:配图|插图|封面图|图文图片)/i.test(statement)) remove.add("content_image");
  if (!remove.size) return tasks;
  for (let index = tasks.length - 1; index >= 0; index -= 1) {
    if (remove.has(tasks[index].kind)) tasks.splice(index, 1);
  }
  return tasks;
}
