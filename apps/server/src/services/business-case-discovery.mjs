import { createHash } from "node:crypto";

import { businessRoutineSchemaVersion } from "@myagenttool/protocol/business-routine";

import { LOCAL_TEAM_ID, LOCAL_USER_ID } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

export const BUSINESS_CASE_DISCOVERY_VERSION = 1;
export const ROUTINE_DISCOVERY_VERSION = 3;
export const MINIMUM_CONFIRMED_CASES = 3;
export const MANDATORY_COVERAGE_THRESHOLD = 0.8;

const MAX_CLASSIFICATIONS = 500;
const MAX_CANDIDATES = 200;
const MIN_LINK_SCORE = 0.35;
const NUMBER_FIELDS = ["inquiry_number", "quotation_number", "order_number"];
const CONFIRMED_CLASSIFICATION_STATES = new Set(["confirmed", "corrected"]);
const CONFIRMED_CASE_STATES = new Set(["confirmed", "active", "completed"]);

const RELATIONSHIPS = new Map([
  ["inquiry:inquiry_ledger", "registers"],
  ["inquiry:price_list", "uses_reference"],
  ["inquiry:customer_reference", "uses_reference"],
  ["inquiry:other_reference", "uses_reference"],
  ["inquiry:quotation", "precedes"],
  ["quotation:price_list", "uses_reference"],
  ["quotation:customer_reference", "uses_reference"],
  ["quotation:quotation_ledger", "registers"],
  ["quotation:order", "handoff"],
  ["order:order_ledger", "registers"],
]);

function boundedText(value, max = 300) {
  const result = String(value ?? "").trim();
  return result && result.length <= max ? result : null;
}

function unique(values) {
  return [...new Set(values)];
}

function roundScore(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 1_000) / 1_000;
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fieldMap(classification) {
  return new Map((classification?.fieldProposals ?? [])
    .map((field) => [field.key, {
      ...field,
      comparableValue: String(field.normalizedValue ?? field.value ?? "").trim().toLowerCase(),
    }])
    .filter(([, field]) => field.comparableValue));
}

function commonDirectory(left, right) {
  const leftSegments = String(left?.relativePath ?? "").replaceAll("\\", "/").split("/").filter(Boolean);
  const rightSegments = String(right?.relativePath ?? "").replaceAll("\\", "/").split("/").filter(Boolean);
  leftSegments.pop();
  rightSegments.pop();
  let count = 0;
  while (count < leftSegments.length && leftSegments[count] === rightSegments[count]) count += 1;
  return count;
}

function dateDistanceDays(left, right) {
  const leftTime = Date.parse(left ?? "");
  const rightTime = Date.parse(right ?? "");
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return null;
  return Math.abs(leftTime - rightTime) / 86_400_000;
}

function matchingFieldEvidence(leftField, rightField) {
  return [
    ...(leftField?.evidenceRefs ?? []),
    ...(rightField?.evidenceRefs ?? []),
  ];
}

export function scoreBusinessDocumentLink({
  fromClassification,
  toClassification,
  fromArtifact,
  toArtifact,
} = {}) {
  const relationship = RELATIONSHIPS.get(
    `${fromClassification?.documentType}:${toClassification?.documentType}`,
  ) ?? null;
  if (!relationship || fromClassification?.artifactId === toClassification?.artifactId) return null;
  const fromFields = fieldMap(fromClassification);
  const toFields = fieldMap(toClassification);
  const reasons = ["The document types form a known business sequence."];
  const evidenceRefs = [];
  let score = 0.12;

  const fromNumbers = NUMBER_FIELDS.map((key) => fromFields.get(key)).filter(Boolean);
  const toNumbers = NUMBER_FIELDS.map((key) => toFields.get(key)).filter(Boolean);
  const numberMatch = fromNumbers.find((left) =>
    toNumbers.some((right) => right.comparableValue === left.comparableValue));
  if (numberMatch) {
    const other = toNumbers.find((right) => right.comparableValue === numberMatch.comparableValue);
    score += 0.48;
    reasons.push("A business document number matches.");
    evidenceRefs.push(...matchingFieldEvidence(numberMatch, other));
  }
  if (relationship !== "uses_reference" && !numberMatch) return null;

  for (const [key, weight, reason] of [
    ["customer", 0.18, "The customer matches."],
    ["product", 0.14, "The product matches."],
    ["amount", 0.08, "The amount matches."],
  ]) {
    const left = fromFields.get(key);
    const right = toFields.get(key);
    if (!left || !right || left.comparableValue !== right.comparableValue) continue;
    score += weight;
    reasons.push(reason);
    evidenceRefs.push(...matchingFieldEvidence(left, right));
  }

  const fromDate = fromFields.get("document_date");
  const toDate = toFields.get("document_date");
  const days = dateDistanceDays(fromDate?.comparableValue, toDate?.comparableValue);
  if (days != null && days <= 90) {
    score += 0.08 * (1 - (days / 91));
    reasons.push(days <= 7 ? "The dates are close together." : "The dates fall in the same business period.");
    evidenceRefs.push(...matchingFieldEvidence(fromDate, toDate));
  }

  const sharedDirectoryDepth = commonDirectory(fromArtifact, toArtifact);
  if (sharedDirectoryDepth > 0) {
    score += Math.min(0.07, sharedDirectoryDepth * 0.035);
    reasons.push("The files share a directory context.");
    evidenceRefs.push(
      { artifactId: fromArtifact.id, kind: "directory_context", field: null, location: "filename" },
      { artifactId: toArtifact.id, kind: "directory_context", field: null, location: "filename" },
    );
  }

  return {
    fromArtifactId: fromClassification.artifactId,
    toArtifactId: toClassification.artifactId,
    relationship,
    score: roundScore(score),
    reasons: unique(reasons).slice(0, 10),
    evidenceRefs: evidenceRefs.slice(0, 30),
    alternatives: [],
  };
}

