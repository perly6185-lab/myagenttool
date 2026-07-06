#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, extname, isAbsolute, join } from "node:path";

const options = parseArgs(process.argv.slice(2));
if (options.mode !== "change-plan") fail(`Unsupported Codex plan mode: ${options.mode}`);
requirePlanCwd(options);
if (!options.goal) fail("--goal is required.");

console.log(`Codex plan started: ${options.mode}`);

const prompt = buildPrompt(options);
const commandPlan = codexCommandPlan(options.codexCli, ["exec", "--sandbox", "read-only", "--json", prompt]);
const { code, stdout, stderr } = await run(commandPlan.command, commandPlan.args, {
  cwd: options.cwd,
});
for (const line of stderr.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
  console.error(line);
}
if (code !== 0) {
  fail(`Codex exited with code ${code}.`, { exitCode: code, stderr: stderr.trim() });
}

const plan = parsePlanOutput(stdout);
const steps = normalizeSteps(plan.steps);
const openQuestions = normalizeStringList(plan.openQuestions);
const verification = normalizeStringList(plan.verification);
const summary = summarizePlan(plan.summary, steps, openQuestions);
console.log(`RESULT ${JSON.stringify({
  summary,
  touchedUserFiles: false,
  output: {
    source: "codex",
    tool: "codex.plan.change",
    mode: options.mode,
    severityFloor: options.severityFloor,
    goal: options.goal,
    constraints: options.constraints,
    summary,
    steps,
    openQuestions,
    verification,
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
    mode: "change-plan",
    codexCli: process.env.MYAGENTTOOL_CODEX_COMMAND || "codex",
    cwd: null,
    goal: null,
    constraints: null,
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
    } else if (arg === "--goal") {
      parsed.goal = normalizeBoundedText(requireValue(args, ++index, arg), "--goal", 2000, true);
    } else if (arg === "--constraints") {
      parsed.constraints = normalizeBoundedText(requireValue(args, ++index, arg), "--constraints", 2000, false);
    } else if (arg === "--severity-floor") {
      parsed.severityFloor = normalizeSeverity(requireValue(args, ++index, arg));
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      fail(`Unsupported Codex plan wrapper argument: ${arg}`);
    }
  }
  return parsed;
}

function requirePlanCwd(opts) {
  if (!opts.cwd || !isAbsolute(opts.cwd) || !existsSync(opts.cwd)) {
    fail("--cwd must be an absolute path to an existing worktree; refusing to plan against an unspecified directory.");
  }
}

function requireValue(args, index, name) {
  const value = args[index];
  if (value === undefined) fail(`Missing value for ${name}.`);
  return value;
}

function normalizeBoundedText(value, name, maxLength, required) {
  const text = String(value ?? "").trim();
  if (!text && required) fail(`${name} is required.`);
  if (text.length > maxLength) fail(`${name} exceeds ${maxLength} characters.`);
  return text || null;
}

function normalizeSeverity(value) {
  const text = String(value ?? "").trim();
  if (!["low", "medium", "high"].includes(text)) fail("--severity-floor must be low, medium, or high.");
  return text;
}

function buildPrompt(value) {
  return [
    "Plan the requested code change for the current worktree.",
    "Do not edit files, run apply tools, or change the worktree.",
    "Return JSON only with this shape:",
    "{\"summary\":\"...\",\"steps\":[{\"title\":\"...\",\"rationale\":\"...\",\"files\":[\"path\"],\"risk\":\"low|medium|high\"}],\"openQuestions\":[\"...\"],\"verification\":[\"...\"]}",
    `Requested goal: ${value.goal}`,
    value.constraints ? `Constraints: ${value.constraints}` : null,
    `Risk attention floor: ${value.severityFloor}.`,
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

function parsePlanOutput(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) fail("Codex produced no plan output.");
  const direct = parseJsonMaybe(text);
  if (direct) return normalizePlanObject(direct);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines.toReversed()) {
    if (line.startsWith("RESULT ")) {
      const result = parseJsonMaybe(line.slice("RESULT ".length));
      if (result) return normalizePlanObject(result.output ?? result);
    }
    const parsed = parseJsonMaybe(line);
    const candidate = extractPlanFromCodexEvent(parsed);
    if (candidate) return normalizePlanObject(candidate);
  }
  fail("Codex produced malformed plan JSON.", { stdoutPreview: text.slice(0, 500) });
}

function parseJsonMaybe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractPlanFromCodexEvent(event) {
  if (!event || typeof event !== "object") return null;
  if (Array.isArray(event.steps)) return event;
  const text = event.message?.content
    ?? event.item?.text
    ?? event.item?.content?.[0]?.text
    ?? event.output?.text
    ?? event.response?.output_text
    ?? null;
  if (!text) return null;
  return parseJsonMaybe(String(text).trim());
}

function normalizePlanObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("Codex plan output must be an object.");
  }
  return {
    summary: typeof value.summary === "string" ? value.summary.trim() : null,
    steps: Array.isArray(value.steps) ? value.steps : [],
    openQuestions: Array.isArray(value.openQuestions) ? value.openQuestions : [],
    verification: Array.isArray(value.verification) ? value.verification : [],
  };
}

function normalizeSteps(steps) {
  return steps
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      title: String(item.title ?? "").trim(),
      rationale: String(item.rationale ?? "").trim(),
      files: normalizeStringList(item.files).slice(0, 25),
      risk: normalizeFindingEnum(item.risk, "medium", ["low", "medium", "high"]),
    }))
    .filter((item) => item.title);
}

function normalizeStringList(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, 50);
}

function normalizeFindingEnum(value, fallback, allowed) {
  const text = String(value ?? fallback).trim();
  return allowed.includes(text) ? text : fallback;
}

function summarizePlan(summary, steps, openQuestions) {
  if (summary) return summary;
  return `Codex plan completed with ${steps.length} step(s) and ${openQuestions.length} open question(s).`;
}

function fail(message, output = {}) {
  console.log(`RESULT ${JSON.stringify({
    summary: message,
    touchedUserFiles: false,
    output: { source: "codex", tool: "codex.plan.change", error: message, ...output },
  })}`);
  process.exit(1);
}

function printHelp() {
  console.log(`Usage:
  node tools/agents/codex-plan-wrapper.mjs --mode change-plan

Options:
  --codex-cli <path-or-command>
  --cwd <path>
  --goal <text>
  --constraints <text>
  --severity-floor low|medium|high
`);
}
