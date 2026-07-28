import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createCompositionService } from "./composition.mjs";
import { materializeTerminal, TerminalRegistry } from "./registry.mjs";
import { RecoveryHistory } from "./recovery-history.mjs";
import { OwnerOperationRuntime } from "./owner-operation-runtime.mjs";
import { SloMonitor, webhookNotifier } from "./slo-monitor.mjs";
import { AlertManager } from "./alert-manager.mjs";
import { bearerAuthorized, requireSecureDeployment } from "./security.mjs";
import { SafeRecovery } from "./safe-recovery.mjs";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const port = Number(process.env.MULTI_TERMINAL_PORT ?? 4311);
const host = requireSecureDeployment();
const seed = JSON.parse(process.env.MULTI_TERMINALS_JSON ?? "[]");
const registry = new TerminalRegistry(process.env.MULTI_TERMINAL_REGISTRY_PATH ?? ".myagenttool/multi-terminals.json", { seed });
await registry.load();
const recoveryHistory = new RecoveryHistory(process.env.MULTI_TERMINAL_RECOVERY_PATH ?? ".myagenttool/multi-terminal-recovery.json");
await recoveryHistory.load();
const operationRuntime = new OwnerOperationRuntime(process.env.MULTI_TERMINAL_AUDIT_PATH ?? ".myagenttool/multi-terminal-operation-audit.json");
await operationRuntime.load();
const sloMonitor = new SloMonitor(process.env.MULTI_TERMINAL_SLO_PATH ?? ".myagenttool/multi-terminal-slo.json", {
  availabilityTarget: Number(process.env.MULTI_TERMINAL_SLO_AVAILABILITY ?? 99),
  staleTarget: Number(process.env.MULTI_TERMINAL_SLO_STALE ?? 0),
  recoveryTargetHours: Number(process.env.MULTI_TERMINAL_SLO_RECOVERY_HOURS ?? 24),
  operationSuccessTarget: Number(process.env.MULTI_TERMINAL_SLO_OPERATION_SUCCESS ?? 95),
  notify: webhookNotifier(process.env.MULTI_TERMINAL_ALERT_WEBHOOK_URL ?? ""),
});
await sloMonitor.load();
const alertManager = new AlertManager(process.env.MULTI_TERMINAL_ALERT_PATH ?? ".myagenttool/multi-terminal-alerts.json", {
  notify: webhookNotifier(process.env.MULTI_TERMINAL_ALERT_WEBHOOK_URL ?? ""),
});
await alertManager.load();
const adminSessions = new Map();
const service = createCompositionService({
  terminals: () => registry.list().map((row) => materializeTerminal(row)),
  request: terminalRequest,
  operationRuntime,
});
const safeRecovery = new SafeRecovery({ enabled: process.env.MULTI_TERMINAL_SAFE_AUTO_RECOVERY === "true", service });
const streamClients = new Set();

