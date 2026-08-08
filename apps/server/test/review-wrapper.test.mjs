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

// --- Phase 2 (#912): the same wrapper's diff-explain mode ---

// A fake Claude CLI that ignores args and prints the explanation JSON the wrapper
// expects (one valid highlight + one file-less highlight that must be dropped).
function writeClaudeExplainStub(output) {
  const stub = join(workdir, `fake-claude-explain-${Math.abs(hash(output ?? "default"))}.mjs`);
  writeFileSync(stub, output === undefined
    ? "console.log(JSON.stringify({ summary: 'Explains the diff.', highlights: [{ file: 'a.ts', change: 'added guard', impact: 'prevents npe' }, { file: '', change: 'dropped', impact: 'no file' }] }));"
    : `process.stdout.write(${JSON.stringify(output)});`);
  return stub;
}

test("claude explain wrapper fails fast when --cwd is missing and stamps the explain tool", () => {
  const res = runWrapper(claudeWrapper, ["--mode", "diff-explain"]);
  assert.notEqual(res.status, 0);
  const payload = resultPayload(res.stdout);
  assert.match(payload.output.error, /--cwd must be an absolute path/);
  assert.equal(payload.output.tool, "claude.explain.diff");
});

test("claude explain wrapper normalizes highlights, drops file-less ones, and reports plan mode", () => {
  const stub = writeClaudeExplainStub();
  const res = runWrapper(claudeWrapper, ["--mode", "diff-explain", "--cwd", workdir, "--claude-cli", stub]);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const payload = resultPayload(res.stdout);
  assert.equal(payload.output.source, "claude");
  assert.equal(payload.output.tool, "claude.explain.diff");
  assert.equal(payload.output.mode, "diff-explain");
  assert.equal(payload.output.highlights.length, 1, "file-less highlight is dropped");
  assert.equal(payload.output.highlights[0].file, "a.ts");
  assert.equal(payload.output.highlights[0].change, "added guard");
  // The wrapper must never carry review-only fields into an explanation.
  assert.ok(!("findings" in payload.output), "explanation output must not contain findings");
});

test("claude explain wrapper fails on malformed explanation JSON", () => {
  const stub = writeClaudeExplainStub("not json at all\n");
  const res = runWrapper(claudeWrapper, ["--mode", "diff-explain", "--cwd", workdir, "--claude-cli", stub]);
  assert.notEqual(res.status, 0);
  assert.match(resultPayload(res.stdout).output.error, /malformed explanation JSON|no explanation output/);
});

// --- Phase 3 (#913): the same wrapper's propose-patch mode ---

function writeClaudeProposeStub(output) {
  const stub = join(workdir, `fake-claude-propose-${Math.abs(hash(output ?? "default"))}.mjs`);
  writeFileSync(stub, output === undefined
    // A proposal with a patch but NO files field, so the wrapper must recover the
    // touched files from the diff headers.
    ? "console.log(JSON.stringify({ summary: 'Add a guard.', patch: 'diff --git a/x.mjs b/x.mjs\\n--- a/x.mjs\\n+++ b/x.mjs\\n@@ -1 +1,2 @@\\n foo\\n+bar\\n' }));"
    : `process.stdout.write(${JSON.stringify(output)});`);
  return stub;
}

test("claude propose wrapper requires --task", () => {
  const res = runWrapper(claudeWrapper, ["--mode", "propose-patch", "--cwd", workdir]);
  assert.notEqual(res.status, 0);
  const payload = resultPayload(res.stdout);
  assert.match(payload.output.error, /--task is required/);
  assert.equal(payload.output.tool, "claude.propose.patch");
});

test("claude propose wrapper returns a patch artifact and recovers touched files from the diff", () => {
  const stub = writeClaudeProposeStub();
  const res = runWrapper(claudeWrapper, ["--mode", "propose-patch", "--cwd", workdir, "--task", "add bar", "--claude-cli", stub]);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const payload = resultPayload(res.stdout);
  assert.equal(payload.output.source, "claude");
  assert.equal(payload.output.tool, "claude.propose.patch");
  assert.equal(payload.output.mode, "propose-patch");
  assert.equal(payload.output.task, "add bar");
  assert.match(payload.output.patch, /diff --git a\/x\.mjs b\/x\.mjs/);
  assert.deepEqual(payload.output.files, [{ path: "x.mjs", action: "modified" }], "files recovered from the diff header");
  // A proposal is never applied by the wrapper.
  assert.equal(payload.touchedUserFiles, false);
  assert.ok(!("findings" in payload.output), "proposal output must not contain findings");
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
  const captured = JSON.parse(readFileSync(capture, "utf8"));
  assert.deepEqual(captured.args.slice(0, 5), ["exec", "--sandbox", "read-only", "--ephemeral", "--json"]);
  assert.deepEqual(captured.args.slice(5, 7), ["-c", "model_reasoning_effort=low"]);
});

test("codex wrapper binds delivery review to the recorded base commit", () => {
  const capture = join(workdir, "base-capture.json");
  const stub = writeCodexStub(capture);
  const base = "a".repeat(40);
  const res = runWrapper(codexWrapper, [
    "--mode", "diff-review", "--cwd", workdir, "--codex-cli", stub, "--base-ref", base,
  ], { STUB_CAPTURE: capture });
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const captured = JSON.parse(readFileSync(capture, "utf8"));
  assert.deepEqual(captured.args.slice(0, 7), ["exec", "review", "-c", 'sandbox_mode="read-only"', "--base", base, "--ephemeral"]);
  assert.deepEqual(captured.args.slice(7, 10), ["-c", "model_reasoning_effort=low", "--output-schema"]);
  assert.match(captured.args[10], /codex-review-output\.schema\.json$/);
  assert.equal(captured.args[11], "--json");
});

