/*
 * #1320: ai:impact deterministic core — classify a diff and render the Change
 * Impact & Risk Assessment. The judgment must be conservative and grounded in
 * file paths (a runtime file touched by a docs/test change carries no business
 * impact); the renderer must emit the exact section heading the PR template uses.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assessChanges,
  classifyKind,
  onRuntimeImportGraph,
  parseNameStatus,
  renderImpactMarkdown,
  touchesBusinessFlow,
} from "../src/impact.mjs";

test("classifyKind buckets by path and extension", () => {
  assert.equal(classifyKind("docs/x.md"), "docs");
  assert.equal(classifyKind("README.md"), "docs");
  assert.equal(classifyKind("tools/ai/test/x.test.mjs"), "test");
  assert.equal(classifyKind("apps/server/test/x.mjs"), "test"); // under a /test/ dir
  assert.equal(classifyKind(".github/workflows/ci.yml"), "config");
  assert.equal(classifyKind("package.json"), "config");
  assert.equal(classifyKind("apps/server/src/services/agents.mjs"), "source");
  assert.equal(classifyKind("apps/web/src/App.tsx"), "source");
});

test("runtime import graph + business flow are path-scoped to product runtime", () => {
  assert.equal(onRuntimeImportGraph("apps/server/src/services/agents.mjs"), true);
  assert.equal(touchesBusinessFlow("apps/server/src/services/agents.mjs"), true);
  assert.equal(touchesBusinessFlow("apps/server/src/routes/bridge.mjs"), true);
  assert.equal(touchesBusinessFlow("packages/protocol/src/agent.ts"), true);
  // Tooling and docs are neither.
  assert.equal(onRuntimeImportGraph("tools/github/src/index.mjs"), false);
  assert.equal(touchesBusinessFlow("tools/github/src/index.mjs"), false);
  assert.equal(touchesBusinessFlow("docs/x.md"), false);
});

test("parseNameStatus reads git --name-status, renames report the new path", () => {
  const changes = parseNameStatus("A\tdocs/new.md\nM\tapps/server/src/services/x.mjs\nD\told.txt\nR100\told/p.mjs\tnew/p.mjs");
  assert.deepEqual(changes.map((c) => [c.change, c.path]), [
    ["add", "docs/new.md"],
    ["edit", "apps/server/src/services/x.mjs"],
    ["delete", "old.txt"],
    ["edit", "new/p.mjs"],
  ]);
});

test("assessChanges: docs+test change is low-risk, off the business flow", () => {
  const a = assessChanges(parseNameStatus("A\tdocs/x.md\nM\ttools/ai/test/y.test.mjs"));
  assert.equal(a.touchesBusinessFlow, false);
  assert.equal(a.onRuntimeImportGraph, false);
  assert.equal(a.risk, "low");
  assert.equal(a.rollback, "low");
});

test("assessChanges: a services change is medium-risk and on the business flow", () => {
  const a = assessChanges(parseNameStatus("M\tapps/server/src/services/invocations.mjs"));
  assert.equal(a.touchesBusinessFlow, true);
  assert.equal(a.onRuntimeImportGraph, true);
  assert.equal(a.risk, "medium");
});

test("assessChanges: a bridge/local-execution path is high-risk", () => {
  const a = assessChanges(parseNameStatus("M\tapps/desktop/src/local-execution-policy.mjs"));
  assert.equal(a.risk, "high");
});

test("renderImpactMarkdown emits the template section heading and every field", () => {
  const md = renderImpactMarkdown(assessChanges(parseNameStatus("M\tapps/server/src/services/x.mjs")));
  assert.ok(md.startsWith("## Change Impact & Risk Assessment"));
  for (const field of ["Changes:", "Touches business flow:", "On the runtime import graph:", "Risk:", "Blast radius:", "Rollback cost:"]) {
    assert.ok(md.includes(field), `missing field: ${field}`);
  }
});
