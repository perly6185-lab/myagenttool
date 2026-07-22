import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import { normalizeDocumentDestination, previewFailureCopy } from "@/features/documents/documents-view";

describe("Documents preview failure guidance", () => {
  it("guides an unavailable OfficeCLI runtime to Applications", () => {
    expect(previewFailureCopy(new ApiError("officecli_unavailable", "missing", 503))).toEqual({
      title: "OfficeCLI is not installed",
      detail: "Install OfficeCLI on this device, then register or retry the application.",
      showApplications: true,
    });
  });

  it("does not send a missing document to application setup", () => {
    expect(previewFailureCopy(new ApiError("not_found", "missing", 404)).showApplications).toBe(false);
  });

  it("preserves an unknown render failure detail", () => {
    expect(previewFailureCopy(new Error("corrupt package"))).toMatchObject({
      title: "Preview unavailable",
      detail: "corrupt package",
    });
  });
});

describe("Documents create destination", () => {
  it("normalizes separators and replaces an Office extension", () => {
    expect(normalizeDocumentDestination("docs\\report.xlsx", "docx")).toBe("docs/report.docx");
    expect(normalizeDocumentDestination("slides/q3", "pptx")).toBe("slides/q3.pptx");
  });
});
