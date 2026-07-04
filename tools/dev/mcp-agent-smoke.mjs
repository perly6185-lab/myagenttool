// End-to-end MCP smoke: the seam neither side's unit tests cover on its own.
// mcp-registration.test.mjs tests server registration; mcp-client.test.mjs tests
// the bridge client against a hand-built adapter. This proves they meet: the
// adapter the SERVER produces from a registration is exactly what the bridge's
// live client needs to drive a real MCP server (the fixture echo server) over
// stdio — handshake, tools/list, tools/call, notification forwarding, health
// probe, and allowlist enforcement.
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createAgentService } from "../../apps/server/src/services/agents.mjs";
import { callMcpTool, probeMcpServer } from "../../apps/desktop/src/mcp-client.mjs";

const fixture = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../apps/desktop/test/fixtures/mcp-echo-server.mjs",
);

let passed = 0;
const ok = (msg) => { passed += 1; console.log(`  ok - ${msg}`); };

function registerMcpAgent(extra = {}) {
  const state = { device: { id: "dev1", status: "online" }, agents: [] };
  let n = 0;
  const svc = createAgentService({ state, now: () => "t", nextId: (p) => `${p}_${++n}`, appendEvent: () => {} });
  return svc.registerAgent({
    type: "mcp",
    transport: "stdio",
    command: process.execPath,
    args: [fixture],
    timeoutMs: 5_000,
    ...extra,
  });
}

// 1. The server hands the bridge exactly the fields the live client executes on.
{
  const agent = registerMcpAgent();
  const a = agent.adapter;
  assert.equal(a.type, "mcp", "the control plane dispatches on adapter.type");
  assert.equal(a.transport, "stdio");
  assert.equal(a.command, process.execPath);
  assert.deepEqual(a.args, [fixture]);
  assert.equal(a.cancellation, "supported");
  ok("registration produces the adapter shape the bridge client consumes");
}

// 2. Health probe drives the registered adapter to a real handshake + tools/list.
{
  const { adapter } = registerMcpAgent();
  const probe = await probeMcpServer(adapter);
  assert.equal(probe.ok, true, probe.message);
  assert.match(probe.message, /echo/, "probe reports the tool the fixture exposes");
  // The dry-probe flow (#137) surfaces this structured list to the Connect
  // Agent UI, so a config resolves to a visible tool set before registration.
  assert.deepEqual(probe.tools, ["echo"], "probe returns the tool names as a structured list");
  ok("probeMcpServer handshakes and lists the fixture's tool");
}

// 3. Full round-trip: invoke through the live client, echo result + forwarded notification.
{
  const { adapter } = registerMcpAgent();
  const events = [];
  const outcome = await callMcpTool({ adapter, task: "hello world", onEvent: (e) => events.push(e) });
  assert.equal(outcome.status, "succeeded", JSON.stringify(outcome));
  assert.equal(outcome.result.toolName, "echo", "the single listed tool is auto-resolved");
  assert.equal(outcome.result.output, "echo: hello world", "the task round-tripped through the MCP server");
  const logs = events.filter((e) => e.type === "log").map((e) => e.message);
  assert.ok(logs.some((m) => /calling tool echo/i.test(m)), "the tool call is announced as an event");
  assert.ok(logs.some((m) => /working on it/i.test(m)), "the server's notification is forwarded as an event");
  ok("callMcpTool round-trips the task and forwards the server notification");
}

// 4. Allowlist enforcement: a tool outside the registered allowlist is refused
//    before it ever reaches the server.
{
  const { adapter } = registerMcpAgent({ allowedTools: ["echo"] });
  const outcome = await callMcpTool({ adapter, task: "x", options: { toolName: "other" } });
  assert.equal(outcome.status, "failed", "a disallowed tool name is rejected");
  ok("allowlist blocks a tool outside the registered set");
}

console.log(`\nmcp-agent-smoke: ${passed} checks passed`);
