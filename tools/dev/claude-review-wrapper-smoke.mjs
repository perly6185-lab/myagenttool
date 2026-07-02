import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const tempRoot = join(tmpdir(), `myagenttool-claude-review-wrapper-smoke-${Date.now()}`);
const fixturePath = join(tempRoot, "fake-claude.mjs");
const capturePath = join(tempRoot, "capture.json");
let passed = 0;

const ok = (message) => {
  passed += 1;
  console.log(`  ok - ${message}`);
};

mkdirSync(tempRoot, { recursive: true });
writeFileSync(fixturePath, [
  "import { writeFileSync } from 'node:fs';",
  "const args = process.argv.slice(2);",
  "const promptIndex = args.indexOf('-p') + 1;",
  "const prompt = promptIndex > 0 ? args[promptIndex] : '';",
  "writeFileSync(process.env.CLAUDE_WRAPPER_SMOKE_CAPTURE, JSON.stringify({ cwd: process.cwd(), args, prompt }, null, 2));",
  "if (!args.includes('--output-format') || args[args.indexOf('--output-format') + 1] !== 'stream-json') process.exit(3);",
  "if (!args.includes('--verbose')) process.exit(4);",
  "if (!args.includes('--permission-mode') || args[args.indexOf('--permission-mode') + 1] !== 'plan') process.exit(5);",
  "console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: JSON.stringify({",
  "  summary: 'Review found 1 issue.',",
  "  findings: [{ severity: 'high', file: 'apps/server/src/routes/tools.mjs', line: 34, message: 'Guard project before invocation.', suggestion: 'Resolve project through facade.', confidence: 'medium' }]",
  "}) }] } }));",
  "console.log(JSON.stringify({ type: 'result', total_cost_usd: 0.01, model: 'claude-3-5-sonnet' }));",
].join("\n"));

try {
  const result = spawnSync(process.execPath, [
    "tools/agents/claude-review-wrapper.mjs",
    "--mode",
    "diff-review",
    "--claude-cli",
    fixturePath,
    "--cwd",
    tempRoot,
    "--instruction",
    "Focus on wrapper smoke correctness.",
    "--severity-floor",
    "medium",
  ], {
    cwd: process.cwd(),
    env: { ...process.env, CLAUDE_WRAPPER_SMOKE_CAPTURE: capturePath },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  ok("wrapper completed successfully with fake Claude");

  const resultLine = result.stdout.split(/\r?\n/).find((line) => line.startsWith("RESULT "));
  assert.ok(resultLine, "wrapper should emit a RESULT line");
  const payload = JSON.parse(resultLine.slice("RESULT ".length));
  assert.equal(payload.output.source, "claude");
  assert.equal(payload.output.tool, "claude.review.diff");
  assert.equal(payload.output.mode, "diff-review");
  assert.equal(payload.output.severityFloor, "medium");
  assert.equal(payload.output.findings.length, 1);
  assert.equal(payload.output.findings[0].severity, "high");
  assert.equal(payload.cost.amountUsd, 0.01);
  assert.equal(payload.cost.amountSource, "reported");
  ok("wrapper normalized stream-json review output and reported cost");

  const capture = JSON.parse(readFileSync(capturePath, "utf8"));
  assert.equal(resolve(capture.cwd), resolve(tempRoot));
  assert(capture.args.includes("--permission-mode"), "Claude args should include permission mode");
  assert.equal(capture.args[capture.args.indexOf("--permission-mode") + 1], "plan");
  assert(capture.prompt.includes("Review the current worktree diff"));
  assert(capture.prompt.includes("severity floor: medium"));
  assert(capture.prompt.includes("Focus on wrapper smoke correctness."));
  ok("wrapper passed only governed prompt and read-only permission settings");

  const rejected = spawnSync(process.execPath, [
    "tools/agents/claude-review-wrapper.mjs",
    "--mode",
    "diff-review",
    "--permission-mode",
    "bypassPermissions",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.notEqual(rejected.status, 0);
  assert(rejected.stdout.includes("Unsupported Claude review wrapper argument"));
  ok("wrapper rejects raw permission-mode arguments");

  console.log(`\nclaude-review-wrapper-smoke: ${passed} checks passed`);
} finally {
  if (existsSync(tempRoot) && resolve(tempRoot).startsWith(resolve(tmpdir()))) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
