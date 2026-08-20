export const PRIVATE_TUTOR_VOICE_CONFIDENCE_THRESHOLD = 0.75;

const CHINESE_DIGITS = new Map([
  ["零", 0], ["〇", 0], ["一", 1], ["二", 2], ["两", 2], ["三", 3],
  ["四", 4], ["五", 5], ["六", 6], ["七", 7], ["八", 8], ["九", 9],
]);

export function normalizePrivateTutorSpeech({ transcript, confidence, alternatives = [], question } = {}) {
  const sourceText = String(transcript ?? "").trim().slice(0, 300);
  const numericConfidence = Number(confidence);
  if (!sourceText || !Number.isFinite(numericConfidence) || numericConfidence < 0 || numericConfidence > 1) {
    return { accepted: false, error: "invalid_private_tutor_voice_transcript" };
  }

  const normalizedExpression = normalizeForQuestion(sourceText, question);
  if (!normalizedExpression) {
    return {
      accepted: true,
      transcript: sourceText,
      normalizedExpression: null,
      confidence: numericConfidence,
      status: "unsupported",
      requiresConfirmation: true,
      reasonCodes: ["unsupported_math_expression"],
    };
  }

  const alternativeExpressions = alternatives
    .slice(0, 3)
    .map((value) => normalizeForQuestion(String(value ?? "").trim(), question))
    .filter(Boolean);
  const hasDifferentAlternative = alternativeExpressions.some((value) => value !== normalizedExpression);
  const reasonCodes = [];
  if (numericConfidence < PRIVATE_TUTOR_VOICE_CONFIDENCE_THRESHOLD) reasonCodes.push("low_confidence");
  if (hasDifferentAlternative) reasonCodes.push("alternative_mismatch");
  return {
    accepted: true,
    transcript: sourceText,
    normalizedExpression,
    confidence: numericConfidence,
    status: reasonCodes.length ? "confirmation_required" : "ready",
    requiresConfirmation: reasonCodes.length > 0,
    reasonCodes,
  };
}

export function privateTutorVoiceTurnView(turn) {
  if (!turn) return null;
  return {
    id: turn.id,
    learnerId: turn.learnerId,
    sessionId: turn.sessionId,
    questionRevisionId: turn.questionRevisionId,
    mode: turn.mode,
    provider: turn.provider,
    transcript: turn.transcript,
    normalizedExpression: turn.normalizedExpression,
    confidence: turn.confidence,
    status: turn.status,
    requiresConfirmation: turn.status !== "ready" && turn.status !== "confirmed",
    reasonCodes: [...turn.reasonCodes],
    attemptId: turn.attemptId,
    createdAt: turn.createdAt,
    confirmedAt: turn.confirmedAt,
  };
}

function normalizeForQuestion(text, question) {
  if (!text || !question) return null;
  if (question.kind === "choice") return normalizeChoice(text, question.options ?? []);
  return normalizeMathExpression(text);
}

function normalizeChoice(text, options) {
  const compact = normalizeWidth(text).toLowerCase().replace(/[\s，。,.！!？?]/g, "");
  const direct = compact.match(/^(?:我)?(?:答案(?:是)?|选择|选)?([a-z])(?:选项)?$/)?.[1];
  if (direct && options.some((option) => option.id.toLowerCase() === direct)) return direct;
  const ordinal = compact.match(/^(?:我)?(?:选择|选)?(?:第)?([一二三四五六七八九]|\d+)(?:个|项|选项)?$/)?.[1];
  const index = ordinal ? chineseInteger(ordinal) : null;
  if (index && options[index - 1]) return options[index - 1].id;
  const exact = options.find((option) => compact === normalizeWidth(option.label).toLowerCase().replace(/[\s，。,.！!？?]/g, ""));
  return exact?.id ?? null;
}

function normalizeMathExpression(text) {
  let input = normalizeWidth(text)
    .toLowerCase()
    .replace(/[，。！？?,!]/g, "")
    .replace(/答案(?:是|为)?/g, "")
    .replace(/应该是/g, "")
    .replace(/([xｘ])\s*(?:的值)?\s*是/g, "$1=")
    .replace(/等于/g, "=")
    .replace(/加上|加/g, "+")
    .replace(/减去|减/g, "-")
    .replace(/乘以|乘/g, "*")
    .replace(/除以|除/g, "/")
    .replace(/左括号/g, "(")
    .replace(/右括号/g, ")")
    .replace(/负/g, "-")
    .replace(/正/g, "+")
    .replace(/\s+/g, "");

  input = input.replace(/([零〇一二两三四五六七八九十百千万点]+)分之([零〇一二两三四五六七八九十百千万点]+)/g, (_match, denominator, numerator) => {
    const top = chineseNumber(numerator);
    const bottom = chineseNumber(denominator);
    return top == null || bottom == null ? _match : `${top}/${bottom}`;
  });
  input = input.replace(/[零〇一二两三四五六七八九十百千万点]+/g, (value) => chineseNumber(value) ?? value);
  input = input.replace(/^([xｘ])(?:的值)?=/, "x=").replace(/ｘ/g, "x");
  if (!input || /[^0-9x=+\-*/().]/.test(input)) return null;
  if ((input.match(/=/g) ?? []).length > 1) return null;
  if (input.includes("=") && !/^x=.+$/.test(input)) return null;
  return input;
}

function normalizeWidth(value) {
  return String(value).replace(/[Ａ-Ｚａ-ｚ０-９＝＋－＊／（）]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 0xfee0));
}

function chineseNumber(value) {
  const [integerPart, decimalPart] = value.split("点");
  if (value.split("点").length > 2) return null;
  const integer = chineseInteger(integerPart);
  if (integer == null) return null;
  if (decimalPart == null) return String(integer);
  if (!decimalPart || [...decimalPart].some((character) => !CHINESE_DIGITS.has(character))) return null;
  return `${integer}.${[...decimalPart].map((character) => CHINESE_DIGITS.get(character)).join("")}`;
}

function chineseInteger(value) {
  if (/^\d+$/.test(value)) return Number(value);
  if (!value) return null;
  if ([...value].every((character) => CHINESE_DIGITS.has(character))) {
    return Number([...value].map((character) => CHINESE_DIGITS.get(character)).join(""));
  }
  const units = { 十: 10, 百: 100, 千: 1_000, 万: 10_000 };
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const character of value) {
    if (CHINESE_DIGITS.has(character)) {
      digit = CHINESE_DIGITS.get(character);
      continue;
    }
    const unit = units[character];
    if (!unit) return null;
    if (unit === 10_000) {
      section = (section + digit) * unit;
      total += section;
      section = 0;
    } else {
      section += (digit || 1) * unit;
    }
    digit = 0;
  }
  return total + section + digit;
}
