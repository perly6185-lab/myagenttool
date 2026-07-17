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

test("registers an http-transport MCP agent (Streamable HTTP via the bridge client)", () => {
  const { svc } = service();
  const agent = svc.registerAgent({ type: "mcp", transport: "http", url: "https://mcp.example/rpc" });
  assert.equal(agent.adapter.type, "mcp");
  assert.equal(agent.adapter.transport, "http");
  assert.equal(agent.adapter.url, "https://mcp.example/rpc");
  assert.equal(agent.location.type, "local_device", "the client still runs on this device's bridge");
  assert.throws(() => svc.registerAgent({ type: "mcp", transport: "http", url: "not-a-url" }), /valid http/);
});

test("rejects invalid MCP config with the slice's plain-language error", () => {
  const { svc } = service();
  assert.throws(() => svc.registerAgent({ type: "mcp", transport: "stdio" }), /requires a command/);
  assert.throws(() => svc.registerAgent({ type: "grpc" }), /cli, http, mcp, a2a, and container/);
});

// #1185: the provider is the only positive evidence of WHICH external service an
// agent fronts. Without it, discovery could only count candidates, and a lone
// wrong-provider agent was wired by default (app_gmail -> a NetEase mailbox).
test("carries the declared provider into state, normalized", () => {
  const { svc } = service();
  const agent = svc.registerAgent({ type: "mcp", transport: "stdio", command: "mail", provider: "  Google  " });
  assert.equal(agent.provider, "google", "trimmed and lowercased so comparison is exact");

  const undeclared = svc.registerAgent({ type: "mcp", transport: "stdio", command: "mail" });
  assert.equal(undeclared.provider, null, "undeclared is null — a match for nobody, not for everybody");
});

test("rejects a malformed provider instead of silently dropping it", () => {
  const { svc } = service();
  // Dropping to null would leave an agent the operator BELIEVES is discoverable
  // but which never matches — a confusing failure far from its cause.
  assert.throws(() => svc.registerAgent({ type: "mcp", transport: "stdio", command: "mail", provider: "not a slug!" }), /must be a slug/);
  assert.throws(() => svc.registerAgent({ type: "mcp", transport: "stdio", command: "mail", provider: "" }), /must be a slug/);
});

test("registers an A2A agent: client runs on the bridge, adapter validated by the slice", () => {
  const { svc } = service();
  const agent = svc.registerAgent({ type: "a2a", name: "Remote", agentUrl: "https://agent.example/", allowedSkills: ["echo"] });
  assert.equal(agent.adapter.type, "a2a");
  assert.equal(agent.adapter.agentUrl, "https://agent.example", "trailing slash trimmed by the slice");
  assert.equal(agent.location.type, "local_device", "the client runs on this device's bridge");
  assert.throws(() => svc.registerAgent({ type: "a2a", agentUrl: "not-a-url" }), /valid http/);
});

test("registers a container agent with the governance guards applied", () => {
  const { svc } = service();
  const agent = svc.registerAgent({ type: "container", image: "acme/agent:1", cpuLimit: 999 });
  assert.equal(agent.adapter.type, "container");
  assert.equal(agent.adapter.network, "none", "network isolated by default");
  assert.equal(agent.adapter.cpuLimit, 8, "cpu clamped to the ceiling");
  assert.throws(() => svc.registerAgent({ type: "container", image: "acme/agent:1", privileged: true }), /not allowed/);
});
