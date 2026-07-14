/*
 * Claude governance Phase 4b (#914): the write-capable apply RUNNER wrapper,
 * exercised against a REAL git worktree. It applies an authorized patch with
 * `git apply`, refuses a patch that does not check cleanly (no half-applied tree),
 * and reports the authoritative file list + reversible rollback guidance.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const applyWrapper = join(repoRoot, "tools/agents/claude-apply-wrapper.mjs");

function git(cwd, args) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return r.stdout ?? "";
}

// A fresh git repo with one committed file and a patch that adds a line to it.
function makeRepoWithPatch() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "claude-apply-test-")));
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "t@t"]);
  git(dir, ["config", "user.name", "t"]);
  writeFileSync(join(dir, "x.txt"), "foo\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "init"]);
  writeFileSync(join(dir, "x.txt"), "foo\nbar\n");
  const patch = git(dir, ["diff"]);
  git(dir, ["checkout", "--", "x.txt"]); // reset so the patch is un-applied
  const patchFile = join(dir, "change.patch");
  writeFileSync(patchFile, patch);
  return { dir, patchFile };
}

function runApply(args) {
  const res = spawnSync(process.execPath, [applyWrapper, ...args], { cwd: repoRoot, encoding: "utf8" });
  const line = (res.stdout ?? "").split(/\r?\n/).find((l) => l.startsWith("RESULT "));
  assert.ok(line, `expected a RESULT line in:\n${res.stdout}\n${res.stderr}`);
  return { status: res.status, payload: JSON.parse(line.slice("RESULT ".length)) };
}

test("apply wrapper applies a clean patch, writes the file, and reports the file list + rollback", () => {
  const { dir, patchFile } = makeRepoWithPatch();
  const { status, payload } = runApply(["--cwd", dir, "--patch-file", patchFile]);
  assert.equal(status, 0);
  assert.equal(payload.output.tool, "claude.apply.patch");
  assert.equal(payload.output.applied, true);
  assert.equal(payload.touchedUserFiles, true, "an applied patch is an honest worktree mutation");
  assert.deepEqual(payload.output.appliedFiles.map((f) => f.path), ["x.txt"]);
  assert.equal(payload.output.verification.checkPassed, true);
  assert.equal(payload.output.rollback.strategy, "git_apply_reverse");
  // The file really changed on disk.
  assert.equal(readFileSync(join(dir, "x.txt"), "utf8"), "foo\nbar\n");
  // Rollback is genuinely reversible.
  git(dir, ["apply", "--reverse", "--", patchFile]);
  assert.equal(readFileSync(join(dir, "x.txt"), "utf8"), "foo\n");
});

test("apply wrapper refuses a patch that does not check cleanly and writes nothing", () => {
  const { dir } = makeRepoWithPatch();
  const badPatch = join(dir, "bad.patch");
  writeFileSync(badPatch, "diff --git a/x.txt b/x.txt\n--- a/x.txt\n+++ b/x.txt\n@@ -99 +99 @@\n-nope\n+nah\n");
  const { status, payload } = runApply(["--cwd", dir, "--patch-file", badPatch]);
  assert.notEqual(status, 0);
  assert.equal(payload.output.applied, false);
  assert.equal(payload.touchedUserFiles, false);
  assert.equal(payload.output.verification.checkPassed, false);
  assert.equal(payload.output.rollback, null);
  assert.equal(readFileSync(join(dir, "x.txt"), "utf8"), "foo\n", "the worktree is untouched after a refused apply");
});

test("apply wrapper --reverse rolls back an applied patch and refuses a second reverse", () => {
  const { dir, patchFile } = makeRepoWithPatch();
  // Apply first.
  const applied = runApply(["--cwd", dir, "--patch-file", patchFile]);
  assert.equal(applied.status, 0);
  assert.equal(readFileSync(join(dir, "x.txt"), "utf8"), "foo\nbar\n");
  // Governed rollback: same patch, --reverse.
  const reversed = runApply(["--cwd", dir, "--patch-file", patchFile, "--reverse"]);
  assert.equal(reversed.status, 0);
  assert.equal(reversed.payload.output.applied, true);
  assert.equal(reversed.payload.output.reversed, true);
  assert.equal(reversed.payload.touchedUserFiles, true, "a rollback is an honest worktree mutation too");
  assert.equal(reversed.payload.output.rollback, null, "a completed rollback is not itself re-reversible here");
  assert.deepEqual(reversed.payload.output.appliedFiles.map((f) => f.path), ["x.txt"]);
  assert.equal(readFileSync(join(dir, "x.txt"), "utf8"), "foo\n", "the file is back to its pre-apply content");
  // A second reverse no longer checks cleanly → refused, nothing written.
  const again = runApply(["--cwd", dir, "--patch-file", patchFile, "--reverse"]);
  assert.notEqual(again.status, 0);
  assert.equal(again.payload.output.applied, false);
  assert.equal(again.payload.output.verification.checkPassed, false);
  assert.equal(readFileSync(join(dir, "x.txt"), "utf8"), "foo\n");
});

// A repo whose committed test passes, plus two patches: one that keeps the test
// green and one that breaks it — verification must report both honestly.
function makeRepoWithVerifiablePatches() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "claude-apply-verify-")));
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "t@t"]);
  git(dir, ["config", "user.name", "t"]);
  writeFileSync(join(dir, "lib.mjs"), "export const v = 1;\n");
  writeFileSync(join(dir, "lib.test.mjs"), [
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { v } from './lib.mjs';",
    "test('v', () => assert.equal(v, 1));",
  ].join("\n"));
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "init"]);
  writeFileSync(join(dir, "lib.mjs"), "export const v = 1;\nexport const w = 2;\n");
  const goodPatch = join(dir, "good.patch");
  writeFileSync(goodPatch, git(dir, ["diff"]));
  git(dir, ["checkout", "--", "lib.mjs"]);
  writeFileSync(join(dir, "lib.mjs"), "export const v = 99;\n");
  const badPatch = join(dir, "bad.patch");
  writeFileSync(badPatch, git(dir, ["diff"]));
  git(dir, ["checkout", "--", "lib.mjs"]);
  return { dir, goodPatch, badPatch };
}

test("apply wrapper --verify runs the allowlisted command and records an honest pass", () => {
  const { dir, goodPatch } = makeRepoWithVerifiablePatches();
  const { status, payload } = runApply(["--cwd", dir, "--patch-file", goodPatch, "--verify", "node-test"]);
  assert.equal(status, 0);
  assert.equal(payload.output.applied, true);
  assert.equal(payload.output.verification.testsPassed, true);
  assert.equal(payload.output.verification.verifyCommand, "node --test");
  assert.equal(payload.output.verification.testExitCode, 0);
});

test("apply wrapper --verify records a failure without undoing the apply", () => {
  const { dir, badPatch } = makeRepoWithVerifiablePatches();
  const { status, payload } = runApply(["--cwd", dir, "--patch-file", badPatch, "--verify", "node-test"]);
  assert.equal(status, 0, "the run completes; the verdict rides the result");
  assert.equal(payload.output.applied, true, "a failing verification does not undo the apply");
  assert.equal(payload.output.verification.testsPassed, false);
  assert.match(payload.summary, /verification .+ FAILED/);
  // The patch is still on disk — the governed rollback is the undo, not a silent revert.
  assert.match(readFileSync(join(dir, "lib.mjs"), "utf8"), /v = 99/);
});

test("apply wrapper refuses an unknown verify id before writing anything", () => {
  const { dir, goodPatch } = makeRepoWithVerifiablePatches();
  const { status, payload } = runApply(["--cwd", dir, "--patch-file", goodPatch, "--verify", "evil-cmd"]);
  assert.notEqual(status, 0);
  assert.match(payload.output.error, /Unsupported verify command id/);
  assert.match(readFileSync(join(dir, "lib.mjs"), "utf8"), /v = 1;\n$/, "nothing was applied");
});

test("apply wrapper refuses a non-git cwd and an empty patch", () => {
  const nonGit = realpathSync(mkdtempSync(join(tmpdir(), "claude-apply-nongit-")));
  const patchFile = join(nonGit, "p.patch");
  writeFileSync(patchFile, "diff --git a/x b/x\n");
  const notGit = runApply(["--cwd", nonGit, "--patch-file", patchFile]);
  assert.notEqual(notGit.status, 0);
  assert.match(notGit.payload.output.error, /git work tree/);

  const { dir } = makeRepoWithPatch();
  const empty = join(dir, "empty.patch");
  writeFileSync(empty, "   \n");
  const emptyRes = runApply(["--cwd", dir, "--patch-file", empty]);
  assert.notEqual(emptyRes.status, 0);
  assert.match(emptyRes.payload.output.error, /empty/);
});
