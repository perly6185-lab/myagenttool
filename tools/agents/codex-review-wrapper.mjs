#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const reviewOutputSchemaPath = resolve(dirname(fileURLToPath(import.meta.url)), "codex-review-output.schema.json");

const options = parseArgs(process.argv.slice(2));
if (options.mode !== "diff-review") fail(`Unsupported Codex review mode: ${options.mode}`);
requireReviewCwd(options);

console.log(`Codex review started: ${options.mode}`);

const prompt = buildPrompt(options);
const commandArgs = options.baseRef
  // Pin the native review sandbox explicitly. On Windows the implicit native
  // review default can inherit workspace-write and leave inspection artifacts
  // in the delivery worktree. Codex forbids a custom prompt with --base, so the
  // task context remains in the delivery report.
  ? ["exec", "review", "-c", 'sandbox_mode="read-only"', "--base", options.baseRef, "--ephemeral", "-c", "model_reasoning_effort=low", "--output-schema", reviewOutputSchemaPath, "--json"]
  : ["exec", "--sandbox", "read-only", "--ephemeral", "--json", "-c", "model_reasoning_effort=low", prompt];
const commandPlan = codexCommandPlan(options.codexCli, commandArgs);
const { code, stdout, stderr } = await run(commandPlan.command, commandPlan.args, {
  cwd: options.cwd,
});
for (const line of stderr.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
  console.error(line);
}
if (code !== 0) {
  fail(`Codex exited with code ${code}.`, { exitCode: code, stderr: stderr.trim() });
}

const review = parseReviewOutput(stdout);
const findings = normalizeFindings(review.findings, options.cwd)
  .filter((finding) => severityRank(finding.severity) >= severityRank(options.severityFloor));
console.log(`RESULT ${JSON.stringify({
  summary: summarizeFindings(findings, review.summary),
  touchedUserFiles: false,
  output: {
    source: "codex",
    tool: "codex.review.diff",
    mode: options.mode,
    severityFloor: options.severityFloor,
    instruction: options.instruction,
    summary: review.summary ?? null,
    findings,
    verdict: review.overallCorrectness === "patch is correct"
      ? "approved"
      : review.overallCorrectness === "patch is incorrect" || findings.length
        ? "changes_requested"
        : "approved",
    structured: review.structured,
  },
  cost: {
    model: "codex",
    billable: true,
    unknown: true,
    currency: "USD",
    inputTokens: review.inputTokens ?? 0,
    cachedInputTokens: review.cachedInputTokens ?? 0,
    outputTokens: review.outputTokens ?? 0,
    reasoningOutputTokens: review.reasoningOutputTokens ?? 0,
    amountSource: "external_codex_usage",
  },
})}`);

