import assert from "node:assert/strict";
import { test } from "node:test";

import { codexCliArgs, codexCliResumeArgs } from "../src/services/agents.mjs";

test("fresh Codex agents default to workspace-write while resume keeps its supported argv", () => {
  assert.deepEqual(codexCliArgs(), [
    "exec",
    "--sandbox", "workspace-write",
    "--skip-git-repo-check",
    "--json",
    "{{task}}",
  ]);
  assert.deepEqual(codexCliResumeArgs(), [
    "exec",
    "resume",
    "--last",
    "--skip-git-repo-check",
    "--json",
    "{{task}}",
  ]);
});
