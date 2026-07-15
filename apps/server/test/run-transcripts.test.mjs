import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_RUN_TRANSCRIPTS,
  RUN_TRANSCRIPT_LIMITS,
  recordRunTranscript,
  sanitizeRunTranscript,
} from "../src/services/run-transcripts.mjs";
import { applyRetentionPolicies } from "../src/services/retention.mjs";
import { createInvocationCompletionRuntime } from "../src/services/invocations/completion.mjs";
import { handleInvocationRoutes } from "../src/routes/invocations.mjs";

// #1072 (Epic #1070): the wrapper's bounded stream transcript (#1071) gets a
// durable per-run home — server-side re-clamp, upsert per invocation, retention
// reap to skeleton, and a tenant-scoped read route.

const NOW = "2026-07-15T12:00:00.000Z";
const now = () => NOW;

const goodTranscript = () => ({
  version: 1,
  blocks: [
    { kind: "thinking", text: "Let me look.", durationMs: 4000 },
    { kind: "tool_use", toolName: "Bash", toolUseId: "tu_1", description: "check tree", input: '{"command":"git status"}' },
    { kind: "tool_result", toolUseId: "tu_1", output: "M a.ts", isError: false },
    { kind: "text", text: "**done**" },
  ],
  totalChars: 60,
  droppedBlocks: 0,
  unparsedLines: 0,
  truncated: false,
});

// --- sanitize: never trust the device ---

test("sanitize rejects non-transcripts and drops unknown block kinds", () => {
  assert.equal(sanitizeRunTranscript(null), null);
  assert.equal(sanitizeRunTranscript("payload"), null);
  assert.equal(sanitizeRunTranscript({ blocks: "nope" }), null);
  const sanitized = sanitizeRunTranscript({
    blocks: [{ kind: "evil", text: "x" }, "garbage", { kind: "text", text: "kept" }],
  });
  assert.equal(sanitized.blocks.length, 1);
  assert.equal(sanitized.blocks[0].text, "kept");
  assert.equal(sanitized.droppedBlocks, 2);
  assert.equal(sanitized.truncated, true);
});

test("sanitize re-clamps oversized payloads with its own limits", () => {
  const sanitized = sanitizeRunTranscript({
    blocks: [{ kind: "text", text: "y".repeat(RUN_TRANSCRIPT_LIMITS.textChars + 500) }],
  });
  assert.equal(sanitized.blocks[0].text.length, RUN_TRANSCRIPT_LIMITS.textChars);
  assert.equal(sanitized.blocks[0].truncated, true);
  assert.equal(sanitized.blocks[0].droppedChars, 500);
});

test("sanitize degrades to skeletons past the total budget and the block cap", () => {
  const limits = { ...RUN_TRANSCRIPT_LIMITS, totalChars: 10, maxBlocks: 3 };
  const block = (text) => ({ kind: "text", text });
  const sanitized = sanitizeRunTranscript(
    { blocks: [block("0123456789AB"), block("skeleton me"), block("also skeleton"), block("beyond cap")] },
    limits,
  );
  assert.equal(sanitized.blocks.length, 3, "maxBlocks bounds the array");
  assert.equal(sanitized.blocks[0].text, "0123456789");
  assert.equal(sanitized.blocks[1].payloadDropped, true);
  assert.equal(sanitized.blocks[1].chars, "skeleton me".length);
  assert.equal(sanitized.droppedBlocks, 3, "two skeletons + one beyond the cap");
});

test("sanitize preserves device-side truncation accounting", () => {
  const sanitized = sanitizeRunTranscript({
    blocks: [
      { kind: "thinking", text: "cut by the device", truncated: true, droppedChars: 40 },
      { kind: "tool_use", toolName: "Bash", toolUseId: "tu_9", payloadDropped: true, chars: 999 },
    ],
    droppedBlocks: 1,
    unparsedLines: 2,
  });
  assert.equal(sanitized.blocks[0].droppedChars, 40);
  assert.equal(sanitized.blocks[1].payloadDropped, true);
  assert.equal(sanitized.blocks[1].chars, 999);
  assert.equal(sanitized.droppedBlocks, 1);
  assert.equal(sanitized.unparsedLines, 2);
  assert.equal(sanitized.truncated, true);
});