function rolesFor(documentType) {
  if (documentType === "inquiry") return ["trigger", "input"];
  if (["price_list", "customer_reference", "other_reference"].includes(documentType)) return ["reference"];
  if (["quotation", "inquiry_ledger", "quotation_ledger", "order_ledger"].includes(documentType)) {
    return ["output"];
  }
  if (documentType === "order") return ["input"];
  return ["reference"];
}

function candidateHealth(candidate, state) {
  const source = state.workflowSources.find((row) => row.id === candidate.sourceId);
  if (!source || source.state !== "active") {
    return { state: "blocked", issues: ["The source is no longer active."] };
  }
  const issues = [];
  let blocked = false;
  for (const binding of candidate.artifactBindings) {
    const artifact = state.workflowArtifacts.find((row) => row.id === binding.artifactId);
    if (!artifact || artifact.availability === "missing") {
      blocked = true;
      issues.push("A supporting file is missing.");
    } else if (artifact.exclusion) {
      blocked = true;
      issues.push("A supporting file was excluded.");
    } else if (candidate.artifactFingerprints[artifact.id] !== artifact.fingerprint) {
      issues.push("A supporting file changed after this candidate was created.");
    }
  }
  return {
    state: blocked ? "blocked" : issues.length ? "downgraded" : "valid",
    issues: unique(issues),
  };
}

function linkAlternatives(link, allLinks) {
  return allLinks
    .filter((candidate) =>
      candidate.fromArtifactId === link.fromArtifactId
      && candidate.relationship === link.relationship
      && candidate.toArtifactId !== link.toArtifactId)
    .sort((left, right) => right.score - left.score || left.toArtifactId.localeCompare(right.toArtifactId))
    .slice(0, 5)
    .map((candidate) => ({
      artifactId: candidate.toArtifactId,
      score: candidate.score,
      reasons: candidate.reasons.slice(0, 5),
    }));
}

