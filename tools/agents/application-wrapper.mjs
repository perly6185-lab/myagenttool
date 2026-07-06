#!/usr/bin/env node
// Application-capability wrapper runner (#359, ADR 0007).
//
// The bridge runs this as a fixed, allowlisted agent command. The SERVER
// resolves an approved+registered npm-wrapper command from the application's own
// source and injects it here via repeated `--exec-arg` flags — each a separate
// argv element, never a shell string, so there is no argv/shell injection.
//
// Defense-in-depth: this runner independently refuses a missing command, a
// command that could be read as a flag (leading "-"), or a shell request. It
// only ever spawns the exact command + args it was handed, with no shell.
//
//   node application-wrapper.mjs --capability app.x.wrapper.daily \
//     --exec-command ccusage --exec-arg daily --exec-arg --json [--cwd DIR]

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, extname, join } from "node:path";

// Cap captured output so a runaway command can't OOM the runner or produce a
// RESULT line too large for the consumer's line buffer. Once exceeded we stop
// accumulating and terminate the child (truncated output still yields a
// well-formed RESULT via the non-JSON fallback).
const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;

const options = parseArgs(process.argv.slice(2));
if (!options.execCommand) fail("Missing --exec-command.");
if (options.execCommand.startsWith("-")) fail("--exec-command must be a program, not a flag.");

const { code, stdout, stderr } = await run(options.execCommand, options.execArgs, options.cwd);
for (const line of stderr.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
  console.error(line);
}
if (code !== 0) {
  fail(`Application wrapper command exited with code ${code}.`, { exitCode: code, stderr: stderr.trim().slice(0, 2000) });
}

let output = stdout.trim();
try {
  output = JSON.parse(stdout);
} catch {
  // Non-JSON stdout is kept as bounded text; not every wrapper emits JSON.
  output = { text: stdout.trim().slice(0, 20000) };
}
console.log(`RESULT ${JSON.stringify({
  summary: `Application wrapper ${options.capability ?? options.execCommand} completed.`,
  touchedUserFiles: false,
  output: {
    source: "application",
    capability: options.capability ?? null,
    command: options.execCommand,
    report: output,
  },
  cost: { model: "application_wrapper", billable: false, unknown: false, amountUsd: 0, amountSource: "free_local_tool" },
})}`);

function parseArgs(args) {
  const parsed = { capability: null, execCommand: null, execArgs: [], cwd: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--capability") parsed.capability = requireValue(args, ++index, arg);
    // Consume the value even if it looks like a flag, then let the explicit
    // leading-"-" guard below reject it with a clear message (the real boundary).
    else if (arg === "--exec-command") parsed.execCommand = requireValueAllowingFlags(args, ++index, arg);
    else if (arg === "--exec-arg") parsed.execArgs.push(requireValueAllowingFlags(args, ++index, arg));
    else if (arg === "--cwd") parsed.cwd = requireValue(args, ++index, arg);
    else if (arg === "--help" || arg === "-h") { printHelp(); process.exit(0); }
    else fail(`Unsupported application wrapper argument: ${arg}`);
  }
  return parsed;
}

// --exec-command / --capability / --cwd take a plain value (never a flag).
function requireValue(args, index, name) {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) fail(`Missing value for ${name}.`);
  return value;
}

// --exec-arg values MAY legitimately be flags (e.g. "--json"); consume exactly
// one following token. Each becomes its own argv element to the spawned command.
function requireValueAllowingFlags(args, index, name) {
  const value = args[index];
  if (value === undefined) fail(`Missing value for ${name}.`);
  return value;
}

function run(command, args, cwd) {
  return new Promise((resolveResult) => {
    const resolved = resolveSpawnCommand(command, args);
    const child = spawn(resolved.command, resolved.args, {
      cwd: cwd || process.cwd(),
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    const cap = (current, chunk) => {
      if (truncated) return current;
      const next = current + chunk.toString("utf8");
      if (next.length > MAX_CAPTURE_BYTES) {
        truncated = true;
        try { child.kill("SIGKILL"); } catch { /* already gone */ }
        return next.slice(0, MAX_CAPTURE_BYTES);
      }
      return next;
    };
    child.stdout.on("data", (chunk) => { stdout = cap(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = cap(stderr, chunk); });
    child.on("error", (error) => resolveResult({ code: 127, stdout, stderr: `${stderr}${error.message}` }));
    child.on("close", (code) => resolveResult({ code: truncated ? 1 : (code ?? 1), stdout, stderr }));
  });
}

function resolveSpawnCommand(command, args) {
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

function printHelp() {
  console.log("Usage: application-wrapper.mjs --exec-command CMD [--exec-arg VALUE]... [--cwd DIR] [--capability NAME]");
}

function fail(message, extra = {}) {
  console.log(`RESULT ${JSON.stringify({
    summary: message,
    touchedUserFiles: false,
    error: message,
    output: { source: "application", ...extra },
    cost: { model: "application_wrapper", billable: false, unknown: false, amountUsd: 0, amountSource: "free_local_tool" },
  })}`);
  process.exit(1);
}
