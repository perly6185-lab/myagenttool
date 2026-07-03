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
    const child = spawn(command, args, {
      cwd: cwd || process.cwd(),
      windowsHide: true,
      shell: false,
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
