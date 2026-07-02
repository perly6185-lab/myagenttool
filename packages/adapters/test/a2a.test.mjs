/*
 * Unit tests for the A2A adapter slice: capability contract, config
 * normalization/validation, and the message/send + tasks/cancel descriptors.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  A2A_ADAPTER_CONTRACT,
  describeA2aTaskCancel,
  describeA2aTaskSend,
  normalizeA2aAdapterConfig,
} from "../src/a2a.mjs";

test("contract: A2A supports success/failure/cancellation/event streaming over http", () => {
  assert.equal(A2A_ADAPTER_CONTRACT.kind, "a2a");
  assert.equal(A2A_ADAPTER_CONTRACT.cancellation, "supported");
  assert.equal(A2A_ADAPTER_CONTRACT.streamsEvents, true);
});

test("normalize: valid url required, trailing slash trimmed, card path defaulted", () => {
  const c = normalizeA2aAdapterConfig({ agentUrl: "https://agent.example/", headers: { authorization: "Bearer x" } });
  assert.equal(c.agentUrl, "https://agent.example");
  assert.equal(c.agentCardPath, "/.well-known/agent.json");
  assert.equal(c.headers.authorization, "Bearer x");
  assert.equal(c.timeoutMs, 120_000);
  assert.throws(() => normalizeA2aAdapterConfig({ agentUrl: "not-a-url" }), /valid http/);
  assert.throws(() => normalizeA2aAdapterConfig({ agentUrl: "https://x", agentCardPath: "no-slash" }), /start with/);
});

test("describeA2aTaskSend: builds a message/send descriptor; enforces skill allowlist", () => {
  const cfg = normalizeA2aAdapterConfig({ agentUrl: "https://agent.example", allowedSkills: ["summarize"] });
  const req = describeA2aTaskSend(cfg, "Summarize the report", { skillId: "summarize" });
  assert.equal(req.method, "message/send");
  assert.deepEqual(req.params.message.parts, [{ kind: "text", text: "Summarize the report" }]);
  assert.equal(req.params.message.metadata.skillId, "summarize");
  assert.equal(req.id, undefined, "the bridge assigns the JSON-RPC id");
  assert.throws(() => describeA2aTaskSend(cfg, "x", { skillId: "delete_all" }), /not in the adapter's allowed skills/);
  assert.throws(() => describeA2aTaskSend(cfg, ""), /requires task text/);
});

test("describeA2aTaskCancel: builds tasks/cancel and requires the task id", () => {
  assert.deepEqual(describeA2aTaskCancel("task_1"), {
    jsonrpc: "2.0",
    method: "tasks/cancel",
    params: { id: "task_1" },
  });
  assert.throws(() => describeA2aTaskCancel(""), /requires the remote task id/);
});
