import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const wrapper = join(repoRoot, "tools/agents/codex-patch-proposal-wrapper.mjs");
const workdir = realpathSync(mkdtempSync(join(tmpdir(), "codex-patch-proposal-wrapper-test-")));

function runWrapper(args, env = {}) {
  return spawnSync(process.execPath, [wrapper, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function resultPayload(stdout) {
  const line = stdout.split(/\r?\n/).find((l) => l.startsWith("RESULT "));
  assert.ok(line, `expected a RESULT line in:\n${stdout}`);
  return JSON.parse(line.slice("RESULT ".length));
}

function writeCodexStub(capturePath, output) {
  const stub = join(workdir, `fake-codex-patch-${Math.abs(hash(capturePath))}.mjs`);
  writeFileSync(stub, [
    "import { writeFileSync } from 'node:fs';",
    "const args = process.argv.slice(2);",
    "writeFileSync(process.env.STUB_CAPTURE, JSON.stringify({ cwd: process.cwd(), args, prompt: args.at(-1) ?? '' }));",
    "if (!args.includes('exec') || !args.includes('--json')) process.exit(3);",
    output === undefined
      ? "console.log(JSON.stringify({ summary: 'Proposal ok.', files: [{ path: 'README.md', changeType: 'BOGUS', risk: 'high' }, { path: '', changeType: 'modify' }], diff: 'diff --git a/README.md b/README.md\\n--- a/README.md\\n+++ b/README.md\\n@@ -1 +1 @@\\n-old\\n+new\\n', verification: ['node --test'] }));"
      : `process.stdout.write(${JSON.stringify(output)});`,
  ].join("\n"));
  return stub;
}

function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
  return h;
}

test("codex patch proposal wrapper fails fast when --cwd is missing", () => {
  const res = runWrapper(["--mode", "patch-proposal", "--goal", "Propose something."]);
  assert.notEqual(res.status, 0);
  assert.match(resultPayload(res.stdout).output.error, /--cwd must be an absolute path/);
});

test("codex patch proposal wrapper fails fast when --goal is missing", () => {
  const res = runWrapper(["--mode", "patch-proposal", "--cwd", workdir]);
  assert.notEqual(res.status, 0);
  assert.match(resultPayload(res.stdout).output.error, /--goal is required/);
});

test("codex patch proposal wrapper forces read-only sandbox and hashes normalized diff", () => {
  const capture = join(workdir, "patch-capture.json");
  const stub = writeCodexStub(capture);
  const res = runWrapper([
    "--mode", "patch-proposal",
    "--cwd", workdir,
    "--codex-cli", stub,
    "--goal", "Add immutable patch proposal artifacts.",
    "--constraints", "--do not write files",
    "--base-plan-id", "cpl_demo_1",
    "--max-files", "5",
  ], { STUB_CAPTURE: capture });

  assert.equal(res.status, 0, res.stderr || res.stdout);
  const payload = resultPayload(res.stdout);
  assert.equal(payload.touchedUserFiles, false);
  assert.equal(payload.output.tool, "codex.propose.patch");
  assert.equal(payload.output.files.length, 1);
  assert.equal(payload.output.files[0].changeType, "unknown");
  assert.equal(payload.output.files[0].risk, "high");
  assert.equal(payload.output.patchSha256, createHash("sha256").update(payload.output.diff, "utf8").digest("hex"));
  assert.deepEqual(payload.output.verification, ["node --test"]);

  const captured = JSON.parse(readFileSync(capture, "utf8"));
  assert.equal(captured.cwd, workdir);
  assert.deepEqual(captured.args.slice(0, 5), ["exec", "--sandbox", "read-only", "--json", captured.prompt]);
  assert.match(captured.prompt, /Requested goal: Add immutable patch proposal artifacts\./);
  assert.match(captured.prompt, /Constraints: --do not write files/);
  assert.match(captured.prompt, /Base change plan id: cpl_demo_1/);
  assert.match(captured.prompt, /Maximum files: 5\./);
});

test("codex patch proposal wrapper fails on malformed proposal JSON", () => {
  const capture = join(workdir, "bad-patch-capture.json");
  const stub = writeCodexStub(capture, "not json\n");
  const res = runWrapper(["--mode", "patch-proposal", "--cwd", workdir, "--codex-cli", stub, "--goal", "Propose."], { STUB_CAPTURE: capture });
  assert.notEqual(res.status, 0);
  assert.match(resultPayload(res.stdout).output.error, /malformed patch proposal JSON|no patch proposal output/);
});

test("codex patch proposal wrapper fails when Codex returns no diff", () => {
  const capture = join(workdir, "no-diff-capture.json");
  const stub = writeCodexStub(capture, JSON.stringify({ summary: "No diff", files: [] }));
  const res = runWrapper(["--mode", "patch-proposal", "--cwd", workdir, "--codex-cli", stub, "--goal", "Propose."], { STUB_CAPTURE: capture });
  assert.notEqual(res.status, 0);
  assert.match(resultPayload(res.stdout).output.error, /must include a unified diff/);
});
