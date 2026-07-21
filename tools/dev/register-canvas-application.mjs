// Register the built-in Canvas Application (Epic #1350, #1353).
//
// Opt-in — the registry stays conservative (nothing auto-registers at boot).
// Canvas needs no install and no Desktop Bridge: registering it projects the 7
// governed scene capabilities (list/get/create/add_elements/update_elements/
// remove_elements/export), ready via the in-process Application Control agent.
//
//   node tools/dev/register-canvas-application.mjs [--online] [--server-url URL]

import { createCanvasApplicationRegistration } from "../../apps/server/src/services/canvas-application.mjs";

const options = parseArgs(process.argv.slice(2));
const serverUrl = options.serverUrl ?? process.env.MYAGENTTOOL_SERVER_URL ?? "http://127.0.0.1:5001";
const body = createCanvasApplicationRegistration({ autoOnline: Boolean(options.online) });

const response = await fetch(`${serverUrl}/api/applications/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const data = await response.json();
if (!response.ok) {
  throw new Error(`Register canvas application failed: ${JSON.stringify(data)}`);
}
const app = data.application ?? data;
console.log(`[canvas] registered application ${app.id}: ${app.name} (built-in; 7 governed capabilities)`);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--online") parsed.online = true;
    else if (arg === "--server-url") parsed.serverUrl = argv[++index];
  }
  return parsed;
}
