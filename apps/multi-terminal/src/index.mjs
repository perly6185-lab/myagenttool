import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createCompositionService } from "./composition.mjs";
import { materializeTerminal, TerminalRegistry } from "./registry.mjs";
import { RecoveryHistory } from "./recovery-history.mjs";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const port = Number(process.env.MULTI_TERMINAL_PORT ?? 4311);
const seed = JSON.parse(process.env.MULTI_TERMINALS_JSON ?? "[]");
const registry = new TerminalRegistry(process.env.MULTI_TERMINAL_REGISTRY_PATH ?? ".myagenttool/multi-terminals.json", { seed });
await registry.load();
const recoveryHistory = new RecoveryHistory(process.env.MULTI_TERMINAL_RECOVERY_PATH ?? ".myagenttool/multi-terminal-recovery.json");
await recoveryHistory.load();

function terminalRequest(terminal, operation) {
  const url = new URL(operation.path, terminal.apiUrl);
  const headers = { accept: "application/json", "content-type": "application/json" };
  if (terminal.observerToken) headers.authorization = `Bearer ${terminal.observerToken}`;
  return fetch(url, { method: operation.method, headers, body: operation.body ? JSON.stringify(operation.body) : undefined, signal: AbortSignal.timeout(5_000) });
}

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const terminals = registry.list().map((row) => materializeTerminal(row));
    const service = createCompositionService({ terminals, request: terminalRequest });
    if (req.method === "GET" && requestUrl.pathname === "/api/overview") {
      const overview = await service.overview();
      await recoveryHistory.observe(overview.terminals);
      const windowDays = Number(requestUrl.searchParams.get("windowDays") ?? 30);
      overview.recoveryHistory = Object.fromEntries(overview.terminals.map((terminal) => [terminal.id, recoveryHistory.summary(terminal.id, windowDays)]));
      return json(res, 200, overview);
    }
    if (req.method === "GET" && requestUrl.pathname === "/api/terminals") {
      return json(res, 200, { terminals: registry.list().map(({ observerTokenEnv: _secretRef, ...row }) => row) });
    }
    if (req.method === "POST" && requestUrl.pathname === "/api/terminals") {
      if (!adminAuthorized(req)) return json(res, 401, { error: "admin_token_required" });
      return json(res, 201, { terminal: await registry.upsert(await readBody(req)) });
    }
    const terminalRegistration = requestUrl.pathname.match(/^\/api\/terminals\/([^/]+)$/);
    if (req.method === "DELETE" && terminalRegistration) {
      if (!adminAuthorized(req)) return json(res, 401, { error: "admin_token_required" });
      const removed = await registry.remove(decodeURIComponent(terminalRegistration[1]));
      return json(res, removed ? 200 : 404, { removed });
    }
    const action = requestUrl.pathname.match(/^\/api\/terminals\/([^/]+)\/(invocations|application-runs|deliveries|applications)\/([^/]+)\/(cancel|retry|replay|maintenance)$/);
    if (req.method === "POST" && action) {
      const body = await readBody(req);
      const result = await service.proxyAction({
        terminalId: decodeURIComponent(action[1]), resourceType: action[2],
        localResourceId: decodeURIComponent(action[3]), action: action[4], body,
      });
      return json(res, result.status, result);
    }
    if (req.method !== "GET" || !["/", "/index.html", "/app.js", "/styles.css"].includes(requestUrl.pathname)) {
      return json(res, 404, { error: "not_found" });
    }
    const file = requestUrl.pathname === "/app.js" ? "app.js" : requestUrl.pathname === "/styles.css" ? "styles.css" : "index.html";
    const type = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html";
    res.writeHead(200, {
      "content-type": `${type}; charset=utf-8`,
      "cache-control": "no-store",
      "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    res.end(await readFile(new URL(file, `file://${publicDir}/`)));
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : "request failed" });
  }
});

function json(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

function adminAuthorized(req) {
  const expected = String(process.env.MULTI_TERMINAL_ADMIN_TOKEN ?? "");
  const supplied = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (expected.length < 24 || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

server.listen(port, "127.0.0.1", () => console.log(`Multi-terminal console: http://127.0.0.1:${port}`));
