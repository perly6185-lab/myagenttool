import assert from "node:assert/strict";
import { test } from "node:test";

import {
  newRoundState,
  claudeRoundEmits,
  codexRoundEmits,
  claudeRequestContext,
} from "../src/round-telemetry.mjs";

const T0 = "2026-07-13T00:00:00.000Z";
const T5 = "2026-07-13T00:00:05.000Z";

function completed(emits) {
  return emits.find((e) => e.type === "round_completed");
}

test("a Claude assistant turn emits a started+completed pair with real tokens and files read", () => {
  const state = newRoundState();
  const event = {
    type: "assistant",
    message: {
      model: "claude-opus-4-8",
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20, cache_creation_input_tokens: 5 },
      content: [
        { type: "text", text: "reading the file" },
        { type: "tool_use", name: "Read", input: { file_path: "/wt/apps/server/a.mjs" } },
      ],
    },
  };
  const emits = claudeRoundEmits(state, event, T0);
  assert.deepEqual(emits.map((e) => e.type), ["round_started", "round_completed"]);
  const done = completed(emits).data;
  assert.equal(done.roundIndex, 0);
  assert.equal(done.provider, "anthropic");
  assert.equal(done.model, "claude-opus-4-8");
  assert.equal(done.status, "succeeded");
  assert.equal(done.inputTokens, 100);
  assert.equal(done.outputTokens, 50);
  assert.equal(done.cachedTokens, 25); // read + creation
  assert.equal(done.reasoningTokens, 0);
  assert.deepEqual(done.filesRead, ["/wt/apps/server/a.mjs"]);
  assert.equal(done.responseDigest, "reading the file [tool: Read]");
  assert.equal(done.durationMs, null, "first round has no prior boundary");
});

test("a multi-turn run increments the index and derives inter-turn duration", () => {
  const state = newRoundState();
  const turn = (usage) => ({ type: "assistant", message: { model: "claude-opus-4-8", usage, content: [] } });
  const first = completed(claudeRoundEmits(state, turn({ input_tokens: 10, output_tokens: 5 }), T0));
  const second = completed(claudeRoundEmits(state, turn({ input_tokens: 20, output_tokens: 8 }), T5));
  assert.equal(first.data.roundIndex, 0);
  assert.equal(second.data.roundIndex, 1);
  assert.equal(first.data.durationMs, null);
  assert.equal(second.data.startedAt, T0, "round 1 starts at round 0's boundary");
  assert.equal(second.data.durationMs, 5000);
});

test("an assistant turn with no usage still emits a round with zeroed tokens", () => {
  const state = newRoundState();
  const emits = claudeRoundEmits(state, { type: "assistant", message: { content: [] } }, T0);
  const done = completed(emits).data;
  assert.equal(done.roundIndex, 0);
  assert.equal(done.status, "succeeded");
  assert.deepEqual(
    [done.inputTokens, done.outputTokens, done.cachedTokens, done.reasoningTokens],
    [0, 0, 0, 0],
  );
  assert.equal(done.model, null);
});

test("a Claude error event ends a failed round", () => {
  const state = newRoundState();
  const emits = claudeRoundEmits(state, { type: "error", error: { type: "overloaded_error", message: "boom" } }, T0);
  const done = completed(emits).data;
  assert.equal(done.status, "failed");
  assert.equal(done.errorCode, "overloaded_error");
  assert.equal(completed(emits) && emits[1].level, "warn");
});

test("non-turn Claude events produce no rounds", () => {
  const state = newRoundState();
  for (const event of [
    { type: "system", subtype: "init", session_id: "s1" },
    { type: "user" },
    { type: "result", result: "done" },
  ]) {
    assert.deepEqual(claudeRoundEmits(state, event, T0), []);
  }
  assert.equal(state.nextIndex, 0);
});

test("Codex accumulates item content, then turn.completed emits one round", () => {
  const state = newRoundState();
  assert.deepEqual(codexRoundEmits(state, { type: "turn.started" }, T0), []);
  assert.deepEqual(
    codexRoundEmits(state, { item: { type: "agent_message", text: "made the change" } }, T0),
    [],
  );
  assert.deepEqual(
    codexRoundEmits(state, { item: { type: "file_change", path: "/wt/x.ts" } }, T0),
    [],
  );
  const emits = codexRoundEmits(
    state,
    { type: "turn.completed", usage: { input_tokens: 30, cached_input_tokens: 4, output_tokens: 12, reasoning_output_tokens: 7 } },
    T5,
  );
  const done = completed(emits).data;
  assert.equal(done.roundIndex, 0);
  assert.equal(done.provider, "openai");
  assert.equal(done.status, "succeeded");
  assert.deepEqual(
    [done.inputTokens, done.cachedTokens, done.outputTokens, done.reasoningTokens],
    [30, 4, 12, 7],
  );
  assert.deepEqual(done.filesRead, ["/wt/x.ts"]);
  assert.equal(done.responseDigest, "made the change");
  assert.equal(done.startedAt, T0);
  assert.equal(done.durationMs, 5000);
  assert.equal(state.touchedUserFiles, true);
  // Pending state is cleared for the next turn.
  assert.deepEqual(state.pendingFiles, []);
  assert.equal(state.pendingMessage, null);
  assert.equal(state.currentStartedAt, null);
});

test("Codex turn.failed ends a failed round", () => {
  const state = newRoundState();
  const emits = codexRoundEmits(state, { type: "turn.failed", error: { message: "rate limited" } }, T0);
  const done = completed(emits).data;
  assert.equal(done.status, "failed");
  assert.equal(done.errorCode, "turn_failed");
});

test("claudeRequestContext shapes the stream-json init into a request_context payload", () => {
  const init = {
    type: "system",
    subtype: "init",
    model: "claude-opus-4-8[1m]",
    permissionMode: "acceptEdits",
    tools: ["Task", "Bash", "Read"],
    mcp_servers: [{ name: "claude.ai Google Drive", status: "needs-auth" }],
    skills: ["deep-research"],
    agents: ["claude", "Explore"],
    slash_commands: ["a", "b", "c", "d"],
    session_id: "sess-123",
  };
  const ctx = claudeRequestContext(init);
  assert.equal(ctx.model, "claude-opus-4-8[1m]");
  assert.equal(ctx.permissionMode, "acceptEdits");
  assert.deepEqual(ctx.tools, ["Task", "Bash", "Read"]);
  assert.deepEqual(ctx.mcpServers, [{ name: "claude.ai Google Drive", status: "needs-auth" }]);
  assert.deepEqual(ctx.skills, ["deep-research"]);
  assert.deepEqual(ctx.agents, ["claude", "Explore"]);
  assert.equal(ctx.slashCommandCount, 4, "the slash-command list is reduced to a count");
  assert.equal(ctx.sessionId, "sess-123");
});

test("claudeRequestContext returns null for non-init events (assistant/result/etc.)", () => {
  assert.equal(claudeRequestContext({ type: "assistant", message: {} }), null);
  assert.equal(claudeRequestContext({ type: "system", subtype: "other" }), null);
  assert.equal(claudeRequestContext(null), null);
});
