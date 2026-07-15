#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

// Phase 2 (#912) adds `diff-explain` beside `diff-review`. Both run the same
// fixed, read-only (`--permission-mode plan`) Claude wrapper; only the prompt and
// the shape of the structured output differ. The tool name is derived from the
// mode so the server's per-tool import gate routes each correctly.
// Default until the mode is known, so an early parseArgs failure still stamps a
// valid tool on its error output.
let outputTool = "claude.review.diff";
const options = parseArgs(process.argv.slice(2));
const MODE_TOOL = {
  "diff-review": "claude.review.diff",
  "diff-explain": "claude.explain.diff",
  "propose-patch": "claude.propose.patch",
};
const TOOL = MODE_TOOL[options.mode];
if (!TOOL) fail(`Unsupported Claude wrapper mode: ${options.mode}`);
outputTool = TOOL;
requireReviewCwd(options);
if (options.mode === "propose-patch" && !options.task) fail("--task is required for propose-patch.");

console.log(`Claude wrapper started: ${options.mode}`);

const prompt = options.mode === "propose-patch"
  ? buildProposePrompt(options)
  : options.mode === "diff-explain"
    ? buildExplainPrompt(options)
    : buildPrompt(options);
const commandPlan = claudeCommandPlan(options.claudeCli, [
  "-p",
  prompt,
  "--output-format",
  "stream-json",
  "--verbose",
  "--permission-mode",
  "plan",
]);
const { code, stdout, stderr } = await run(commandPlan.command, commandPlan.args, {
  cwd: options.cwd,
});
for (const line of stderr.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
  console.error(line);
}
if (code !== 0) {
  fail(`Claude exited with code ${code}.`, { exitCode: code, stderr: stderr.trim() });
}

if (options.mode === "propose-patch") {
  emitProposeResult(stdout);
} else if (options.mode === "diff-explain") {
  emitExplainResult(stdout);
} else {
  emitReviewResult(stdout);
}

function emitProposeResult(rawStdout) {
  const proposal = parseProposeOutput(rawStdout);
  const patch = normalizePatch(proposal.patch);
  const files = normalizeProposedFiles(proposal.files, patch);
  console.log(`RESULT ${JSON.stringify({
    summary: proposal.summary ?? summarizeProposal(files),
    // A proposal is never applied by the wrapper; it only reports what it would do.
    touchedUserFiles: false,
    output: {
      source: "claude",
      tool: TOOL,
      mode: options.mode,
      task: options.task,
      instruction: options.instruction,
      summary: proposal.summary ?? null,
      patch,
      files,
      // #913 binding: the worktree HEAD this proposal was generated against,
      // reported by git itself — never by the model. The server validates the
      // shape and the apply runner later refuses a worktree whose HEAD moved.
      baseCommit: worktreeBaseCommit(options.cwd),
    },
    cost: costPayload(proposal),
  })}`);
}

