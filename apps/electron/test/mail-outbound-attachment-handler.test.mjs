import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { pruneStagedMailAttachments, registerMailOutboundAttachmentHandler } from "../src/mail-outbound-attachment-handler.mjs";

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

test("staged attachment orphans older than the retention window are pruned safely", () => {
  const root = mkdtempSync(join(tmpdir(), "mat-mail-retention-"));
  try {
    const ref = "mailatt_12345678-1234-1234-1234-123456789abc";
    const old = new Date("2026-06-01T00:00:00Z");
    for (const extension of ["bin", "json"]) {
      const path = join(root, `${ref}.${extension}`);
      writeFileSync(path, "x");
      utimesSync(path, old, old);
    }
    const unrelated = join(root, "keep-me.txt");
    writeFileSync(unrelated, "safe");
    const result = pruneStagedMailAttachments(root, { now: Date.parse("2026-08-13T00:00:00Z"), referencedRefs: [] });
    assert.equal(result.removed, 2);
    assert.equal(existsSync(unrelated), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("retention cleanup preserves old attachments referenced by a live draft", () => {
  const root = mkdtempSync(join(tmpdir(), "mat-mail-retention-live-"));
  try {
    const ref = "mailatt_22345678-1234-1234-1234-123456789abc";
    const old = new Date("2026-06-01T00:00:00Z");
    for (const extension of ["bin", "json"]) {
      const path = join(root, `${ref}.${extension}`);
      writeFileSync(path, "x");
      utimesSync(path, old, old);
    }
    const result = pruneStagedMailAttachments(root, {
      now: Date.parse("2026-08-13T00:00:00Z"),
      referencedRefs: [ref],
    });
    assert.equal(result.removed, 0);
    assert.equal(existsSync(join(root, `${ref}.bin`)), true);
    assert.equal(existsSync(join(root, `${ref}.json`)), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("retention cleanup is disabled when live draft references cannot be loaded", () => {
  const root = mkdtempSync(join(tmpdir(), "mat-mail-retention-unknown-"));
  try {
    const ref = "mailatt_32345678-1234-1234-1234-123456789abc";
    const path = join(root, `${ref}.bin`);
    writeFileSync(path, "x");
    utimesSync(path, new Date("2026-06-01T00:00:00Z"), new Date("2026-06-01T00:00:00Z"));
    assert.equal(pruneStagedMailAttachments(root, { now: Date.parse("2026-08-13T00:00:00Z") }).removed, 0);
    assert.equal(existsSync(path), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
