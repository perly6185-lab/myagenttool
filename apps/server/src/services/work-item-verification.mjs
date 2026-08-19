const ACCEPTANCE_HEADING_PATTERN = /^(#{1,6})\s*(acceptance(?:\s+criteria)?|definition\s+of\s+done|验收标准|完成标准)\s*[:：]?\s*$/i;

export function extractAcceptanceCriteriaFromBody(body) {
  const lines = String(body ?? "").split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => ACCEPTANCE_HEADING_PATTERN.test(line.trim()));
  if (headingIndex < 0) return [];
  const headingLevel = lines[headingIndex].trim().match(/^#+/)?.[0].length ?? 6;
  const criteria = [];
  for (const rawLine of lines.slice(headingIndex + 1)) {
    const line = rawLine.trim();
    const nextHeading = line.match(/^(#{1,6})\s+/);
    if (nextHeading && nextHeading[1].length <= headingLevel) break;
    const bullet = line.match(/^(?:[-*+]\s+|\d+[.)]\s+)(?:\[[ xX]\]\s*)?(.+)$/);
    if (!bullet) continue;
    const criterion = bullet[1].trim();
    if (criterion && criterion.length <= 2_000 && !criteria.includes(criterion)) criteria.push(criterion);
    if (criteria.length >= 100) break;
  }
  return criteria;
}

export function defaultVerificationSop({ title = "", body = "" } = {}) {
  const chinese = /[\u3400-\u9fff]/.test(`${title}${body}`);
  return chinese ? [
    "按实际使用方式逐项检查验收标准描述的行为，并记录每一项是否通过。",
    "查看自动测试、类型检查或其他验证证据，确认它们对应当前这版交付。",
    "查看独立代码复核结论，确认不存在阻止交付的问题。",
    "确认变更范围与任务目标一致，并了解应用变更或创建 Pull Request 的影响与风险。",
  ] : [
    "Exercise each acceptance criterion through the real user flow and record whether it passes.",
    "Review automated test, typecheck, or other verification evidence and confirm it belongs to this delivery.",
    "Review the independent code-review conclusion and confirm that no delivery-blocking issue remains.",
    "Confirm that the change stays within the task goal and understand the impact and risk of applying it or creating a pull request.",
  ];
}
