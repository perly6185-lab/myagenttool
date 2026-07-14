import { createClaudeApplicationRegistration } from "../../apps/server/src/services/claude-application.mjs";

const options = parseArgs(process.argv.slice(2));
const serverUrl = options.serverUrl ?? process.env.MYAGENTTOOL_SERVER_URL ?? "http://127.0.0.1:5001";
const response = await fetch(`${serverUrl}/api/applications/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(createClaudeApplicationRegistration({ autoOnline: Boolean(options.online) })),
});
const data = await response.json();
if (!response.ok) throw new Error(`Register Claude application failed: ${JSON.stringify(data)}`);
const application = data.application ?? data;
console.log(`[claude] registered application ${application.id}: ${application.name} (${application.status})`);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--online") parsed.online = true;
    else if (arg === "--server-url") parsed.serverUrl = argv[++index];
  }
  return parsed;
}