function selectLinksForAnchor(anchorId, allLinks, classificationByArtifact) {
  const selected = [];
  const visited = new Set([anchorId]);
  let frontier = [anchorId];
  for (let stage = 0; stage < 4 && frontier.length; stage += 1) {
    const next = [];
    for (const artifactId of frontier) {
      const outgoing = allLinks.filter((link) =>
        link.fromArtifactId === artifactId && link.score >= MIN_LINK_SCORE);
      const groups = new Map();
      for (const link of outgoing) {
        const key = `${link.relationship}:${classificationByArtifact.get(link.toArtifactId)?.documentType ?? "unknown"}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(link);
      }
      for (const links of groups.values()) {
        links.sort((left, right) => right.score - left.score || left.toArtifactId.localeCompare(right.toArtifactId));
        const best = links[0]?.score ?? 0;
        for (const link of links.filter((row) => row.score >= best - 0.1).slice(0, 5)) {
          selected.push({ ...link, alternatives: linkAlternatives(link, allLinks) });
          if (!visited.has(link.toArtifactId)) {
            visited.add(link.toArtifactId);
            next.push(link.toArtifactId);
          }
        }
      }
    }
    frontier = next;
  }
  return selected;
}

function buildCandidateShape({
  anchor,
  links,
  classifications,
  artifacts,
  correctionReason = null,
}) {
  const classificationByArtifact = new Map(classifications.map((row) => [row.artifactId, row]));
  const artifactById = new Map(artifacts.map((row) => [row.id, row]));
  const artifactIds = unique([
    anchor.artifactId,
    ...links.flatMap((link) => [link.fromArtifactId, link.toArtifactId]),
  ]);
  const anchorFields = fieldMap(anchor);
  const businessKey = anchorFields.get("inquiry_number")?.comparableValue.toUpperCase()
    ?? `case:${anchor.artifactId}`;
  const artifactBindings = artifactIds.map((artifactId) => {
    const documentType = classificationByArtifact.get(artifactId)?.documentType ?? "unknown";
    return { artifactId, documentType, roles: rolesFor(documentType) };
  });
  const evidenceRefs = links.flatMap((link) => link.evidenceRefs).slice(0, 100);
  const artifactFingerprints = Object.fromEntries(artifactIds.map((artifactId) => [
    artifactId,
    artifactById.get(artifactId)?.fingerprint ?? "",
  ]));
  const confidence = links.length
    ? roundScore(links.reduce((sum, link) => sum + link.score, 0) / links.length)
    : 0;
  return {
    businessKey,
    anchorArtifactId: anchor.artifactId,
    artifactBindings,
    links,
    evidenceRefs,
    artifactFingerprints,
    confidence,
    correctionReason,
  };
}

function caseEvidenceHealth(businessCase, state) {
  const source = state.workflowSources.find((row) => row.id === businessCase.sourceId);
  if (!source || source.state !== "active") return false;
  return businessCase.artifactBindings.every((binding) => {
    const artifact = state.workflowArtifacts.find((row) => row.id === binding.artifactId);
    const classification = state.businessDocumentClassifications.find((row) =>
      row.artifactId === binding.artifactId
      && CONFIRMED_CLASSIFICATION_STATES.has(row.confirmationState));
    return artifact
      && artifact.availability !== "missing"
      && !artifact.exclusion
      && businessCase.artifactFingerprints?.[artifact.id] === artifact.fingerprint
      && classification?.artifactFingerprint === artifact.fingerprint;
  });
}

function routineCandidateHealth(candidate, state) {
  const source = state.workflowSources.find((row) => row.id === candidate.sourceId);
  if (!source || source.state !== "active") {
    return { state: "blocked", issues: ["The source is no longer active."], healthyCaseCount: 0 };
  }
  const cases = candidate.confirmedCaseIds
    .map((caseId) => state.businessCases.find((row) => row.id === caseId))
    .filter(Boolean);
  const healthyCaseCount = cases.filter((businessCase) => caseEvidenceHealth(businessCase, state)).length;
  const issues = [];
  if (cases.length !== candidate.confirmedCaseIds.length) {
    issues.push("A historical business case is no longer available.");
  }
  if (healthyCaseCount !== cases.length) {
    issues.push("Evidence for a historical business case changed or became unavailable.");
  }
  if (healthyCaseCount < candidate.minimumCaseCount) {
    issues.push(`At least ${candidate.minimumCaseCount} healthy confirmed cases are required.`);
    return { state: "blocked", issues: unique(issues), healthyCaseCount };
  }
  return {
    state: issues.length ? "downgraded" : "valid",
    issues: unique(issues),
    healthyCaseCount,
  };
}

const STEP_TEMPLATES = [
  {
    key: "inquiry_registration",
    kind: "ledger_upsert",
    label: "Register the inquiry",
    documentTypes: ["inquiry_ledger"],
  },
  {
    key: "reference_retrieval",
    kind: "retrieve",
    label: "Retrieve pricing and customer references",
    documentTypes: ["price_list", "customer_reference", "other_reference"],
  },
  {
    key: "quotation_generation",
    kind: "generate",
    label: "Prepare the quotation",
    documentTypes: ["quotation"],
  },
  {
    key: "quotation_approval",
    kind: "human_approval",
    label: "Review and approve the quotation",
    documentTypes: ["quotation"],
    safetyGuard: true,
  },
  {
    key: "quotation_registration",
    kind: "ledger_upsert",
    label: "Register the quotation",
    documentTypes: ["quotation_ledger"],
  },
  {
    key: "order_signal",
    kind: "condition",
    label: "Check whether an order was received",
    documentTypes: ["order"],
  },
  {
    key: "order_handoff",
    kind: "create_issue",
    label: "Hand the confirmed order to order processing",
    documentTypes: ["order"],
  },
  {
    key: "order_registration",
    kind: "ledger_upsert",
    label: "Register the order",
    documentTypes: ["order_ledger"],
  },
];

export function deriveRoutineCandidateFromCases(cases, {
  minimumCaseCount = MINIMUM_CONFIRMED_CASES,
  mandatoryCoverageThreshold = MANDATORY_COVERAGE_THRESHOLD,
} = {}) {
  if (!Array.isArray(cases) || cases.length < minimumCaseCount) {
    return {
      ok: false,
      error: "insufficient_confirmed_business_cases",
      confirmedCaseCount: Array.isArray(cases) ? cases.length : 0,
      minimumCaseCount,
    };
  }
  const caseTypes = new Map(cases.map((businessCase) => [
    businessCase.id,
    new Set(businessCase.artifactBindings.map((binding) => binding.documentType)),
  ]));
  const steps = [];
  let previousKey = null;
  for (const template of STEP_TEMPLATES) {
    const supportCaseIds = cases
      .filter((businessCase) =>
        template.documentTypes.some((type) => caseTypes.get(businessCase.id).has(type)))
      .map((businessCase) => businessCase.id);
    if (!supportCaseIds.length) continue;
    const coverage = roundScore(supportCaseIds.length / cases.length);
    const mandatory = supportCaseIds.length >= minimumCaseCount
      && coverage >= mandatoryCoverageThreshold;
    const exceptionCaseIds = cases
      .map((businessCase) => businessCase.id)
      .filter((id) => !supportCaseIds.includes(id));
    const requirement = mandatory ? "mandatory" : "conditional";
    const explanation = template.safetyGuard
      ? `${supportCaseIds.length} of ${cases.length} confirmed cases generated a quotation; human review is kept as a safety gate.`
      : mandatory
        ? `${supportCaseIds.length} of ${cases.length} confirmed cases include this step, meeting the ${Math.round(mandatoryCoverageThreshold * 100)}% mandatory threshold and minimum support of ${minimumCaseCount}.`
        : `${supportCaseIds.length} of ${cases.length} confirmed cases include this step; it remains conditional because it does not meet both mandatory gates.`;
    const evidenceRefs = cases
      .filter((businessCase) => supportCaseIds.includes(businessCase.id))
      .flatMap((businessCase) => businessCase.artifactBindings
        .filter((binding) => template.documentTypes.includes(binding.documentType))
        .map((binding) => ({
          artifactId: binding.artifactId,
          kind: "routine_step_coverage",
          field: null,
          location: null,
        })))
      .slice(0, 100);
    steps.push({
      key: template.key,
      kind: template.kind,
      label: template.label,
      required: mandatory,
      requirement,
      coverage,
      supportCaseIds,
      exceptionCaseIds,
      explanation,
      dependsOn: previousKey ? [previousKey] : [],
      evidenceRefs,
      configuration: template.safetyGuard ? { safetyGate: true } : {},
    });
    previousKey = template.key;
  }
  return { ok: true, steps };
}

const TEMPLATE_FORMAT_LABELS = Object.freeze({
  pdf: "PDF",
  doc: "Word",
  docx: "Word",
  xls: "Excel",
  xlsx: "Excel",
  ppt: "PowerPoint",
  pptx: "PowerPoint",
  png: "图片",
  jpg: "图片",
  jpeg: "图片",
  webp: "图片",
  md: "文本",
  txt: "文本",
});

function templateArtifactExtension(artifact) {
  const declared = String(artifact?.extension ?? "").replace(/^\./, "").toLowerCase();
  if (declared) return declared;
  return String(artifact?.name ?? artifact?.relativePath ?? "").match(/\.([^.\/\\]+)$/)?.[1]?.toLowerCase() ?? "";
}

function templateFileStem(artifact) {
  const name = String(artifact?.name ?? artifact?.relativePath ?? "").split(/[\\/]/).pop() ?? "";
  return name.replace(/\.[^.]+$/, "").trim();
}

function templateArtifactText(artifact) {
  return (artifact?.extraction?.blocks ?? [])
    .map((block) => String(block?.text ?? "").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 100_000);
}

function uniqueArtifactsForBindings(cases, state, acceptedRoles) {
  const ids = [...new Set(cases.flatMap((businessCase) => businessCase.artifactBindings
    .filter((binding) => (binding.roles ?? []).some((role) => acceptedRoles.has(role)))
    .map((binding) => binding.artifactId)))];
  return ids.map((id) => state.workflowArtifacts.find((artifact) => artifact.id === id)).filter(Boolean);
}

function templateInputConcept(artifacts) {
  const corpus = artifacts.map((artifact) => `${templateFileStem(artifact)}\n${templateArtifactText(artifact).slice(0, 2_000)}`).join("\n");
  if (/技术协议/u.test(corpus)) return /设备|试验箱|仪器/u.test(corpus) ? "设备技术协议" : "技术协议";
  for (const [pattern, label] of [
    [/采购申请/u, "采购申请"],
    [/合同/u, "合同资料"],
    [/验收/u, "验收资料"],
    [/周报/u, "周报资料"],
    [/询价|需求/u, "客户需求资料"],
    [/报价/u, "报价资料"],
  ]) {
    if (pattern.test(corpus)) return label;
  }
  const stems = [...new Set(artifacts.map(templateFileStem).filter(Boolean))];
  return stems.length === 1 && stems[0].length <= 40 ? stems[0] : "历史输入文件";
}

function templateFormatSummary(artifacts) {
  return [...new Set(artifacts.map((artifact) =>
    TEMPLATE_FORMAT_LABELS[templateArtifactExtension(artifact)] ?? templateArtifactExtension(artifact).toUpperCase())
    .filter(Boolean))].join("、");
}

function spreadsheetColumns(artifact) {
  if (!["xls", "xlsx"].includes(templateArtifactExtension(artifact))) return [];
  const row = (artifact?.extraction?.blocks ?? []).find((block) => block?.kind === "row" && String(block.text ?? "").includes("|"));
  if (!row) return [];
  return String(row.text).split("|")
    .map((cell) => cell.trim().replace(/^[A-Z]{1,3}:\s*/u, ""))
    .map((column) => column === "产品名利" ? "产品名称" : column)
    .filter(Boolean)
    .slice(0, 100);
}

function mappingForColumn(column, inputCorpus) {
  const rules = [
    { pattern: /序号/u, source: "按输出顺序生成", evidence: true },
    { pattern: /文件名/u, source: "输入文件名", evidence: true },
    { pattern: /技术协议号/u, source: "技术协议编号", terms: ["技术协议号", "协议编号"] },
    { pattern: /品牌|厂家/u, source: "生产厂家", terms: ["生产厂家", "厂家"] },
    { pattern: /产品名/u, source: "设备或产品名称", terms: ["设备", "产品", "试验箱"] },
    { pattern: /型号/u, source: "设备型号", terms: ["设备型号", "型号"] },
    { pattern: /数量/u, source: "配置或合同数量", terms: ["数量", "套", "台"] },
    { pattern: /保修/u, source: "售后服务中的保修年限", terms: ["保修", "质保"] },
    { pattern: /使用地/u, source: "设备使用地", terms: ["使用地", "安装地点"] },
    { pattern: /第三方计量/u, source: "计量或第三方校准要求", terms: ["第三方", "计量", "校准"] },
    { pattern: /报价单价/u, source: "报价单价", terms: ["报价单价", "单价"] },
    { pattern: /报价总价/u, source: "报价总价", terms: ["报价总价", "总价", "合计"] },
    { pattern: /备注/u, source: "补充说明", terms: ["备注"] },
  ];
  const rule = rules.find((candidate) => candidate.pattern.test(column));
  if (!rule) return { column, source: "待确认来源", confidence: "needs_confirmation" };
  const supported = rule.evidence === true || rule.terms.some((term) => inputCorpus.includes(term));
  return { column, source: rule.source, confidence: supported ? "supported" : "needs_confirmation" };
}

function deriveTemplateLearningRoutine(cases, state) {
  const inputArtifacts = uniqueArtifactsForBindings(cases, state, new Set(["trigger", "input"]));
  const outputArtifacts = uniqueArtifactsForBindings(cases, state, new Set(["output"]));
  if (!inputArtifacts.length || !outputArtifacts.length) return null;
  const inputConcept = templateInputConcept(inputArtifacts);
  const inputFormat = templateFormatSummary(inputArtifacts);
  const inputSummary = `${inputConcept}${inputFormat ? ` ${inputFormat}` : ""}`;
  const primaryOutput = outputArtifacts[0];
  const outputStem = templateFileStem(primaryOutput) || "工作结果";
  const outputFormat = templateFormatSummary(outputArtifacts);
  const outputSummary = `${outputStem}${outputFormat ? ` ${outputFormat}` : ""}`;
  const outputColumns = spreadsheetColumns(primaryOutput);
  const inputCorpus = inputArtifacts.map(templateArtifactText).join("\n");
  const fieldMappings = outputColumns.map((column) => mappingForColumn(column, inputCorpus));
  const uncertainFields = fieldMappings
    .filter((mapping) => mapping.confidence === "needs_confirmation")
    .map((mapping) => mapping.column);
  const evidenceRefs = [...inputArtifacts, ...outputArtifacts].map((artifact) => ({
    artifactId: artifact.id,
    kind: "template_learning_contract",
    field: null,
    location: null,
  })).slice(0, 100);
  const supportCaseIds = cases.map((businessCase) => businessCase.id);
  const step = (key, kind, label, dependsOn, configuration, refs = evidenceRefs) => ({
    key,
    kind,
    label,
    required: true,
    requirement: "mandatory",
    coverage: 1,
    supportCaseIds,
    exceptionCaseIds: [],
    explanation: `来自用户明确指定的 ${cases.length} 组历史输入和最终输出。`,
    dependsOn,
    evidenceRefs: refs,
    configuration,
  });
  const templateContract = {
    version: 1,
    inputSummary,
    inputFormats: [...new Set(inputArtifacts.map(templateArtifactExtension).filter(Boolean))],
    inputArtifactIds: inputArtifacts.map((artifact) => artifact.id),
    outputSummary,
    outputFormat: templateArtifactExtension(primaryOutput),
    outputFileName: primaryOutput.name ?? `${outputStem}.${templateArtifactExtension(primaryOutput)}`,
    outputArtifactIds: outputArtifacts.map((artifact) => artifact.id),
    outputColumns,
    fieldMappings,
    uncertainFields,
  };
  const triggerDocumentTypes = [...new Set(cases.flatMap((businessCase) => businessCase.artifactBindings
    .filter((binding) => (binding.roles ?? []).some((role) => role === "trigger" || role === "input"))
    .map((binding) => binding.documentType)))].filter(Boolean);
  return {
    name: `${inputConcept}生成${outputStem}`.slice(0, 200),
    description: `收到：${inputSummary}\n得到：${outputSummary}`,
    triggerDocumentTypes: triggerDocumentTypes.length ? triggerDocumentTypes : ["other_reference"],
    templateContract,
    evidenceRefs,
    steps: [
      step("read_inputs", "extract", `读取并理解${inputSummary}`, [], {
        inputSummary,
        inputFormats: templateContract.inputFormats,
        inputArtifactIds: templateContract.inputArtifactIds,
      }, evidenceRefs.filter((ref) => templateContract.inputArtifactIds.includes(ref.artifactId))),
      step("map_output_fields", "extract", `提取并整理${outputStem}所需字段`, ["read_inputs"], {
        outputColumns,
        fieldMappings,
        uncertainFields,
      }),
      step("generate_output", "generate", `生成${outputSummary}`, ["map_output_fields"], {
        executorId: "local.learned-template-output.v1",
        outputDirectory: "runs/template-outputs",
        expectedOutput: outputSummary,
        outputFileName: templateContract.outputFileName,
        outputFormat: templateContract.outputFormat,
        outputColumns,
        fieldMappings,
        uncertainFields,
        templateContract,
      }),
      step("review_output", "human_approval", `检查并确认${outputStem}`, ["generate_output"], {
        safetyGate: true,
        uncertainFields,
      }),
    ],
  };
}

export function createBusinessCaseDiscoveryService({
  state,
  now = () => new Date().toISOString(),
  nextId = (prefix) => `${prefix}_${Date.now().toString(36)}`,
  appendEvent = () => {},
  persistStateSoon = () => {},
  createBusinessCase,
  store,
} = {}) {
  if (!Array.isArray(state.businessCaseCandidates)) state.businessCaseCandidates = [];
  if (!Array.isArray(state.routineDiscoveryCandidates)) state.routineDiscoveryCandidates = [];
  const runTx = makeRunTx({ store, persistStateSoon });
  const actorTeam = (actor) => actor?.teamId ?? LOCAL_TEAM_ID;
  const actorUser = (actor) => actor?.userId ?? LOCAL_USER_ID;
  const visible = (row, actor) => row.ownerTeamId === actorTeam(actor);
  const sourceFor = (sourceId, actor) => state.workflowSources.find((row) =>
    row.id === sourceId && visible(row, actor));

  function event(type, message, record, actor, data = {}) {
    appendEvent({
      invocationId: null,
      type,
      level: type.includes("rejected") || type.includes("blocked") ? "warning" : "info",
      message,
      data: {
        projectId: record.projectId,
        sourceId: record.sourceId,
        actorTeamId: actorTeam(actor),
        actorId: actorUser(actor),
        ...data,
      },
    });
  }

  function persistCandidate(shape, source, actor, {
    familyId = null,
    version = 1,
    supersedes = null,
  } = {}) {
    const signature = hash([
      BUSINESS_CASE_DISCOVERY_VERSION,
      shape.anchorArtifactId,
      shape.artifactBindings.map((row) => [row.artifactId, shape.artifactFingerprints[row.artifactId]]).sort(),
      shape.links.map((row) => [row.fromArtifactId, row.toArtifactId, row.relationship, row.score]),
      shape.correctionReason,
    ]);
    const replay = state.businessCaseCandidates.find((row) =>
      visible(row, actor)
      && row.sourceId === source.id
      && ["proposed", "confirmed"].includes(row.state)
      && row.signature === signature);
    if (replay) return { candidate: replay, replayed: true };
    const timestamp = now();
    const id = nextId("bcc");
    const candidate = {
      id,
      familyId: familyId ?? id,
      schemaVersion: businessRoutineSchemaVersion,
      ownerTeamId: actorTeam(actor),
      projectId: source.projectId,
      sourceId: source.id,
      version,
      state: "proposed",
      ...shape,
      signature,
      supersedesId: supersedes?.id ?? null,
      supersededById: null,
      businessCaseId: null,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorUser(actor),
      updatedBy: actorUser(actor),
    };
    runTx(() => {
      if (supersedes) {
        supersedes.state = "superseded";
        supersedes.supersededById = candidate.id;
        supersedes.revision += 1;
        supersedes.updatedAt = timestamp;
        supersedes.updatedBy = actorUser(actor);
      }
      state.businessCaseCandidates.push(candidate);
      event("business_case_candidate_created", "Business case candidate created.", candidate, actor, {
        candidateId: candidate.id,
        version: candidate.version,
        artifactCount: candidate.artifactBindings.length,
        linkCount: candidate.links.length,
      });
    });
    return { candidate, replayed: false };
  }

  function discoverBusinessCases({ sourceId } = {}, actor = null) {
    const source = sourceFor(sourceId, actor);
    if (!source) return { status: 404, body: { error: "workflow_source_not_found" } };
    if (source.state !== "active") {
      return { status: 409, body: { error: "workflow_source_not_active" } };
    }
    const classifications = state.businessDocumentClassifications.filter((row) =>
      visible(row, actor)
      && row.sourceId === source.id
      && CONFIRMED_CLASSIFICATION_STATES.has(row.confirmationState))
      .slice(0, MAX_CLASSIFICATIONS);
    const artifacts = state.workflowArtifacts.filter((row) =>
      visible(row, actor)
      && row.sourceId === source.id
      && row.availability !== "missing"
      && !row.exclusion);
    const artifactById = new Map(artifacts.map((row) => [row.id, row]));
    const healthyClassifications = classifications.filter((row) =>
      artifactById.get(row.artifactId)?.fingerprint === row.artifactFingerprint);
    const classificationByArtifact = new Map(healthyClassifications.map((row) => [row.artifactId, row]));

    // A template-learning intake already contains a user-declared case boundary
    // and explicit input/output roles. Preserve that fact instead of trying to
    // rediscover the pairing from document numbers. Real businesses commonly use
    // different inquiry and quotation numbers, so a heuristic-only pass can lose
    // an otherwise unambiguous pair even after the user selected both files.
    const learningTask = (state.templateLearningTasks ?? []).find((row) =>
      row.sourceId === source.id && row.ownerTeamId === actorTeam(actor));
    if (learningTask?.cases?.length) {
      const artifactByPath = new Map(artifacts.map((row) => [row.relativePath, row]));
      const results = [];
      for (const learningCase of learningTask.cases.slice(0, MAX_CANDIDATES)) {
        const declared = learningCase.files.map((file) => {
          const artifact = artifactByPath.get(file.relativePath);
          return {
            role: file.role,
            artifact,
            classification: artifact ? classificationByArtifact.get(artifact.id) : null,
          };
        }).filter((row) => row.artifact && row.classification);
        const inputs = declared.filter((row) => row.role === "input");
        const outputs = declared.filter((row) => row.role === "output");
        if (!inputs.length || !outputs.length) continue;
        const anchorRecord = inputs.find((row) => row.classification.documentType === "inquiry") ?? inputs[0];
        const links = declared
          .filter((row) => row.artifact.id !== anchorRecord.artifact.id)
          .map((row) => ({
            fromArtifactId: anchorRecord.artifact.id,
            toArtifactId: row.artifact.id,
            relationship: row.role === "output" ? "precedes"
              : row.role === "reference" ? "uses_reference" : "supports",
            score: 1,
            reasons: ["The user explicitly selected these files as one historical input/output case."],
            evidenceRefs: [
              { artifactId: anchorRecord.artifact.id, kind: "template_learning_pair", field: null, location: learningCase.id },
              { artifactId: row.artifact.id, kind: "template_learning_pair", field: null, location: learningCase.id },
            ],
            alternatives: [],
          }));
        const shape = buildCandidateShape({
          anchor: anchorRecord.classification,
          links,
          classifications: declared.map((row) => row.classification),
          artifacts: declared.map((row) => row.artifact),
        });
        shape.confidence = 1;
        shape.artifactBindings = declared.map((row) => ({
          artifactId: row.artifact.id,
          documentType: row.classification.documentType,
          roles: row.role === "input"
            ? (row.artifact.id === anchorRecord.artifact.id ? ["trigger", "input"] : ["input"])
            : row.role === "output" ? ["output"] : ["reference"],
        }));
        const previous = state.businessCaseCandidates
          .filter((row) => visible(row, actor)
            && row.sourceId === source.id
            && row.anchorArtifactId === anchorRecord.artifact.id
            && row.state !== "rejected")
          .sort((left, right) => right.version - left.version)[0] ?? null;
        const persisted = persistCandidate(shape, source, actor, previous
          ? { familyId: previous.familyId, version: previous.version + 1, supersedes: previous }
          : {});
        results.push(persisted);
      }
      return {
        status: 200,
        body: {
          sourceId: source.id,
          candidates: results.map((row) => ({
            ...row.candidate,
            evidenceHealth: candidateHealth(row.candidate, state),
            replayed: row.replayed,
          })),
          count: results.length,
          analyzedClassificationCount: healthyClassifications.length,
          pairingMode: "user_declared_template_cases",
          truncated: learningTask.cases.length > MAX_CANDIDATES,
        },
      };
    }
    const allLinks = [];
    for (const fromClassification of healthyClassifications) {
      for (const toClassification of healthyClassifications) {
        const link = scoreBusinessDocumentLink({
          fromClassification,
          toClassification,
          fromArtifact: artifactById.get(fromClassification.artifactId),
          toArtifact: artifactById.get(toClassification.artifactId),
        });
        if (link) allLinks.push(link);
      }
    }
    const results = [];
    const anchors = healthyClassifications.filter((row) => row.documentType === "inquiry");
    for (const anchor of anchors.slice(0, MAX_CANDIDATES)) {
      const links = selectLinksForAnchor(
        anchor.artifactId,
        allLinks,
        classificationByArtifact,
      );
      if (!links.length) continue;
      const shape = buildCandidateShape({ anchor, links, classifications: healthyClassifications, artifacts });
      const previous = state.businessCaseCandidates
        .filter((row) =>
          visible(row, actor)
          && row.sourceId === source.id
          && row.anchorArtifactId === anchor.artifactId
          && row.state !== "rejected")
        .sort((left, right) => right.version - left.version)[0] ?? null;
      const persisted = persistCandidate(shape, source, actor, previous
        ? { familyId: previous.familyId, version: previous.version + 1, supersedes: previous }
        : {});
      results.push(persisted);
    }
    return {
      status: 200,
      body: {
        sourceId: source.id,
        candidates: results.map((row) => ({
          ...row.candidate,
          evidenceHealth: candidateHealth(row.candidate, state),
          replayed: row.replayed,
        })),
        count: results.length,
        analyzedClassificationCount: healthyClassifications.length,
        truncated: classifications.length >= MAX_CLASSIFICATIONS || anchors.length > MAX_CANDIDATES,
      },
    };
  }

  function listBusinessCaseCandidates({ sourceId = null, state: stateFilter = null } = {}, actor = null) {
    if (sourceId && !sourceFor(sourceId, actor)) {
      return { status: 404, body: { error: "workflow_source_not_found" } };
    }
    if (stateFilter && !["proposed", "confirmed", "rejected", "superseded"].includes(stateFilter)) {
      return { status: 400, body: { error: "invalid_business_case_candidate_state" } };
    }
    const candidates = state.businessCaseCandidates
      .filter((row) =>
        visible(row, actor)
        && (!sourceId || row.sourceId === sourceId)
        && (!stateFilter || row.state === stateFilter))
      .map((row) => ({ ...row, evidenceHealth: candidateHealth(row, state) }));
    return { status: 200, body: { candidates, count: candidates.length } };
  }

  function correctedCandidateShape(candidate, artifactIds, correctionReason, actor) {
    const selectedIds = unique(Array.isArray(artifactIds) ? artifactIds.map((value) => boundedText(value)).filter(Boolean) : []);
    if (selectedIds.length < 2 || selectedIds.length > 100 || !selectedIds.includes(candidate.anchorArtifactId)) {
      return { error: "invalid_business_case_candidate_artifacts" };
    }
    const classifications = selectedIds.map((artifactId) =>
      state.businessDocumentClassifications.find((row) =>
        visible(row, actor)
        && row.sourceId === candidate.sourceId
        && row.artifactId === artifactId
        && CONFIRMED_CLASSIFICATION_STATES.has(row.confirmationState)));
    const artifacts = selectedIds.map((artifactId) =>
      state.workflowArtifacts.find((row) =>
        visible(row, actor)
        && row.sourceId === candidate.sourceId
        && row.id === artifactId
        && row.availability !== "missing"
        && !row.exclusion));
    if (classifications.some((row) => !row) || artifacts.some((row) => !row)) {
      return { error: "business_case_candidate_artifact_not_found" };
    }
    if (classifications.some((row, index) => row.artifactFingerprint !== artifacts[index].fingerprint)) {
      return { error: "business_case_candidate_evidence_changed" };
    }
    const allLinks = [];
    for (const fromClassification of classifications) {
      for (const toClassification of classifications) {
        const link = scoreBusinessDocumentLink({
          fromClassification,
          toClassification,
          fromArtifact: artifacts.find((row) => row.id === fromClassification.artifactId),
          toArtifact: artifacts.find((row) => row.id === toClassification.artifactId),
        });
        if (link) {
          allLinks.push({
            ...link,
            reasons: unique([...link.reasons, "This document was included by a user correction."]),
          });
        }
      }
    }
    const reachable = new Set([candidate.anchorArtifactId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const link of allLinks) {
        if (!reachable.has(link.fromArtifactId) || reachable.has(link.toArtifactId)) continue;
        reachable.add(link.toArtifactId);
        changed = true;
      }
    }
    if (selectedIds.some((artifactId) => !reachable.has(artifactId))) {
      return { error: "business_case_candidate_contains_disconnected_artifacts" };
    }
    const anchor = classifications.find((row) => row.artifactId === candidate.anchorArtifactId);
    const links = allLinks.map((link) => ({ ...link, alternatives: linkAlternatives(link, allLinks) }));
    if (!links.length) return { error: "business_case_candidate_has_no_valid_links" };
    return {
      shape: buildCandidateShape({
        anchor,
        links,
        classifications,
        artifacts,
        correctionReason,
      }),
    };
  }

  function reviewBusinessCaseCandidate({
    candidateId,
    expectedRevision,
    action,
    artifactIds = [],
    correctionReason = null,
  } = {}, actor = null) {
    const candidate = state.businessCaseCandidates.find((row) =>
      row.id === candidateId && visible(row, actor));
    if (!candidate) return { status: 404, body: { error: "business_case_candidate_not_found" } };
    if (expectedRevision !== candidate.revision) {
      return {
        status: 409,
        body: { error: "business_case_candidate_revision_conflict", currentRevision: candidate.revision },
      };
    }
    if (candidate.state !== "proposed") {
      return { status: 409, body: { error: "business_case_candidate_not_reviewable" } };
    }
    if (action === "correct") {
      const reason = boundedText(correctionReason, 500);
      if (!reason) return { status: 400, body: { error: "business_case_candidate_correction_reason_required" } };
      const corrected = correctedCandidateShape(candidate, artifactIds, reason, actor);
      if (corrected.error) return { status: 400, body: { error: corrected.error } };
      const source = sourceFor(candidate.sourceId, actor);
      const persisted = persistCandidate(corrected.shape, source, actor, {
        familyId: candidate.familyId,
        version: candidate.version + 1,
        supersedes: candidate,
      });
      return {
        status: 201,
        body: {
          candidate: { ...persisted.candidate, evidenceHealth: candidateHealth(persisted.candidate, state) },
          replayed: persisted.replayed,
        },
      };
    }
    if (!["confirm", "reject"].includes(action)) {
      return { status: 400, body: { error: "invalid_business_case_candidate_action" } };
    }
    if (action === "confirm") {
      const health = candidateHealth(candidate, state);
      if (health.state !== "valid") {
        return { status: 409, body: { error: "business_case_candidate_evidence_not_valid", evidenceHealth: health } };
      }
      const entityIds = state.businessEntities
        .filter((row) =>
          visible(row, actor)
          && row.sourceId === candidate.sourceId
          && row.evidenceRefs.some((ref) =>
            candidate.artifactBindings.some((binding) => binding.artifactId === ref.artifactId)))
        .map((row) => row.id);
      const materialized = createBusinessCase({
        projectId: candidate.projectId,
        sourceId: candidate.sourceId,
        businessKey: candidate.businessKey,
        state: "confirmed",
        entityIds,
        artifactBindings: candidate.artifactBindings,
        evidenceRefs: candidate.evidenceRefs,
        confidence: candidate.confidence,
      }, actor);
      if (![200, 201].includes(materialized.status)) return materialized;
      runTx(() => {
        candidate.state = "confirmed";
        candidate.businessCaseId = materialized.body.businessCase.id;
        candidate.revision += 1;
        candidate.updatedAt = now();
        candidate.updatedBy = actorUser(actor);
        event("business_case_candidate_confirmed", "Business case candidate confirmed.", candidate, actor, {
          candidateId: candidate.id,
          businessCaseId: candidate.businessCaseId,
          version: candidate.version,
        });
      });
      return {
        status: 200,
        body: {
          candidate: { ...candidate, evidenceHealth: candidateHealth(candidate, state) },
          businessCase: materialized.body.businessCase,
        },
      };
    }
    runTx(() => {
      candidate.state = "rejected";
      candidate.revision += 1;
      candidate.updatedAt = now();
      candidate.updatedBy = actorUser(actor);
      event("business_case_candidate_rejected", "Business case candidate rejected.", candidate, actor, {
        candidateId: candidate.id,
        version: candidate.version,
      });
    });
    return { status: 200, body: { candidate: { ...candidate, evidenceHealth: candidateHealth(candidate, state) } } };
  }

  function discoverRoutine({ sourceId } = {}, actor = null) {
    const source = sourceFor(sourceId, actor);
    if (!source) return { status: 404, body: { error: "workflow_source_not_found" } };
    if (source.state !== "active") {
      return { status: 409, body: { error: "workflow_source_not_active" } };
    }
    const cases = state.businessCases.filter((row) =>
      visible(row, actor)
      && row.sourceId === source.id
      && CONFIRMED_CASE_STATES.has(row.state)
      && row.artifactBindings.some((binding) =>
        binding.documentType === "inquiry"
        || (source.purpose === "template_learning"
          && (binding.roles ?? []).some((role) => role === "input" || role === "trigger")))
      && caseEvidenceHealth(row, state));
    const minimumCaseCount = source.purpose === "template_learning" ? 1 : MINIMUM_CONFIRMED_CASES;
    const templateRoutine = source.purpose === "template_learning"
      ? deriveTemplateLearningRoutine(cases, state)
      : null;
    const derived = templateRoutine
      ? { ok: true, steps: templateRoutine.steps }
      : deriveRoutineCandidateFromCases(cases, { minimumCaseCount });
    if (!derived.ok) return { status: 409, body: derived };
    const evidenceRefs = derived.steps.flatMap((step) => step.evidenceRefs).slice(0, 100);
    const signature = hash([
      ROUTINE_DISCOVERY_VERSION,
      cases.map((row) => [row.id, row.revision]).sort(),
      derived.steps.map((row) => [row.key, row.requirement, row.coverage]),
      templateRoutine?.templateContract ?? null,
    ]);
    const replay = state.routineDiscoveryCandidates.find((row) =>
      visible(row, actor) && row.sourceId === source.id && row.signature === signature);
    if (replay) {
      return {
        status: 200,
        body: { candidate: { ...replay, evidenceHealth: routineCandidateHealth(replay, state) }, replayed: true },
      };
    }
    const previous = state.routineDiscoveryCandidates
      .filter((row) => visible(row, actor) && row.sourceId === source.id && row.state === "candidate")
      .sort((left, right) => right.version - left.version)[0] ?? null;
    const timestamp = now();
    const id = nextId("rdc");
    const mandatorySteps = derived.steps.filter((step) => step.requirement === "mandatory");
    const candidate = {
      id,
      familyId: previous?.familyId ?? id,
      schemaVersion: businessRoutineSchemaVersion,
      ownerTeamId: actorTeam(actor),
      projectId: source.projectId,
      sourceId: source.id,
      name: templateRoutine?.name ?? "Inquiry to quotation",
      description: templateRoutine?.description ?? null,
      version: (previous?.version ?? 0) + 1,
      state: "candidate",
      triggerDocumentTypes: templateRoutine?.triggerDocumentTypes ?? ["inquiry"],
      confirmedCaseIds: cases.map((row) => row.id),
      minimumCaseCount,
      templateMaturity: "stable",
      mandatoryCoverageThreshold: MANDATORY_COVERAGE_THRESHOLD,
      steps: derived.steps,
      evidenceRefs: templateRoutine?.evidenceRefs ?? evidenceRefs,
      templateContract: templateRoutine?.templateContract ?? null,
      confidence: cases.length >= MINIMUM_CONFIRMED_CASES
        ? roundScore(mandatorySteps.reduce((sum, step) => sum + step.coverage, 0)
          / Math.max(1, mandatorySteps.length))
        : 0.6,
      signature,
      supersedesId: previous?.id ?? null,
      supersededById: null,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorUser(actor),
      updatedBy: actorUser(actor),
    };
    runTx(() => {
      if (previous) {
        previous.state = "superseded";
        previous.supersededById = candidate.id;
        previous.revision += 1;
        previous.updatedAt = timestamp;
        previous.updatedBy = actorUser(actor);
      }
      state.routineDiscoveryCandidates.push(candidate);
      event("routine_discovery_candidate_created", "Business routine candidate discovered.", candidate, actor, {
        candidateId: candidate.id,
        version: candidate.version,
        confirmedCaseCount: cases.length,
        mandatoryStepCount: mandatorySteps.length,
        conditionalStepCount: derived.steps.length - mandatorySteps.length,
      });
    });
    return {
      status: 201,
      body: { candidate: { ...candidate, evidenceHealth: routineCandidateHealth(candidate, state) }, replayed: false },
    };
  }

  function listRoutineDiscoveryCandidates({ sourceId = null } = {}, actor = null) {
    if (sourceId && !sourceFor(sourceId, actor)) {
      return { status: 404, body: { error: "workflow_source_not_found" } };
    }
    const candidates = state.routineDiscoveryCandidates
      .filter((row) => visible(row, actor) && (!sourceId || row.sourceId === sourceId))
      .map((row) => ({ ...row, evidenceHealth: routineCandidateHealth(row, state) }));
    return { status: 200, body: { candidates, count: candidates.length } };
  }

  return {
    discoverBusinessCases,
    listBusinessCaseCandidates,
    reviewBusinessCaseCandidate,
    discoverRoutine,
    listRoutineDiscoveryCandidates,
  };
}
