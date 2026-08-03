import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_WORKTREE_ATTACHMENT_BYTES,
  stageWorktreeAttachmentFiles,
} from "@/features/invocations/worktree-attachment-picker";

describe("stageWorktreeAttachmentFiles", () => {
  const originalFileReader = globalThis.FileReader;

  afterEach(() => {
    vi.stubGlobal("FileReader", originalFileReader);
  });

  it("reads accepted files and reports empty, oversized, and over-limit files", async () => {
    const result = await stageWorktreeAttachmentFiles([
      new File(["hello"], "notes.txt", { type: "text/plain" }),
      new File([], "empty.txt", { type: "text/plain" }),
      new File([new Uint8Array(MAX_WORKTREE_ATTACHMENT_BYTES + 1)], "large.bin"),
      new File(["extra"], "extra.txt", { type: "text/plain" }),
    ], 1);

    expect(result.attachments).toEqual([expect.objectContaining({
      name: "notes.txt",
      dataBase64: "aGVsbG8=",
      size: 5,
      type: "text/plain",
    })]);
    expect(result.rejected).toEqual([
      { name: "empty.txt", reason: "empty" },
      { name: "large.bin", reason: "too_large" },
      { name: "extra.txt", reason: "too_many" },
    ]);
  });

  it("turns browser read failures into an explicit rejection", async () => {
    class FailingFileReader {
      result: string | ArrayBuffer | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      readAsDataURL() {
        this.onerror?.();
      }
    }
    vi.stubGlobal("FileReader", FailingFileReader);

    const result = await stageWorktreeAttachmentFiles([
      new File(["hello"], "unreadable.txt", { type: "text/plain" }),
    ], 1);

    expect(result.attachments).toEqual([]);
    expect(result.rejected).toEqual([{ name: "unreadable.txt", reason: "read_failed" }]);
  });
});
