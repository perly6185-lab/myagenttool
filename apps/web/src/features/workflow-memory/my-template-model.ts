import type { BusinessRoutineDefinition, BusinessRoutineStep, WorkflowSource } from "@/lib/api-client";

export type MyTemplateState = "learning" | "needs_review" | "ready" | "paused";

export type MyTemplateSummary = {
  id: string;
  familyId: string | null;
  definitionId: string | null;
  definitionVersion: number | null;
  projectId: string;
  sourceId: string;
  name: string;
  description: string;
  state: MyTemplateState;
  input: string;
  output: string;
  applicability: string;
  historyCaseCount: number;
  historyFolderName: string;
  maturity: "trial" | "stable" | null;
};

const INPUT_LABELS: Record<string, string> = {
  inquiry: "客户询价单",
  quotation: "报价资料",
  order: "订单",
  contract_review: "待审合同",
  purchase_request: "采购申请",
  customer_complaint: "客户投诉",
  weekly_report: "周报资料",
  project_acceptance: "项目验收资料",
  other_reference: "参考资料",
};

const TEMPLATE_TEXT_ZH: Record<string, string> = {
  "Commercial inquiry and quotation": "客户询价与报价",
  "Register an inquiry, retrieve references, prepare and approve a quotation, then hand off a confirmed order.": "登记客户询价，查找参考资料，准备并确认报价；客户确认后再交接订单处理。",
  "Prepare the quotation": "准备报价单",
  "Register the inquiry": "登记客户询价",
  "Retrieve quotation references": "查找报价参考资料",
  "Approve the quotation": "确认报价内容",
  "Register the quotation": "登记最终报价",
  "Detect an order signal": "识别订单信号",
  "Hand off the order": "交接订单处理",
  "Register the order": "登记订单",
};

export function localizedTemplateText(value: string): string {
  const normalized = value.trim();
  return TEMPLATE_TEXT_ZH[normalized] ?? normalized;
}

function configuredText(step: BusinessRoutineStep): string | null {
  const configuration = step.configuration ?? {};
  for (const key of ["output", "expectedOutput", "result", "outputName", "fileName", "format"]) {
    const value = configuration[key];
    if (typeof value === "string" && value.trim()) return localizedTemplateText(value);
  }
  return null;
}

export function myTemplateExpectedOutput(definition: BusinessRoutineDefinition): string {
  const outputs = definition.steps
    .filter((step) => ["generate", "create_issue", "ledger_upsert"].includes(step.kind))
    .map((step) => configuredText(step) ?? localizedTemplateText(step.label))
    .filter(Boolean);
  return [...new Set(outputs)].join("、") || "需要继续确认最终结果";
}

function inputText(definition: BusinessRoutineDefinition): string {
  const learnedInput = definition.templateContract?.inputSummary?.trim();
  if (learnedInput) return localizedTemplateText(learnedInput);
  const labels = definition.triggerDocumentTypes
    .map((type) => INPUT_LABELS[type] ?? type)
    .filter(Boolean);
  return [...new Set(labels)].join("、") || "需要继续确认输入材料";
}

function definitionState(definition: BusinessRoutineDefinition): MyTemplateState {
  if (definition.state === "published") return "ready";
  if (definition.state === "disabled") return "paused";
  return "needs_review";
}

function currentDefinitions(definitions: BusinessRoutineDefinition[]): BusinessRoutineDefinition[] {
  const families = new Map<string, BusinessRoutineDefinition>();
  const priority: Record<BusinessRoutineDefinition["state"], number> = {
    published: 5,
    draft: 4,
    candidate: 3,
    disabled: 2,
    superseded: 1,
  };
  for (const definition of definitions) {
    if (definition.state === "superseded") continue;
    const current = families.get(definition.familyId);
    if (!current
      || priority[definition.state] > priority[current.state]
      || (priority[definition.state] === priority[current.state] && definition.version > current.version)) {
      families.set(definition.familyId, definition);
    }
  }
  return [...families.values()];
}

export function buildMyTemplateSummaries(
  sources: WorkflowSource[],
  definitions: BusinessRoutineDefinition[],
): MyTemplateSummary[] {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const summaries: MyTemplateSummary[] = currentDefinitions(definitions).flatMap((definition) => {
    const source = sourceById.get(definition.sourceId);
    if (!source || (source.purpose !== "template_learning" && definition.templateScope !== "team")) return [];
    const input = inputText(definition);
    const output = myTemplateExpectedOutput(definition);
    return [{
      id: definition.familyId,
      familyId: definition.familyId,
      definitionId: definition.id,
      definitionVersion: definition.version,
      projectId: definition.projectId,
      sourceId: definition.sourceId,
      name: localizedTemplateText(definition.name),
      description: localizedTemplateText(definition.description),
      state: definitionState(definition),
      input,
      output,
      applicability: `当收到 ${input}，并希望得到 ${output} 时`,
      historyCaseCount: definition.historicalCaseIds.length,
      historyFolderName: source.name,
      maturity: definition.templateMaturity ?? "stable",
    } satisfies MyTemplateSummary];
  });

  const sourceIdsWithDefinitions = new Set(summaries.map((summary) => summary.sourceId));
  for (const source of sources) {
    if (source.state !== "active"
      || source.purpose !== "template_learning"
      || sourceIdsWithDefinitions.has(source.id)) continue;
    summaries.push({
      id: `source:${source.id}`,
      familyId: null,
      definitionId: null,
      definitionVersion: null,
      projectId: source.projectId,
      sourceId: source.id,
      name: source.name,
      description: "正在从本地历史工作中提取输入、输出和处理方法。",
      state: "learning",
      input: "待识别",
      output: "待识别",
      applicability: "完成历史案例确认后可用",
      historyCaseCount: 0,
      historyFolderName: source.name,
      maturity: null,
    });
  }

  const stateOrder: Record<MyTemplateState, number> = { needs_review: 0, learning: 1, ready: 2, paused: 3 };
  const preferredState: Record<MyTemplateState, number> = { ready: 4, needs_review: 3, learning: 2, paused: 1 };
  const normalizedLabel = (value: string) => value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
  const deduplicated: MyTemplateSummary[] = [];
  const duplicateIndex = new Map<string, number>();
  for (const summary of summaries) {
    if (!summary.familyId) {
      deduplicated.push(summary);
      continue;
    }
    const key = [summary.name, summary.input, summary.output].map(normalizedLabel).join("|");
    const existingIndex = duplicateIndex.get(key);
    if (existingIndex == null) {
      duplicateIndex.set(key, deduplicated.length);
      deduplicated.push(summary);
      continue;
    }
    const existing = deduplicated[existingIndex];
    const shouldReplace = preferredState[summary.state] > preferredState[existing.state]
      || (preferredState[summary.state] === preferredState[existing.state]
        && (summary.definitionVersion ?? 0) > (existing.definitionVersion ?? 0))
      || (preferredState[summary.state] === preferredState[existing.state]
        && (summary.definitionVersion ?? 0) === (existing.definitionVersion ?? 0)
        && summary.historyCaseCount > existing.historyCaseCount);
    if (shouldReplace) deduplicated[existingIndex] = summary;
  }
  return deduplicated.sort((left, right) => stateOrder[left.state] - stateOrder[right.state]
    || left.name.localeCompare(right.name));
}
