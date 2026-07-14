import { isGovernedClaudeReviewAgent } from "./claude-agent.mjs";
import { createReviewImportService } from "./review-imports.mjs";

// Imports the structured findings a governed claude.review.diff run produced. The
// normalize-and-store logic lives in review-imports.mjs (shared with Codex); this
// is just the Claude spec + the historical export name/shape.
export function createClaudeReviewImportService(deps) {
  const { recordReviewFindings } = createReviewImportService(deps, {
    source: "claude",
    label: "Claude",
    tool: "claude.review.diff",
    collection: "claudeReviewFindings",
    idPrefix: "clf_demo",
    isGovernedAgent: isGovernedClaudeReviewAgent,
  });
  return { recordClaudeReviewFindings: recordReviewFindings };
}
