import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const codexWrapper = join(repoRoot, "tools/agents/codex-review-wrapper.mjs");
const claudeWrapper = join(repoRoot, "tools/agents/claude-review-wrapper.mjs");

// realpathSync resolves the macOS /var -> /private/var symlink so the wrapper's
// existsSync(--cwd) check and any cwd comparison agree with the child process.
const workdir = realpathSync(mkdtempSync(join(tmpdir(), "review-wrapper-test-")));

function runWrapper(wrapper, args, env = {}) {
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

// A fake Codex CLI: captures the prompt (last arg) and prints the JSON review
// the wrapper expects. STUB_OUTPUT overrides stdout to exercise parse branches.
function writeCodexStub(capturePath, output) {
  const stub = join(workdir, `fake-codex-${Math.abs(hash(capturePath))}.mjs`);
  writeFileSync(stub, [
    "import { writeFileSync } from 'node:fs';",
    "const args = process.argv.slice(2);",
    "writeFileSync(process.env.STUB_CAPTURE, JSON.stringify({ cwd: process.cwd(), args, prompt: args.at(-1) ?? '' }));",
    "if (!args.includes('exec') || !args.includes('--json')) process.exit(3);",
    output === undefined
      ? "console.log(JSON.stringify({ summary: 's', findings: [{ severity: 'BOGUS', file: 'a.ts', line: 2, message: 'issue', suggestion: 'fix', confidence: 'high' }, { severity: 'high', file: '', message: 'dropped' }] }));"
      : `process.stdout.write(${JSON.stringify(output)});`,
  ].join("\n"));
  return stub;
}

function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
  return h;
}

// --- #3: --cwd is required; refuse to review an unspecified directory ---

test("codex wrapper fails fast when --cwd is missing", () => {
  const res = runWrapper(codexWrapper, ["--mode", "diff-review", "--severity-floor", "low"]);
  assert.notEqual(res.status, 0);
  assert.match(resultPayload(res.stdout).output.error, /--cwd must be an absolute path/);
});

test("claude wrapper fails fast when --cwd is missing", () => {
  const res = runWrapper(claudeWrapper, ["--mode", "diff-review"]);
  assert.notEqual(res.status, 0);
  assert.match(resultPayload(res.stdout).output.error, /--cwd must be an absolute path/);
});

test("codex wrapper rejects a --cwd that does not exist", () => {
  const res = runWrapper(codexWrapper, ["--mode", "diff-review", "--cwd", join(workdir, "does-not-exist")]);
  assert.notEqual(res.status, 0);
  assert.match(resultPayload(res.stdout).output.error, /--cwd must be an absolute path/);
});

// --- #6: an --instruction value may legitimately begin with "--" ---

test("codex wrapper accepts an --instruction value beginning with --", () => {
  const capture = join(workdir, "instr-capture.json");
  const stub = writeCodexStub(capture);
  const res = runWrapper(codexWrapper, [
    "--mode", "diff-review", "--cwd", workdir, "--codex-cli", stub, "--instruction", "--focus on the auth path",
  ], { STUB_CAPTURE: capture });
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const payload = resultPayload(res.stdout);
  assert.equal(payload.output.instruction, "--focus on the auth path");
  const captured = JSON.parse(readFileSync(capture, "utf8"));
  assert.match(captured.prompt, /Additional reviewer instruction: --focus on the auth path/);
});

// --- Parse + normalization branches (previously only hit by one happy path) ---

test("codex wrapper normalizes findings and filters malformed ones", () => {
  const capture = join(workdir, "norm-capture.json");
  const stub = writeCodexStub(capture); // default output: one valid + one file-less finding
  const res = runWrapper(codexWrapper, ["--mode", "diff-review", "--cwd", workdir, "--codex-cli", stub], { STUB_CAPTURE: capture });
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const payload = resultPayload(res.stdout);
  assert.equal(payload.output.findings.length, 1, "file-less finding is dropped");
  assert.equal(payload.output.findings[0].severity, "medium", "unknown severity enum falls back to medium");
  assert.equal(payload.output.findings[0].file, "a.ts");
});

test("codex wrapper fails on malformed review JSON", () => {
  const capture = join(workdir, "bad-capture.json");
  const stub = writeCodexStub(capture, "this is not json\n");
  const res = runWrapper(codexWrapper, ["--mode", "diff-review", "--cwd", workdir, "--codex-cli", stub], { STUB_CAPTURE: capture });
  assert.notEqual(res.status, 0);
  assert.match(resultPayload(res.stdout).output.error, /malformed review JSON|no review output/);
});

test("codex wrapper accepts a RESULT-line envelope from the CLI", () => {
  const capture = join(workdir, "result-line-capture.json");
  const envelope = "noise line\nRESULT " + JSON.stringify({ output: { summary: "s", findings: [{ severity: "high", file: "z.ts", line: 1, message: "m" }] } }) + "\n";
  const stub = writeCodexStub(capture, envelope);
  const res = runWrapper(codexWrapper, ["--mode", "diff-review", "--cwd", workdir, "--codex-cli", stub], { STUB_CAPTURE: capture });
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const payload = resultPayload(res.stdout);
  assert.equal(payload.output.findings.length, 1);
  assert.equal(payload.output.findings[0].file, "z.ts");
});
