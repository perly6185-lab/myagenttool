// #1145 (#979): wire app_gmail. Unlike git/ccusage/claude, gmail is NOT in the
// quick-register catalog on purpose — quick-register resolves name-known
// binary/npm software, while app_gmail requires the id of a LIVE registered
// mail MCP agent (#976) to delegate its agent_facades to. This script is the
// wiring path: resolve that agent (or take --agent-id), then register the
// Application. Credentials never touch this path (ADR 0010) — readiness is
// reported by the Desktop Bridge separately.
import { createGmailApplicationRegistration } from "../../apps/server/src/services/gmail-application.mjs";

// The provider app_gmail's descriptor pins in `credential { provider: google }`.
// Discovery matches the agent that declares the SAME provider, so the mailbox
// read is the mailbox the Application says it reads.
const GMAIL_PROVIDER = "google";

const options = parseArgs(process.argv.slice(2));
const serverUrl = options.serverUrl ?? process.env.MYAGENTTOOL_SERVER_URL ?? "http://127.0.0.1:5001";

let agentId = options.agentId ?? null;
if (!agentId) {
  const stateResponse = await fetch(`${serverUrl}/api/state`);
  const state = await stateResponse.json();
  if (!stateResponse.ok) throw new Error(`Reading server state failed: ${JSON.stringify(state)}`);
  const isMcp = (agent) => agent.type === "mcp" || agent.adapter?.type === "mcp";
  const mailAgents = (state.agents ?? []).filter(
    (agent) => isMcp(agent)
      && (agent.capabilities ?? []).some((capability) => (capability?.name ?? capability) === "mail.read"),
  );
  // `mail.read` says an agent reads SOME mailbox, never whose. Counting matches
  // was the old shape (#1176) and it could only catch the >=2 case — with one
  // NetEase agent and nothing else, app_gmail was wired to it, silently, exit 0
  // (#1185). So match on the provider the agent declares (#1185), which is the
  // only positive Gmail evidence that exists, and treat "declares nothing" as
  // "not a match" rather than as a match by default.
  const candidates = mailAgents.filter((agent) => agent.provider === GMAIL_PROVIDER);
  if (!candidates.length && mailAgents.length) {
    throw new Error(
      `No mail MCP agent declares provider "${GMAIL_PROVIDER}", but ${mailAgents.length} mail `
      + `MCP agent(s) are registered (${mailAgents.map((agent) => `${agent.id} -> provider ${agent.provider ?? "(none)"}`).join(", ")}). `
      + `app_gmail reads a ${GMAIL_PROVIDER} mailbox (ADR 0010), so wiring it to one of these would read the wrong mailbox `
      + "under Gmail's identity. Re-register the Gmail mail agent with `provider: \"google\"`, or pass --agent-id <id> to name it deliberately.",
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `Ambiguous: ${candidates.length} mail MCP agents declare provider "${GMAIL_PROVIDER}" `
      + `(${candidates.map((agent) => agent.id).join(", ")}). `
      + "Pass --agent-id <id> to name the one app_gmail delegates to.",
    );
  }
  agentId = candidates[0]?.id ?? null;
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
