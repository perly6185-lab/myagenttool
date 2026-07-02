#!/usr/bin/env node
import { spawn } from "node:child_process";

const REPORTS = {
  daily: ["daily"],
  weekly: ["weekly"],
  monthly: ["monthly"],
  session: ["session"],
  codex_daily: ["codex", "daily"],
  claude_daily: ["claude", "daily"],
};

const options = parseArgs(process.argv.slice(2));
const reportArgs = REPORTS[options.report];
if (!reportArgs) fail(`Unsupported ccusage report: ${options.report}`);
if (!options.ccusageCli) fail("Missing --ccusage-cli path.");

const args = [options.ccusageCli, ...reportArgs, "--json"];
if (options.offline) args.push("--offline");
if (options.since) args.push("--since", options.since);
if (options.until) args.push("--until", options.until);
if (options.timezone) args.push("--timezone", options.timezone);

console.log(`ccusage report started: ${options.report}`);
const { code, stdout, stderr } = await run(process.execPath, args);
for (const line of stderr.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
  console.error(line);
}
if (code !== 0) {
  fail(`ccusage exited with code ${code}.`, { exitCode: code, stderr: stderr.trim() });
}

const report = parseJson(stdout);
console.log(`RESULT ${JSON.stringify({
  summary: summarizeReport(options.report, report),
  touchedUserFiles: false,
  output: {
    source: "ccusage",
    reportId: options.report,
    offline: options.offline,
    filters: {
      since: options.since ?? null,
      until: options.until ?? null,
      timezone: options.timezone ?? null,
    },
    report,
  },
  cost: {
    model: "ccusage",
    billable: false,
    unknown: false,
    amountUsd: 0,
    amountSource: "free_local_tool",
  },
})}`);

function parseArgs(args) {
  const parsed = {
    ccusageCli: null,
    report: "daily",
    offline: true,
    since: null,
    until: null,
    timezone: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--ccusage-cli") {
      parsed.ccusageCli = requireValue(args, ++index, arg);
    } else if (arg === "--report") {
      parsed.report = requireValue(args, ++index, arg);
    } else if (arg === "--since") {
      parsed.since = normalizeDateFilter(requireValue(args, ++index, arg), arg);
    } else if (arg === "--until") {
      parsed.until = normalizeDateFilter(requireValue(args, ++index, arg), arg);
    } else if (arg === "--timezone") {
      parsed.timezone = normalizeTimezone(requireValue(args, ++index, arg));
    } else if (arg === "--online") {
      parsed.offline = false;
    } else if (arg === "--offline") {
      parsed.offline = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      fail(`Unsupported ccusage wrapper argument: ${arg}`);
    }
  }
  return parsed;
}

function requireValue(args, index, name) {
  const value = args[index];
  if (!value || value.startsWith("--")) fail(`Missing value for ${name}.`);
  return value;
}

function normalizeDateFilter(value, name) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail(`${name} must use YYYY-MM-DD.`);
  return text;
}

function normalizeTimezone(value) {
  const text = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_+\-/:.]{1,64}$/.test(text)) fail("--timezone contains unsupported characters.");
  return text;
}

function run(command, args) {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => resolveResult({ code: 127, stdout, stderr: `${stderr}${error.message}` }));
    child.on("close", (code) => resolveResult({ code: code ?? 1, stdout, stderr }));
  });
}

function parseJson(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) fail("ccusage produced no JSON output.");
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`ccusage produced malformed JSON: ${error instanceof Error ? error.message : String(error)}`, {
      stdoutPreview: text.slice(0, 500),
    });
  }
}

function summarizeReport(reportId, report) {
  const rows = Array.isArray(report)
    ? report.length
    : Array.isArray(report?.daily)
      ? report.daily.length
      : Array.isArray(report?.data)
        ? report.data.length
        : null;
  return rows === null
    ? `ccusage ${reportId.replaceAll("_", " ")} report generated.`
    : `ccusage ${reportId.replaceAll("_", " ")} report generated with ${rows} row(s).`;
}

function fail(message, output = {}) {
  console.log(`RESULT ${JSON.stringify({
    summary: message,
    touchedUserFiles: false,
    output: { source: "ccusage", error: message, ...output },
  })}`);
  process.exit(1);
}

function printHelp() {
  console.log(`Usage:
  node tools/agents/ccusage-wrapper.mjs --ccusage-cli <path> --report daily

Reports:
  daily, weekly, monthly, session, codex_daily, claude_daily

Options:
  --since YYYY-MM-DD
  --until YYYY-MM-DD
  --timezone <iana-or-offset>
  --offline
  --online
`);
}
