import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearRecentDocuments, readRecentDocuments, recordRecentDocument, removeRecentDocument, toggleRecentDocumentPinned } from "@/features/documents/recent-documents";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
});

describe("recent documents", () => {
  it("moves a reopened document to the front without duplicates", () => {
    const base = { projectId: "p1", worktreeId: null, name: "a.docx", path: "a.docx", type: "docx" as const, gitStatus: "clean" };
    recordRecentDocument(base);
    recordRecentDocument({ ...base, name: "b.xlsx", path: "b.xlsx", type: "xlsx" });
    recordRecentDocument(base);
    expect(readRecentDocuments().map((item) => item.path)).toEqual(["a.docx", "b.xlsx"]);
  });

  it("pins, removes, and clears entries", () => {
    const a = { projectId: "p1", worktreeId: null, name: "a.docx", path: "a.docx", type: "docx" as const, gitStatus: "clean" };
    const b = { ...a, name: "b.xlsx", path: "b.xlsx", type: "xlsx" as const };
    recordRecentDocument(a);
    const list = recordRecentDocument(b);
    toggleRecentDocumentPinned(list[1]);
    expect(readRecentDocuments().map((item) => [item.path, item.pinned])).toEqual([["a.docx", true], ["b.xlsx", undefined]]);
    removeRecentDocument(readRecentDocuments()[0]);
    expect(readRecentDocuments().map((item) => item.path)).toEqual(["b.xlsx"]);
    expect(clearRecentDocuments()).toEqual([]);
  });
});
