import { beforeEach, describe, expect, it, vi } from "vitest";
import { readDocumentTemplates, removeDocumentTemplate, saveDocumentTemplate } from "./document-templates";

describe("document template library", () => {
  beforeEach(() => { const values = new Map<string, string>(); vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }); });
  it("saves fields, replaces a duplicate, and removes a template", () => {
    const document = { projectId: "p", worktreeId: "w", path: "report.docx", name: "report.docx", type: "docx", gitStatus: "clean" } as const;
    saveDocumentTemplate(document, "Report", ["title", " owner "]);
    saveDocumentTemplate(document, "New report", ["quarter"]);
    expect(readDocumentTemplates()).toMatchObject([{ name: "New report", fields: [{ key: "quarter" }] }]);
    expect(removeDocumentTemplate(readDocumentTemplates()[0].id)).toEqual([]);
  });
});
