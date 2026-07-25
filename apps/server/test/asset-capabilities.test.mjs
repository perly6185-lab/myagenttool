import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assetCapabilityMatrix, classifyAsset, describeProjectAsset,
  evaluateAssetRequirements, resolveAssetCapabilities,
  summarizeAssetForRemote,
  deriveAssetRuntimeReadiness,
  assetResourceClass,
} from "../src/services/asset-capabilities.mjs";

test("publishes explicit support without promising CAD, image, or video editing", () => {
  const matrix = assetCapabilityMatrix();
  for (const family of ["canvas", "word", "excel", "powerpoint", "markdown", "cad_dxf", "cad_dwg", "image", "video", "unknown"]) {
    assert.ok(matrix[family]);
  }
  assert.equal(matrix.cad_dxf.capabilities.includes("edit"), false);
  assert.equal(matrix.cad_dwg.capabilities.includes("edit"), false);
  assert.equal(matrix.video.capabilities.includes("transform"), false);
  assert.equal(matrix.image.capabilities.includes("edit"), false);
  assert.equal(matrix.word.mutationGovernance, "approval_and_audit");
});

test("classifies representative formats and gates DWG on its local runtime", () => {
  assert.equal(classifyAsset("deck.PPTX").family, "powerpoint");
  assert.equal(classifyAsset("clip.mp4").family, "video");
  assert.equal(classifyAsset("thing.bin").family, "unknown");
  assert.deepEqual(resolveAssetCapabilities("drawing.dwg").readiness, {
    state: "waiting_capability", reason: "dwg_preview_runtime_required",
  });
  assert.equal(resolveAssetCapabilities("drawing.dwg", { runtimeReadiness: { cad_dwg: true } }).readiness.state, "ready");
});

test("describes only confined project-relative files with bounded preview policy", () => {
  const root = mkdtempSync(join(tmpdir(), "asset-capability-"));
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs", "notes.md"), "# Notes");
  const descriptor = describeProjectAsset({
    projectId: "project-1", projectRoot: root, relativePath: "docs/notes.md", terminalId: "terminal-1",
  });
  assert.equal(descriptor.path, "docs/notes.md");
  assert.equal(descriptor.terminalId, "terminal-1");
  assert.match(descriptor.hash, /^sha256:/);
  assert.equal(descriptor.preview.remoteResources, false);
  assert.equal(descriptor.preview.sandboxed, true);
  assert.throws(() => describeProjectAsset({
    projectId: "project-1", projectRoot: root, relativePath: "../outside.md", terminalId: "terminal-1",
  }));
  const outside = mkdtempSync(join(tmpdir(), "asset-outside-"));
  writeFileSync(join(outside, "secret.md"), "secret");
  symlinkSync(join(outside, "secret.md"), join(root, "docs", "linked.md"));
  assert.throws(() => describeProjectAsset({
    projectId: "project-1", projectRoot: root, relativePath: "docs/linked.md", terminalId: "terminal-1",
  }), /asset_path_outside_project/);
});

test("queue readiness stays on one terminal and waits for missing capabilities", () => {
  const asset = { terminalId: "terminal-1", capabilities: ["preview"], readiness: { state: "ready" } };
  assert.equal(evaluateAssetRequirements([asset], ["edit"], "terminal-1").state, "waiting_capability");
  assert.equal(evaluateAssetRequirements([asset], ["preview"], "terminal-1").state, "ready");
  assert.deepEqual(evaluateAssetRequirements([asset], ["preview"], "terminal-2"), {
    state: "refused", reason: "asset_terminal_mismatch", terminalId: "terminal-2",
  });
});

test("resource classes are bounded and large work waits on the owning terminal", () => {
  assert.equal(assetResourceClass(8 * 1024 * 1024), "small");
  assert.equal(assetResourceClass(8 * 1024 * 1024 + 1), "medium");
  assert.equal(assetResourceClass(100 * 1024 * 1024 + 1), "large");
  assert.deepEqual(evaluateAssetRequirements([{
    terminalId: "terminal-1", size: 120 * 1024 * 1024, resourceClass: "large",
    capabilities: ["transform"], readiness: { state: "ready" },
  }], ["transform"], "terminal-1"), {
    state: "waiting_capability",
    reason: "local_resource_class_required:large",
    terminalId: "terminal-1",
  });
  assert.equal(evaluateAssetRequirements([{
    terminalId: "terminal-1", resourceClass: "large",
    capabilities: ["compare"], readiness: { state: "ready" },
  }], ["compare"], "terminal-1", { availableResourceClasses: ["small", "medium", "large"] }).state, "ready");
});

test("remote summary is bounded and explicitly read-only", () => {
  const summary = summarizeAssetForRemote({
    id: "asset-1", projectId: "project-1", worktreeId: null, terminalId: "terminal-1",
    name: "review.png", path: "evidence/review.png", family: "image", size: 42,
    version: "v1", hash: "must-not-cross", capabilities: ["preview"],
    readiness: { state: "ready", reason: "available_on_owning_terminal" },
    preview: { available: true },
  });
  assert.equal(summary.directOperationsAllowed, false);
  assert.equal(summary.hash, undefined);
  assert.match(summary.owningTerminalDeepLink, /section=documents/);
});

test("derives Office and Canvas readiness from Applications on the owning terminal", () => {
  const ready = deriveAssetRuntimeReadiness({
    applications: [
      { id: "app_officecli", status: "active", runtimeRequirements: [] },
      { id: "app_canvas", status: "active", runtimeRequirements: [] },
    ],
    devices: [{ id: "terminal-1", status: "online" }],
  });
  assert.equal(ready.word, true);
  assert.equal(ready.excel, true);
  assert.equal(ready.powerpoint, true);
  assert.equal(ready.canvas, true);
  assert.equal(ready.markdown, false);
  assert.equal(ready.cad_dwg, false);

  const absentRuntime = deriveAssetRuntimeReadiness({
    applications: [{
      id: "app_officecli", status: "active",
      runtimeRequirements: [{ runtimeId: "officecli", required: true }],
    }],
    devices: [{ id: "terminal-1", status: "online", runtimeReadiness: [] }],
  });
  assert.equal(absentRuntime.word, false);
});
