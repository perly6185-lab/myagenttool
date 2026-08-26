import { resolve } from "node:path";
import {
  createWechatOfficialAgentRegistration,
  createWechatOfficialApplicationRegistration,
  WECHAT_OFFICIAL_AGENT_ID,
  WECHAT_OFFICIAL_APPLICATION_ID,
} from "../../apps/server/src/services/wechat-official-application.mjs";

const serverUrl = process.env.MYAGENTTOOL_SERVER_URL ?? "http://127.0.0.1:5001";
const state = await request("GET", "/api/state");
if (!(state.agents ?? []).some((agent) => agent.id === WECHAT_OFFICIAL_AGENT_ID)) {
  await request("POST", "/api/agents", createWechatOfficialAgentRegistration({
    serverScriptPath: resolve("tools/wechat-official-site/src/server.mjs"),
  }));
}
if (!(state.applications ?? []).some((application) => application.id === WECHAT_OFFICIAL_APPLICATION_ID)) {
  await request("POST", "/api/applications/register", createWechatOfficialApplicationRegistration({ autoOnline: true }));
}
console.log(`[wechat-official] agent ${WECHAT_OFFICIAL_AGENT_ID} and application ${WECHAT_OFFICIAL_APPLICATION_ID} are registered.`);
console.log("[wechat-official] open My settings → Website logins to scan and seed the local publisher session.");

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
