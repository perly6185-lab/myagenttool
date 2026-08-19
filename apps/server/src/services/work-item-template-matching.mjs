const TEMPLATE_TRIGGER_TERMS = Object.freeze({
  inquiry: ["询价", "报价", "inquiry", "rfq", "quotation", "quote"],
  quotation: ["报价", "quotation", "quote"],
  order: ["订单", "order"],
  contract_review: ["合同", "审查", "contract", "review"],
  purchase_request: ["采购", "purchase", "procurement"],
  customer_complaint: ["投诉", "客诉", "complaint"],
  weekly_report: ["周报", "weekly report"],
  project_acceptance: ["验收", "acceptance"],
  payment_reconciliation: ["对账", "汇款对账", "收款核对", "reconciliation"],
  payment_confirmation: ["回款确认", "确认回款", "已回款", "核销回款", "payment confirmation"],
  after_sales: ["售后", "投诉", "维修", "退换货", "服务单", "after sales"],
  other_reference: ["技术协议", "设备协议", "技术规格书", "技术要求书", "reference"],
});

const TEMPLATE_OUTPUT_TERMS = Object.freeze({
  quotation: ["报价", "报价单", "quotation", "quote", "commercial offer"],
  order: ["订单", "order"],
  contract_review: ["合同审查", "合同审核", "contract review"],
  purchase_request: ["采购申请", "purchase request", "procurement request"],
  customer_complaint: ["投诉处理", "客诉处理", "complaint response"],
  weekly_report: ["周报", "weekly report"],
  project_acceptance: ["验收报告", "acceptance report"],
  payment_reconciliation: ["对账", "对账结果", "reconciliation"],
  payment_confirmation: ["回款确认", "回款已到账", "已回款", "payment confirmation"],
  after_sales: ["售后处理", "售后结果", "服务单", "after sales"],
  procurement_list: ["采购清单", "采购表", "采购明细表", "采购明细", "设备清单", "采购用excel"],
});

export function compactMatchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/采购明细表|采购明细|采购用(?:的)?excel|采购表|设备清单/giu, "采购清单")
    .replace(/设备协议|技术规格书|技术要求书/giu, "设备技术协议")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function normalizedDocumentFormat(value) {
  const format = String(value ?? "").trim().toLowerCase().replace(/^\./, "");
  if (["xls", "excel", "spreadsheet"].includes(format)) return "xlsx";
  if (["doc", "word"].includes(format)) return "docx";
  if (["ppt", "powerpoint"].includes(format)) return "pptx";
  if (format === "jpeg") return "jpg";
  return format;
}

function attachmentFormat(asset) {
  const fileNameMatch = String(asset?.originalName ?? "").match(/\.([^.]+)$/u);
  if (fileNameMatch) return normalizedDocumentFormat(fileNameMatch[1]);
  const mime = String(asset?.mimeType ?? "").toLowerCase();
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("spreadsheet") || mime.includes("excel")) return "xlsx";
  if (mime.includes("wordprocessing") || mime.includes("word")) return "docx";
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "pptx";
  if (mime.startsWith("image/")) return normalizedDocumentFormat(mime.slice(6));
  return "";
}

export function definitionTemplateContract(definition) {
  return definition?.templateContract
    ?? (definition?.steps ?? []).find((step) => step.kind === "generate")?.configuration?.templateContract
    ?? null;
}

export function textSimilarity(left, right) {
  const units = (value) => {
    const normalized = compactMatchText(value);
    if (!normalized) return new Set();
    if (normalized.length < 2) return new Set([normalized]);
    return new Set(Array.from({ length: normalized.length - 1 }, (_, index) => normalized.slice(index, index + 2)));
  };
  const leftUnits = units(left);
  const rightUnits = units(right);
  if (!leftUnits.size || !rightUnits.size) return 0;
  let intersection = 0;
  for (const unit of leftUnits) if (rightUnits.has(unit)) intersection += 1;
  return intersection / (leftUnits.size + rightUnits.size - intersection);
}

const TEMPLATE_ROUTING_VOCABULARY = [...new Set([
  ...Object.values(TEMPLATE_TRIGGER_TERMS).flat(),
  ...Object.values(TEMPLATE_OUTPUT_TERMS).flat(),
])];

