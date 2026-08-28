export const reviewVerdicts = ["approved", "changes_requested"];
export const reviewVerdictConsistencies = [
  "consistent",
  "corrected_clean_summary",
  "corrected_actionable_findings",
];

const CLEAN_SUMMARY_PATTERNS = [
  /\bno\s+(?:actionable\s+)?(?:findings?|issues?|bugs?|defects?|regressions?)(?:\s+(?:were\s+)?(?:found|identified|detected))?\b/i,
  /\bno\s+actionable(?:\s+[a-z-]+){0,6}\s+(?:findings?|issues?|bugs?|defects?|regressions?)(?:\s+(?:were\s+)?(?:found|identified|detected))?\b/i,
  /\bpatch is correct\b/i,
  /\blooks good\b/i,
  /\b(?:does|do|did) not introduce(?:\s+(?:any|observable|obvious|new))?\s+(?:issues?|bugs?|defects?|regressions?)\b/i,
  /\bno\s+(?:observable|obvious|new)\s+(?:issues?|bugs?|defects?|regressions?)\b/i,
  /(?:未发现|没有发现).{0,12}(?:缺陷|问题|错误|漏洞|回归)/i,
  /(?:未引入|没有引入).{0,12}(?:明显|可观察|新的)?(?:缺陷|问题|错误|漏洞|回归)/i,
];

const CONTRADICTORY_SUMMARY_PATTERN = /\b(?:but|however|although|yet|except|nevertheless|still)\b[\s\S]{0,300}\b(?:issue|bug|defect|regression|failure|incorrect|missing|broken|incomplete)\b|\b(?:is|are|was|were|remains?)\s+(?:still\s+)?(?:incorrect|missing|broken|incomplete|failing)\b|(?:但是|但|然而|不过|仍然|仍有).{0,150}(?:缺陷|问题|错误|漏洞|回归|失败|缺少|遗漏|未完成)/i;

export function reviewSummaryIndicatesClean(summary) {
  const text = String(summary ?? "").trim();
  return Boolean(text)
    && CLEAN_SUMMARY_PATTERNS.some((pattern) => pattern.test(text))
    && !CONTRADICTORY_SUMMARY_PATTERN.test(text);
}

export function normalizeReviewVerdict({ reportedVerdict = null, findings = [], summary = null } = {}) {
  const normalizedReportedVerdict = reviewVerdicts.includes(reportedVerdict) ? reportedVerdict : null;
  const actionableFindingCount = Array.isArray(findings) ? findings.length : 0;
  const cleanSummary = reviewSummaryIndicatesClean(summary);

  if (actionableFindingCount > 0) {
    return {
      verdict: "changes_requested",
      reportedVerdict: normalizedReportedVerdict,
      consistency: normalizedReportedVerdict === "approved" ? "corrected_actionable_findings" : "consistent",
      cleanSummary,
      actionableFindingCount,
    };
  }
  if (cleanSummary && normalizedReportedVerdict === "changes_requested") {
    return {
      verdict: "approved",
      reportedVerdict: normalizedReportedVerdict,
      consistency: "corrected_clean_summary",
      cleanSummary,
      actionableFindingCount,
    };
  }
  return {
    verdict: normalizedReportedVerdict ?? "approved",
    reportedVerdict: normalizedReportedVerdict,
    consistency: "consistent",
    cleanSummary,
    actionableFindingCount,
  };
}
