import { describe, expect, it } from "vitest";
import { classifyLocalDocumentPath, directoryOfLocalPath } from "./local-document-location";

describe("local document location", () => {
  const projects = [{ id: "p1", git: { repoPath: "/projects/demo" } }];
  const worktrees = [{ id: "w1", projectId: "p1", path: "/projects/demo/.worktrees/docs" }];
  it("prefers a worktree over its project root", () => expect(classifyLocalDocumentPath("/projects/demo/.worktrees/docs/report.docx", projects, worktrees)).toEqual({ scope: "worktree", projectId: "p1", worktreeId: "w1", relativePath: "report.docx" }));
  it("recognizes project and external documents", () => {
    expect(classifyLocalDocumentPath("/projects/demo/docs/report.docx", projects, worktrees)).toEqual({ scope: "project", projectId: "p1", relativePath: "docs/report.docx" });
    expect(classifyLocalDocumentPath("/Downloads/report.docx", projects, worktrees)).toEqual({ scope: "external" });
  });
  it("does not confuse sibling path prefixes", () => expect(classifyLocalDocumentPath("/projects/demo-copy/report.docx", projects, worktrees)).toEqual({ scope: "external" }));
  it("handles Windows drive casing and extracts platform-independent directories", () => {
    expect(classifyLocalDocumentPath("c:\\Projects\\Demo\\report.docx", [{ id: "p", git: { repoPath: "C:\\Projects\\Demo" } }], [])).toEqual({ scope: "project", projectId: "p", relativePath: "report.docx" });
    expect(directoryOfLocalPath("C:\\Users\\psy\\report.docx")).toBe("C:/Users/psy");
    expect(directoryOfLocalPath("/Users/psy/report.docx")).toBe("/Users/psy");
  });
});
