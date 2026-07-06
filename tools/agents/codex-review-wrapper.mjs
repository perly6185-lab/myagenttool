#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, extname, isAbsolute, join } from "node:path";

const options = parseArgs(process.argv.slice(2));
if (options.mode !== "diff-review") fail(`Unsupported Codex review mode: ${options.mode}`);
requireReviewCwd(options);

console.log(`Codex review started: ${options.mode}`);

const prompt = buildPrompt(options);
const commandPlan = codexCommandPlan(options.codexCli, ["exec", "--json", prompt]);
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
const findings = normalizeFindings(review.findings);
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
  },
  cost: {
    model: "codex",
    billable: true,
    unknown: true,
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
  const scriptPlan = /\.(mjs|cjs|js)$/i.test(text)
    ? { command: process.execPath, args: [text, ...args] }
    : { command: text, args };
  return resolveWindowsNpmShim(scriptPlan.command, scriptPlan.args);
}

function resolveWindowsNpmShim(command, args) {
  if (process.platform !== "win32") return { command, args };
  const shim = findWindowsNpmCmdShim(command);
  if (!shim) return { command, args };
  const target = npmCmdShimTarget(shim);
  return target ? { command: process.execPath, args: [target, ...args] } : { command, args };
}

function findWindowsNpmCmdShim(command) {
  const text = String(command ?? "").trim();
  if (!text || extname(text)) return null;
  const hasDirectory = /[\\/]/.test(text);
  const candidates = hasDirectory
    ? [`${text}.cmd`]
    : (process.env.PATH ?? "")
      .split(delimiter)
      .filter(Boolean)
      .map((dir) => join(dir, `${text}.cmd`));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function npmCmdShimTarget(shimPath) {
  let text = "";
  try {
    text = readFileSync(shimPath, "utf8");
  } catch {
    return null;
  }
  const match = text.match(/"%dp0%\\([^"]+?\.js)"/i);
  if (!match) return null;
  const target = join(dirname(shimPath), match[1]);
  return existsSync(target) ? target : null;
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
  if (direct) return normalizeReviewObject(direct);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines.toReversed()) {
    if (line.startsWith("RESULT ")) {
      const result = parseJsonMaybe(line.slice("RESULT ".length));
      if (result) return normalizeReviewObject(result.output ?? result);
    }
    const parsed = parseJsonMaybe(line);
    const candidate = extractReviewFromCodexEvent(parsed);
    if (candidate) return normalizeReviewObject(candidate);
  }
  fail("Codex produced malformed review JSON.", { stdoutPreview: text.slice(0, 500) });
}

function parseJsonMaybe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
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
  return parseJsonMaybe(String(text).trim());
}

function normalizeReviewObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("Codex review output must be an object.");
  }
  return {
    summary: typeof value.summary === "string" ? value.summary.trim() : null,
    findings: Array.isArray(value.findings) ? value.findings : [],
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
