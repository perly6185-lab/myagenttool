import assert from "node:assert/strict";
import test from "node:test";

import { attachmentPreviewPayload } from "../src/attachment-163.mjs";

test("preview accepts allowlisted text and keeps binary bytes out of the shape", () => {
  const result = attachmentPreviewPayload({ name: "note.txt", contentType: "text/plain", size: 5 }, Buffer.from("hello"));
  assert.equal(result.kind, "text");
  assert.equal(result.text, "hello");
  assert.equal("content" in result, false);
});

test("preview rejects MIME spoofing before bytes reach the renderer", () => {
  assert.throws(
    () => attachmentPreviewPayload({ name: "fake.png", contentType: "image/png", size: 4 }, Buffer.from("MZ!!")),
    (error) => error.code === "preview_not_supported",
  );
});

test("preview rejects oversized content and unsafe executable MIME types", () => {
  assert.throws(
    () => attachmentPreviewPayload({ name: "large.txt", contentType: "text/plain", size: 6 * 1024 * 1024 }, Buffer.alloc(6 * 1024 * 1024, 0x61)),
    (error) => error.code === "preview_too_large",
  );
  assert.throws(
    () => attachmentPreviewPayload({ name: "run.exe", contentType: "application/x-msdownload", size: 2 }, Buffer.from("MZ")),
    (error) => error.code === "preview_not_supported",
  );
});
