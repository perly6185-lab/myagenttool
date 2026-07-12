// Register the canonical git Application (Epic #772, slice #776).
//
// Opt-in — the registry stays conservative (nothing auto-registers at boot).
// POSTs the canonical spec to /api/applications/register, projecting the
// read-only git capability set (status/log/diff_stat/branch_list/head).
//
//   node tools/dev/register-git-application.mjs [--online] [--server-url URL]

import { createGitApplicationRegistration } from "../../apps/server/src/services/git-application.mjs";

const options = parseArgs(process.argv.slice(2));
const serverUrl = options.serverUrl ?? process.env.MYAGENTTOOL_SERVER_URL ?? "http://127.0.0.1:5001";
const body = createGitApplicationRegistration({ autoOnline: Boolean(options.online) });

const response = await fetch(`${serverUrl}/api/applications/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const data = await response.json();
if (!response.ok) {
  throw new Error(`Register git application failed: ${JSON.stringify(data)}`);
}
const app = data.application ?? data;
console.log(`[git] registered application ${app.id}: ${app.name} (${app.source?.wrapper?.commands?.length ?? 0} read-only capabilities)`);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--online") parsed.online = true;
    else if (arg === "--server-url") parsed.serverUrl = argv[++index];
  }
  return parsed;
}
