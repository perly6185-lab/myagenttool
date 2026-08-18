import { describe, expect, it } from "vitest";
import { deriveDeliveryDecision } from "./work-item-summary-model";

const baseDecision = {
  language: "en" as const,
  mode: "local_merge" as const,
  changedFiles: ["src/feature.ts"],
  reviewVerdict: null,
  reviewStatus: null,
  verification: null,
  executionKind: "auto_run" as const,
  resultFiles: [],
};

describe("work item delivery decision", () => {
  it("blocks acceptance when reproducible verification failed", () => {
    const decision = deriveDeliveryDecision({
      ...baseDecision,
      verification: { passed: false, verified: true, summary: "test failed" },
    });

    expect(decision.state).toBe("changes");
    expect(decision.risk).toBe("high");
  });

  it("waits while independent review is still running", () => {
    const decision = deriveDeliveryDecision({
      ...baseDecision,
      reviewStatus: "running",
      verification: { passed: true, verified: true, summary: "checks passed" },
    });

    expect(decision.state).toBe("waiting");
    expect(decision.risk).toBe("unknown");
  });

  it("recommends acceptance only after review and verification pass", () => {
    const decision = deriveDeliveryDecision({
      ...baseDecision,
      reviewVerdict: "approved",
      reviewStatus: "completed",
      verification: { passed: true, verified: true, summary: "checks passed" },
    });

    expect(decision.state).toBe("ready");
    expect(decision.risk).toBe("low");
  });

  it("treats a verified article import as a completed low-risk result", () => {
    const decision = deriveDeliveryDecision({
      ...baseDecision,
      changedFiles: [],
      executionKind: "article_import",
      resultFiles: ["article.md"],
      verification: { passed: true, verified: true, summary: "accepted" },
    });

    expect(decision.state).toBe("ready");
    expect(decision.scope).toContain("1 output file");
  });
});
