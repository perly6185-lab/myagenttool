import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { ensureMailApplication } from "../../apps/electron/src/mail-account-connector.mjs";

const serverUrl = process.env.MYAGENTTOOL_SERVER_URL ?? "http://127.0.0.1:5001";
const runtimeRoot = resolve(process.cwd());
const applicationId = await ensureMailApplication({ requestServer: request, runtimeRoot, nodeCommand: process.execPath });
const readinessDir = process.env.BRIDGE_CREDENTIAL_DIR
  ?? (process.env.APPDATA ? join(process.env.APPDATA, "myagenttool", "credential-readiness") : null);
if (!readinessDir) throw new Error("credential readiness directory is unavailable");
const existing = existsSync(join(readinessDir, "app_163_mail_v2.json"))
  ? JSON.parse(readFileSync(join(readinessDir, "app_163_mail_v2.json"), "utf8"))
  : {};
const target = join(readinessDir, `${applicationId}.json`);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify({
  applicationId,
  provider: "netease",
  scope: "imap.readonly",
  obtainedAt: existing.obtainedAt ?? new Date().toISOString(),
}, null, 2)}\n`, { mode: 0o600 });
console.log(`[163-mail] lightweight body prefetch ready on ${applicationId}`);

async function request(method, path, body) {
  const response = await fetch(`${serverUrl}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${method} ${path} failed: ${JSON.stringify(data)}`);
  return data;
}
