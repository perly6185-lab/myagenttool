import assert from "node:assert/strict";
import test from "node:test";

import { createServerState } from "../src/runtime/state-factory.mjs";
import {
  createAgentService,
  normalizeClaudeRuntimeKind,
} from "../src/services/agents.mjs";

const now = () => "2026-07-28T00:00:00.000Z";

function service() {
  const { state } = createServerState({ defaultProjectPath: process.cwd(), now });
  let next = 0;
  return createAgentService({
    state,
    now,
    nextId: (prefix) => `${prefix}_${++next}`,
    appendEvent: () => undefined,
    persistStateSoon: () => undefined,
  });
}

test("Claude registration inherits the device transport default unless explicitly pinned", () => {
  const agents = service();
  const cli = agents.registerAgent({
    type: "cli",
    command: "claude",
    permissionMode: "plan",
  });
  const sdk = agents.registerAgent({
    type: "cli",
    command: "claude",
    permissionMode: "plan",
    claudeRuntime: "agent_sdk",
  });

  assert.equal(cli.adapter.claudeRuntime, undefined);
  assert.equal(sdk.adapter.claudeRuntime, "agent_sdk");
  assert.equal(normalizeClaudeRuntimeKind("sdk"), "agent_sdk");
  assert.equal(normalizeClaudeRuntimeKind("unexpected"), "cli");
});
