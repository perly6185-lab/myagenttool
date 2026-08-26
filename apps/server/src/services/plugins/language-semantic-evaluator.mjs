const MAX_RESPONSE_LENGTH = 4_000;
const NEGATION_TOKENS = new Set(["no", "not", "never", "without", "cannot"]);
const SENTENCE_BOUNDARY = "__sentence_boundary__";

export const LANGUAGE_SEMANTIC_EVALUATOR_VERSION = "causal-semantic-v2";

export function evaluateLanguageSemanticResponse(input, question) {
  const answer = String(input.rawAnswer ?? "").trim();
  const rubric = question.rubric ?? {};
  if (!answer || answer.length > MAX_RESPONSE_LENGTH) {
    return { accepted: false, error: "invalid_private_tutor_answer_format" };
  }
  if (rubric.profile !== LANGUAGE_SEMANTIC_EVALUATOR_VERSION || !Array.isArray(rubric.criteria) || !rubric.criteria.length) {
    return { accepted: false, error: "private_tutor_rubric_unavailable" };
  }

  const tokens = tokenizeEnglish(answer);
  if (!tokens.some((token) => token !== SENTENCE_BOUNDARY)) return { accepted: false, error: "invalid_private_tutor_answer_format" };
  const criteria = rubric.criteria.slice(0, 12).map((criterion) => evaluateCriterion(tokens, criterion));
  const required = criteria.filter((criterion) => criterion.required);
  const matched = required.filter((criterion) => criterion.matched);
  const contradicted = required.filter((criterion) => criterion.contradicted);
  const relation = evaluateCausalRelation(tokens, rubric.relation);
  const directionContradiction = matched.length === required.length && relation.recognized && !relation.valid;
  const coverage = required.length ? matched.length / required.length : 0;
  const semanticConfidence = required.length
    ? round(required.reduce((total, criterion) => total + criterion.matchConfidence, 0) / required.length)
    : 0;
  const evidenceThreshold = boundedNumber(rubric.evidenceThreshold, 0.88);
  const reviewThreshold = boundedNumber(rubric.reviewThreshold, 0.65);
  const voiceEvidenceThreshold = boundedNumber(rubric.voiceEvidenceThreshold, 0.9);
  const speechConfidence = input.source === "voice_confirmed"
    ? boundedNumber(input.recognitionConfidence, 0)
    : null;
  const combinedConfidence = speechConfidence === null
    ? semanticConfidence
    : round(Math.min(semanticConfidence, speechConfidence));

  const complete = required.length > 0
    && matched.length === required.length
    && contradicted.length === 0
    && relation.valid;
  const contradiction = contradicted.length > 0 || directionContradiction;
  const voiceNeedsReview = complete && speechConfidence !== null && speechConfidence < voiceEvidenceThreshold;
  const semanticNeedsReview = !contradiction && !complete && coverage >= reviewThreshold;
  const confidenceNeedsReview = complete && combinedConfidence < evidenceThreshold;
  const requiresReview = voiceNeedsReview || semanticNeedsReview || confidenceNeedsReview;
  const evidenceEligible = complete && !requiresReview;
  const semanticStatus = contradiction
    ? directionContradiction
      ? relation.direction === "disconnected" ? "causal_relation_disconnected" : "causal_direction_reversed"
      : "contradicted"
    : evidenceEligible ? "complete_high_confidence"
      : complete ? "complete_review_required"
        : requiresReview ? "borderline_review"
          : "incomplete";
  const reason = contradiction
    ? "semantic_contradiction"
    : evidenceEligible ? "semantic_complete_calibrated"
      : complete ? voiceNeedsReview ? "semantic_speech_review_required" : "semantic_review_required"
        : requiresReview ? "semantic_review_required"
          : "semantic_incomplete";

  return {
    accepted: true,
    correct: complete,
    responseKind: "answer",
    normalizedAnswer: answer.slice(0, MAX_RESPONSE_LENGTH),
    reason,
    evidenceEligible,
    evidenceTier: evidenceEligible ? "rubric_calibrated" : "practice_only",
    confidence: combinedConfidence,
    evaluation: {
      profile: LANGUAGE_SEMANTIC_EVALUATOR_VERSION,
      semanticStatus,
      score: round(coverage),
      confidence: combinedConfidence,
      semanticConfidence,
      speechConfidence,
      thresholds: { evidence: evidenceThreshold, review: reviewThreshold, voiceEvidence: voiceEvidenceThreshold },
      criteria,
      missingCriteria: required.filter((criterion) => !criterion.matched).map((criterion) => criterion.id),
      contradictedCriteria: contradicted.map((criterion) => criterion.id),
      causalRelation: relation,
      requiresReview,
      explanation: feedback({ complete, contradiction, directionContradiction, relation, requiresReview, criteria }),
    },
  };
}

