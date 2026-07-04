/*
 * The auto-run verification runner: resolves an env-configured command (never
 * agent input) and runs it in the worktree, reporting passed/verified. Real
 * node subprocesses, no mocks.
 */

import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { after, test } from "node:test";

import { resolveAutoRunVerifyCommand, runWorktreeVerification } from "../src/services/worktree-verify.mjs";

const saved = process.env.MYAGENTTOOL_AUTORUN_VERIFY_COMMAND_JSON;
after(() => {
  if (saved === undefined) delete process.env.MYAGENTTOOL_AUTORUN_VERIFY_COMMAND_JSON;
  else process.env.MYAGENTTOOL_AUTORUN_VERIFY_COMMAND_JSON = saved;
});

test("resolveAutoRunVerifyCommand parses a valid JSON array, rejects junk", () => {
  delete process.env.MYAGENTTOOL_AUTORUN_VERIFY_COMMAND_JSON;
  assert.equal(resolveAutoRunVerifyCommand(), null, "unset → null");

  process.env.MYAGENTTOOL_AUTORUN_VERIFY_COMMAND_JSON = JSON.stringify(["pnpm", "-s", "typecheck"]);
  assert.deepEqual(resolveAutoRunVerifyCommand(), ["pnpm", "-s", "typecheck"]);

  process.env.MYAGENTTOOL_AUTORUN_VERIFY_COMMAND_JSON = "not json";
  assert.equal(resolveAutoRunVerifyCommand(), null, "invalid JSON → null");

  process.env.MYAGENTTOOL_AUTORUN_VERIFY_COMMAND_JSON = JSON.stringify([]);
  assert.equal(resolveAutoRunVerifyCommand(), null, "empty array → null");
});

test("runWorktreeVerification reports a passing command as verified+passed", async () => {
  const result = await runWorktreeVerification({ cwd: tmpdir(), command: ["node", "-e", "process.exit(0)"] });
  assert.equal(result.verified, true);
  assert.equal(result.passed, true);
  assert.equal(result.exitCode, 0);
  assert.match(result.summary, /passed/);
});

test("runWorktreeVerification reports a failing command as verified+not-passed (never throws)", async () => {
  const result = await runWorktreeVerification({
    cwd: tmpdir(),
    command: ["node", "-e", "console.log('boom'); process.exit(3)"],
  });
  assert.equal(result.verified, true);
  assert.equal(result.passed, false);
  assert.equal(result.exitCode, 3);
  assert.match(result.summary, /failed \(exit 3\)/);
});