function worktreeBaseCommit(cwd) {
  const head = spawnSync("git", ["-C", cwd, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const sha = String(head.stdout ?? "").trim();
  return head.status === 0 && /^[0-9a-f]{40}$/i.test(sha) ? sha.toLowerCase() : null;
}

function emitReviewResult(rawStdout) {
  const review = parseReviewOutput(rawStdout);
  const findings = normalizeFindings(review.findings);
  console.log(`RESULT ${JSON.stringify({
    summary: summarizeFindings(findings, review.summary),
    touchedUserFiles: false,
    output: {
      source: "claude",
      tool: TOOL,
      mode: options.mode,
      severityFloor: options.severityFloor,
      instruction: options.instruction,
      summary: review.summary ?? null,
      findings,
    },
    cost: costPayload(review),
  })}`);
}

function emitExplainResult(rawStdout) {
  const explain = parseExplainOutput(rawStdout);
  const highlights = normalizeHighlights(explain.highlights);
  console.log(`RESULT ${JSON.stringify({
    summary: explain.summary ?? summarizeHighlights(highlights),
    touchedUserFiles: false,
    output: {
      source: "claude",
      tool: TOOL,
      mode: options.mode,
      instruction: options.instruction,
      summary: explain.summary ?? null,
      highlights,
    },
    cost: costPayload(explain),
  })}`);
}

function costPayload(result) {
  return {
    model: result.model ?? "claude",
    billable: true,
    unknown: !result.reportedCost,
    currency: "USD",
    inputTokens: result.inputTokens ?? 0,
    outputTokens: result.outputTokens ?? 0,
    cachedInputTokens: result.cachedTokens ?? 0,
    ...(result.reportedCost ? { amountUsd: result.amountUsd, amountSource: "reported" } : { amountSource: "external_claude_usage" }),
  };
}

function parseArgs(args) {
  const parsed = {
    mode: "diff-review",
    claudeCli: process.env.MYAGENTTOOL_CLAUDE_COMMAND || "claude",
    cwd: null,
    instruction: null,
    severityFloor: "low",
    task: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--mode") {
      parsed.mode = requireValue(args, ++index, arg);
    } else if (arg === "--claude-cli") {
      parsed.claudeCli = requireValue(args, ++index, arg);
    } else if (arg === "--cwd") {
      parsed.cwd = requireValue(args, ++index, arg);
    } else if (arg === "--instruction") {
      parsed.instruction = normalizeInstruction(requireValue(args, ++index, arg));
    } else if (arg === "--task") {
      parsed.task = normalizeTask(requireValue(args, ++index, arg));
    } else if (arg === "--severity-floor") {
      parsed.severityFloor = normalizeSeverity(requireValue(args, ++index, arg));
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      fail(`Unsupported Claude review wrapper argument: ${arg}`);
    }
  }
  return parsed;
}

function requireReviewCwd(opts) {
  // The governed facade derives --cwd from the ownership-checked worktree path.
  // If it can't (worktree not materialized), the Bridge previously injected no
  // --cwd and this wrapper silently reviewed process.cwd() — the Bridge's own
  // working tree. Refuse rather than review an unspecified directory.
  if (!opts.cwd || !isAbsolute(opts.cwd) || !existsSync(opts.cwd)) {
    fail("--cwd must be an absolute path to an existing worktree; refusing to review an unspecified directory.");
  }
}

function requireValue(args, index, name) {
  const value = args[index];
  // Only a genuinely absent value (end of argv) is an error. Do not reject a
  // value that starts with "--": a review --instruction can legitimately begin
  // with dashes (e.g. "--focus on the auth path"), and the flags are paired by
  // the trusted Desktop Bridge, so the following token is always the value.
  if (value === undefined) fail(`Missing value for ${name}.`);
  return value;
}

function normalizeInstruction(value) {
  const text = String(value ?? "").trim();
  if (text.length > 1200) fail("--instruction exceeds 1200 characters.");
  return text || null;
}

function normalizeTask(value) {
  const text = String(value ?? "").trim();
  if (text.length > 4000) fail("--task exceeds 4000 characters.");
  return text || null;
}

function normalizeSeverity(value) {
  const text = String(value ?? "").trim();
  if (!["low", "medium", "high"].includes(text)) fail("--severity-floor must be low, medium, or high.");
  return text;
}

function buildPrompt(value) {
  return [
    "Review the current worktree diff for bugs, regressions, and missing tests.",
    "Return JSON only with this shape:",
    "{\"summary\":\"...\",\"findings\":[{\"severity\":\"high|medium|low\",\"file\":\"path\",\"line\":1,\"message\":\"...\",\"suggestion\":\"...\",\"confidence\":\"high|medium|low\"}]}",
    `Only include findings at or above severity floor: ${value.severityFloor}.`,
    "Do not edit files, run apply tools, or change the worktree.",
    value.instruction ? `Additional reviewer instruction: ${value.instruction}` : null,
  ].filter(Boolean).join("\n");
}

function buildExplainPrompt(value) {
  return [
    "Explain the current worktree diff: what each change does and why it matters.",
    "Return JSON only with this shape:",
    "{\"summary\":\"...\",\"highlights\":[{\"file\":\"path\",\"change\":\"what changed\",\"impact\":\"why it matters\"}]}",
    "Describe behavior and intent, not style. Do NOT judge, score, or list bugs — that is the review tool's job.",
    "Do not edit files, run apply tools, or change the worktree.",
    value.instruction ? `Additional instruction: ${value.instruction}` : null,
  ].filter(Boolean).join("\n");
}

function buildProposePrompt(value) {
  return [
    "Propose a change to this repository that accomplishes the task below.",
    `Task: ${value.task}`,
    "Return JSON only with this shape:",
    "{\"summary\":\"...\",\"patch\":\"<a unified diff in git apply format>\",\"files\":[{\"path\":\"path\",\"action\":\"created|modified|deleted\"}]}",
    "The patch MUST be a valid unified diff (as produced by `git diff`), applyable with `git apply`.",
    "IMPORTANT: Do NOT edit files, run apply tools, or change the worktree. Output the proposed diff as TEXT only.",
    value.instruction ? `Additional instruction: ${value.instruction}` : null,
  ].filter(Boolean).join("\n");
}

function claudeCommandPlan(command, args) {
  const text = String(command ?? "").trim();
  return /\.(mjs|cjs|js)$/i.test(text)
    ? { command: process.execPath, args: [text, ...args] }
    : { command: text, args };
}

function run(command, args, options) {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => resolveResult({ code: 127, stdout, stderr: `${stderr}${error.message}` }));
    child.on("close", (code) => resolveResult({ code: code ?? 1, stdout, stderr }));
  });
}

