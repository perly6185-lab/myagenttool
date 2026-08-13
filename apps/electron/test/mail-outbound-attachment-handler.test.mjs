import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { registerMailOutboundAttachmentHandler } from "../src/mail-outbound-attachment-handler.mjs";

test("picker stages a private copy and returns metadata without the source path", async () => {
  const root = mkdtempSync(join(tmpdir(), "mat-mail-outbound-"));
  try {
    const source = join(root, "Quarterly report.txt");
    const staging = join(root, "staging");
    writeFileSync(source, "private body");
    const handlers = new Map();
    registerMailOutboundAttachmentHandler({
      ipcMain: { removeHandler() {}, handle(name, fn) { handlers.set(name, fn); } },
      dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [source] }) },
      getWindow: () => null,
      attachmentRoot: staging,
    });
    const result = await handlers.get("mail:pick-outbound-attachments")();
    assert.equal(result.ok, true);
    assert.equal(result.attachments[0].name, "Quarterly report.txt");
    assert.match(result.attachments[0].ref, /^mailatt_[a-f0-9-]{36}$/);
    assert(!JSON.stringify(result).includes(source));
    assert.equal(readFileSync(join(staging, `${result.attachments[0].ref}.bin`), "utf8"), "private body");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pasted file bytes are staged locally and bounded", async () => {
  const root = mkdtempSync(join(tmpdir(), "mat-mail-paste-"));
  try {
    const handlers = new Map();
    registerMailOutboundAttachmentHandler({
      ipcMain: { removeHandler() {}, handle(name, fn) { handlers.set(name, fn); } },
      dialog: {}, getWindow: () => null, attachmentRoot: root,
    });
    const ok = await handlers.get("mail:stage-pasted-attachments")(null, { files: [{ name: "note.txt", contentType: "text/plain", data: new TextEncoder().encode("hello").buffer }] });
    assert.equal(ok.ok, true);
    const tooLarge = await handlers.get("mail:stage-pasted-attachments")(null, { files: [{ name: "huge.bin", contentType: "application/octet-stream", data: new ArrayBuffer(25 * 1024 * 1024 + 1) }] });
    assert.deepEqual(tooLarge, { ok: false, error: "attachment_too_large" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
