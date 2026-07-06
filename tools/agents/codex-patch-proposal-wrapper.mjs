#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, extname, isAbsolute, join } from "node:path";

const options = parseArgs(process.argv.slice(2));
if (options.mode !== "patch-proposal") fail(`Unsupported Codex patch proposal mode: ${options.mode}`);
requireProposalCwd(options);
if (!options.goal) fail("--goal is required.");

console.log(`Codex patch proposal started: ${options.mode}`);

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

const proposal = parseProposalOutput(stdout);
const diff = normalizeDiff(proposal.diff);
if (!diff) fail("Codex proposal output must include a unified diff.");
const files = normalizeFiles(proposal.files).slice(0, options.maxFiles);
const droppedFileCount = Math.max(0, normalizeFiles(proposal.files).length - files.length);
const verification = normalizeStringList(proposal.verification);
const patchSha256 = sha256(diff);
const summary = summarizeProposal(proposal.summary, files);
console.log(`RESULT ${JSON.stringify({
  summary,
  touchedUserFiles: false,
  output: {
    source: "codex",
    tool: "codex.propose.patch",
    mode: options.mode,
    goal: options.goal,
    constraints: options.constraints,
    basePlanId: options.basePlanId,
    maxFiles: options.maxFiles,
    summary,
    files,
    diff,
    diffPreview: boundedText(diff, 12000),
    patchSha256,
    verification,
    droppedFileCount,
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
    mode: "patch-proposal",
    codexCli: process.env.MYAGENTTOOL_CODEX_COMMAND || "codex",
    cwd: null,
    goal: null,
    constraints: null,
    basePlanId: null,
    maxFiles: 10,
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
    } else if (arg === "--base-plan-id") {
      parsed.basePlanId = normalizeToken(requireValue(args, ++index, arg), "--base-plan-id", false);
    } else if (arg === "--max-files") {
      parsed.maxFiles = normalizeMaxFiles(requireValue(args, ++index, arg));
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      fail(`Unsupported Codex patch proposal wrapper argument: ${arg}`);
    }
  }
  return parsed;
}

function requireProposalCwd(opts) {
  if (!opts.cwd || !isAbsolute(opts.cwd) || !existsSync(opts.cwd)) {
    fail("--cwd must be an absolute path to an existing worktree; refusing to propose a patch against an unspecified directory.");
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

function normalizeToken(value, name, required) {
  const text = String(value ?? "").trim();
  if (!text && required) fail(`${name} is required.`);
  if (text && !/^[A-Za-z0-9_.:-]{1,120}$/.test(text)) fail(`${name} contains unsupported characters.`);
  return text || null;
}

function normalizeMaxFiles(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 25) {
    fail("--max-files must be an integer from 1 to 25.");
  }
  return number;
}

function buildPrompt(value) {
  return [
    "Generate a patch proposal for the current worktree.",
    "Do not edit files, run apply tools, or change the worktree.",
    "Return JSON only with this shape:",
    "{\"summary\":\"...\",\"files\":[{\"path\":\"path\",\"changeType\":\"add|modify|delete|rename|unknown\",\"risk\":\"low|medium|high\"}],\"diff\":\"unified diff text\",\"verification\":[\"...\"]}",
    "The diff must be a unified diff suitable for human review and later application.",
    `Requested goal: ${value.goal}`,
    value.constraints ? `Constraints: ${value.constraints}` : null,
    value.basePlanId ? `Base change plan id: ${value.basePlanId}` : null,
    `Maximum files: ${value.maxFiles}.`,
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

function parseProposalOutput(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) fail("Codex produced no patch proposal output.");
  const direct = parseJsonMaybe(text);
  if (direct) return normalizeProposalObject(direct);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines.toReversed()) {
    if (line.startsWith("RESULT ")) {
      const result = parseJsonMaybe(line.slice("RESULT ".length));
      if (result) return normalizeProposalObject(result.output ?? result);
    }
    const parsed = parseJsonMaybe(line);
    const candidate = extractProposalFromCodexEvent(parsed);
    if (candidate) return normalizeProposalObject(candidate);
  }
  fail("Codex produced malformed patch proposal JSON.", { stdoutPreview: text.slice(0, 500) });
}

function parseJsonMaybe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractProposalFromCodexEvent(event) {
  if (!event || typeof event !== "object") return null;
  if (typeof event.diff === "string" || typeof event.patch === "string" || typeof event.unifiedDiff === "string") return event;
  const text = event.message?.content
    ?? event.item?.text
    ?? event.item?.content?.[0]?.text
    ?? event.output?.text
    ?? event.response?.output_text
    ?? null;
  if (!text) return null;
  return parseJsonMaybe(String(text).trim());
}

function normalizeProposalObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("Codex patch proposal output must be an object.");
  }
  return {
    summary: typeof value.summary === "string" ? value.summary.trim() : null,
    files: Array.isArray(value.files) ? value.files : [],
    diff: typeof value.diff === "string" ? value.diff : typeof value.patch === "string" ? value.patch : typeof value.unifiedDiff === "string" ? value.unifiedDiff : "",
    verification: Array.isArray(value.verification) ? value.verification : [],
  };
}

function normalizeFiles(files) {
  return (Array.isArray(files) ? files : [])
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      path: String(item.path ?? "").trim(),
      changeType: normalizeEnum(item.changeType, "unknown", ["add", "modify", "delete", "rename", "unknown"]),
      risk: normalizeEnum(item.risk, "medium", ["low", "medium", "high"]),
    }))
    .filter((item) => item.path);
}

function normalizeDiff(value) {
  const text = String(value ?? "").replace(/\r\n/g, "\n").trim();
  return text || null;
}

function normalizeStringList(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, 50);
}

function normalizeEnum(value, fallback, allowed) {
  const text = String(value ?? fallback).trim();
  return allowed.includes(text) ? text : fallback;
}

function boundedText(text, maxLength) {
  const value = String(text ?? "");
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function sha256(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

function summarizeProposal(summary, files) {
  if (summary) return summary;
  return `Codex patch proposal completed for ${files.length} file(s).`;
}

function fail(message, output = {}) {
  console.log(`RESULT ${JSON.stringify({
    summary: message,
    touchedUserFiles: false,
    output: { source: "codex", tool: "codex.propose.patch", error: message, ...output },
  })}`);
  process.exit(1);
}

function printHelp() {
  console.log(`Usage:
  node tools/agents/codex-patch-proposal-wrapper.mjs --mode patch-proposal

Options:
  --codex-cli <path-or-command>
  --cwd <path>
  --goal <text>
  --constraints <text>
  --base-plan-id <id>
  --max-files <number>
`);
}
