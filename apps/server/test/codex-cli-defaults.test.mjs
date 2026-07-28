import assert from "node:assert/strict";
import { test } from "node:test";

import { codexCliArgs, codexCliResumeArgs } from "../src/services/agents.mjs";

test("fresh Codex agents default to ask mode while resume keeps its supported argv", () => {
  assert.deepEqual(codexCliArgs(), [
    "exec",
    "--sandbox", "workspace-write",
    "--config", 'approval_policy="on-request"',
    "--config", 'approvals_reviewer="user"',
    "--skip-git-repo-check",
    "--json",
    "{{task}}",
  ]);
  assert.ok(codexCliArgs("auto").includes('approvals_reviewer="auto_review"'));
  assert.deepEqual(codexCliArgs("full").slice(0, 2), [
    "exec",
    "--dangerously-bypass-approvals-and-sandbox",
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
