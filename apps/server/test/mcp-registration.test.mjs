/*
 * Unit tests for MCP agent registration: the server registers exactly what the
 * bridge executes (config validated by the shared adapter slice), local-device
 * placement so it dispatches via the bridge, and clear rejections for the
 * unsupported cases.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createAgentService } from "../src/services/agents.mjs";

function service() {
  const state = { device: { id: "dev_1" }, agents: [] };
  let counter = 0;
  const svc = createAgentService({
    state,
    now: () => "2026-07-02T00:00:00.000Z",
    nextId: (p) => `${p}_${++counter}`,
    appendEvent: () => {},
  });
  return { state, svc };
}

test("registers a stdio MCP agent with a normalized adapter on the local device", () => {
  const { svc } = service();
  const agent = svc.registerAgent(
    { type: "mcp", name: "FS tools", transport: "stdio", command: "mcp-fs", args: ["--root", "/x"], allowedTools: ["read_file"] },
    { userId: "usr_a" },
  );
  assert.equal(agent.adapter.type, "mcp", "the control plane dispatches on adapter.type");
  assert.equal(agent.adapter.kind, "mcp");
  assert.equal(agent.adapter.transport, "stdio");
  assert.equal(agent.adapter.command, "mcp-fs");
  assert.deepEqual(agent.adapter.allowedTools, ["read_file"]);
  assert.equal(agent.location.type, "local_device");
  assert.equal(agent.ownerUserId, "usr_a");
  assert.equal(agent.health.status, "unknown", "starts unknown so dispatch is not blocked");
});

test("rejects http-transport MCP registration (bridge-side stdio only for now)", () => {
  const { svc } = service();
  assert.throws(
    () => svc.registerAgent({ type: "mcp", transport: "http", url: "https://mcp.example" }),
    /stdio transport only/,
  );
});

test("rejects invalid MCP config with the slice's plain-language error", () => {
  const { svc } = service();
  assert.throws(() => svc.registerAgent({ type: "mcp", transport: "stdio" }), /requires a command/);
  assert.throws(() => svc.registerAgent({ type: "grpc" }), /cli, http, and mcp/);
});