// --- ingest through the real completion runtime ---

function completionHarness() {
  const state = {
    runTranscripts: [],
    auditSummaries: [],
    agentUsageSummaries: [],
    spans: [],
    compareRuns: [],
    invocations: [],
  };
  const runtime = createInvocationCompletionRuntime({
    state,
    now,
    appendEvent: () => {},
    persistStateSoon: () => {},
    persistStateNow: () => {},
    namespace: "test",
    protocolVersion: "1",
    findAgent: () => null,
    findInvocation: () => null,
    closeCodexSession: () => {},
    isTerminal: (status) => ["succeeded", "failed", "cancelled", "timed_out"].includes(status),
  });
  return { state, runtime };
}

const makeInvocation = (id, status = "running") => ({
  id,
  status,
  agentId: "agt_claude",
  projectId: "prj_a",
  requestedBy: "usr_a",
  delivery: { deviceId: "dev_1" },
  cancellation: { state: "none" },
});

test("completion ingests the RESULT transcript and strips it off invocation.result", () => {
  const { state, runtime } = completionHarness();
  const invocation = makeInvocation("inv_1");
  runtime.completeInvocation(invocation, {
    status: "succeeded",
    summary: "ok",
    result: { summary: "ok", output: { source: "claude" }, transcript: goodTranscript() },
  });
  assert.equal(state.runTranscripts.length, 1);
  const record = state.runTranscripts[0];
  assert.equal(record.id, "trs_inv_1");
  assert.equal(record.invocationId, "inv_1");
  assert.equal(record.projectId, "prj_a");
  assert.equal(record.agentId, "agt_claude");
  assert.equal(record.status, "succeeded");
  assert.equal(record.blocks.length, 4);
  assert.equal(record.blocks[0].durationMs, 4000);
  assert.ok(!("transcript" in invocation.result), "raw payload has exactly one durable home");
});

test("a failed run's transcript is ingested too; a transcript-less result records nothing", () => {
  const { state, runtime } = completionHarness();
  runtime.completeInvocation(makeInvocation("inv_fail"), {
    status: "failed",
    result: { output: { error: "exit 1" }, transcript: goodTranscript() },
  });
  runtime.completeInvocation(makeInvocation("inv_plain"), {
    status: "succeeded",
    result: { output: {} },
  });
  assert.equal(state.runTranscripts.length, 1);
  assert.equal(state.runTranscripts[0].invocationId, "inv_fail");
  assert.equal(state.runTranscripts[0].status, "failed");
});

test("recordRunTranscript upserts per invocation and caps the collection newest-first", () => {
  const state = { runTranscripts: [] };
  const invocation = makeInvocation("inv_dup", "succeeded");
  recordRunTranscript({ state, invocation, result: { transcript: goodTranscript() }, now });
  recordRunTranscript({ state, invocation, result: { transcript: goodTranscript() }, now });
  assert.equal(state.runTranscripts.length, 1, "re-delivery replaces, never duplicates");
  for (let i = 0; i < MAX_RUN_TRANSCRIPTS + 10; i += 1) {
    recordRunTranscript({
      state,
      invocation: makeInvocation(`inv_${i}`, "succeeded"),
      result: { transcript: goodTranscript() },
      now,
    });
  }
  assert.equal(state.runTranscripts.length, MAX_RUN_TRANSCRIPTS);
  assert.equal(state.runTranscripts[0].invocationId, `inv_${MAX_RUN_TRANSCRIPTS + 9}`, "newest first");
});

