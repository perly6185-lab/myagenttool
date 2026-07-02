/*
 * Fixture MCP server for tests: newline-delimited JSON-RPC over stdio.
 * Exposes one `echo` tool; emits a notifications/message log before answering a
 * call. `--slow` makes tools/call hang (for cancellation tests); `--two-tools`
 * lists a second tool (for tool-resolution tests).
 */

const slow = process.argv.includes("--slow");
const twoTools = process.argv.includes("--two-tools");

const tools = [
  { name: "echo", description: "Echo the task back.", inputSchema: { type: "object" } },
  ...(twoTools ? [{ name: "other", description: "Another tool.", inputSchema: { type: "object" } }] : []),
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    handle(message);
  }
});

function handle(message) {
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "fixture-echo", version: "0.0.0" },
      },
    });
    return;
  }
  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools } });
    return;
  }
  if (message.method === "tools/call") {
    if (slow) return; // hang forever — the client should cancel or time out
    send({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info", data: "working on it" } });
    const name = message.params?.name;
    if (name !== "echo") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: { isError: true, content: [{ type: "text", text: `unknown tool ${name}` }] },
      });
      return;
    }
    const task = message.params?.arguments?.task ?? "";
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { content: [{ type: "text", text: `echo: ${task}` }] },
    });
    return;
  }
  // notifications (initialized, cancelled) need no reply
}
