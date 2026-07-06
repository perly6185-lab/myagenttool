import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const wrapper = join(repoRoot, "tools/agents/codex-apply-patch-wrapper.mjs");

function runWrapper(args, cwd = repoRoot) {
  return spawnSync(process.execPath, [wrapper, ...args], {
    cwd,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function resultPayload(stdout) {
  const line = stdout.split(/\r?\n/).find((l) => l.startsWith("RESULT "));
  assert.ok(line, `expected a RESULT line in:\n${stdout}`);
  return JSON.parse(line.slice("RESULT ".length));
}

function git(args, cwd) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(res.status, 0, res.stderr || res.stdout);
  return res;
}

function makeRepo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "codex-apply-patch-wrapper-test-")));
  git(["init"], dir);
  writeFileSync(join(dir, "README.md"), "old\n", "utf8");
  return dir;
}

function readmePatch(from = "old", to = "new") {
  return [
    "diff --git a/README.md b/README.md",
    "--- a/README.md",
    "+++ b/README.md",
    "@@ -1 +1 @@",
    `-${from}`,
    `+${to}`,
    "",
  ].join("\n");
}

function sha256(text) {
  return createHash("sha256").update(String(text).replace(/\r\n/g, "\n").trim(), "utf8").digest("hex");
}

function normalizedFile(path) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

test("codex apply patch wrapper fails fast when --cwd is missing", () => {
  const res = runWrapper(["--mode", "apply-patch"]);
  assert.notEqual(res.status, 0);
  assert.match(resultPayload(res.stdout).output.error, /--cwd must be an absolute path/);
});

test("codex apply patch wrapper rejects a patch hash mismatch", () => {
  const repo = makeRepo();
  const patchFile = join(repo, "proposal.patch");
  writeFileSync(patchFile, readmePatch(), "utf8");
  const res = runWrapper([
    "--mode", "apply-patch",
    "--cwd", repo,
    "--patch-file", patchFile,
    "--proposal-id", "cpp_apply_test",
    "--patch-sha256", "a".repeat(64),
  ]);
  assert.notEqual(res.status, 0);
  assert.match(resultPayload(res.stdout).output.error, /hash does not match/);
  assert.equal(normalizedFile(join(repo, "README.md")), "old\n");
});

test("codex apply patch wrapper checks before applying", () => {
  const repo = makeRepo();
  const patchFile = join(repo, "proposal.patch");
  const patch = readmePatch("missing", "new");
  writeFileSync(patchFile, patch, "utf8");
  const res = runWrapper([
    "--mode", "apply-patch",
    "--cwd", repo,
    "--patch-file", patchFile,
    "--proposal-id", "cpp_apply_check",
    "--patch-sha256", sha256(patch),
  ]);
  assert.notEqual(res.status, 0);
  assert.match(resultPayload(res.stdout).output.error, /git apply --check failed/);
  assert.equal(normalizedFile(join(repo, "README.md")), "old\n");
});

test("codex apply patch wrapper applies an approved patch and removes the temp patch file", () => {
  const repo = makeRepo();
  const patchFile = join(repo, "proposal.patch");
  const patch = readmePatch();
  writeFileSync(patchFile, patch, "utf8");
  const res = runWrapper([
    "--mode", "apply-patch",
    "--cwd", repo,
    "--patch-file", patchFile,
    "--proposal-id", "cpp_apply_ok",
    "--patch-sha256", sha256(patch),
  ]);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const payload = resultPayload(res.stdout);
  assert.equal(payload.touchedUserFiles, true);
  assert.equal(payload.output.tool, "codex.apply.patch");
  assert.equal(payload.output.proposalId, "cpp_apply_ok");
  assert.equal(payload.output.patchSha256, sha256(patch));
  assert.deepEqual(payload.output.files, ["README.md"]);
  assert.equal(normalizedFile(join(repo, "README.md")), "new\n");
  assert.equal(existsSync(patchFile), false);
});
