import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { read163Attachment } from "../src/attachment-163.mjs";
import { archiveMailSource, mailArchiveRef, readMailArchive } from "../src/mail-archive.mjs";

const source = Buffer.from([
  "Message-ID: <archive@example.com>",
  "From: sender@example.com",
  "To: receiver@example.com",
  "Subject: archive",
  "MIME-Version: 1.0",
  "Content-Type: multipart/mixed; boundary=demo",
  "",
  "--demo",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "local body",
  "--demo",
  "Content-Type: text/plain; name=note.txt",
  "Content-Disposition: attachment; filename=note.txt",
  "Content-Transfer-Encoding: base64",
  "",
  "aGVsbG8=",
  "--demo--",
  "",
].join("\r\n"));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mail-archive-"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("archives exact RFC 822 bytes and makes repeat fetch idempotent", () => {
  const fx = fixture();
  try {
    const input = { account: "User@163.com", messageId: "<archive@example.com>", folderPath: "INBOX", source, root: fx.root };
    const first = archiveMailSource({ ...input, now: () => "2026-08-14T05:00:00.000Z" });
    const second = archiveMailSource({ ...input, now: () => "2026-08-14T06:00:00.000Z" });
    assert.deepEqual(second, first);
    assert.equal(first.availability, "available");
    assert.deepEqual(readMailArchive({ ref: first.ref, root: fx.root }).source, source);
    assert.equal(JSON.stringify(first).includes(fx.root), false);
    assert.equal(first.ref, mailArchiveRef(input));
    assert.throws(
      () => archiveMailSource({ ...input, source: Buffer.from("different") }),
      (error) => error.code === "mail_archive_integrity_failed",
    );
  } finally { fx.cleanup(); }
});

test("refuses a changed original instead of presenting it as verified", () => {
  const fx = fixture();
  try {
    const archived = archiveMailSource({ account: "user@163.com", messageId: "<archive@example.com>", source, root: fx.root });
    const [, accountKey] = /^mailarc_([a-f0-9]{24})_/.exec(archived.ref);
    writeFileSync(join(fx.root, accountKey, archived.ref, "message.eml"), "tampered");
    assert.throws(
      () => readMailArchive({ ref: archived.ref, root: fx.root }),
      (error) => error.code === "mail_archive_integrity_failed",
    );
  } finally { fx.cleanup(); }
});

test("fails closed at per-message and total capacity limits", () => {
  const fx = fixture();
  try {
    assert.throws(
      () => archiveMailSource({ account: "user@163.com", messageId: "<large@example.com>", source, root: fx.root, maxMessageBytes: source.length - 1 }),
      (error) => error.code === "mail_archive_message_too_large",
    );
    assert.throws(
      () => archiveMailSource({ account: "user@163.com", messageId: "<full@example.com>", source, root: fx.root, maxArchiveBytes: source.length - 1 }),
      (error) => error.code === "mail_archive_capacity_exceeded",
    );
  } finally { fx.cleanup(); }
});

test("rejects symlinked archive files", (t) => {
  const fx = fixture();
  try {
    const archived = archiveMailSource({ account: "user@163.com", messageId: "<archive@example.com>", source, root: fx.root });
    const [, accountKey] = /^mailarc_([a-f0-9]{24})_/.exec(archived.ref);
    const messagePath = join(fx.root, accountKey, archived.ref, "message.eml");
    const target = join(fx.root, "outside.eml");
    writeFileSync(target, source);
    unlinkSync(messagePath);
    try { symlinkSync(target, messagePath, "file"); } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error?.code)) { t.skip(`symlink unavailable: ${error.code}`); return; }
      throw error;
    }
    assert.throws(() => readMailArchive({ ref: archived.ref, root: fx.root }), (error) => error.code === "mail_archive_path_invalid");
  } finally { fx.cleanup(); }
});

test("reads an attachment from the verified archive without provider access", async () => {
  const fx = fixture();
  try {
    const archived = archiveMailSource({ account: "user@163.com", messageId: "<archive@example.com>", source, root: fx.root });
    let providerCalls = 0;
    const result = await read163Attachment(
      { messageId: "<archive@example.com>", folderPath: "INBOX", attachmentId: "attachment-1", archiveRef: archived.ref, purpose: "download" },
      {
        readArchive: ({ ref }) => readMailArchive({ ref, root: fx.root }),
        fetchMessage: async () => { providerCalls += 1; throw new Error("offline"); },
      },
    );
    assert.equal(result.content.toString("utf8"), "hello");
    assert.equal(providerCalls, 0);
  } finally { fx.cleanup(); }
});

test("legacy messages without an archive keep provider-backed attachment access", async () => {
  let providerCalls = 0;
  const result = await read163Attachment(
    { messageId: "<legacy@example.com>", attachmentId: "attachment-1", purpose: "download" },
    { fetchMessage: async () => { providerCalls += 1; return { parsed: { attachments: [{ filename: "legacy.txt", contentType: "text/plain", content: Buffer.from("legacy") }] } }; } },
  );
  assert.equal(result.content.toString("utf8"), "legacy");
  assert.equal(providerCalls, 1);
});
