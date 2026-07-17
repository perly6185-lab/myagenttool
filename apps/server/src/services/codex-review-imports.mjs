import { isGovernedCodexReviewAgent } from "./codex-agent.mjs";
import { createReviewImportService } from "./review-imports.mjs";

// Imports the structured findings a governed codex.review.diff run produced. The
// normalize-and-store logic lives in review-imports.mjs (shared with Claude); this
// is just the Codex spec + the historical export name/shape.
export function createCodexReviewImportService(deps) {
  const { recordReviewFindings } = createReviewImportService(deps, {
    source: "codex",
    label: "Codex",
    tool: "codex.review.diff",
    collection: "codexReviewFindings",
    idPrefix: "crf_demo",
    isGovernedAgent: isGovernedCodexReviewAgent,
  });
  return { recordCodexReviewFindings: recordReviewFindings };
}
