import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { defaultSendCredentialPath, resolveAttachments, send163Mail } from "../src/send-163.mjs";

test("sending reuses the receiving credential path", () => {
  assert.equal(
    defaultSendCredentialPath({ APPDATA: "D:\\Redirected\\AppData\\Roaming" }),
    join("D:\\Redirected\\AppData\\Roaming", "myagenttool", "mail", "163.json"),
  );
});

test("send resolves opaque attachment refs locally and returns only the provider receipt", async () => {
  const root = mkdtempSync(join(tmpdir(), "mat-mail-send-"));
  try {
    mkdirSync(root, { recursive: true });
    const attachment = { ref: "mailatt_12345678-1234-1234-1234-123456789abc", name: "note.txt", contentType: "text/plain", size: 5 };
    writeFileSync(join(root, `${attachment.ref}.bin`), "hello");
    writeFileSync(join(root, `${attachment.ref}.json`), JSON.stringify(attachment));
    let sent;
    const result = await send163Mail({ to: "a@example.com", subject: "x", body: "body", attachments: [attachment] }, {
      credential: { username: "me@163.com", authorizationCode: "secret" }, attachmentRoot: root,
      transportFactory: () => ({ sendMail: async (message) => { sent = message; return { messageId: "<receipt@163.com>" }; }, close() {} }),
    });
    assert.deepEqual(result, { sent: true, sentMessageId: "<receipt@163.com>" });
    assert.equal(sent.attachments[0].path, join(root, `${attachment.ref}.bin`));
    assert(!JSON.stringify(result).includes(root));
    assert.equal(existsSync(join(root, `${attachment.ref}.bin`)), false);
    assert.equal(existsSync(join(root, `${attachment.ref}.json`)), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("send attachment resolver rejects metadata changes", () => {
  const root = mkdtempSync(join(tmpdir(), "mat-mail-send-change-"));
  try {
    const attachment = { ref: "mailatt_12345678-1234-1234-1234-123456789abc", name: "note.txt", contentType: "text/plain", size: 5 };
    writeFileSync(join(root, `${attachment.ref}.bin`), "hello!");
    writeFileSync(join(root, `${attachment.ref}.json`), JSON.stringify(attachment));
    assert.throws(() => resolveAttachments([attachment], root), /mail_attachment_changed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
