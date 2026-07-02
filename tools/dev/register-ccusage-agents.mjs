import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { createCcusageAgentRegistration, createCcusageAgentRegistrations } from "../../apps/server/src/services/ccusage-agent.mjs";

const options = parseArgs(process.argv.slice(2));
const serverUrl = options.serverUrl ?? process.env.MYAGENTTOOL_SERVER_URL ?? "http://127.0.0.1:5001";
const cliScriptPath = options.cliScriptPath ?? resolveGlobalCcusageCli();
const registrations = options.all
  ? createCcusageAgentRegistrations({ cliScriptPath, wrapperScriptPath: options.wrapperScriptPath, costOwner: options.costOwner })
  : [createCcusageAgentRegistration({
      reportId: options.report,
      cliScriptPath,
      wrapperScriptPath: options.wrapperScriptPath,
      costOwner: options.costOwner,
    })];

for (const registration of registrations) {
  const response = await fetch(`${serverUrl}/api/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(registration),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Register ${registration.id} failed: ${JSON.stringify(data)}`);
  }
  console.log(`[ccusage] registered ${data.agent.id}: ${data.agent.name}`);
}

function resolveGlobalCcusageCli() {
  const npmRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  return join(npmRoot, "ccusage", "src", "cli.js");
}

function parseArgs(args) {
  const parsed = {
    all: false,
    report: "daily",
    costOwner: "usr_local",
    cliScriptPath: null,
    wrapperScriptPath: "tools/agents/ccusage-wrapper.mjs",
    serverUrl: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--all") {
      parsed.all = true;
    } else if (arg === "--report") {
      parsed.report = args[++index] ?? parsed.report;
    } else if (arg === "--cost-owner") {
      parsed.costOwner = args[++index] ?? parsed.costOwner;
    } else if (arg === "--cli-script") {
      parsed.cliScriptPath = args[++index] ?? parsed.cliScriptPath;
    } else if (arg === "--wrapper-script") {
      parsed.wrapperScriptPath = args[++index] ?? parsed.wrapperScriptPath;
    } else if (arg === "--server-url") {
      parsed.serverUrl = args[++index] ?? parsed.serverUrl;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage:
  node tools/dev/register-ccusage-agents.mjs [--all]
  node tools/dev/register-ccusage-agents.mjs --report daily

Options:
  --all                    Register all fixed ccusage report agents.
  --report <id>            daily, weekly, monthly, session, codex_daily, claude_daily.
  --cost-owner <owner>     Cost owner metadata. Defaults to usr_local.
  --cli-script <path>      Path to ccusage/src/cli.js. Defaults to npm root -g.
  --wrapper-script <path>  Path to ccusage-wrapper.mjs. Defaults to tools/agents/ccusage-wrapper.mjs.
  --server-url <url>       MyAgentTool API server. Defaults to http://127.0.0.1:5001.
`);
}
