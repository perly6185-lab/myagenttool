import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { renderOfficecliPreview, OfficecliPreviewError } from "../src/services/officecli-preview.mjs";

function projectWith(files = { "demo.xlsx": "x" }) {
  const root = mkdtempSync(join(tmpdir(), "officecli-preview-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, name), body);
  return root;
}

// A spawn stub standing in for `officecli view <file> html`.
const htmlRun = (html) => async (_cmd, argv) => {
  assert.deepEqual(argv, ["view", "demo.xlsx", "html"], "renders via the stdout-default html mode");
  return { stdout: html };
};

test("renders a document to a transient text/html artifact (no 20k cap, not persisted)", async () => {
  const root = projectWith();
  const big = "<html>" + "y".repeat(50_000) + "</html>"; // well past the wrapper's 20 000 cap
  const preview = await renderOfficecliPreview({ projectPath: root, relativeFile: "demo.xlsx", run: htmlRun(big) });
  assert.equal(preview.mime, "text/html");
  assert.equal(preview.encoding, "utf8");
  assert.equal(preview.content, big, "full HTML is returned, never truncated");
  assert.equal(preview.path, "demo.xlsx");
  assert.equal(preview.bytes, Buffer.byteLength(big, "utf8"));
});

test("refuses a non-Office extension before spawning", async () => {
  const root = projectWith({ "notes.txt": "x" });
  await assert.rejects(
    renderOfficecliPreview({ projectPath: root, relativeFile: "notes.txt", run: async () => assert.fail("must not spawn") }),
    (e) => e instanceof OfficecliPreviewError && e.code === "unsupported_type",
  );
});

test("refuses path traversal out of the project root", async () => {
  const root = projectWith();
  await assert.rejects(
    renderOfficecliPreview({ projectPath: root, relativeFile: "../../etc/passwd.xlsx", run: async () => assert.fail("must not spawn") }),
    (e) => e instanceof OfficecliPreviewError && e.code === "path_escape",
  );
});

test("refuses a symlink that escapes the root", async () => {
  const root = projectWith();
  try {
    symlinkSync("/etc/hosts", join(root, "link.xlsx"));
  } catch {
    return; // symlink not permitted in this environment — skip
  }
  await assert.rejects(
    renderOfficecliPreview({ projectPath: root, relativeFile: "link.xlsx", run: async () => ({ stdout: "<html></html>" }) }),
    (e) => e instanceof OfficecliPreviewError && e.code === "path_escape",
  );
});

test("a missing file is not_found", async () => {
  const root = projectWith();
  await assert.rejects(
    renderOfficecliPreview({ projectPath: root, relativeFile: "absent.xlsx", run: async () => assert.fail("must not spawn") }),
    (e) => e instanceof OfficecliPreviewError && e.code === "not_found",
  );
});

test("a missing officecli binary maps to officecli_unavailable", async () => {
  const root = projectWith();
  const enoent = Object.assign(new Error("spawn officecli ENOENT"), { code: "ENOENT" });
  await assert.rejects(
    renderOfficecliPreview({ projectPath: root, relativeFile: "demo.xlsx", run: async () => { throw enoent; } }),
    (e) => e instanceof OfficecliPreviewError && e.code === "officecli_unavailable",
  );
});

test("an empty render is reported, not returned as a blank preview", async () => {
  const root = projectWith();
  await assert.rejects(
    renderOfficecliPreview({ projectPath: root, relativeFile: "demo.xlsx", run: async () => ({ stdout: "   " }) }),
    (e) => e instanceof OfficecliPreviewError && e.code === "empty_render",
  );
});