export function templateRoutingTerms(intent) {
  const normalizedIntent = compactMatchText(intent);
  return TEMPLATE_ROUTING_VOCABULARY
    .filter((term) => normalizedIntent.includes(compactMatchText(term)))
    .map(compactMatchText)
    .filter((term, index, terms) => terms.indexOf(term) === index);
}

function templateConfigurationStrings(configuration, depth = 0) {
  if (!configuration || typeof configuration !== "object" || depth > 4) return [];
  return Object.values(configuration).flatMap((value) => {
    if (typeof value === "string") return value.trim() ? [value.trim()] : [];
    if (Array.isArray(value)) return value.flatMap((item) =>
      typeof item === "string" && item.trim()
        ? [item.trim()]
        : item && typeof item === "object" ? templateConfigurationStrings(item, depth + 1) : []);
    return value && typeof value === "object" ? templateConfigurationStrings(value, depth + 1) : [];
  });
}

function intentIncludesTemplateSignal(normalizedIntent, signal) {
  const normalized = compactMatchText(signal);
  const withoutFormat = normalized.replace(/(?:pdf|xlsx?|excel|docx?|word|pptx?|powerpoint|png|jpe?g|webp|文件)$/giu, "");
  return [normalized, withoutFormat].some((candidate) => candidate.length >= 2 && normalizedIntent.includes(candidate));
}

