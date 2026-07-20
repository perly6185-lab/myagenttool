// Register the canonical OfficeCLI Application (read-only slice, P1).
//
// Opt-in — the registry stays conservative (nothing auto-registers at boot).
// This POSTs the canonical spec to /api/applications/register, projecting the
// OfficeCLI read verbs (get/query/view/validate/dump) as governed, read-only
// bin-wrapper capabilities. Write verbs are a separate, security-reviewed slice.
//
//   node tools/dev/register-officecli-application.mjs [--online] [--server-url http://127.0.0.1:5001]

import { createOfficecliApplicationRegistration } from "../../apps/server/src/services/officecli-application.mjs";

const options = parseArgs(process.argv.slice(2));
const serverUrl = options.serverUrl ?? process.env.MYAGENTTOOL_SERVER_URL ?? "http://127.0.0.1:5001";
const body = createOfficecliApplicationRegistration({ autoOnline: Boolean(options.online) });

const response = await fetch(`${serverUrl}/api/applications/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const data = await response.json();
if (!response.ok) {
  throw new Error(`Register OfficeCLI application failed: ${JSON.stringify(data)}`);
}
const app = data.application ?? data;
console.log(
  `[officecli] registered application ${app.id}: ${app.name} ` +
    `(${app.source?.wrapper?.commands?.length ?? 0} read capabilities)`,
);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--online") parsed.online = true;
    else if (arg === "--server-url") parsed.serverUrl = argv[++index];
  }
  return parsed;
}
