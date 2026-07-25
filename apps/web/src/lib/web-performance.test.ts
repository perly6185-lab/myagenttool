import { describe, expect, it } from "vitest";
import { rateWebPerformance } from "./web-performance";

describe("web performance ratings", () => {
  it("applies Core Web Vitals thresholds", () => {
    expect(rateWebPerformance("LCP", 2_500)).toBe("good");
    expect(rateWebPerformance("LCP", 3_000)).toBe("needs-improvement");
    expect(rateWebPerformance("LCP", 4_001)).toBe("poor");
    expect(rateWebPerformance("CLS", 0.1)).toBe("good");
    expect(rateWebPerformance("INP", 501)).toBe("poor");
  });
});
