// #1147 (ADR 0014): wire app_gmail_send — the write-credential Application that
// holds send authority. Mirrors register-gmail-application.mjs: resolves the
// registered mail SEND agent (an MCP agent allowlisting mail_send) or takes
// --agent-id. The capability is gate-only; registering it does NOT make send
// invokable — MYAGENTTOOL_MAIL_SEND_ENABLED, credential readiness, and a
// per-send single-use grant all still gate execution.
import { createGmailSendApplicationRegistration } from "../../apps/server/src/services/gmail-send-application.mjs";

// Same provider the app_gmail_send descriptor pins in its credential (ADR 0014).
const GMAIL_PROVIDER = "google";

const options = parseArgs(process.argv.slice(2));
const serverUrl = options.serverUrl ?? process.env.MYAGENTTOOL_SERVER_URL ?? "http://127.0.0.1:5001";

let agentId = options.agentId ?? null;
if (!agentId) {
  const stateResponse = await fetch(`${serverUrl}/api/state`);
  const state = await stateResponse.json();
  if (!stateResponse.ok) throw new Error(`Reading server state failed: ${JSON.stringify(state)}`);
  const isMcp = (agent) => agent.type === "mcp" || agent.adapter?.type === "mcp";
  const sendAgents = (state.agents ?? []).filter(
    (agent) => isMcp(agent) && (agent.adapter?.allowedTools ?? []).includes("mail_send"),
  );
  // Guessing matters more here than on the read side: this Application holds send
  // authority (ADR 0014), so a wrong bind points the exfiltration boundary at a
  // mailbox nobody named. `mail_send` says an agent can send, never as whom — so
  // match the declared provider (#1185), and refuse when nothing declares it
  // rather than falling back on the single candidate that happens to be there.
  const candidates = sendAgents.filter((agent) => agent.provider === GMAIL_PROVIDER);
  if (!candidates.length && sendAgents.length) {
    throw new Error(
      `No mail send MCP agent declares provider "${GMAIL_PROVIDER}", but ${sendAgents.length} send-capable `
      + `MCP agent(s) are registered (${sendAgents.map((agent) => `${agent.id} -> provider ${agent.provider ?? "(none)"}`).join(", ")}). `
      + "app_gmail_send holds send authority for a google mailbox; binding it to one of these would send as the wrong account. "
      + "Re-register the Gmail send agent with `provider: \"google\"`, or pass --agent-id <id> to name it deliberately.",
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `Ambiguous: ${candidates.length} mail send MCP agents declare provider "${GMAIL_PROVIDER}" `
      + `(${candidates.map((agent) => agent.id).join(", ")}). `
      + "Pass --agent-id <id> to name the one app_gmail_send delegates to.",
    );
  }
  agentId = candidates[0]?.id ?? null;
}
if (!agentId) {
  throw new Error(
    "No registered mail SEND MCP agent found (and no --agent-id given). "
    + "Register a send-capable mail agent (allowedTools including mail_send) first — "
    + "app_gmail_send delegates to it and cannot exist without it.",
  );
}

const response = await fetch(`${serverUrl}/api/applications/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(createGmailSendApplicationRegistration({ agentId, autoOnline: Boolean(options.online) })),
});
const data = await response.json();
if (!response.ok) throw new Error(`Register Gmail send application failed: ${JSON.stringify(data)}`);
const application = data.application ?? data;
console.log(`[gmail-send] registered application ${application.id}: ${application.name} (${application.status}) -> agent ${agentId}`);

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
