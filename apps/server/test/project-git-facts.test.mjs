import assert from "node:assert/strict";
import { test } from "node:test";

import { readProjectTree } from "../src/services/projects.mjs";

test("readProjectTree refreshes stale project.git from the real repo (#908)", () => {
  // git facts were captured once at registration; browsing the workspace must
  // refresh them so a checkout since then isn't shown as the old branch.
  const project = {
    id: `prj_facts_${Date.now()}`,
    path: process.cwd(),
    git: { repoPath: process.cwd(), remoteUrl: null, defaultBranch: null, currentBranch: "stale-branch", isRepo: false },
  };
  readProjectTree(project, { relativePath: "" });
  assert.equal(project.git.isRepo, true, "the real repo is detected");
  assert.notEqual(project.git.currentBranch, "stale-branch", "the branch is refreshed, not the stale registration snapshot");
});
