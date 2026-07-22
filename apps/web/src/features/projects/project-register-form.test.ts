import { describe, expect, it } from "vitest";
import { localDocumentReturnUrl } from "./project-register-form";

describe("local document registration handoff", () => {
  it("returns to Documents with the new project and selected filename", () => {
    expect(localDocumentReturnUrl("http://localhost/?section=projects&worktree=old&api=http%3A%2F%2Flocal", "project new", "Report Q4.docx")).toBe("/?section=documents&api=http%3A%2F%2Flocal&project=project+new&document=Report+Q4.docx");
  });
});
