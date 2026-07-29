/*
 * The auto-run verification runner: resolves an env-configured command (never
 * agent input) and runs it in the worktree, reporting passed/verified. Real
 * node subprocesses, no mocks.
 */

import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { after, test } from "node:test";

import {
  resolveAutoRunVerificationPlan,
  resolveAutoRunVerifyCommand,
  resolveVerificationInvocation,
  runWorktreeVerification,
  runWorktreeVerificationPlan,
} from "../src/services/worktree-verify.mjs";

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

test("verification resolves the pnpm JavaScript CLI on Windows without invoking a command shell", () => {
  assert.deepEqual(resolveVerificationInvocation("pnpm", ["test"], {
    platform: "win32",
    env: { npm_execpath: "C:\\tools\\pnpm.cjs" },
    fileExists: () => true,
    nodePath: "C:\\node.exe",
  }), {
    executable: "C:\\node.exe",
    args: ["C:\\tools\\pnpm.cjs", "test"],
  });
  assert.deepEqual(resolveVerificationInvocation("node", ["--test"], { platform: "win32" }), {
    executable: "node",
    args: ["--test"],
  });
  assert.deepEqual(resolveVerificationInvocation("pnpm", ["test"], { platform: "linux" }), {
    executable: "pnpm",
    args: ["test"],
  });
});

test("automatic verification derives targeted tests and typechecks from safe changed paths", () => {
  const plan = resolveAutoRunVerificationPlan({
    changedPaths: [
      "apps/server/src/services/example.mjs",
      "apps/server/test/example.test.mjs",
      "apps/web/src/example.tsx",
      "apps/web/src/example.test.tsx",
      "../outside.test.mjs",
    ],
    env: { MYAGENTTOOL_AUTORUN_VERIFY_AUTO: "1" },
  });
  assert.deepEqual(plan, [
    ["node", "--test", "apps/server/test/example.test.mjs"],
    ["pnpm", "--filter", "@myagenttool/web", "test:unit", "--", "src/example.test.tsx"],
    ["pnpm", "--filter", "@myagenttool/server", "typecheck"],
    ["pnpm", "--filter", "@myagenttool/web", "typecheck"],
  ]);
});

test("automatic verification falls back to the repository CI suite when no targeted check is discoverable", () => {
  assert.deepEqual(resolveAutoRunVerificationPlan({
    changedPaths: ["README.md"],
    env: { MYAGENTTOOL_AUTORUN_VERIFY_AUTO: "1" },
  }), [["pnpm", "test:ci"]]);
  assert.deepEqual(resolveAutoRunVerificationPlan({
    changedPaths: ["README.md"],
    env: {},
  }), []);
});

test("verification plan stops on failure and preserves platform-owned command evidence", async () => {
  const result = await runWorktreeVerificationPlan({
    cwd: tmpdir(),
    commands: [
      ["node", "-e", "process.exit(0)"],
      ["node", "-e", "process.exit(4)"],
      ["node", "-e", "process.exit(0)"],
    ],
  });
  assert.equal(result.verified, true);
  assert.equal(result.passed, false);
  assert.equal(result.exitCode, 4);
  assert.equal(result.commands.length, 2);
});