function terminalRequest(terminal, operation) {
  const url = new URL(operation.path, terminal.apiUrl);
  const headers = { accept: "application/json", "content-type": "application/json" };
  if (operation.readOnly && terminal.observerToken) headers.authorization = `Observer ${terminal.observerToken}`;
  else if (terminal.operatorToken) headers.authorization = `Bearer ${terminal.operatorToken}`;
  return fetch(url, { method: operation.method, headers, body: operation.body ? JSON.stringify(operation.body) : undefined, signal: AbortSignal.timeout(5_000) });
}

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (req.method === "GET" && requestUrl.pathname === "/health") {
      return json(res, 200, { status: "ok", service: "myagenttool-multi-terminal", contract: "terminal-observation/v1" });
    }
    if (req.method === "GET" && requestUrl.pathname === "/api/overview") {
      const overview = await service.overview();
      await recoveryHistory.observe(overview.terminals);
      overview.slo = await sloMonitor.evaluate(overview, operationRuntime.records());
      for (const terminal of overview.terminals) {
        for (const alert of terminal.alerts) {
          const managed = await alertManager.ingest({ ...alert, code: alert.ref });
          await safeRecovery.handle(managed);
        }
        if (terminal.status === "offline") await alertManager.ingest({ terminalId: terminal.id, code: "terminal_offline", severity: "critical", message: `${terminal.name} unavailable` });
      }
      overview.managedAlerts = alertManager.list().filter((row) => row.status !== "resolved");
      const windowDays = Number(requestUrl.searchParams.get("windowDays") ?? 30);
      overview.recoveryHistory = Object.fromEntries(overview.terminals.map((terminal) => [terminal.id, recoveryHistory.summary(terminal.id, windowDays)]));
      return json(res, 200, overview);
    }
    if (req.method === "GET" && requestUrl.pathname === "/api/slo") {
      return json(res, 200, sloMonitor.summary(requestUrl.searchParams.get("windowDays")));
    }
    if (req.method === "POST" && requestUrl.pathname === "/api/admin/session") {
      if (!bearerAuthorized(req.headers.authorization, process.env.MULTI_TERMINAL_ADMIN_TOKEN)) return json(res, 401, { error: "admin_token_required" });
      const token = randomBytes(32).toString("base64url");
      const expiresAt = Date.now() + Math.min(60, Math.max(5, Number(process.env.MULTI_TERMINAL_ADMIN_SESSION_MINUTES) || 15)) * 60_000;
      adminSessions.set(token, expiresAt);
      return json(res, 201, { token, expiresAt: new Date(expiresAt).toISOString() });
    }
    if (req.method === "GET" && requestUrl.pathname === "/api/alerts") {
      if (!adminAuthorized(req)) return json(res, 401, { error: "admin_token_required" });
      return json(res, 200, { alerts: alertManager.list() });
    }
    const alertAction = requestUrl.pathname.match(/^\/api\/alerts\/([^/]+)\/(acknowledge|silence|resolve)$/);
    if (req.method === "POST" && alertAction) {
      if (!adminAuthorized(req)) return json(res, 401, { error: "admin_token_required" });
      const row = await alertManager.update(decodeURIComponent(alertAction[1]), alertAction[2], await readBody(req));
      return json(res, row ? 200 : 404, { alert: row });
    }
    if (req.method === "GET" && requestUrl.pathname === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream", "cache-control": "no-cache, no-transform",
        connection: "keep-alive", "x-accel-buffering": "no",
      });
      const client = { res, id: Number(req.headers["last-event-id"] ?? 0) || 0 };
      streamClients.add(client);
      res.write(`event: ready\ndata: ${JSON.stringify({ reconnect: client.id > 0 })}\n\n`);
      req.on("close", () => streamClients.delete(client));
      return;
    }
    if (req.method === "GET" && requestUrl.pathname === "/api/traces") {
      const overview = await service.overview();
      const query = String(requestUrl.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 200);
      const limit = Math.min(100, Math.max(1, Number(requestUrl.searchParams.get("limit")) || 25));
      const offset = decodeCursor(requestUrl.searchParams.get("cursor"));
      const rows = overview.terminals.flatMap((terminal) => terminal.tasks)
        .filter((task) => !query || `${task.title} ${task.terminalName} ${task.localResourceId} ${task.traceId ?? ""} ${task.assetFamilies.join(" ")} ${task.applicationIds.join(" ")} ${task.channelIds.join(" ")} ${task.operationIds.join(" ")} ${task.evidenceIds.join(" ")}`.toLowerCase().includes(query))
        .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
      const page = rows.slice(offset, offset + limit);
      return json(res, 200, { traces: page, nextCursor: offset + limit < rows.length ? encodeCursor(offset + limit) : null });
    }
    if (req.method === "GET" && requestUrl.pathname === "/api/terminals") {
      return json(res, 200, { terminals: registry.list().map(({ observerTokenEnv: _observerRef, operatorTokenEnv: _operatorRef, ...row }) => row) });
    }
    const terminalDiagnostic = requestUrl.pathname.match(/^\/api\/terminals\/([^/]+)\/diagnostics$/);
    if (req.method === "GET" && terminalDiagnostic) {
      if (!adminAuthorized(req)) return json(res, 401, { error: "admin_token_required" });
      const terminalId = decodeURIComponent(terminalDiagnostic[1]);
      const terminal = registry.list().find((row) => row.id === terminalId);
      if (!terminal) return json(res, 404, { error: "terminal_not_found" });
      const started = performance.now();
      const row = (await service.overview()).terminals.find((item) => item.id === terminalId);
      return json(res, 200, {
        terminalId, status: row?.status ?? "unknown", stale: Boolean(row?.stale),
        observedAt: row?.observedAt ?? null, latencyMs: Math.round(performance.now() - started),
        observerTokenConfigured: Boolean(terminal.observerTokenEnv && process.env[terminal.observerTokenEnv]),
        operatorTokenConfigured: Boolean(terminal.operatorTokenEnv && process.env[terminal.operatorTokenEnv]),
        unavailableReason: row?.unavailableReason ?? null,
      });
    }
    if (req.method === "GET" && requestUrl.pathname === "/api/operation-audit") {
      if (!adminAuthorized(req)) return json(res, 401, { error: "admin_token_required" });
      return json(res, 200, { records: operationRuntime.records() });
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
        idempotencyKey: String(req.headers["idempotency-key"] ?? ""),
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
  const supplied = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const expiry = adminSessions.get(supplied);
  if (expiry && expiry > Date.now()) return true;
  if (expiry) adminSessions.delete(supplied);
  return bearerAuthorized(req.headers.authorization, process.env.MULTI_TERMINAL_ADMIN_TOKEN);
}

function encodeCursor(offset) {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  if (!cursor) return 0;
  try {
    const offset = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")).offset;
    return Number.isInteger(offset) && offset >= 0 && offset <= 100_000 ? offset : 0;
  } catch {
    return 0;
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

server.listen(port, host, () => console.log(`Multi-terminal console: http://${host}:${port}`));

let streamEventId = 0;
setInterval(async () => {
  if (!streamClients.size) return;
  try {
    const overview = await service.overview();
    streamEventId += 1;
    const payload = JSON.stringify({ generatedAt: overview.generatedAt, terminals: overview.terminals.map(({ id, status, stale, observedAt, counts }) => ({ id, status, stale, observedAt, counts })) });
    for (const client of streamClients) client.res.write(`id: ${streamEventId}\nevent: overview\ndata: ${payload}\n\n`);
  } catch {
    for (const client of streamClients) client.res.write(": keepalive\n\n");
  }
}, 15_000).unref();