function parseReviewOutput(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) fail("Claude produced no review output.");
  const direct = parseJsonMaybe(text);
  if (direct) return normalizeReviewObject(direct);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let latestCost = {};
  for (const line of lines) {
    const parsed = parseJsonMaybe(line);
    if (parsed?.type === "result" || parsed?.subtype === "success") {
      latestCost = costFields(parsed);
    }
  }
  for (const line of lines.toReversed()) {
    if (line.startsWith("RESULT ")) {
      const result = parseJsonMaybe(line.slice("RESULT ".length));
      if (result) return { ...normalizeReviewObject(result.output ?? result), ...latestCost };
    }
    const parsed = parseJsonMaybe(line);
    const candidate = extractReviewFromClaudeEvent(parsed);
    if (candidate) return { ...normalizeReviewObject(candidate), ...latestCost };
  }
  fail("Claude produced malformed review JSON.", { stdoutPreview: text.slice(0, 500) });
}

function parseJsonMaybe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractReviewFromClaudeEvent(event) {
  if (!event || typeof event !== "object") return null;
  if (Array.isArray(event.findings)) return event;
  const text = event.result
    ?? event.summary
    ?? claudeContentText(event.message?.content)
    ?? claudeContentText(event.content)
    ?? null;
  if (!text) return null;
  return parseJsonFromText(String(text).trim());
}

function claudeContentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  return content
    .map((part) => typeof part === "string" ? part : part?.type === "text" ? part.text : "")
    .filter(Boolean)
    .join("\n")
    .trim() || null;
}

function parseJsonFromText(text) {
  const direct = parseJsonMaybe(text);
  if (direct) return direct;
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  return first >= 0 && last > first ? parseJsonMaybe(text.slice(first, last + 1)) : null;
}

function normalizeReviewObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("Claude review output must be an object.");
  }
  return {
    summary: typeof value.summary === "string" ? value.summary.trim() : null,
    findings: Array.isArray(value.findings) ? value.findings : [],
  };
}

function costFields(event) {
  const amountUsd = Number(event.total_cost_usd ?? event.cost_usd);
  const reportedCost = Number.isFinite(amountUsd) && amountUsd > 0;
  // Surface the real token usage the result event carries (previously dropped),
  // so the server can attribute measured tokens — not only a USD amount.
  const usage = event.usage ?? event.message?.usage ?? null;
  const nonNeg = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0);
  return {
    model: event.message?.model ?? event.model ?? "claude",
    reportedCost,
    inputTokens: nonNeg(usage?.input_tokens),
    outputTokens: nonNeg(usage?.output_tokens),
    cachedTokens: nonNeg(usage?.cache_read_input_tokens) + nonNeg(usage?.cache_creation_input_tokens),
    ...(reportedCost ? { amountUsd } : {}),
  };
}

function normalizeFindings(findings) {
  return findings
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      severity: normalizeFindingEnum(item.severity, "medium", ["low", "medium", "high"]),
      file: String(item.file ?? "").trim(),
      line: normalizeLine(item.line),
      message: String(item.message ?? "").trim(),
      suggestion: String(item.suggestion ?? "").trim(),
      confidence: normalizeFindingEnum(item.confidence, "medium", ["low", "medium", "high"]),
    }))
    .filter((item) => item.file && item.message);
}

function normalizeFindingEnum(value, fallback, allowed) {
  const text = String(value ?? fallback).trim();
  return allowed.includes(text) ? text : fallback;
}

function normalizeLine(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function summarizeFindings(findings, summary) {
  if (summary) return summary;
  const high = findings.filter((item) => item.severity === "high").length;
  const medium = findings.filter((item) => item.severity === "medium").length;
  return `Claude review completed with ${findings.length} finding(s), including ${high} high and ${medium} medium.`;
}

// Explain-mode parsing mirrors the review path but extracts `highlights` (what
// changed / why) instead of `findings`. It reuses the same leaf JSON helpers so
// only the object shape differs; the review path above is left untouched.
function parseExplainOutput(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) fail("Claude produced no explanation output.");
  const direct = parseJsonMaybe(text);
  if (direct) return normalizeExplainObject(direct);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let latestCost = {};
  for (const line of lines) {
    const parsed = parseJsonMaybe(line);
    if (parsed?.type === "result" || parsed?.subtype === "success") {
      latestCost = costFields(parsed);
    }
  }
  for (const line of lines.toReversed()) {
    if (line.startsWith("RESULT ")) {
      const result = parseJsonMaybe(line.slice("RESULT ".length));
      if (result) return { ...normalizeExplainObject(result.output ?? result), ...latestCost };
    }
    const parsed = parseJsonMaybe(line);
    const candidate = extractExplainFromClaudeEvent(parsed);
    if (candidate) return { ...normalizeExplainObject(candidate), ...latestCost };
  }
  fail("Claude produced malformed explanation JSON.", { stdoutPreview: text.slice(0, 500) });
}

