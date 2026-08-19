/*
 * The auto-run verification runner: resolves an env-configured command (never
 * agent input) and runs it in the worktree, reporting passed/verified. Real
 * node subprocesses, no mocks.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  resolveAutoRunVerificationPlan,
  resolveAutoRunVerifyCommand,
  resolveVerificationInvocation,
  runWorktreeVerification,
  runWorktreeVerificationPlan,
  verificationFailureIsRepairable,
} from "../src/services/worktree-verify.mjs";
import { startVerificationProcessGuardian } from "../src/runtime/verification-process-guardian.mjs";

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

test("automatic verification uses the deterministic docs check for Markdown-only changes", () => {
  assert.deepEqual(resolveAutoRunVerificationPlan({
    changedPaths: ["README.md"],
    env: { MYAGENTTOOL_AUTORUN_VERIFY_AUTO: "1" },
  }), [[
    "pwsh", "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", "tools/docs/check-markdown-links.ps1",
  ]]);
  assert.deepEqual(resolveAutoRunVerificationPlan({
    changedPaths: ["docs/engineering/reliability.md"],
    env: { MYAGENTTOOL_AUTORUN_VERIFY_AUTO: "1" },
  }), [[
    "pwsh", "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", "tools/docs/check-markdown-links.ps1",
  ]]);
  assert.deepEqual(resolveAutoRunVerificationPlan({
    changedPaths: ["README.md"],
    env: {},
  }), []);
});

test("automatic verification leaves a plain business-document repository unverified instead of inventing code checks", () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "myagenttool-business-docs-"));
  try {
    mkdirSync(join(repositoryRoot, "deliverables"), { recursive: true });
    writeFileSync(join(repositoryRoot, "deliverables", "quotation.md"), "# Quotation\n");
    assert.deepEqual(resolveAutoRunVerificationPlan({
      repositoryRoot,
      changedPaths: ["deliverables/quotation.md"],
      env: { MYAGENTTOOL_AUTORUN_VERIFY_AUTO: "1" },
    }), []);
    assert.deepEqual(resolveAutoRunVerificationPlan({
      repositoryRoot,
      changedPaths: ["business-data.json"],
      env: { MYAGENTTOOL_AUTORUN_VERIFY_AUTO: "1" },
    }), []);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test("automatic Markdown verification requires the repository-owned checker to exist", () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "myagenttool-docs-check-"));
  try {
    mkdirSync(join(repositoryRoot, "tools", "docs"), { recursive: true });
    writeFileSync(join(repositoryRoot, "tools", "docs", "check-markdown-links.ps1"), "exit 0\n");
    assert.deepEqual(resolveAutoRunVerificationPlan({
      repositoryRoot,
      changedPaths: ["README.md"],
      env: { MYAGENTTOOL_AUTORUN_VERIFY_AUTO: "1" },
    }), [[
      "pwsh", "-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", "tools/docs/check-markdown-links.ps1",
    ]]);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test("missing verifier infrastructure is not classified as agent-repairable", () => {
  assert.equal(verificationFailureIsRepairable({
    command: "pnpm install --offline --frozen-lockfile",
    summary: "ERR_PNPM_NO_PKG_MANIFEST No package.json found",
  }), false);
  assert.equal(verificationFailureIsRepairable({
    command: "node --test focused.test.mjs",
    summary: "AssertionError: expected quotation total to match",
  }), true);
});

test("automatic verification still falls back to repository CI for unclassified changes", () => {
  assert.deepEqual(resolveAutoRunVerificationPlan({
    changedPaths: ["config/example.json"],
    env: { MYAGENTTOOL_AUTORUN_VERIFY_AUTO: "1" },
  }), [["pnpm", "test:ci"]]);
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

test("aborting verification terminates the real subprocess tree", {
  skip: process.platform === "win32" && Boolean(process.env.CODEX_PERMISSION_PROFILE),
}, async () => {
  const cwd = mkdtempSync(join(tmpdir(), "myagenttool-verify-abort-"));
  const marker = join(cwd, "grandchild-survived.txt");
  const grandchild = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "survived"), 3000); setInterval(() => {}, 1000);`;
  const parent = `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(grandchild)}], { stdio: "ignore" }); setInterval(() => {}, 1000);`;
  const controller = new AbortController();
  try {
    const verification = runWorktreeVerification({
      cwd,
      command: [process.execPath, "-e", parent],
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 150);
    const result = await verification;
    assert.equal(result.aborted, true);
    assert.equal(result.verified, false);
    await new Promise((resolve) => setTimeout(resolve, 3_500));
    assert.equal(existsSync(marker), false, "a grandchild must not survive a superseded verification");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("verification guardian kills the real subprocess tree after its Server parent disappears", {
  skip: process.platform === "win32" && Boolean(process.env.CODEX_PERMISSION_PROFILE),
}, async () => {
  const cwd = mkdtempSync(join(tmpdir(), "myagenttool-verify-guardian-"));
  const marker = join(cwd, "grandchild-survived.txt");
  const grandchild = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "survived"), 3000); setInterval(() => {}, 1000);`;
  const parent = `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(grandchild)}], { stdio: "ignore" }); setInterval(() => {}, 1000);`;
  try {
    const result = await runWorktreeVerification({
      cwd,
      command: [process.execPath, "-e", parent],
      timeoutMs: 5_000,
      startGuardian: (child) => startVerificationProcessGuardian(child, {
        parentPid: 2_147_483_647,
        pollIntervalMs: 50,
        detached: false,
        stdio: "inherit",
      }),
    });
    assert.equal(result.passed, false);
    await new Promise((resolve) => setTimeout(resolve, 3_500));
    assert.equal(existsSync(marker), false, "a verifier grandchild must not outlive a hard-killed Server");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
