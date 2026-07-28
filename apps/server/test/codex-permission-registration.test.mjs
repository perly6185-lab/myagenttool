import assert from "node:assert/strict";
import test from "node:test";

import { createServerState } from "../src/runtime/state-factory.mjs";
import { createAgentService } from "../src/services/agents.mjs";

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

test("Codex agent registration persists ask, auto, and full as executable permission profiles", () => {
  const agents = service();
  const ask = agents.registerAgent({ type: "cli", command: "codex", permissionMode: "ask" });
  const auto = agents.registerAgent({ type: "cli", command: "codex", permissionMode: "auto" });
  const full = agents.registerAgent({ type: "cli", command: "codex", permissionMode: "full" });

  assert.equal(ask.id, "agt_codex_cli");
  assert.equal(ask.adapter.sandbox, "workspace-write");
  assert.ok(ask.adapter.args.includes('approvals_reviewer="user"'));
  assert.equal(auto.id, "agt_codex_auto");
  assert.ok(auto.adapter.args.includes('approvals_reviewer="auto_review"'));
  assert.equal(full.id, "agt_codex_full");
  assert.equal(full.adapter.sandbox, "danger-full-access");
  assert.ok(full.adapter.args.includes("--dangerously-bypass-approvals-and-sandbox"));
});

test("legacy Codex sandbox registrations migrate to the nearest permission mode", () => {
  const agents = service();
  const legacyWorkspace = agents.registerAgent({ type: "cli", command: "codex", sandbox: "workspace-write" });
  const legacyFull = agents.registerAgent({ type: "cli", command: "codex", sandbox: "danger-full-access" });

  assert.equal(legacyWorkspace.adapter.permissionMode, "ask");
  assert.equal(legacyFull.adapter.permissionMode, "full");
});