function extractExplainFromClaudeEvent(event) {
  if (!event || typeof event !== "object") return null;
  if (Array.isArray(event.highlights)) return event;
  const text = event.result
    ?? event.summary
    ?? claudeContentText(event.message?.content)
    ?? claudeContentText(event.content)
    ?? null;
  if (!text) return null;
  return parseJsonFromText(String(text).trim());
}

function normalizeExplainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("Claude explanation output must be an object.");
  }
  return {
    summary: typeof value.summary === "string" ? value.summary.trim() : null,
    highlights: Array.isArray(value.highlights) ? value.highlights : [],
  };
}

function normalizeHighlights(value) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      file: String(item.file ?? "").trim(),
      change: String(item.change ?? "").trim(),
      impact: String(item.impact ?? "").trim(),
    }))
    .filter((item) => item.file && item.change);
}

function summarizeHighlights(highlights) {
  return `Claude explained ${highlights.length} change highlight(s).`;
}

// Propose-mode parsing: extract the proposed { summary, patch, files } object.
// Reuses the same leaf JSON helpers; the review/explain paths are untouched.
function parseProposeOutput(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) fail("Claude produced no proposal output.");
  const direct = parseJsonMaybe(text);
  if (direct) return normalizeProposeObject(direct);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let latestCost = {};
  for (const line of lines) {
    const parsed = parseJsonMaybe(line);
    if (parsed?.type === "result" || parsed?.subtype === "success") {
      latestCost = costFields(parsed);
    }
  }
  for (const line of lines.toReversed()) {
    if (line.startsWith("RESULT ")) {
      const result = parseJsonMaybe(line.slice("RESULT ".length));
      if (result) return { ...normalizeProposeObject(result.output ?? result), ...latestCost };
    }
    const parsed = parseJsonMaybe(line);
    const candidate = extractProposeFromClaudeEvent(parsed);
    if (candidate) return { ...normalizeProposeObject(candidate), ...latestCost };
  }
  fail("Claude produced malformed proposal JSON.", { stdoutPreview: text.slice(0, 500) });
}

function extractProposeFromClaudeEvent(event) {
  if (!event || typeof event !== "object") return null;
  if (typeof event.patch === "string") return event;
  const text = event.result
    ?? event.summary
    ?? claudeContentText(event.message?.content)
    ?? claudeContentText(event.content)
    ?? null;
  if (!text) return null;
  return parseJsonFromText(String(text).trim());
}

function normalizeProposeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("Claude proposal output must be an object.");
  }
  return {
    summary: typeof value.summary === "string" ? value.summary.trim() : null,
    patch: typeof value.patch === "string" ? value.patch : "",
    files: Array.isArray(value.files) ? value.files : [],
  };
}

function normalizePatch(patch) {
  const maxPatchChars = 100000;
  const text = String(patch ?? "");
  return text.length <= maxPatchChars ? text : `${text.slice(0, maxPatchChars)}\n... (patch truncated)`;
}

function normalizeProposedFiles(files, patch) {
  const declared = (Array.isArray(files) ? files : [])
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      path: String(item.path ?? item.file ?? "").trim(),
      action: normalizeFindingEnum(item.action, "modified", ["created", "modified", "deleted"]),
    }))
    .filter((item) => item.path);
  // If the model omitted the file list, recover paths from the diff headers so the
  // artifact always names what it touches.
  if (declared.length) return declared;
  const fromDiff = [...String(patch ?? "").matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => ({
    path: match[1].trim(),
    action: "modified",
  }));
  return fromDiff.filter((item) => item.path);
}

function summarizeProposal(files) {
  return `Claude proposed a patch touching ${files.length} file(s).`;
}

function fail(message, output = {}) {
  console.log(`RESULT ${JSON.stringify({
    summary: message,
    touchedUserFiles: false,
    output: { source: "claude", tool: outputTool, error: message, ...output },
  })}`);
  process.exit(1);
}

function printHelp() {
  console.log(`Usage:
  node tools/agents/claude-review-wrapper.mjs --mode diff-review

Options:
  --claude-cli <path-or-command>
  --cwd <path>
  --instruction <text>
  --severity-floor low|medium|high
`);
}
