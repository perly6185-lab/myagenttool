import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OfficeDocumentFrame } from "@/components/common/office-document-frame";

describe("OfficeDocumentFrame", () => {
  it("sandboxes rendered Office HTML and injects the restrictive CSP", () => {
    render(<OfficeDocumentFrame title="report.docx" content="<p>Report</p>" />);
    const frame = screen.getByTitle("report.docx");
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("srcdoc")).toContain("default-src 'none'");
    expect(frame.getAttribute("srcdoc")).toContain("<p>Report</p>");
  });
});
