import assert from "node:assert/strict";
import { test } from "node:test";
import { simpleParser } from "mailparser";

import { attachmentMetadataFromStructure, classificationHeadersOf, formatAddresses, headerOf, lightweightMessageRecordOf, messageRecordOf } from "../src/message.mjs";
import { selectDisplayBodyNodes } from "../src/imap-163.mjs";

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
  assert.equal(record.body, "html only");
  assert.equal(record.bodyHtml, "<p>html only</p>");
  assert.equal(record.hasHtml, true);
  assert.equal(record.bodyTruncated, false);
  assert.equal(record.bodyContentVersion, 2);
  const empty = messageRecordOf({ envelope }, {});
  assert.equal(empty.body, "", "a bodyless message reads as empty, not undefined");
});

test("headerOf carries only bounded classification-safe list and automation headers", () => {
  const headers = Buffer.from([
    "List-Id: Product Updates <updates.example.com>",
    "List-Unsubscribe: <https://example.com/private-token>",
    "Auto-Submitted: auto-generated",
    "Precedence: bulk",
    "X-Secret: must-not-survive",
    "",
  ].join("\r\n"));
  assert.deepEqual(classificationHeadersOf(headers), {
    listId: "Product Updates <updates.example.com>",
    listUnsubscribe: true,
    autoSubmitted: "auto-generated",
    precedence: "bulk",
  });
  const header = headerOf({ envelope, headers });
  assert.equal(header.classificationHeaders.listUnsubscribe, true);
  assert.equal(JSON.stringify(header).includes("private-token"), false);
  assert.equal(JSON.stringify(header).includes("must-not-survive"), false);
});

test("messageRecordOf bounds text and HTML independently and reports truncation", () => {
  const record = messageRecordOf({ envelope }, { text: "t".repeat(20_001), html: `<p>${"h".repeat(50_001)}</p>` });
  assert.equal(record.body.length, 20_000);
  assert.equal(record.bodyHtml.length, 50_000);
  assert.equal(record.bodyTruncated, true);
});

test("an HTML-only MIME message becomes readable text while retaining bounded safe-preview data", async () => {
  const parsed = await simpleParser([
    "From: a@example.com",
    "To: b@example.com",
    "Subject: HTML",
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    "",
    '<p>Open <a href="https://example.com/path">the report</a>.</p><img src="https://images.example.com/pixel.png" alt="Chart">',
  ].join("\r\n"), { keepCidLinks: true });
  const record = messageRecordOf({ envelope }, parsed);
  assert.match(record.body, /the report \[https:\/\/example\.com\/path\]/);
  assert.match(record.body, /Chart \[https:\/\/images\.example\.com\/pixel\.png\]/);
  assert.match(record.bodyHtml, /<img/);
  assert.equal(record.hasHtml, true);
});

test("messageRecordOf exposes bounded attachment metadata but never bytes", () => {
  const record = messageRecordOf({ envelope }, { text: "body", attachments: [
    { filename: "diagram.png", contentType: "image/png", contentId: "<logo@mail>", size: 1234, content: Buffer.from("secret-binary") },
    { filename: "macro.docm", contentType: "application/vnd.ms-word.document.macroenabled.12", size: 99, content: Buffer.from("macro") },
  ] });
  assert.deepEqual(record.attachments, [
    { id: "attachment-1", name: "diagram.png", contentType: "image/png", size: 1234, sha256: "0f4f9b1e5b00181f65e71a7c501f03a2512913d3ebe08c91d2edf43f2d443bdb", previewable: true, contentId: "logo@mail" },
    { id: "attachment-2", name: "macro.docm", contentType: "application/vnd.ms-word.document.macroenabled.12", size: 99, sha256: "27d66c0dcef19a926429158d80111b954a5c23d076833347da3e27b91e4b423d", previewable: false },
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

test("lightweight body records carry display content and structure metadata without attachment bytes", () => {
  const structure = {
    type: "multipart/mixed",
    childNodes: [
      { part: "1", type: "multipart/alternative", childNodes: [
        { part: "1.1", type: "text/plain", size: 20 },
        { part: "1.2", type: "text/html", size: 40 },
      ] },
      { part: "2", type: "application/pdf", size: 1234, disposition: "attachment", dispositionParameters: { filename: "quote.pdf" } },
    ],
  };
  const selected = selectDisplayBodyNodes(structure);
  assert.equal(selected.plain.part, "1.1");
  assert.equal(selected.html.part, "1.2");
  const attachments = attachmentMetadataFromStructure(structure);
  assert.deepEqual(attachments, [{ id: "attachment-1", name: "quote.pdf", contentType: "application/pdf", size: 1234, sha256: null, previewable: true }]);
  const record = lightweightMessageRecordOf({ envelope }, { text: "hello", html: "<p>hello</p>", attachments });
  assert.equal(record.body, "hello");
  assert.equal(record.lightweightBody, true);
  assert.equal(record.attachmentMetadataLoaded, true);
  assert.equal(JSON.stringify(record).includes("secret-binary"), false);
});
