#!/usr/bin/env node
// Governed Codex EDIT wrapper (codex.exec). Runs Codex with edit permission in a
// worktree, then derives the AUTHORITATIVE changeset from git (never the model's
// self-report). Fixed argv, path-locked by isGovernedCodexExecAgent — external
// callers cannot choose cwd, shell args, sandbox, or permission flags.
//
// See docs/engineering/CODEX_EXEC_CONTRACT_DESIGN.md.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

const MAX_DIFF_PREVIEW = 4000;
const MAX_CHANGES = 1000;

const options = parseArgs(process.argv.slice(2));
if (options.mode !== "edit") fail(`Unsupported Codex exec mode: ${options.mode}`);
requireEditCwd(options);

console.log(`Codex exec started: ${options.mode}`);

const prompt = buildPrompt(options);
const commandPlan = codexCommandPlan(options.codexCli, ["exec", prompt]);
const { code, stdout, stderr } = await run(commandPlan.command, commandPlan.args, { cwd: options.cwd });
for (const line of stderr.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
  console.error(line);
}
if (code !== 0) {
  fail(`Codex exited with code ${code}.`, { exitCode: code, stderr: stderr.trim() });
}

// Authoritative changeset: enumerate what actually changed on disk via git, not
// whatever the model claimed. Untracked files are captured too (porcelain "??").
const changes = collectChanges(options.cwd);
const modelSummary = extractModelSummary(stdout);
console.log(`RESULT ${JSON.stringify({
  summary: summarizeChanges(changes, modelSummary),
  touchedUserFiles: changes.length > 0,
  output: {
    source: "codex",
    tool: "codex.exec",
    mode: options.mode,
    task: options.task,
    summary: modelSummary,
    changes,
  },
  cost: {
    model: "codex",
    billable: true,
    unknown: true,
    currency: "USD",
    amountSource: "external_codex_usage",
  },
})}`);

function parseArgs(args) {
  const parsed = {
    mode: "edit",
    codexCli: process.env.MYAGENTTOOL_CODEX_COMMAND || "codex",
    cwd: null,
    task: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--mode") {
      parsed.mode = requireValue(args, ++index, arg);
    } else if (arg === "--codex-cli") {
      parsed.codexCli = requireValue(args, ++index, arg);
    } else if (arg === "--cwd") {
      parsed.cwd = requireValue(args, ++index, arg);
    } else if (arg === "--task") {
      parsed.task = normalizeTask(requireValue(args, ++index, arg));
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      fail(`Unsupported Codex exec wrapper argument: ${arg}`);
    }
  }
  if (!parsed.task) fail("--task is required for Codex exec.");
  return parsed;
}

function requireEditCwd(opts) {
  // Writes must land in an explicit, existing worktree — never the Bridge's own
  // working tree. Same guard the review wrapper enforces; doubly important here
  // because this wrapper WRITES.
  if (!opts.cwd || !isAbsolute(opts.cwd) || !existsSync(opts.cwd)) {
    fail("--cwd must be an absolute path to an existing worktree; refusing to edit an unspecified directory.");
  }
}

function requireValue(args, index, name) {
  const value = args[index];
  if (value === undefined) fail(`Missing value for ${name}.`);
  return value;
}

function normalizeTask(value) {
  const text = String(value ?? "").trim();
  if (text.length > 4000) fail("--task exceeds 4000 characters.");
  return text || null;
}

function buildPrompt(value) {
  return [
    "Make the following code change in the current worktree.",
    value.task,
    "Only edit files within this worktree. Do not run destructive commands.",
  ].filter(Boolean).join("\n");
}

function codexCommandPlan(command, args) {
  const text = String(command ?? "").trim();
  return /\.(mjs|cjs|js)$/i.test(text)
    ? { command: process.execPath, args: [text, ...args] }
    : { command: text, args };
}

function run(command, args, opts) {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
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

function collectChanges(cwd) {
  const porcelain = git(cwd, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (porcelain === null) {
    fail("Unable to read git status in the worktree.");
  }
  const lines = porcelain.split(/\r?\n/).filter((line) => line.length > 0);
  const changes = [];
  for (const line of lines) {
    if (changes.length >= MAX_CHANGES) break;
    const xy = line.slice(0, 2);
    const rawPath = line.slice(3).trim();
    // Renames show "orig -> new"; record the new path.
    const file = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1).trim() : rawPath;
    if (!file) continue;
    const action = actionForStatus(xy);
    changes.push({
      file,
      action,
      diffPreview: diffPreviewFor(cwd, file, action),
      changeRisk: riskForPath(file),
      summary: `${action} ${file}`,
    });
  }
  return changes;
}

function actionForStatus(xy) {
  if (xy === "??") return "created";
  if (xy.includes("D")) return "deleted";
  if (xy.includes("A")) return "created";
  return "modified";
}

function diffPreviewFor(cwd, file, action) {
  const diff = action === "created"
    // Untracked/new files aren't in the index, so --no-index against /dev/null
    // renders their full content as an addition diff.
    ? git(cwd, ["diff", "--no-index", "--", "/dev/null", file], { allowFailure: true })
    : git(cwd, ["diff", "--", file], { allowFailure: true });
  const text = String(diff ?? "").trim();
  if (!text) return null;
  return text.length <= MAX_DIFF_PREVIEW ? text : `${text.slice(0, MAX_DIFF_PREVIEW)}\n... (diff truncated)`;
}

function riskForPath(file) {
  const lowered = file.toLowerCase();
  const highRisk = ["auth", "secret", "credential", "password", "token", ".env", "id_rsa", "private", "package-lock", "pnpm-lock"];
  return highRisk.some((pattern) => lowered.includes(pattern)) ? "high" : "low";
}

function git(cwd, args, { allowFailure = false } = {}) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  // `git diff --no-index` exits 1 when files differ — that's success for us.
  if (result.status !== 0 && !allowFailure) {
    return null;
  }
  return result.stdout ?? "";
}

function extractModelSummary(stdout) {
  const lines = String(stdout ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines.toReversed()) {
    const parsed = parseJsonMaybe(line);
    const text = parsed?.summary ?? parsed?.message?.content ?? parsed?.item?.text ?? null;
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  return null;
}

function parseJsonMaybe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function summarizeChanges(changes, modelSummary) {
  if (!changes.length) return modelSummary ?? "Codex exec completed with no file changes.";
  const high = changes.filter((item) => item.changeRisk === "high").length;
  const base = `Codex exec changed ${changes.length} file(s)`;
  return high ? `${base}, including ${high} high-risk path(s).` : `${base}.`;
}

function fail(message, output = {}) {
  console.log(`RESULT ${JSON.stringify({
    summary: message,
    touchedUserFiles: false,
    output: { source: "codex", tool: "codex.exec", error: message, ...output },
  })}`);
  process.exit(1);
}

function printHelp() {
  console.log(`Usage:
  node tools/agents/codex-exec-wrapper.mjs --mode edit --cwd <worktree> --task <text>

Options:
  --codex-cli <path-or-command>
  --cwd <path>
  --task <text>
`);
}
