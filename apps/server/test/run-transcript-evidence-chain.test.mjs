import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_RUN_TRANSCRIPTS,
  recordRunTranscript,
  reapRunTranscriptPayloads,
  transcriptContentHash,
} from "../src/services/run-transcripts.mjs";
import { applyRetentionPolicies } from "../src/services/retention.mjs";

// #1084: the transcript's evidence chain — integrity hash, supersede trail,
// lifecycle events, traceId, and archived (not vanished) count-cap evictions.

const NOW = "2026-07-15T12:00:00.000Z";
const now = () => NOW;

const blocks = (text = "**done**") => [
  { kind: "thinking", text: "look", durationMs: 1000 },
  { kind: "text", text },
];
const resultWith = (text) => ({ transcript: { blocks: blocks(text), droppedBlocks: 0, unparsedLines: 0 } });
const invocation = (id) => ({ id, status: "succeeded", agentId: "agt_claude", projectId: "prj_a", traceId: `trc_${id}` });

function harness() {
  const state = { runTranscripts: [] };
  const events = [];
  const archived = [];
  const appendEvent = (event) => events.push(event);
  const capWithArchive = (list, max, collection) => {
    if (list.length <= max) return list;
    archived.push({ collection, rows: list.slice(max) });
    return list.slice(0, max);
  };
  return { state, events, archived, appendEvent, capWithArchive };
}

test("record stamps traceId + server-computed contentHash and emits run_transcript_recorded", () => {
  const { state, events, appendEvent } = harness();
  const record = recordRunTranscript({ state, invocation: invocation("inv_1"), result: resultWith(), now, appendEvent });
  assert.equal(record.traceId, "trc_inv_1");
  assert.equal(record.contentHash, transcriptContentHash(record.blocks));
  assert.match(record.contentHash, /^[0-9a-f]{64}$/);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "run_transcript_recorded");
  assert.equal(events[0].invocationId, "inv_1");
  assert.equal(events[0].data.contentHash, record.contentHash);
  assert.equal(events[0].data.blocks, 2);
});

test("a device-supplied contentHash is ignored — the hash is always server-computed", () => {
  const { state, appendEvent } = harness();
  const result = { transcript: { blocks: blocks(), contentHash: "f".repeat(64) } };
  const record = recordRunTranscript({ state, invocation: invocation("inv_h"), result, now, appendEvent });
  assert.notEqual(record.contentHash, "f".repeat(64));
  assert.equal(record.contentHash, transcriptContentHash(record.blocks));
});

test("identical re-delivery is an idempotent no-op; different content leaves a supersede trail", () => {
  const { state, events, appendEvent } = harness();
  const inv = invocation("inv_2");
  const first = recordRunTranscript({ state, invocation: inv, result: resultWith("v1"), now, appendEvent });
  const replay = recordRunTranscript({ state, invocation: inv, result: resultWith("v1"), now, appendEvent });
  assert.equal(replay, first, "same content returns the existing record untouched");
  assert.equal(events.filter((e) => e.type === "run_transcript_superseded").length, 0);

  const swapped = recordRunTranscript({ state, invocation: inv, result: resultWith("v2 — different"), now, appendEvent });
  assert.equal(state.runTranscripts.length, 1, "still one record per invocation");
  assert.equal(swapped.supersededHash, first.contentHash, "the replaced content's hash survives on the new record");
  assert.equal(swapped.supersededAt, NOW);
  const supersedeEvents = events.filter((e) => e.type === "run_transcript_superseded");
  assert.equal(supersedeEvents.length, 1);
  assert.equal(supersedeEvents[0].data.supersededHash, first.contentHash);
  assert.equal(supersedeEvents[0].data.contentHash, swapped.contentHash);
});

test("count-cap evictions go through the archive instead of vanishing", () => {
  const { state, archived, appendEvent, capWithArchive } = harness();
  for (let i = 0; i <= MAX_RUN_TRANSCRIPTS; i += 1) {
    recordRunTranscript({ state, invocation: invocation(`inv_${i}`), result: resultWith(`t${i}`), now, appendEvent, capWithArchive });
  }
  assert.equal(state.runTranscripts.length, MAX_RUN_TRANSCRIPTS);
  assert.equal(archived.length, 1);
  assert.equal(archived[0].collection, "runTranscripts");
  assert.equal(archived[0].rows[0].invocationId, "inv_0", "the oldest transcript is archived, not dropped");
});

test("retention sweep reaps payloads and leaves ONE event naming the affected runs", () => {
  const events = [];
  const state = {
    retentionSettings: { logsDays: 30 },
    runTranscripts: [
      { id: "trs_old_a", invocationId: "inv_old_a", blocks: blocks(), payloadReaped: false, createdAt: "2026-05-01T00:00:00.000Z" },
      { id: "trs_old_b", invocationId: "inv_old_b", blocks: blocks(), payloadReaped: false, createdAt: "2026-05-02T00:00:00.000Z" },
      { id: "trs_new", invocationId: "inv_new", blocks: blocks(), payloadReaped: false, createdAt: "2026-07-14T00:00:00.000Z" },
    ],
  };
  const { reaped } = applyRetentionPolicies(state, { now, appendEvent: (e) => events.push(e) });
  assert.equal(reaped, 2);
  const reapEvents = events.filter((e) => e.type === "run_transcript_payloads_reaped");
  assert.equal(reapEvents.length, 1, "one event per sweep, not per record");
  assert.deepEqual(reapEvents[0].data.invocationIds.sort(), ["inv_old_a", "inv_old_b"]);
  // A second sweep reaps nothing and stays silent.
  const again = applyRetentionPolicies(state, { now, appendEvent: (e) => events.push(e) });
  assert.equal(again.reaped, 0);
  assert.equal(events.filter((e) => e.type === "run_transcript_payloads_reaped").length, 1);
});

test("reap keeps contentHash on the skeleton — existence stays provable after the payload is gone", () => {
  const state = {
    runTranscripts: [{
      id: "trs_x",
      invocationId: "inv_x",
      contentHash: transcriptContentHash(blocks()),
      blocks: blocks(),
      payloadReaped: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    }],
  };
  const { reaped, invocationIds } = reapRunTranscriptPayloads(state, { cutoffMs: Date.parse(NOW), now });
  assert.equal(reaped, 1);
  assert.deepEqual(invocationIds, ["inv_x"]);
  const record = state.runTranscripts[0];
  assert.match(record.contentHash, /^[0-9a-f]{64}$/, "hash survives the reap");
  assert.ok(record.blocks.every((b) => b.payloadDropped));
});

test("ingest without appendEvent/capWithArchive still works (hermetic harness degradation)", () => {
  const state = { runTranscripts: [] };
  const record = recordRunTranscript({ state, invocation: invocation("inv_bare"), result: resultWith(), now });
  assert.ok(record);
  assert.match(record.contentHash, /^[0-9a-f]{64}$/);
});
