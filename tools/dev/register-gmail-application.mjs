// #1145 (#979): wire app_gmail. Unlike git/ccusage/claude, gmail is NOT in the
// quick-register catalog on purpose — quick-register resolves name-known
// binary/npm software, while app_gmail requires the id of a LIVE registered
// mail MCP agent (#976) to delegate its agent_facades to. This script is the
// wiring path: resolve that agent (or take --agent-id), then register the
// Application. Credentials never touch this path (ADR 0010) — readiness is
// reported by the Desktop Bridge separately.
import { createGmailApplicationRegistration } from "../../apps/server/src/services/gmail-application.mjs";

const options = parseArgs(process.argv.slice(2));
const serverUrl = options.serverUrl ?? process.env.MYAGENTTOOL_SERVER_URL ?? "http://127.0.0.1:5001";

let agentId = options.agentId ?? null;
if (!agentId) {
  const stateResponse = await fetch(`${serverUrl}/api/state`);
  const state = await stateResponse.json();
  if (!stateResponse.ok) throw new Error(`Reading server state failed: ${JSON.stringify(state)}`);
  const isMcp = (agent) => agent.type === "mcp" || agent.adapter?.type === "mcp";
  const mailAgent = (state.agents ?? []).find(
    (agent) => isMcp(agent)
      && (agent.capabilities ?? []).some((capability) => (capability?.name ?? capability) === "mail.read"),
  ) ?? (state.agents ?? []).find((agent) => isMcp(agent) && /mail/i.test(agent.name ?? ""));
  agentId = mailAgent?.id ?? null;
}
if (!agentId) {
  throw new Error(
    "No registered read-only mail MCP agent found (and no --agent-id given). "
    + "Register the mail agent first (#976: POST /api/agents with the mcp mail registration) — "
    + "app_gmail delegates to it and cannot exist without it.",
  );
}

const response = await fetch(`${serverUrl}/api/applications/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(createGmailApplicationRegistration({ agentId, autoOnline: Boolean(options.online) })),
});
const data = await response.json();
if (!response.ok) throw new Error(`Register Gmail application failed: ${JSON.stringify(data)}`);
const application = data.application ?? data;
console.log(`[gmail] registered application ${application.id}: ${application.name} (${application.status}) -> agent ${agentId}`);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--online") parsed.online = true;
    else if (arg === "--server-url") parsed.serverUrl = argv[++index];
    else if (arg === "--agent-id") parsed.agentId = argv[++index];
  }
  return parsed;
}