function parseArgs(args) {
  const parsed = {
    mode: "diff-review",
    codexCli: process.env.MYAGENTTOOL_CODEX_COMMAND || "codex",
    cwd: null,
    instruction: null,
    severityFloor: "low",
    baseRef: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--mode") {
      parsed.mode = requireValue(args, ++index, arg);
    } else if (arg === "--codex-cli") {
      parsed.codexCli = requireValue(args, ++index, arg);
    } else if (arg === "--cwd") {
      parsed.cwd = requireValue(args, ++index, arg);
    } else if (arg === "--instruction") {
      parsed.instruction = normalizeInstruction(requireValue(args, ++index, arg));
    } else if (arg === "--severity-floor") {
      parsed.severityFloor = normalizeSeverity(requireValue(args, ++index, arg));
    } else if (arg === "--base-ref") {
      parsed.baseRef = normalizeBaseRef(requireValue(args, ++index, arg));
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      fail(`Unsupported Codex review wrapper argument: ${arg}`);
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

function normalizeSeverity(value) {
  const text = String(value ?? "").trim();
  if (!["low", "medium", "high"].includes(text)) fail("--severity-floor must be low, medium, or high.");
  return text;
}

function normalizeBaseRef(value) {
  const text = String(value ?? "").trim();
  if (!/^[0-9a-f]{40}$/i.test(text)) fail("--base-ref must be a full commit SHA.");
  return text.toLowerCase();
}

function buildPrompt(value) {
  return [
    "Review the current worktree diff for bugs, regressions, and missing tests.",
    "Return JSON only with this shape:",
    "{\"summary\":\"...\",\"findings\":[{\"severity\":\"high|medium|low\",\"file\":\"path\",\"line\":1,\"message\":\"...\",\"suggestion\":\"...\",\"confidence\":\"high|medium|low\"}]}",
    `Only include findings at or above severity floor: ${value.severityFloor}.`,
    value.instruction ? `Additional reviewer instruction: ${value.instruction}` : null,
  ].filter(Boolean).join("\n");
}

function codexCommandPlan(command, args) {
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
  if (!text) fail("Codex produced no review output.");
  const direct = parseJsonMaybe(text);
  if (direct) {
    if (Array.isArray(direct.findings)) return normalizeReviewObject(direct);
    const candidate = extractReviewFromCodexEvent(direct);
    if (candidate) return normalizeReviewObject(candidate);
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  // Capture the turn's real token usage (previously dropped) so the server can
  // attribute measured tokens for the review run.
  let usageTokens = {};
  for (const line of lines) {
    const parsed = parseJsonMaybe(line);
    if (parsed?.type === "turn.completed" && parsed.usage) {
      usageTokens = codexUsageTokens(parsed.usage);
    }
  }
  for (const line of lines.toReversed()) {
    if (line.startsWith("RESULT ")) {
      const result = parseJsonMaybe(line.slice("RESULT ".length));
      if (result) return { ...normalizeReviewObject(result.output ?? result), ...usageTokens };
    }
    const parsed = parseJsonMaybe(line);
    const candidate = extractReviewFromCodexEvent(parsed);
    if (candidate) return { ...normalizeReviewObject(candidate), ...usageTokens };
  }
  fail("Codex produced malformed review JSON.", { stdoutPreview: text.slice(0, 2000) });
}

function codexUsageTokens(usage) {
  const nonNeg = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0);
  return {
    inputTokens: nonNeg(usage?.input_tokens),
    cachedInputTokens: nonNeg(usage?.cached_input_tokens),
    outputTokens: nonNeg(usage?.output_tokens),
    reasoningOutputTokens: nonNeg(usage?.reasoning_output_tokens),
  };
}

function parseJsonMaybe(text) {
  const normalized = String(text ?? "").trim();
  try {
    return JSON.parse(normalized);
  } catch {
    const fenced = normalized.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (!fenced) return null;
    try {
      return JSON.parse(fenced[1]);
    } catch {
      return null;
    }
  }
}

function extractReviewFromCodexEvent(event) {
  if (!event || typeof event !== "object") return null;
  if (Array.isArray(event.findings)) return event;
  const text = event.message?.content
    ?? event.item?.text
    ?? event.item?.content?.[0]?.text
    ?? event.output?.text
    ?? event.response?.output_text
    ?? null;
  if (!text) return null;
  const normalized = String(text).trim();
  return parseJsonMaybe(normalized) ?? {
    summary: normalized,
    findings: [],
    overall_correctness: /(?:^|\b)(?:no\s+(?:actionable\s+)?(?:findings?|issues?|bugs?|regressions?)(?:\s+(?:were\s+)?(?:found|identified|detected))?|patch is correct|looks good)(?:\b|[.!])/i.test(normalized)
      ? "patch is correct"
      : "patch is incorrect",
    __unstructured: true,
  };
}

function normalizeReviewObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("Codex review output must be an object.");
  }
  return {
    summary: typeof value.summary === "string"
      ? value.summary.trim()
      : typeof value.overall_explanation === "string"
        ? value.overall_explanation.trim()
        : null,
    findings: Array.isArray(value.findings) ? value.findings : [],
    overallCorrectness: ["patch is correct", "patch is incorrect"].includes(value.overall_correctness)
      ? value.overall_correctness
      : null,
    structured: value.__unstructured !== true,
  };
}

function normalizeFindings(findings, cwd = null) {
  return findings
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      severity: normalizeFindingSeverity(item),
      file: normalizeFindingPath(item.file ?? item.code_location?.absolute_file_path, cwd),
      line: normalizeLine(item.line ?? item.code_location?.line_range?.start),
      message: String(item.message ?? [item.title, item.body].filter(Boolean).join(": ")).trim(),
      suggestion: String(item.suggestion ?? "").trim(),
      confidence: normalizeFindingConfidence(item),
    }))
    .filter((item) => item.file && item.message);
}

function normalizeFindingSeverity(item) {
  if (["low", "medium", "high"].includes(String(item?.severity))) return String(item.severity);
  const priority = Number(item?.priority);
  if (priority <= 1) return "high";
  if (priority === 2) return "medium";
  if (priority >= 3) return "low";
  return "medium";
}

function normalizeFindingConfidence(item) {
  if (["low", "medium", "high"].includes(String(item?.confidence))) return String(item.confidence);
  const score = Number(item?.confidence_score);
  if (Number.isFinite(score)) return score >= 0.85 ? "high" : score >= 0.6 ? "medium" : "low";
  return "medium";
}

function normalizeFindingPath(value, cwd) {
  const path = String(value ?? "").trim();
  if (!path || !cwd) return "";
  const absolutePath = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  const rel = relative(resolve(cwd), absolutePath);
  const escapes = rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
  return rel && !escapes && !isAbsolute(rel) ? rel.replaceAll("\\", "/") : "";
}

function severityRank(value) {
  return { low: 1, medium: 2, high: 3 }[value] ?? 2;
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
  return `Codex review completed with ${findings.length} finding(s), including ${high} high and ${medium} medium.`;
}

function fail(message, output = {}) {
  console.log(`RESULT ${JSON.stringify({
    summary: message,
    touchedUserFiles: false,
    output: { source: "codex", tool: "codex.review.diff", error: message, ...output },
  })}`);
  process.exit(1);
}

function printHelp() {
  console.log(`Usage:
  node tools/agents/codex-review-wrapper.mjs --mode diff-review

Options:
  --codex-cli <path-or-command>
  --cwd <path>
  --instruction <text>
  --severity-floor low|medium|high
`);
}
