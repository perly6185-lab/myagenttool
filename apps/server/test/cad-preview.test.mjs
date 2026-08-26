import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { CadPreviewError, cleanupCadPreviewTemps, inspectCadDocument, renderCadDocument, resolveCadDocument, resolveCadPython, runCadWorker } from "../src/services/cad-preview.mjs";

const DXF = "0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n";
const RESULT = { ok: true, version: "AC1032", units: 4, extents: { min: [0, 0, 0], max: [10, 5, 0] }, layoutExtents: { Model: { min: [0, 0, 0], max: [10, 5, 0] } }, layouts: ["Model"], layers: ["0"], entityCounts: { LINE: 1 }, texts: [{ text: "Pump", type: "TEXT", layer: "0", layout: "Model", x: 2, y: 3 }], warnings: [], audit: { errors: 0, fixes: 0 } };
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

test("startup cleanup removes only stale CAD preview directories", () => {
  const root = mkdtempSync(join(tmpdir(), "cad-cleanup-root-"));
  mkdirSync(join(root, "myagenttool-cad-preview-stale"));
  mkdirSync(join(root, "unrelated"));
  assert.equal(cleanupCadPreviewTemps(root), 1);
  assert.equal(existsSync(join(root, "myagenttool-cad-preview-stale")), false);
  assert.equal(existsSync(join(root, "unrelated")), true);
});

test("inspects a contained DXF through stdin worker input and returns bounded metadata", async () => {
  const root = fixture();
  let request;
  let snapshot;
  const result = await inspectCadDocument({ projectPath: root, relativeFile: "drawing.dxf", run: async (input) => { request = input; snapshot = readFileSync(input.file, "utf8"); return RESULT; } });
  assert.equal(request.action, "inspect");
  assert.equal(snapshot, DXF);
  assert.equal(existsSync(request.file), false);
  assert.deepEqual(result.layouts, ["Model"]);
  assert.equal(result.path, "drawing.dxf");
  assert.equal(result.entityCounts.LINE, 1);
  assert.deepEqual(result.layoutExtents.Model.max, [10, 5, 0]);
  assert.deepEqual(result.texts[0], { text: "Pump", type: "TEXT", layer: "0", layout: "Model", x: 2, y: 3 });
});

test("requires an absolute managed runtime and escalates a stuck worker to SIGKILL", async () => {
  assert.throws(() => resolveCadPython("python3"), (error) => error.code === "ezdxf_unavailable");
  const signals = [];
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stdin = { end() {} };
    child.exitCode = null;
    child.signalCode = null;
    child.kill = (signal) => {
      signals.push(signal);
      if (signal === "SIGKILL") { child.signalCode = signal; queueMicrotask(() => child.emit("close", null)); }
      return true;
    };
    return child;
  };
  await assert.rejects(() => runCadWorker({ action: "inspect", file: "/private/snapshot.dxf" }, { timeoutMs: 5, terminateGraceMs: 5, python: "/managed/python", spawnProcess }), (error) => error.code === "cad_processing_timeout");
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("cancels an in-flight worker, waits for process exit, and removes its private snapshot", async () => {
  const root = fixture();
  const controller = new AbortController();
  const signals = [];
  let snapshotPath;
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stdin = { end(body) { snapshotPath = JSON.parse(body).file; queueMicrotask(() => controller.abort()); } };
    child.exitCode = null;
    child.signalCode = null;
    child.kill = (signal) => { signals.push(signal); child.signalCode = signal; queueMicrotask(() => child.emit("close", null)); return true; };
    return child;
  };
  await assert.rejects(() => inspectCadDocument({ projectPath: root, relativeFile: "drawing.dxf", signal: controller.signal, run: (request, options) => runCadWorker(request, { ...options, python: "/managed/python", spawnProcess }) }), (error) => error.code === "cad_processing_cancelled");
  assert.deepEqual(signals, ["SIGTERM"]);
  assert.equal(existsSync(snapshotPath), false);
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
  const maliciousSvg = readFileSync(join(FIXTURE_ROOT, "malicious.svg"), "utf8");
  await assert.rejects(() => renderCadDocument({ projectPath: root, relativeFile: "drawing.dxf", run: async () => ({ ...RESULT, svg: maliciousSvg }) }), (error) => error.code === "cad_svg_rejected");
});

test("worker error codes are closed and native details are sanitized", async () => {
  const root = fixture();
  await assert.rejects(() => inspectCadDocument({ projectPath: root, relativeFile: "drawing.dxf", run: async () => ({ ok: false, error: "../../secret", message: "/Users/private/path" }) }), (error) => error instanceof CadPreviewError && error.code === "cad_processing_failed" && !error.message.includes("/Users"));
});
