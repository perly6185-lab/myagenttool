/*
 * Pre-flight dry-probe of an unregistered agent config (#137): the runtime that
 * lets the Connect Agent flow hand an MCP config to the bridge for a
 * handshake + tools/list *before* any agent is registered. Covers queueing
 * (not gated on an approved artifact, unlike createIntegrationProbeRun),
 * bridge-online + type guards, the bridge probe queue serving MCP alongside CLI,
 * and tool-list persistence on completion. A regression here either registers an
 * agent the operator never saw resolve, or drops the tools the UI shows.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createIntegrationProbeRuntime } from "../src/services/integrations/probes.mjs";

function runtime({ deviceStatus = "online", unlinkState = "linked" } = {}) {
  const state = {
    device: { id: "dev_1", status: deviceStatus, unlinkState },
    integrationProbeRuns: [],
  };
  let n = 0;
  const rt = createIntegrationProbeRuntime({
    state,
    now: () => "2026-07-04T00:00:00.000Z",
    nextId: (p) => `${p}_${++n}`,
    appendEvent: () => {},
    findIntegrationArtifact: () => undefined,
  });
  return { state, rt };
}

const mcpAdapter = (extra = {}) => ({ type: "mcp", transport: "stdio", command: "mcp-fs", args: ["--root", "/x"], ...extra });

test("createAgentDryProbeRun: queues an ungated run for the bridge, registers no agent", () => {
  const { state, rt } = runtime();
  const run = rt.createAgentDryProbeRun(mcpAdapter());

  assert.equal(run.status, "queued");
  assert.equal(run.kind, "agent_dry_probe");
  assert.equal(run.artifactId, null, "not tied to an approved adapter_config artifact");
  assert.equal(run.deviceId, "dev_1");
  assert.deepEqual(run.tools, []);
  assert.equal(state.integrationProbeRuns.length, 1);
  assert.equal(rt.nextBridgeProbeRun().id, run.id, "the bridge picks up the queued MCP probe");
});

test("createAgentDryProbeRun: requires the bridge to be online", () => {
  const offline = runtime({ deviceStatus: "offline" });
  assert.throws(() => offline.rt.createAgentDryProbeRun(mcpAdapter()), /Bridge must be online/);
  const unlinked = runtime({ unlinkState: "unlinked" });
  assert.throws(() => unlinked.rt.createAgentDryProbeRun(mcpAdapter()), /Bridge must be online/);
});

test("createAgentDryProbeRun: only MCP configs are supported for now", () => {
  const { rt } = runtime();
  assert.throws(() => rt.createAgentDryProbeRun({ type: "cli", command: "x" }), /MCP agent configs only/);
});

test("nextBridgeProbeRun still serves CLI runs alongside MCP", () => {
  const { state, rt } = runtime();
  state.integrationProbeRuns.push(
    { id: "cli_unowned", status: "queued", deviceId: null, adapter: { type: "cli", command: "codex" } },
    { id: "cli_1", status: "queued", deviceId: "dev_1", adapter: { type: "cli", command: "codex" } },
  );
  const found = rt.nextBridgeProbeRun();
  assert.ok(found, "a queued CLI probe is still dispatchable");
  assert.equal(found.id, "cli_1");
  assert.equal(found.adapter.type, "cli");
});

test("completeIntegrationProbeRun: persists the tool list the bridge reports", () => {
  const { rt } = runtime();
  const run = rt.createAgentDryProbeRun(mcpAdapter());
  rt.completeIntegrationProbeRun(run, {
    status: "succeeded",
    summary: "MCP server is reachable and exposes 2 tool(s): read_file, write_file.",
    tools: ["read_file", "write_file"],
  });
  assert.equal(run.status, "succeeded");
  assert.deepEqual(run.tools, ["read_file", "write_file"]);
});