function templateConfiguredOutput(configuration) {
  if (!configuration || typeof configuration !== "object") return null;
  for (const key of ["output", "expectedOutput", "result", "outputName", "fileName", "format"]) {
    const value = configuration[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function learnedTemplateOutput(definition) {
  const outputs = (definition.steps ?? [])
    .filter((step) => ["generate", "create_issue", "ledger_upsert"].includes(step.kind))
    .flatMap((step) => [templateConfiguredOutput(step.configuration) ?? step.label])
    .filter(Boolean);
  return [...new Set(outputs)].join("、") || "按已确认步骤完成处理";
}

const MY_TEMPLATE_GOVERNANCE_WINDOW = 10;

export function latestMyTemplateGovernanceIntervention(interventions, familyId) {
  return interventions
    .filter((entry) => entry?.familyId === familyId && entry.action === "resume_observation")
    .sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")))[0] ?? null;
}

/**
 * Outcome governance is deliberately conservative: one bad result never
 * disables a template, content-quality feedback is not treated as a routing
 * error, and editing an earlier response immediately recalculates the state.
 */
export function evaluateMyTemplateGovernance({ outcomeFeedback = [], interventions = [], familyId = "" } = {}) {
  const latestIntervention = latestMyTemplateGovernanceIntervention(interventions, familyId);
  const historicalFeedbackIds = new Set(latestIntervention?.feedbackIds ?? []);
  const recent = outcomeFeedback
    .filter((entry) => entry?.familyId === familyId && !historicalFeedbackIds.has(entry.id))
    .sort((left, right) => String(right.updatedAt ?? right.createdAt ?? "")
      .localeCompare(String(left.updatedAt ?? left.createdAt ?? "")))
    .slice(0, MY_TEMPLATE_GOVERNANCE_WINDOW);
  const metExpectations = recent.filter((entry) => entry.outcome === "met_expectations").length;
  const wrongResult = recent.filter((entry) => entry.outcome === "wrong_result").length;
  const needsQualityAdjustment = recent.filter((entry) => entry.outcome === "needs_quality_adjustment").length;
  const matchingFeedbackCount = metExpectations + wrongResult;
  const wrongResultRate = matchingFeedbackCount ? wrongResult / matchingFeedbackCount : 0;
  const paused = matchingFeedbackCount >= 5 && wrongResult >= 3 && wrongResultRate >= 0.6;
  const watch = !paused && matchingFeedbackCount >= 3 && wrongResult >= 2 && wrongResultRate >= 0.4;
  const trusted = !paused && !watch && metExpectations >= 3 && wrongResultRate <= 0.25;
  const manualObservation = Boolean(latestIntervention) && !paused && !watch && !trusted;
  const state = paused ? "paused" : (watch || manualObservation) ? "watch" : trusted ? "trusted" : "learning";
  return {
    state,
    windowSize: recent.length,
    matchingFeedbackCount,
    metExpectations,
    wrongResult,
    needsQualityAdjustment,
    wrongResultRate: Number(wrongResultRate.toFixed(4)),
    autoMatchAllowed: !paused,
    requiresConfirmation: paused || watch || manualObservation,
    scoreAdjustment: watch || manualObservation ? -3 : 0,
    manualObservation,
    historicalFeedbackCount: historicalFeedbackIds.size,
    latestIntervention: latestIntervention ? {
      id: latestIntervention.id,
      action: latestIntervention.action,
      reason: latestIntervention.reason,
      createdAt: latestIntervention.createdAt,
      createdBy: latestIntervention.createdBy,
    } : null,
    reason: paused ? "repeated_wrong_result_feedback"
      : watch ? "elevated_wrong_result_feedback"
        : manualObservation ? "manual_resume_observation"
        : trusted ? "consistent_expected_results" : "insufficient_outcome_feedback",
  };
}

/**
 * Deterministic first-stage router for learned local templates. It deliberately
 * returns no match when only weak evidence exists; the caller can always create
 * an ordinary Issue instead of forcing a template.
 */
export function matchPublishedMyTemplate({
  definitions = [], routingFeedback = [], outcomeFeedback = [], governanceInterventions = [], projectId = "", intent = "", attachments = [],
} = {}) {
  const attachmentNames = attachments.map((asset) => asset?.originalName).filter(Boolean).join("\n");
  const normalizedIntent = compactMatchText(`${intent}\n${attachmentNames}`);
  if (!normalizedIntent) return {
    state: "missing", candidates: [], selected: null,
    decision: { kind: "no_match", confidence: "low", reason: "empty_intent" },
  };
  const currentRoutingTerms = templateRoutingTerms(intent);
  const explicitlyRequestsKnownOutput = definitions.some((definition) => {
    const output = learnedTemplateOutput(definition);
    if (intentIncludesTemplateSignal(normalizedIntent, output)) return true;
    return Object.values(TEMPLATE_OUTPUT_TERMS).some((terms) =>
      terms.some((term) => compactMatchText(output).includes(compactMatchText(term)))
      && terms.some((term) => normalizedIntent.includes(compactMatchText(term))));
  });
  const relevantRoutingFeedback = explicitlyRequestsKnownOutput ? [] : routingFeedback.filter((feedback) =>
    (feedback.intentTerms ?? []).some((term) => currentRoutingTerms.includes(term)));
  const learnedChoiceCounts = [...relevantRoutingFeedback.reduce((counts, feedback) => {
    const key = compactMatchText(feedback.selectedOutput);
    if (!key) return counts;
    const current = counts.get(key) ?? { label: feedback.selectedOutput, count: 0, familyIds: new Set() };
    current.count += feedback.kind === "confirmation" ? 2 : 1;
    current.familyIds.add(feedback.selectedFamilyId);
    counts.set(key, current);
    return counts;
  }, new Map()).values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  const learnedPreferenceConflict = learnedChoiceCounts.length > 1
    && learnedChoiceCounts[0].count - learnedChoiceCounts[1].count <= 1;
  const conflictingFamilyIds = new Set(learnedPreferenceConflict
    ? learnedChoiceCounts.flatMap((choice) => [...choice.familyIds])
    : []);
  const scoredCandidates = definitions
    .filter((definition) => definition?.state === "published"
      && (definition?.projectId === projectId || definition?.templateScope === "team"))
    .map((definition) => {
      let score = 0;
      const reasons = [];
      const name = compactMatchText(definition.name);
      if (name.length >= 2 && normalizedIntent.includes(name)) {
        score += 10;
        reasons.push(`任务目标明确提到“${definition.name}”`);
      }
      const output = learnedTemplateOutput(definition);
      const outputSignals = (definition.steps ?? [])
        .filter((step) => ["generate", "create_issue", "ledger_upsert"].includes(step.kind))
        .flatMap((step) => [step.key, step.label, ...templateConfigurationStrings(step.configuration)]);
      for (const signal of outputSignals) {
        const normalized = compactMatchText(signal);
        if (normalized.length < 2 || !intentIncludesTemplateSignal(normalizedIntent, signal)) continue;
        score += 6;
        if (!reasons.some((reason) => reason.startsWith("期望结果"))) reasons.push(`期望结果与“${signal}”一致`);
      }
      const outputSemantics = Object.entries(TEMPLATE_OUTPUT_TERMS).find(([, terms]) =>
        outputSignals.some((signal) => terms.some((term) => compactMatchText(signal).includes(compactMatchText(term)))));
      const matchedOutputTerm = outputSemantics?.[1].find((term) => normalizedIntent.includes(compactMatchText(term)));
      if (matchedOutputTerm && !reasons.some((reason) => reason.startsWith("期望结果"))) {
        score += 6;
        reasons.push(`期望结果与“${matchedOutputTerm}”一致`);
      }
      const triggerTerms = (definition.triggerDocumentTypes ?? [])
        .flatMap((type) => TEMPLATE_TRIGGER_TERMS[type] ?? [String(type)]);
      const matchedTrigger = triggerTerms.find((term) => normalizedIntent.includes(compactMatchText(term)));
      if (matchedTrigger) {
        score += 3;
        reasons.push(`输入或目标包含“${matchedTrigger}”`);
      }
      const inputSignals = (definition.steps ?? [])
        .filter((step) => ["extract", "retrieve"].includes(step.kind))
        .flatMap((step) => typeof step.configuration?.inputSummary === "string"
          ? [step.label, step.configuration.inputSummary]
          : []);
      const matchedInputSignal = inputSignals.find((signal) => intentIncludesTemplateSignal(normalizedIntent, signal));
      if (matchedInputSignal) {
        score += 4;
        reasons.push(`输入材料与“${matchedInputSignal}”一致`);
      }
      const configuredFormats = definitionTemplateContract(definition)?.inputFormats ?? [];
      const acceptedFormats = (Array.isArray(configuredFormats) ? configuredFormats : [configuredFormats])
        .map(normalizedDocumentFormat)
        .filter(Boolean);
      const providedFormats = [...new Set(attachments.map(attachmentFormat).filter(Boolean))];
      const matchedFormat = providedFormats.find((format) => acceptedFormats.includes(format));
      if (matchedFormat) {
        score += 5;
        reasons.push(`附件格式与模版需要的 ${matchedFormat.toUpperCase()} 一致`);
      }
      const description = compactMatchText(definition.description);
      if (description.length >= 4 && normalizedIntent.includes(description)) score += 4;
      if (!explicitlyRequestsKnownOutput && currentRoutingTerms.length) {
        const correctionScore = relevantRoutingFeedback.reduce((total, feedback) => {
          if (feedback.selectedFamilyId === definition.familyId) return total + 3;
          if (feedback.rejectedFamilyId === definition.familyId) return total - 3;
          return total;
        }, 0);
        const boundedCorrectionScore = Math.max(-6, Math.min(6, correctionScore));
        score += boundedCorrectionScore;
        if (boundedCorrectionScore > 0) reasons.push("参考了你之前对相似任务的纠正");
      }
      const governance = evaluateMyTemplateGovernance({
        outcomeFeedback, interventions: governanceInterventions, familyId: definition.familyId,
      });
      const rawScore = score;
      score += governance.scoreAdjustment;
      if (governance.state === "watch") reasons.push("近期匹配反馈偏低，使用前需要你确认");
      if (governance.state === "paused") reasons.push("近期多次反馈结果类型不对，已暂停自动匹配");
      return {
        templateId: definition.familyId,
        definitionId: definition.id,
        version: definition.version,
        name: definition.name,
        description: definition.description,
        expectedOutput: output,
        steps: (definition.steps ?? []).map((step) => step.label).filter(Boolean),
        rawScore,
        score,
        reasons,
        governance,
        templateMaturity: definition.templateMaturity ?? "stable",
      };
    });
  const candidates = scoredCandidates
    .filter((candidate) => candidate.governance.state !== "paused"
      && (candidate.rawScore >= 5 || conflictingFamilyIds.has(candidate.templateId)))
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 3);
  const pausedCandidates = scoredCandidates
    .filter((candidate) => candidate.governance.state === "paused" && candidate.rawScore >= 5)
    .sort((left, right) => right.rawScore - left.rawScore || left.name.localeCompare(right.name))
    .slice(0, 3);
  if (!candidates.length) return {
    state: pausedCandidates.length ? "ambiguous" : "missing",
    candidates: pausedCandidates,
    selected: null,
    decision: pausedCandidates.length
      ? { kind: "confirm_output", confidence: "low", reason: "outcome_feedback_paused" }
      : { kind: "no_match", confidence: "low", reason: "insufficient_evidence" },
    ...(pausedCandidates.length ? {
      clarification: {
        kind: "desired_output",
        question: "仍要按这个模版处理吗？",
        reason: "outcome_feedback_paused",
        message: "这个模版近期多次得到错误的结果类型，系统已停止自动套用。你仍可确认本次使用。",
        options: [...new Map(pausedCandidates.map((candidate) => [
          compactMatchText(candidate.expectedOutput),
          { definitionId: candidate.definitionId, label: candidate.expectedOutput },
        ])).values()],
      },
    } : {}),
  };
  const explicitlyRequestedOutputs = candidates.filter((candidate) => {
    const directMatch = intentIncludesTemplateSignal(normalizedIntent, candidate.expectedOutput);
    const semanticMatch = Object.values(TEMPLATE_OUTPUT_TERMS).some((terms) =>
      terms.some((term) => compactMatchText(candidate.expectedOutput).includes(compactMatchText(term)))
      && terms.some((term) => normalizedIntent.includes(compactMatchText(term))));
    return directMatch || semanticMatch;
  });
  const explicitOutputConflict = new Set(
    explicitlyRequestedOutputs.map((candidate) => compactMatchText(candidate.expectedOutput)),
  ).size > 1;
  const closeCandidates = candidates.length > 1 && candidates[0].score - candidates[1].score < 3;
  const scoreGap = candidates.length > 1 ? candidates[0].score - candidates[1].score : candidates[0].score;
  const dominantCandidate = candidates.length === 1
    || (scoreGap >= 6 && candidates[0].score >= Math.max(10, candidates[1].score * 2));
  const explicitlyOffersAlternatives = /(?:或(?:者)?|二选一|either\b|\bor\b)/iu.test(String(intent));
  const actionableExplicitOutputConflict = explicitOutputConflict
    && (!dominantCandidate || explicitlyOffersAlternatives);
  const conflictingCandidateOutputs = new Set(candidates
    .filter((candidate) => conflictingFamilyIds.has(candidate.templateId))
    .map((candidate) => compactMatchText(candidate.expectedOutput)));
  const hasActionableLearnedConflict = learnedPreferenceConflict && conflictingCandidateOutputs.size > 1;
  const governanceNeedsConfirmation = candidates[0]?.governance.requiresConfirmation === true;
  const manualObservationConfirmation = candidates[0]?.governance.manualObservation === true;
  const ambiguous = governanceNeedsConfirmation || actionableExplicitOutputConflict || hasActionableLearnedConflict || (closeCandidates
    && compactMatchText(candidates[0].expectedOutput) !== compactMatchText(candidates[1].expectedOutput));
  const decisionReason = manualObservationConfirmation ? "manual_resume_observation"
    : governanceNeedsConfirmation ? "outcome_feedback_watch"
    : actionableExplicitOutputConflict ? "explicit_output_conflict"
    : hasActionableLearnedConflict ? "learned_preference_conflict"
      : ambiguous ? "close_different_results"
        : explicitlyRequestedOutputs.length === 1 ? "explicit_result_match"
          : relevantRoutingFeedback.length ? "consistent_learned_preference"
            : "strong_template_match";
  const confidence = ambiguous ? "low"
    : (explicitlyRequestedOutputs.length === 1 || (candidates[0].score >= 9 && scoreGap >= 3)) ? "high" : "medium";
  return {
    state: ambiguous ? "ambiguous" : "matched",
    candidates,
    selected: ambiguous ? null : candidates[0],
    decision: { kind: ambiguous ? "confirm_output" : "auto_apply", confidence, reason: decisionReason },
    ...(ambiguous ? {
      clarification: {
        kind: "desired_output",
        question: "这次你希望最终得到什么？",
        reason: decisionReason,
        ...(manualObservationConfirmation ? {
          message: "这个模版由你恢复到观察期，本次确认结果后才会使用。",
        } : governanceNeedsConfirmation ? {
          message: "这个模版近期出现过多次结果类型不符，本次先由你确认结果。",
        } : {}),
        ...(hasActionableLearnedConflict ? {
          message: "你以前对此类任务选择过不同结果，请确认这次需要什么。",
          learnedChoices: learnedChoiceCounts.map(({ label, count }) => ({ label, count })),
        } : {}),
        options: [...new Map(candidates.map((candidate) => [
          compactMatchText(candidate.expectedOutput),
          { definitionId: candidate.definitionId, label: candidate.expectedOutput },
        ])).values()],
      },
    } : {}),
  };
}