// --- retention: payload reaped, skeleton survives ---

test("retention reaps old transcript payloads to skeletons and keeps fresh ones", () => {
  const state = {
    retentionSettings: { logsDays: 30 },
    runTranscripts: [
      {
        id: "trs_old",
        invocationId: "inv_old",
        blocks: goodTranscript().blocks,
        totalChars: 60,
        payloadReaped: false,
        createdAt: "2026-05-01T00:00:00.000Z",
      },
      {
        id: "trs_fresh",
        invocationId: "inv_fresh",
        blocks: goodTranscript().blocks,
        totalChars: 60,
        payloadReaped: false,
        createdAt: "2026-07-14T00:00:00.000Z",
      },
    ],
  };
  const { reaped } = applyRetentionPolicies(state, { now });
  assert.equal(reaped, 1);
  const old = state.runTranscripts[0];
  assert.equal(old.payloadReaped, true);
  assert.equal(old.reapedAt, NOW);
  assert.deepEqual(old.blocks.map((b) => b.kind), ["thinking", "tool_use", "tool_result", "text"], "shape survives");
  assert.ok(old.blocks.every((b) => b.payloadDropped), "every payload is gone");
  assert.ok(!("text" in old.blocks[0]) && !("input" in old.blocks[1]) && !("output" in old.blocks[2]));
  assert.equal(old.blocks[1].toolName, "Bash", "tool names survive the reap");
  assert.equal(old.blocks[0].durationMs, 4000, "durations survive the reap");
  const fresh = state.runTranscripts[1];
  assert.equal(fresh.payloadReaped, false);
  assert.equal(fresh.blocks[0].text, "Let me look.");
  // Idempotent: a second sweep reaps nothing new.
  assert.equal(applyRetentionPolicies(state, { now }).reaped, 0);
});

// --- read route: guarded exactly like the invocation itself ---

function routeHarness(actor) {
  const state = {
    projects: [
      { id: "prj_a", ownerTeamId: "team_a" },
      { id: "prj_b", ownerTeamId: "team_b" },
    ],
    runTranscripts: [
      { id: "trs_inv_a", invocationId: "inv_a", blocks: goodTranscript().blocks, payloadReaped: false },
    ],
  };
  const invocations = {
    inv_a: { id: "inv_a", projectId: "prj_a" },
    inv_bare: { id: "inv_bare", projectId: "prj_a" },
  };
  const responses = [];
  const call = async (path) => {
    const handled = await handleInvocationRoutes({
      req: { method: "GET", headers: {} },
      res: {},
      url: new URL(`http://localhost${path}`),
      sendJson: (_res, statusCode, body) => responses.push({ statusCode, body }),
      readJson: async () => ({}),
      state,
      actor,
      findInvocation: (id) => invocations[id] ?? null,
    });
    return { handled, response: responses.at(-1) };
  };
  return { call };
}

test("GET /api/invocations/:id/transcript returns the owner's transcript", async () => {
  const { call } = routeHarness({ teamId: "team_a" });
  const { handled, response } = await call("/api/invocations/inv_a/transcript");
  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.invocationId, "inv_a");
  assert.equal(response.body.transcript.blocks.length, 4);
});

test("GET transcript is denied cross-tenant as a 404, indistinguishable from absence", async () => {
  const { call } = routeHarness({ teamId: "team_b" });
  const { response } = await call("/api/invocations/inv_a/transcript");
  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error, "invocation_not_found");
});

test("GET transcript: unknown run is 404; a run without a transcript is 200 + null", async () => {
  const { call } = routeHarness({ teamId: "team_a" });
  const missing = await call("/api/invocations/inv_missing/transcript");
  assert.equal(missing.response.statusCode, 404);
  const bare = await call("/api/invocations/inv_bare/transcript");
  assert.equal(bare.response.statusCode, 200);
  assert.equal(bare.response.body.transcript, null);
});
