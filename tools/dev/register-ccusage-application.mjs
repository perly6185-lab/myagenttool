// Register the canonical ccusage Application (ADR 0007 / #355 Phase 1).
//
// Opt-in, mirroring register-ccusage-agents.mjs — the registry stays
// conservative (nothing auto-registers at boot). This POSTs the canonical spec
// to /api/applications/register; the ccusage.report tool + agents are unaffected.
//
//   node tools/dev/register-ccusage-application.mjs [--version 20.0.14] [--online]

import { createCcusageApplicationRegistration } from "../../apps/server/src/services/ccusage-application.mjs";

const options = parseArgs(process.argv.slice(2));
const serverUrl = options.serverUrl ?? process.env.MYAGENTTOOL_SERVER_URL ?? "http://127.0.0.1:5001";
const body = createCcusageApplicationRegistration({
  version: options.version,
  autoOnline: Boolean(options.online),
});

const response = await fetch(`${serverUrl}/api/applications/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const data = await response.json();
if (!response.ok) {
  throw new Error(`Register ccusage application failed: ${JSON.stringify(data)}`);
}
const app = data.application ?? data;
console.log(`[ccusage] registered application ${app.id}: ${app.name} (npm ${app.source?.version}, ${app.source?.wrapper?.commands?.length ?? 0} report capabilities)`);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--online") parsed.online = true;
    else if (arg === "--version") parsed.version = argv[++index];
    else if (arg === "--server-url") parsed.serverUrl = argv[++index];
  }
  return parsed;
}
