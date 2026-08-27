import { describe, expect, it } from "vitest";

import { readPrivateTutorMaterialFile } from "./private-tutor-material-file";

describe("private tutor material file encoding", () => {
  it("keeps text material as UTF-8 text", async () => {
    const file = new File(["# 第一章\n学习证据"], "notes.md", { type: "text/markdown" });

    await expect(readPrivateTutorMaterialFile(file, "markdown")).resolves.toEqual({
      fileContent: "# 第一章\n学习证据",
      fileEncoding: "utf8",
    });
  });

  it("preserves PDF bytes as base64 instead of decoding them as text", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0xff, 0x00, 0x80]);
    const file = new File([bytes], "book.pdf");

    const result = await readPrivateTutorMaterialFile(file, "pdf");

    expect(result.fileEncoding).toBe("base64");
    expect(result.fileContent).toBe("JVBERi0xLjQK/wCA");
    expect(result.fileContent).not.toContain("%PDF-");
  });
});
