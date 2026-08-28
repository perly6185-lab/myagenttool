export declare const reviewVerdicts: readonly ["approved", "changes_requested"];
export type ReviewVerdict = (typeof reviewVerdicts)[number];

export declare const reviewVerdictConsistencies: readonly [
  "consistent",
  "corrected_clean_summary",
  "corrected_actionable_findings",
];
export type ReviewVerdictConsistency = (typeof reviewVerdictConsistencies)[number];

export type NormalizedReviewVerdict = {
  verdict: ReviewVerdict;
  reportedVerdict: ReviewVerdict | null;
  consistency: ReviewVerdictConsistency;
  cleanSummary: boolean;
  actionableFindingCount: number;
};

export declare function reviewSummaryIndicatesClean(summary: unknown): boolean;
export declare function normalizeReviewVerdict(input?: {
  reportedVerdict?: unknown;
  findings?: unknown;
  summary?: unknown;
}): NormalizedReviewVerdict;
