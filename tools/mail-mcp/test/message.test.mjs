import assert from "node:assert/strict";
import { test } from "node:test";

import { formatAddresses, headerOf, messageRecordOf } from "../src/message.mjs";

const envelope = {
  messageId: "<CAF8x9kQm2vZ@mail.163.com>",
  from: [{ name: "Zhang Wei", address: "zhangwei@163.com" }],
  subject: "git capability fails with exit 127",
  date: new Date("2026-07-16T09:30:00.000Z"),
};

test("headerOf projects the envelope onto the mail_headers shape", () => {
  const header = headerOf({ envelope });
  assert.deepEqual(header, {
    messageId: "<CAF8x9kQm2vZ@mail.163.com>",
    from: "Zhang Wei <zhangwei@163.com>",
    subject: "git capability fails with exit 127",
    date: "2026-07-16T09:30:00.000Z",
  });
});

test("headerOf refuses a message with no envelope rather than inventing one", () => {
  assert.equal(headerOf(null), null);
  assert.equal(headerOf({}), null);
  assert.equal(messageRecordOf({}, { text: "body" }), null);
});

test("headerOf survives a malformed Date header instead of throwing (#1199)", () => {
  // imapflow parses a garbage Date into an Invalid Date — still `instanceof
  // Date` but toISOString() throws. One such message must not fail the whole
  // list; it degrades to the raw string.
  const invalid = headerOf({ envelope: { messageId: "<a@b>", from: [], subject: "x", date: new Date("not a date") } });
  assert.equal(invalid.date, "Invalid Date");
  const missing = headerOf({ envelope: { messageId: "<a@b>", from: [], subject: "x", date: undefined } });
  assert.equal(missing.date, "");
});

// The regression this module exists for: without these two fields every reply
// opens a NEW issue instead of commenting on the mapped one
// (apps/server/src/services/mail-issue-transcription.mjs reads them), and the
// server-side parser tolerates their absence — so the loss is silent.
test("messageRecordOf carries the threading headers a reply needs", () => {
  const record = messageRecordOf(
    { envelope: { ...envelope, inReplyTo: "<parent@mail.163.com>" } },
    { text: "Same config works on my Mac.", references: ["<root@mail.163.com>", "<parent@mail.163.com>"] },
  );
  assert.equal(record.inReplyTo, "<parent@mail.163.com>");
  assert.deepEqual(record.references, ["<root@mail.163.com>", "<parent@mail.163.com>"]);
  assert.equal(record.body, "Same config works on my Mac.");
  assert.equal(record.messageId, "<CAF8x9kQm2vZ@mail.163.com>");
});

test("messageRecordOf normalizes a lone reference string into an array", () => {
  // mailparser hands back a bare string when there is exactly one reference.
  const record = messageRecordOf({ envelope }, { text: "x", references: "<only@mail.163.com>" });
  assert.deepEqual(record.references, ["<only@mail.163.com>"]);
});

test("messageRecordOf reports an unthreaded message honestly, never guessing", () => {
  const record = messageRecordOf({ envelope }, { text: "a fresh report" });
  assert.equal(record.inReplyTo, null);
  assert.deepEqual(record.references, []);
});

test("messageRecordOf falls back to html when a message carries no text part", () => {
  const record = messageRecordOf({ envelope }, { html: "<p>html only</p>" });
  assert.equal(record.body, "<p>html only</p>");
  const empty = messageRecordOf({ envelope }, {});
  assert.equal(empty.body, "", "a bodyless message reads as empty, not undefined");
});

test("messageRecordOf exposes bounded attachment metadata but never bytes", () => {
  const record = messageRecordOf({ envelope }, { text: "body", attachments: [
    { filename: "diagram.png", contentType: "image/png", size: 1234, content: Buffer.from("secret-binary") },
    { filename: "macro.docm", contentType: "application/vnd.ms-word.document.macroenabled.12", size: 99, content: Buffer.from("macro") },
  ] });
  assert.deepEqual(record.attachments, [
    { id: "attachment-1", name: "diagram.png", contentType: "image/png", size: 1234, previewable: true },
    { id: "attachment-2", name: "macro.docm", contentType: "application/vnd.ms-word.document.macroenabled.12", size: 99, previewable: false },
  ]);
  assert(!JSON.stringify(record).includes("secret-binary"));
});

test("formatAddresses keeps a bare address and joins multiple senders", () => {
  assert.equal(formatAddresses([{ address: "noname@163.com" }]), "noname@163.com");
  assert.equal(
    formatAddresses([{ name: "A", address: "a@163.com" }, { address: "b@163.com" }]),
    "A <a@163.com>, b@163.com",
  );
  assert.equal(formatAddresses(), "");
});
