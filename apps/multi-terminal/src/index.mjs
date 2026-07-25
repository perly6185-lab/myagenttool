import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createCompositionService } from "./composition.mjs";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const port = Number(process.env.MULTI_TERMINAL_PORT ?? 4311);
const terminals = JSON.parse(process.env.MULTI_TERMINALS_JSON ?? "[]");

function terminalRequest(terminal, operation) {
  const url = new URL(operation.path, terminal.apiUrl);
  const headers = { accept: "application/json", "content-type": "application/json" };
  if (terminal.observerToken) headers.authorization = `Bearer ${terminal.observerToken}`;
  return fetch(url, { method: operation.method, headers, body: operation.body ? JSON.stringify(operation.body) : undefined, signal: AbortSignal.timeout(5_000) });
}

const service = createCompositionService({ terminals, request: terminalRequest });
const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/overview") return json(res, 200, await service.overview());
    const action = req.url?.match(/^\/api\/terminals\/([^/]+)\/(work-items|invocations)\/([^/]+)\/(cancel|retry|replay|maintenance)$/);
    if (req.method === "POST" && action) {
      const body = await readBody(req);
      const result = await service.proxyAction({
        terminalId: decodeURIComponent(action[1]), resourceType: action[2],
        localResourceId: decodeURIComponent(action[3]), action: action[4], body,
      });
      return json(res, result.status, result);
    }
    const file = req.url === "/app.js" ? "app.js" : req.url === "/styles.css" ? "styles.css" : "index.html";
    const type = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html";
    res.writeHead(200, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" });
    res.end(await readFile(new URL(file, `file://${publicDir}/`)));
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : "request failed" });
  }
});

function json(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

server.listen(port, "127.0.0.1", () => console.log(`Multi-terminal console: http://127.0.0.1:${port}`));