export function tokenizeEnglish(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/can['’]t/g, "cannot")
    .replace(/won['’]t/g, "will not")
    .replace(/n['’]t/g, " not")
    .match(/[a-z]+(?:['’][a-z]+)?|[.!?]+/g)
    ?.map((token) => /^[.!?]+$/.test(token) ? SENTENCE_BOUNDARY : token) ?? [];
}

function evaluateCriterion(tokens, criterion) {
  const exact = bestPhraseMatch(tokens, criterion.acceptedPhrases ?? []);
  const groupMatches = (criterion.conceptGroups ?? []).map((alternatives) => bestPhraseMatch(tokens, alternatives));
  const matchedGroupCount = groupMatches.filter(Boolean).length;
  const groupCoverage = groupMatches.length ? matchedGroupCount / groupMatches.length : 0;
  const baseMatched = Boolean(exact) || (groupMatches.length > 0 && matchedGroupCount === groupMatches.length);
  const positions = exact?.positions ?? groupMatches.flatMap((match) => match?.positions ?? []);
  const contradicted = criterion.detectNegation !== false
    && baseMatched
    && positions.some((position) => hasNearbyNegation(tokens, position));
  const matchConfidence = exact ? 1 : round(groupCoverage * 0.9);
  return {
    id: criterion.id,
    label: criterion.label,
    required: criterion.required !== false,
    matched: baseMatched && !contradicted,
    contradicted,
    matchType: exact ? "authored_phrase" : baseMatched ? "concept_groups" : groupCoverage > 0 ? "partial_concepts" : "none",
    matchConfidence,
    matchedPhrase: exact?.phrase ?? null,
    matchedConcepts: groupMatches.map((match) => match?.phrase ?? null),
  };
}

function bestPhraseMatch(tokens, alternatives) {
  const matches = (alternatives ?? []).map((phrase) => {
    const phraseTokens = tokenizeEnglish(phrase);
    if (!phraseTokens.length) return null;
    for (let index = 0; index <= tokens.length - phraseTokens.length; index += 1) {
      if (phraseTokens.every((token, offset) => tokens[index + offset] === token)) {
        return { phrase: phraseTokens.join(" "), positions: phraseTokens.map((_, offset) => index + offset) };
      }
    }
    return null;
  }).filter(Boolean);
  return matches.sort((left, right) => right.positions.length - left.positions.length)[0] ?? null;
}

function hasNearbyNegation(tokens, position) {
  const nearby = tokens.slice(Math.max(0, position - 3), Math.min(tokens.length, position + 2));
  return nearby.some((token) => NEGATION_TOKENS.has(token));
}

function evaluateCausalRelation(tokens, relation = {}) {
  const causePositions = positionsForAliases(tokens, relation.causeAnchors ?? []);
  const effectPositions = positionsForAliases(tokens, relation.effectAnchors ?? []);
  const explicitConnectors = [
    ...connectorMatches(tokens, relation.reasonConnectors ?? ["because", "since", "due to"], "reason"),
    ...connectorMatches(tokens, relation.resultConnectors ?? ["so", "therefore", "thus"], "result"),
  ].sort((left, right) => left.start - right.start);
  const forwardConnectors = connectorMatches(
    tokens,
    relation.forwardVerbs ?? ["helps", "enables", "allows", "supports", "need", "needs"],
    "forward",
  ).sort((left, right) => left.start - right.start);
  const connectors = explicitConnectors.length ? explicitConnectors : forwardConnectors;
  if (!causePositions.length || !effectPositions.length || !connectors.length) {
    return { recognized: false, valid: false, connector: null, direction: "unresolved" };
  }
  const validations = connectors.map((connector) => ({ connector, ...validateConnectorDirection(connector, causePositions, effectPositions, tokens) }));
  const invalid = validations.find((candidate) => !candidate.valid);
  const selected = invalid ?? validations[0];
  return {
    recognized: true,
    valid: !invalid,
    connector: selected.connector.phrase,
    direction: invalid ? invalid.failure : "cause_to_effect",
  };
}

function validateConnectorDirection(connector, causePositions, effectPositions, tokens) {
  const connectorSegment = sentenceSegment(tokens, connector.start);
  const sameSegmentEffects = effectPositions.filter((position) => sentenceSegment(tokens, position) === connectorSegment);
  const allowedCauseSegments = connector.type === "result" ? new Set([connectorSegment - 1, connectorSegment]) : new Set([connectorSegment]);
  const relatedCauses = causePositions.filter((position) => allowedCauseSegments.has(sentenceSegment(tokens, position)));
  if (!relatedCauses.length || !sameSegmentEffects.length) return { valid: false, failure: "disconnected" };
  const causeBefore = relatedCauses.some((position) => position < connector.start);
  const causeAfter = relatedCauses.some((position) => position > connector.end);
  const effectBefore = sameSegmentEffects.some((position) => position < connector.start);
  const effectAfter = sameSegmentEffects.some((position) => position > connector.end);
  if (connector.type === "result" || connector.type === "forward") {
    return causeBefore && effectAfter ? { valid: true, failure: null } : { valid: false, failure: "reversed_or_ambiguous" };
  }
  const connectorStartsSegment = connector.start === 0 || tokens[connector.start - 1] === SENTENCE_BOUNDARY;
  const valid = connectorStartsSegment
    ? causeAfter && effectAfter && Math.min(...relatedCauses.filter((position) => position > connector.end)) < Math.max(...sameSegmentEffects)
    : effectBefore && causeAfter;
  return valid ? { valid: true, failure: null } : { valid: false, failure: "reversed_or_ambiguous" };
}

function sentenceSegment(tokens, position) {
  return tokens.slice(0, position).filter((token) => token === SENTENCE_BOUNDARY).length;
}

function positionsForAliases(tokens, aliases) {
  return aliases.flatMap((alias) => bestPhraseMatch(tokens, [alias])?.positions ?? []);
}

function connectorMatches(tokens, aliases, type) {
  return aliases.map((alias) => {
    const match = bestPhraseMatch(tokens, [alias]);
    return match ? { phrase: match.phrase, start: match.positions[0], end: match.positions.at(-1), type } : null;
  }).filter(Boolean);
}

function feedback({ complete, contradiction, directionContradiction, relation, requiresReview, criteria }) {
  if (directionContradiction && relation.direction === "disconnected") return "原因和结果都出现了，但连接词没有把它们连在同一个因果关系中。";
  if (directionContradiction) return "原因和结果都出现了，但因果方向写反了。";
  if (contradiction) return "回答中出现了否定表达，与题目要求的因果关系冲突。";
  if (complete && requiresReview) return "表达的因果内容完整，但当前置信度不足，需要确认后再计入掌握度。";
  if (complete) return "原因、结果和因果连接都表达清楚。";
  const missing = criteria.filter((criterion) => criterion.required && !criterion.matched).map((criterion) => criterion.label);
  return `还需要补充：${missing.join("、") || "完整的因果关系"}。`;
}

function boundedNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : fallback;
}

function round(value) {
  return Number(Number(value).toFixed(4));
}
