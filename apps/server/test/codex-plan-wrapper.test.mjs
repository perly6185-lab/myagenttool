import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const codexPlanWrapper = join(repoRoot, "tools/agents/codex-plan-wrapper.mjs");
const workdir = realpathSync(mkdtempSync(join(tmpdir(), "codex-plan-wrapper-test-")));

function runWrapper(args, env = {}) {
  return spawnSync(process.execPath, [codexPlanWrapper, ...args], {
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
  const stub = join(workdir, `fake-codex-plan-${Math.abs(hash(capturePath))}.mjs`);
  writeFileSync(stub, [
    "import { writeFileSync } from 'node:fs';",
    "const args = process.argv.slice(2);",
    "writeFileSync(process.env.STUB_CAPTURE, JSON.stringify({ cwd: process.cwd(), args, prompt: args.at(-1) ?? '' }));",
    "if (!args.includes('exec') || !args.includes('--json')) process.exit(3);",
    output === undefined
      ? "console.log(JSON.stringify({ summary: 'Plan ok.', steps: [{ title: 'Add tests', rationale: 'Prove the facade.', files: ['apps/server/src/services/tools.mjs'], risk: 'BOGUS' }, { title: '', files: ['drop.ts'] }], openQuestions: ['Question?'], verification: ['node --test'] }));"
      : `process.stdout.write(${JSON.stringify(output)});`,
  ].join("\n"));
  return stub;
}

function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
  return h;
}

test("codex plan wrapper fails fast when --cwd is missing", () => {
  const res = runWrapper(["--mode", "change-plan", "--goal", "Plan something."]);
  assert.notEqual(res.status, 0);
  assert.match(resultPayload(res.stdout).output.error, /--cwd must be an absolute path/);
});

test("codex plan wrapper fails fast when --goal is missing", () => {
  const res = runWrapper(["--mode", "change-plan", "--cwd", workdir]);
  assert.notEqual(res.status, 0);
  assert.match(resultPayload(res.stdout).output.error, /--goal is required/);
});

test("codex plan wrapper forces read-only sandbox and normalizes plan output", () => {
  const capture = join(workdir, "plan-capture.json");
  const stub = writeCodexStub(capture);
  const res = runWrapper([
    "--mode", "change-plan",
    "--cwd", workdir,
    "--codex-cli", stub,
    "--goal", "Add governed patch proposal artifacts.",
    "--constraints", "--do not write files",
    "--severity-floor", "high",
  ], { STUB_CAPTURE: capture });

  assert.equal(res.status, 0, res.stderr || res.stdout);
  const payload = resultPayload(res.stdout);
  assert.equal(payload.touchedUserFiles, false);
  assert.equal(payload.output.tool, "codex.plan.change");
  assert.equal(payload.output.steps.length, 1);
  assert.equal(payload.output.steps[0].risk, "medium");
  assert.deepEqual(payload.output.openQuestions, ["Question?"]);
  assert.deepEqual(payload.output.verification, ["node --test"]);

  const captured = JSON.parse(readFileSync(capture, "utf8"));
  assert.equal(captured.cwd, workdir);
  assert.deepEqual(captured.args.slice(0, 5), ["exec", "--sandbox", "read-only", "--json", captured.prompt]);
  assert.match(captured.prompt, /Requested goal: Add governed patch proposal artifacts\./);
  assert.match(captured.prompt, /Constraints: --do not write files/);
  assert.match(captured.prompt, /Risk attention floor: high\./);
});

test("codex plan wrapper fails on malformed plan JSON", () => {
  const capture = join(workdir, "bad-plan-capture.json");
  const stub = writeCodexStub(capture, "not json\n");
  const res = runWrapper(["--mode", "change-plan", "--cwd", workdir, "--codex-cli", stub, "--goal", "Plan."], { STUB_CAPTURE: capture });
  assert.notEqual(res.status, 0);
  assert.match(resultPayload(res.stdout).output.error, /malformed plan JSON|no plan output/);
});
