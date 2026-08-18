import { describe, expect, it } from "vitest";
import {
  browsableDeliveryPath,
  deliveryFileCanUseLegacyPath,
  parseMarkdownDocument,
  resolveDeliveryAssetPath,
} from "./work-item-delivery-preview-model";

describe("work item delivery preview model", () => {
  it("keeps legacy delivery paths inside the project", () => {
    expect(deliveryFileCanUseLegacyPath("deliverables/report.md")).toBe(true);
    expect(deliveryFileCanUseLegacyPath("../private.txt")).toBe(false);
    expect(deliveryFileCanUseLegacyPath("C:\\private.txt")).toBe(false);
    expect(browsableDeliveryPath("deliverables/report.md")).toBe(true);
    expect(browsableDeliveryPath("deliverables/archive.bin")).toBe(false);
  });

  it("resolves Markdown assets without escaping their project root", () => {
    expect(resolveDeliveryAssetPath("reports/weekly/report.md", "../images/chart.png"))
      .toBe("reports/images/chart.png");
    expect(resolveDeliveryAssetPath("report.md", "../private.png")).toBeNull();
    expect(resolveDeliveryAssetPath("report.md", "https://example.com/chart.png")).toBeNull();
  });

  it("turns front matter into readable document metadata and title", () => {
    expect(parseMarkdownDocument("---\ntitle: Weekly report\nauthor: Morgan\n---\nSummary")).toEqual({
      metadata: { title: "Weekly report", author: "Morgan" },
      body: "# Weekly report\n\nSummary",
    });
  });
});
