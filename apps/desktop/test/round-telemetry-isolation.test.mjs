/**
 * #1259 — concurrent-invocation reporting isolation guard.
 *
 * Since #1242 the bridge runs multiple worktree invocations at once, each with
 * its own `newRoundState()` created inside runInvocation. The codex round state
 * ACCUMULATES a turn's files/message across item events until turn.completed —
 * the one reporting spot where a future refactor that made `roundState` shared
 * (e.g. a module singleton) would silently cross two concurrent runs' content.
 *
 * These tests interleave two independent streams through two states and assert
 * each turn boundary reports ONLY its own content. They fail the moment the
 * per-run accumulator is shared.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { newRoundState, codexRoundEmits, claudeRoundEmits } from "../src/round-telemetry.mjs";

const T = "2026-07-13T00:00:00.000Z";

function completed(emits) {
  return emits.find((e) => e.type === "round_completed")?.data;
}
const fileChange = (path) => ({ item: { type: "file_change", path } });
const agentMessage = (text) => ({ item: { type: "agent_message", text } });
const turnCompleted = { type: "turn.completed", model: "codex", usage: { input_tokens: 1, output_tokens: 2 } };

test("two interleaved codex round states never cross their accumulated files or message", () => {
  const a = newRoundState();
  const b = newRoundState();

  // Interleave item events across the two runs, exactly as concurrent stdout
  // sinks would feed them on one event loop.
  codexRoundEmits(a, fileChange("/wt-a/one.mjs"), T);
  codexRoundEmits(b, fileChange("/wt-b/one.mjs"), T);
  codexRoundEmits(a, agentMessage("summary for run A"), T);
  codexRoundEmits(b, fileChange("/wt-b/two.mjs"), T);
  codexRoundEmits(b, agentMessage("summary for run B"), T);
  codexRoundEmits(a, fileChange("/wt-a/two.mjs"), T);

  const doneA = completed(codexRoundEmits(a, turnCompleted, T));
  assert.deepEqual(doneA.filesRead, ["/wt-a/one.mjs", "/wt-a/two.mjs"], "run A reports only its own files");
  assert.equal(doneA.responseDigest, "summary for run A");

  const doneB = completed(codexRoundEmits(b, turnCompleted, T));
  assert.deepEqual(doneB.filesRead, ["/wt-b/one.mjs", "/wt-b/two.mjs"], "run B reports only its own files");
  assert.equal(doneB.responseDigest, "summary for run B");
});

test("a codex turn.completed resets only its own state, not a concurrent run's", () => {
  const a = newRoundState();
  const b = newRoundState();

  codexRoundEmits(a, fileChange("/wt-a/pending.mjs"), T);
  codexRoundEmits(b, fileChange("/wt-b/pending.mjs"), T);

  // A closes its turn — its accumulator resets, B's must be untouched.
  const doneA = completed(codexRoundEmits(a, turnCompleted, T));
  assert.deepEqual(doneA.filesRead, ["/wt-a/pending.mjs"]);

  // B closes next — still holding only its own pending file.
  const doneB = completed(codexRoundEmits(b, turnCompleted, T));
  assert.deepEqual(doneB.filesRead, ["/wt-b/pending.mjs"]);

  // A's next turn starts empty (its reset was independent of B).
  const doneA2 = completed(codexRoundEmits(a, turnCompleted, T));
  assert.deepEqual(doneA2.filesRead, []);
});

test("two interleaved claude round states advance independent round indexes", () => {
  const a = newRoundState();
  const b = newRoundState();
  const assistant = (text) => ({ type: "assistant", message: { model: "claude-opus-4-8", usage: {}, content: [{ type: "text", text }] } });

  const a0 = completed(claudeRoundEmits(a, assistant("A turn 0"), T));
  const b0 = completed(claudeRoundEmits(b, assistant("B turn 0"), T));
  const a1 = completed(claudeRoundEmits(a, assistant("A turn 1"), T));

  assert.equal(a0.roundIndex, 0);
  assert.equal(b0.roundIndex, 0, "B's index is independent of A's");
  assert.equal(a1.roundIndex, 1, "A advances its own index, unaffected by B");
  assert.equal(a0.responseDigest, "A turn 0");
  assert.equal(b0.responseDigest, "B turn 0");
});
