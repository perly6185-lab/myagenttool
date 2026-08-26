const MAX_RESPONSE_LENGTH = 4_000;

export function evaluateAuthoredRubric(rawAnswer, rubric, { requiredSourceRefs = [] } = {}) {
  const answer = String(rawAnswer ?? "").trim();
  if (!answer || answer.length > MAX_RESPONSE_LENGTH) {
    return { accepted: false, error: "invalid_private_tutor_answer_format" };
  }
  const normalized = normalizeSemanticText(answer);
  const criteria = Array.isArray(rubric?.criteria) ? rubric.criteria.slice(0, 12) : [];
  if (!criteria.length) return { accepted: false, error: "private_tutor_rubric_unavailable" };

  const results = criteria.map((criterion) => {
    const alternatives = (criterion.acceptedPhrases ?? []).map(normalizeSemanticText).filter(Boolean);
    const matchedPhrase = alternatives.find((phrase) => normalized.includes(phrase)) ?? null;
    return {
      id: criterion.id,
      label: criterion.label,
      required: criterion.required !== false,
      matched: Boolean(matchedPhrase),
      matchedPhrase,
      sourceRef: criterion.sourceRef ?? null,
    };
  });
  const required = results.filter((item) => item.required);
  const matchedRequired = required.filter((item) => item.matched);
  const citations = extractSourceRefs(answer);
  const missingSourceRefs = requiredSourceRefs.filter((ref) => !citations.includes(ref));
  const score = required.length ? Number((matchedRequired.length / required.length).toFixed(2)) : 0;
  const complete = required.length > 0 && matchedRequired.length === required.length && missingSourceRefs.length === 0;

  return {
    accepted: true,
    correct: complete,
    responseKind: "answer",
    normalizedAnswer: answer.slice(0, MAX_RESPONSE_LENGTH),
    reason: complete ? "authored_rubric_complete" : "authored_rubric_incomplete",
    evidenceEligible: complete,
    evidenceTier: complete ? "rubric_high_confidence" : "practice_only",
    evaluation: {
      score,
      criteria: results,
      citedSourceRefs: citations,
      missingSourceRefs,
      requiresReview: !complete,
    },
  };
}

export function normalizeSemanticText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function extractSourceRefs(value) {
  return [...String(value).matchAll(/\[ref:([a-z0-9._-]{1,80})\]/gi)]
    .map((match) => match[1].toLowerCase())
    .filter((item, index, all) => all.indexOf(item) === index)
    .slice(0, 20);
}
