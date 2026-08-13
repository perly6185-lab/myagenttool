import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { registerMailAttachmentHandler } from "../src/mail-attachment-handler.mjs";

function harness({ chosenPath = null, readAttachment } = {}) {
  const handlers = new Map();
  registerMailAttachmentHandler({
    ipcMain: { removeHandler: (name) => handlers.delete(name), handle: (name, fn) => handlers.set(name, fn) },
    dialog: { showSaveDialog: async () => chosenPath ? { canceled: false, filePath: chosenPath } : { canceled: true } },
    getWindow: () => null,
    readAttachment: readAttachment ?? (async ({ purpose }) => purpose === "preview"
      ? { id: "attachment-1", name: "note.txt", contentType: "text/plain", size: 5, kind: "text", text: "hello" }
      : { id: "attachment-1", name: "note.txt", contentType: "text/plain", size: 5, content: Buffer.from("hello") }),
  });
  return handlers;
}

test("safe preview returns bounded content without a filesystem path", async () => {
  const handlers = harness();
  const result = await handlers.get("mail:preview-attachment")(null, { messageId: "<m@x>", attachmentId: "attachment-1" });
  assert.equal(result.ok, true);
  assert.equal(result.preview.text, "hello");
  assert.equal("content" in result.preview, false);
});

test("download writes only to the native-dialog selection and returns no path", async () => {
  const root = mkdtempSync(join(tmpdir(), "mail-attachment-"));
  const chosenPath = join(root, "saved.txt");
  const handlers = harness({ chosenPath });
  const result = await handlers.get("mail:download-attachment")(null, { messageId: "<m@x>", attachmentId: "attachment-1", path: "C:\\attacker\\chosen" });
  assert.deepEqual(result, { ok: true, saved: true, name: "saved.txt" });
  assert.equal(readFileSync(chosenPath, "utf8"), "hello");
  assert.equal(existsSync(join(root, "attacker")), false);
});

test("attachment failures expose only allowlisted ordinary error codes", async () => {
  const handlers = harness({ readAttachment: async () => { throw new Error("credential path C:\\secret"); } });
  assert.deepEqual(await handlers.get("mail:preview-attachment")(null, {}), { ok: false, error: "attachment_unavailable" });
});
