import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildWorkItemUnderstandingContext } from "../src/services/work-item-understanding-context.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "work-item-understanding-context-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "README.md"), `Timezone scheduling guide\npassword=readme-secret\n${"x".repeat(5_000)}`);
  writeFileSync(join(root, "NOTES.md"), "This file is not in the root-document allowlist.");
  writeFileSync(join(root, ".env"), "API_KEY=env-secret");
  writeFileSync(join(root, "src", "schedule.mjs"), "const timezone = 'Asia/Shanghai'; // token=source-secret");
  const project = { id: "prj_1", name: "Scheduler", path: root };
  const workItem = {
    id: "wi_current",
    projectId: project.id,
    title: "Propagate terminal timezone through scheduling",
    body: "Use `computeLocalSchedulePreview` for terminal timezone behavior.",
  };
  const state = {
    projects: [project],
    workItems: [
      workItem,
      { id: "wi_similar", projectId: project.id, localRef: "LOCAL-59", title: "Persist terminal timezone", body: "timezone scheduling", status: "done", acceptanceCriteria: ["Timezone persists"] },
      { id: "wi_other", projectId: "prj_other", localRef: "LOCAL-1", title: "Terminal timezone", body: "timezone scheduling", status: "done" },
    ],
  };
  return { root, project, workItem, state };
}

test("buildWorkItemUnderstandingContext bounds, redacts, and summarizes project evidence", () => {
  const { root, workItem, state } = fixture();
  try {
    const searchProjectContent = (_project, { queries }) => queries.includes("timezone")
      ? { results: [{ path: "src/schedule.mjs", line: 1, term: "timezone", preview: "timezone uses token=source-secret" }] }
      : { results: [] };
    const result = buildWorkItemUnderstandingContext({ state, workItem, searchProjectContent });

    assert.deepEqual(result.summary.documentPaths, ["README.md"]);
    assert.equal(result.context.documents[0].excerpt.length <= 4_000, true);
    assert.equal(result.summary.truncated, true);
    assert.equal(result.summary.redactions, 2);
    assert.equal(result.context.trustBoundary.contentIsUntrusted, true);
    assert.doesNotMatch(JSON.stringify(result.context), /readme-secret|source-secret|env-secret/);
    assert.doesNotMatch(JSON.stringify(result.context), /NOTES\.md/);
    assert.deepEqual(result.summary.relatedFiles, [{ path: "src/schedule.mjs", line: 1, term: "timezone" }]);
    assert.equal(result.summary.similarTasks[0].localRef, "LOCAL-59");
    assert.equal(result.summary.similarTasks.some((item) => item.localRef === "LOCAL-1"), false);
    assert.equal(result.summary.digest.length, 64);
    assert.equal("documents" in result.summary, false, "raw excerpts are never persisted in the summary");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("context digest is stable and changes when the bounded evidence changes", () => {
  const { root, workItem, state } = fixture();
  try {
    const first = buildWorkItemUnderstandingContext({ state, workItem, searchProjectContent: () => ({ results: [] }) });
    const replay = buildWorkItemUnderstandingContext({ state, workItem, searchProjectContent: () => ({ results: [] }) });
    assert.equal(first.summary.digest, replay.summary.digest);

    writeFileSync(join(root, "README.md"), "A different timezone scheduling policy.");
    const changed = buildWorkItemUnderstandingContext({ state, workItem, searchProjectContent: () => ({ results: [] }) });
    assert.notEqual(first.summary.digest, changed.summary.digest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