test("codex wrapper normalizes native review findings", () => {
  const capture = join(workdir, "native-capture.json");
  const native = JSON.stringify({
    overall_correctness: "patch is incorrect",
    overall_explanation: "One persistence regression remains.",
    findings: [{
      title: "[P1] Persist the registered timezone",
      body: "The route mutates memory without scheduling persistence.",
      priority: 1,
      confidence_score: 0.97,
      code_location: {
        absolute_file_path: join(workdir, "apps/server/src/routes/agents.mjs"),
        line_range: { start: 170, end: 170 },
      },
    }],
  });
  const stub = writeCodexStub(capture, native);
  const res = runWrapper(codexWrapper, [
    "--mode", "diff-review", "--cwd", workdir, "--codex-cli", stub,
    "--base-ref", "b".repeat(40), "--severity-floor", "medium",
  ], { STUB_CAPTURE: capture });
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const payload = resultPayload(res.stdout);
  assert.equal(payload.output.summary, "One persistence regression remains.");
  assert.deepEqual(payload.output.findings[0], {
    severity: "high",
    file: "apps/server/src/routes/agents.mjs",
    line: 170,
    message: "[P1] Persist the registered timezone: The route mutates memory without scheduling persistence.",
    suggestion: "",
    confidence: "high",
  });
});

test("codex wrapper drops absolute and relative findings outside the review worktree", () => {
  const capture = join(workdir, "outside-path-capture.json");
  const native = JSON.stringify({
    overall_correctness: "patch is incorrect",
    overall_explanation: "Only the in-worktree finding is valid.",
    findings: [
      {
        title: "[P1] Valid finding",
        body: "This file belongs to the reviewed patch.",
        priority: 1,
        confidence_score: 0.95,
        code_location: {
          absolute_file_path: join(workdir, "src/inside.mjs"),
          line_range: { start: 4, end: 4 },
        },
      },
      {
        title: "[P1] Outside absolute path",
        body: "This path must not leave the worktree.",
        priority: 1,
        confidence_score: 0.95,
        code_location: {
          absolute_file_path: resolve(workdir, "../outside-secret.txt"),
          line_range: { start: 1, end: 1 },
        },
      },
      {
        title: "[P1] Traversal path",
        body: "Relative traversal must also be rejected.",
        priority: 1,
        confidence_score: 0.95,
        code_location: {
          absolute_file_path: "../outside-relative.txt",
          line_range: { start: 1, end: 1 },
        },
      },
    ],
  });
  const stub = writeCodexStub(capture, native);
  const res = runWrapper(codexWrapper, [
    "--mode", "diff-review", "--cwd", workdir, "--codex-cli", stub,
    "--base-ref", "c".repeat(40), "--severity-floor", "medium",
  ], { STUB_CAPTURE: capture });
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const payload = resultPayload(res.stdout);
  assert.deepEqual(payload.output.findings.map((finding) => finding.file), ["src/inside.mjs"]);
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

test("codex wrapper accepts fenced JSON in the final Codex event", () => {
  const capture = join(workdir, "fenced-event-capture.json");
  const review = JSON.stringify({
    summary: "A concrete regression was found.",
    findings: [{ severity: "high", file: "route.ts", line: 9, message: "Missing persistence." }],
  });
  const output = `${JSON.stringify({
    type: "item.completed",
    item: { type: "agent_message", text: `\`\`\`json\n${review}\n\`\`\`` },
  })}\n`;
  const stub = writeCodexStub(capture, output);
  const res = runWrapper(codexWrapper, ["--mode", "diff-review", "--cwd", workdir, "--codex-cli", stub], { STUB_CAPTURE: capture });
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const payload = resultPayload(res.stdout);
  assert.equal(payload.output.summary, "A concrete regression was found.");
  assert.equal(payload.output.findings[0].file, "route.ts");
  assert.equal(payload.output.verdict, "changes_requested");
  assert.equal(payload.output.structured, true);
});

test("codex wrapper preserves an unstructured native review instead of reporting a parser failure", () => {
  const capture = join(workdir, "plain-review-capture.json");
  const output = `${JSON.stringify({
    type: "item.completed",
    item: { type: "agent_message", text: "[P1] Persist the timezone before returning.\nThe current route only mutates memory." },
  })}\n`;
  const stub = writeCodexStub(capture, output);
  const res = runWrapper(codexWrapper, ["--mode", "diff-review", "--cwd", workdir, "--codex-cli", stub], { STUB_CAPTURE: capture });
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const payload = resultPayload(res.stdout);
  assert.match(payload.output.summary, /Persist the timezone/);
  assert.equal(payload.output.verdict, "changes_requested", "ambiguous plain text fails closed");
  assert.equal(payload.output.structured, false);
});

test("codex wrapper recognizes an explicitly clean unstructured review", () => {
  const capture = join(workdir, "plain-clean-review-capture.json");
  const output = `${JSON.stringify({
    type: "item.completed",
    item: { type: "agent_message", text: "The tests pass, with no actionable regressions identified." },
  })}\n`;
  const stub = writeCodexStub(capture, output);
  const res = runWrapper(codexWrapper, ["--mode", "diff-review", "--cwd", workdir, "--codex-cli", stub], { STUB_CAPTURE: capture });
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const payload = resultPayload(res.stdout);
  assert.equal(payload.output.verdict, "approved");
  assert.equal(payload.output.structured, false);
});
