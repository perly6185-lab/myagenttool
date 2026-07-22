import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { CadPreviewError, inspectCadDocument, renderCadDocument, resolveCadDocument } from "../src/services/cad-preview.mjs";

const DXF = "0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n";
const RESULT = { ok: true, version: "AC1032", units: 4, extents: { min: [0, 0, 0], max: [10, 5, 0] }, layouts: ["Model"], layers: ["0"], entityCounts: { LINE: 1 }, texts: [], warnings: [], audit: { errors: 0, fixes: 0 } };
const FIXTURE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "fixtures/cad");

function fixture(name = "drawing.dxf", body = DXF) {
  const root = mkdtempSync(join(tmpdir(), "cad-preview-"));
  writeFileSync(join(root, name), body);
  return root;
}

test("ships a deterministic, signature-valid DXF fixture", () => {
  const document = resolveCadDocument(FIXTURE_ROOT, "deterministic.dxf");
  assert.equal(document.relPath, "deterministic.dxf");
  assert.ok(document.size > 0);
});

test("inspects a contained DXF through stdin worker input and returns bounded metadata", async () => {
  const root = fixture();
  let request;
  const result = await inspectCadDocument({ projectPath: root, relativeFile: "drawing.dxf", run: async (input) => { request = input; return RESULT; } });
  assert.equal(request.action, "inspect");
  assert.equal(request.file, realpathSync(join(root, "drawing.dxf")));
  assert.deepEqual(result.layouts, ["Model"]);
  assert.equal(result.path, "drawing.dxf");
  assert.equal(result.entityCounts.LINE, 1);
});

test("refuses traversal, symlink escape, signature mismatch, and oversized input before spawning", async () => {
  const root = fixture();
  await assert.rejects(() => inspectCadDocument({ projectPath: root, relativeFile: "../drawing.dxf", run: async () => assert.fail("must not run") }), (error) => error.code === "cad_invalid_path");
  const outside = fixture("outside.dxf");
  symlinkSync(join(outside, "outside.dxf"), join(root, "linked.dxf"));
  await assert.rejects(() => inspectCadDocument({ projectPath: root, relativeFile: "linked.dxf", run: async () => assert.fail("must not run") }), (error) => error.code === "cad_path_escape");
  const bad = fixture("bad.dxf", "not a DXF");
  assert.throws(() => resolveCadDocument(bad, "bad.dxf"), (error) => error.code === "cad_invalid_signature");
  const large = fixture("large.dxf");
  truncateSync(join(large, "large.dxf"), 25 * 1024 * 1024 + 1);
  assert.throws(() => resolveCadDocument(large, "large.dxf"), (error) => error.code === "cad_file_too_large");
});

test("valid DWG is detected but remains unavailable without approved ODA readiness", async () => {
  const root = fixture("drawing.dwg", "AC1032" + "\0".repeat(100));
  await assert.rejects(() => inspectCadDocument({ projectPath: root, relativeFile: "drawing.dwg", run: async () => assert.fail("must not run") }), (error) => error.code === "oda_unavailable");
});

test("render passes only bounded layout/layer values and rejects active SVG", async () => {
  const root = fixture();
  let request;
  const result = await renderCadDocument({ projectPath: root, relativeFile: "drawing.dxf", layout: "Model", visibleLayers: ["0"], run: async (input) => { request = input; return { ...RESULT, svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>' }; } });
  assert.deepEqual(request.visibleLayers, ["0"]);
  assert.match(result.svg, /^<svg/);
  await assert.rejects(() => renderCadDocument({ projectPath: root, relativeFile: "drawing.dxf", run: async () => ({ ...RESULT, svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' }) }), (error) => error.code === "cad_svg_rejected");
  await assert.rejects(() => renderCadDocument({ projectPath: root, relativeFile: "drawing.dxf", run: async () => ({ ...RESULT, svg: '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.test/x"/></svg>' }) }), (error) => error.code === "cad_svg_rejected");
});

test("worker error codes are closed and native details are sanitized", async () => {
  const root = fixture();
  await assert.rejects(() => inspectCadDocument({ projectPath: root, relativeFile: "drawing.dxf", run: async () => ({ ok: false, error: "../../secret", message: "/Users/private/path" }) }), (error) => error instanceof CadPreviewError && error.code === "cad_processing_failed" && !error.message.includes("/Users"));
});
