/*
 * Fixture Streamable-HTTP MCP server: one POST endpoint speaking JSON-RPC.
 * initialize returns an Mcp-Session-Id header and every later request REQUIRES
 * that header back (400 otherwise) — proving the client echoes the session.
 * tools/call answers application/json by default, text/event-stream (a log
 * notification frame + the response frame) with `--sse`, and never with
 * `--slow`. Prints "LISTENING <port>" on stdout.
 */

import { createServer } from "node:http";

const sse = process.argv.includes("--sse");
const slow = process.argv.includes("--slow");
const SESSION_ID = "sess-fixture-1";

const server = createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const message = JSON.parse(body);
    const json = (payload, headers = {}) => {
      res.writeHead(200, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(payload));
    };

    if (message.method === "initialize") {
      json(
        { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "fixture-http", version: "0.0.0" } } },
        { "mcp-session-id": SESSION_ID },
      );
      return;
    }
    if (req.headers["mcp-session-id"] !== SESSION_ID) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id ?? null, error: { message: "missing session id" } }));
      return;
    }
    if (message.id === undefined) {
      res.writeHead(202).end(); // notification
      return;
    }
    if (message.method === "tools/list") {
      json({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "echo", description: "Echo the task.", inputSchema: { type: "object" } }] } });
      return;
    }
    if (message.method === "tools/call") {
      if (slow) return; // hold the connection open
      const task = message.params?.arguments?.task ?? "";
      const result = { content: [{ type: "text", text: `echo: ${task}` }] };
      if (sse) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info", data: "http working" } })}\n\n`);
        res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n\n`);
        res.end();
        return;
      }
      json({ jsonrpc: "2.0", id: message.id, result });
      return;
    }
    json({ jsonrpc: "2.0", id: message.id, error: { message: `unknown method ${message.method}` } });
  });
});

server.listen(0, "127.0.0.1", () => {
  console.log(`LISTENING ${server.address().port}`);
});
