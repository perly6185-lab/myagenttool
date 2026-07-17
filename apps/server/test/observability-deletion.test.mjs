/*
 * ADR 0018 — per-subject deletion of observability data. Erases CONTENT (and, at
 * tier `full`, telemetry rows) for a subject; the shielded set is never deleted;
 * deletion is auditable, idempotent, and owner-gated.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canDeleteObservabilityData,
  deleteObservabilityData,
  resolveSubjectInvocationIds,
} from "../src/services/observability-deletion.mjs";

const now = () => "2026-07-17T00:00:00.000Z";

function baseState() {
  return {
    agents: [{ id: "agt_1", location: { deviceId: "dev_1" } }, { id: "agt_2", location: { deviceId: "dev_2" } }],
    projects: [{ id: "proj_a", ownerTeamId: "team_a" }, { id: "proj_b", ownerTeamId: "team_b" }],
    invocations: [
      { id: "inv_u1", requestedBy: "usr_1", agentId: "agt_1", projectId: "proj_a", result: { output: { patch: "diff --git a b", contentHash: "h" } } },
      { id: "inv_u2", requestedBy: "usr_2", agentId: "agt_2", projectId: "proj_b" },
    ],
    invocationRounds: [
      { id: "r1", invocationId: "inv_u1", requestDigest: "prompt", responseDigest: "answer", inputTokens: 10 },
      { id: "r2", invocationId: "inv_u2", requestDigest: "other", responseDigest: "other" },
    ],
    toolInvocationRecords: [
      { id: "t1", invocationId: "inv_u1", inputDigest: "grep x", outputDigest: "match" },
    ],
    runTranscripts: [
      { invocationId: "inv_u1", createdAt: now(), blocks: [{ kind: "thinking", text: "secret plan" }], totalChars: 11 },
    ],
    events: [{ id: "e1", invocationId: "inv_u1" }, { id: "e2", invocationId: "inv_u2" }],
    traces: [{ id: "trc_1", subjectId: "inv_u1" }, { id: "trc_2", subjectId: "inv_u2" }],
    spans: [{ id: "s1", traceId: "trc_1" }, { id: "s2", traceId: "trc_2" }],
    // Shielded — must survive every deletion.
    ledgerEntries: [{ id: "led_1", userId: "usr_1", amountUsd: 5 }],
    lifecycleAuditRecords: [{ id: "lco_1", status: "failed" }],
    refusals: [{ id: "ref_1", invocationId: "inv_u1", category: "policy", summary: "blocked send to alice@example.com", evidence: { attempted: "call 13800138000" }, remedy: "ask alice@example.com" }],
    auditSummaries: [{ id: "aud_1" }],
  };
}

test("resolveSubjectInvocationIds scopes by user, device, and team", () => {
  const s = baseState();
  assert.deepEqual([...resolveSubjectInvocationIds(s, { scope: "user", subjectId: "usr_1" })], ["inv_u1"]);
  assert.deepEqual([...resolveSubjectInvocationIds(s, { scope: "device", subjectId: "dev_1" })], ["inv_u1"]);
  assert.deepEqual([...resolveSubjectInvocationIds(s, { scope: "team", subjectId: "team_a" })], ["inv_u1"]);
  assert.deepEqual([...resolveSubjectInvocationIds(s, { scope: "user", subjectId: "nobody" })], []);
});

test("operational deletion erases the subject's content, keeps the skeleton, leaves others", () => {
  const s = baseState();
  const events = [];
  const result = deleteObservabilityData(s, { scope: "user", subjectId: "usr_1", tier: "operational", now, appendEvent: (e) => events.push(e) });

  const r1 = s.invocationRounds.find((r) => r.id === "r1");
  assert.equal(r1.requestDigest, null, "prompt digest erased");
  assert.equal(r1.responseDigest, null);
  assert.equal(r1.inputTokens, 10, "skeleton (tokens) survives");
  assert.equal(s.toolInvocationRecords[0].inputDigest, null, "tool digest erased");
  assert.equal(s.runTranscripts[0].payloadReaped, true, "transcript reaped to skeleton");
  assert.equal(s.invocations[0].result.output.patch, undefined, "proposal patch removed");
  assert.equal(s.invocations[0].result.output.patchRedacted, true);
  assert.equal(s.invocations[0].result.output.contentHash, "h", "patch binding survives");

  // The OTHER subject is untouched.
  assert.equal(s.invocationRounds.find((r) => r.id === "r2").requestDigest, "other");

  // operational does NOT remove telemetry rows.
  assert.equal(s.events.length, 2);
  assert.equal(s.traces.length, 2);
  assert.equal(s.spans.length, 2);

  assert.equal(result.tier, "operational");
  assert.equal(events.filter((e) => e.type === "observability_data_deleted").length, 1);
  assert.equal(events[0].data.counts.digests, 4, "r1 request+response + t1 input+output");
  assert.equal(events[0].data.counts.patches, 1);
  assert.equal(events[0].data.counts.transcripts, 1);
});

test("full deletion additionally removes the subject's events/traces/spans", () => {
  const s = baseState();
  const result = deleteObservabilityData(s, { scope: "user", subjectId: "usr_1", tier: "full", now });
  assert.deepEqual(s.events.map((e) => e.id), ["e2"], "subject's event removed, other kept");
  assert.deepEqual(s.traces.map((t) => t.id), ["trc_2"]);
  assert.deepEqual(s.spans.map((sp) => sp.id), ["s2"], "spans under the removed trace are gone");
  assert.equal(result.counts.events, 1);
  assert.equal(result.counts.traces, 1);
  assert.equal(result.counts.spans, 1);
});

test("no tier ever deletes a shielded row (ledger/audit/refusals/summaries)", () => {
  const s = baseState();
  deleteObservabilityData(s, { scope: "user", subjectId: "usr_1", tier: "full", now });
  assert.equal(s.ledgerEntries.length, 1, "spend ledger retained of record");
  assert.equal(s.lifecycleAuditRecords.length, 1);
  assert.equal(s.refusals.length, 1);
  assert.equal(s.auditSummaries.length, 1);
});

test("a subject's shielded refusal is RETAINED but its PII is scrubbed (ADR 0018 invariant 4)", () => {
  const s = baseState();
  const events = [];
  const result = deleteObservabilityData(s, { scope: "user", subjectId: "usr_1", tier: "operational", now, appendEvent: (e) => events.push(e) });
  const refusal = s.refusals.find((r) => r.id === "ref_1");
  assert.ok(refusal, "the refusal is NOT deleted (retained of record)");
  assert.equal(refusal.category, "policy", "the taxonomy survives");
  assert.ok(!/alice@example\.com/.test(refusal.summary), "email PII scrubbed from summary");
  assert.ok(refusal.summary.includes("[redacted]"));
  assert.ok(!/13800138000/.test(refusal.evidence.attempted), "phone PII scrubbed from evidence");
  assert.ok(!/alice@example\.com/.test(refusal.remedy), "email PII scrubbed from remedy");
  assert.equal(refusal.piiRedacted, true);
  assert.equal(refusal.piiRedactedAt, now());
  assert.equal(result.counts.shieldedPiiRedacted, 1);
  const audit = events.find((e) => e.type === "observability_data_deleted");
  assert.equal(audit.data.counts.shieldedPiiRedacted, 1);
});

test("shielded PII scrub is idempotent and leaves other subjects' refusals alone", () => {
  const s = baseState();
  s.refusals.push({ id: "ref_2", invocationId: "inv_u2", summary: "other bob@example.com" });
  deleteObservabilityData(s, { scope: "user", subjectId: "usr_1", tier: "full", now });
  const second = deleteObservabilityData(s, { scope: "user", subjectId: "usr_1", tier: "full", now });
  assert.equal(second.counts.shieldedPiiRedacted, 0, "already-scrubbed refusal is not re-counted");
  assert.equal(s.refusals.find((r) => r.id === "ref_2").summary, "other bob@example.com", "team's other subject untouched");
});

test("deletion is idempotent — a second run changes nothing and still audits", () => {
  const s = baseState();
  const events = [];
  deleteObservabilityData(s, { scope: "user", subjectId: "usr_1", tier: "full", now, appendEvent: (e) => events.push(e) });
  const second = deleteObservabilityData(s, { scope: "user", subjectId: "usr_1", tier: "full", now, appendEvent: (e) => events.push(e) });
  assert.equal(second.counts.digests, 0, "nothing left to erase");
  assert.equal(second.counts.events, 0);
  // The first deletion's audit proof survives the second deletion (invocationId:null).
  assert.equal(events.filter((e) => e.type === "observability_data_deleted").length, 2);
});

test("a scoped actor can only delete its OWN team's data (cross-tenant is a no-op)", () => {
  const s = baseState();
  const actorA = { userId: "usr_a_owner", teamId: "team_a", role: "owner" };
  // usr_2's invocation inv_u2 is on proj_b / team_b — out of team_a's reach.
  const result = deleteObservabilityData(s, { scope: "user", subjectId: "usr_2", tier: "full", now, actor: actorA });
  assert.equal(result.invocationCount, 0, "no team_b invocation is in scope for a team_a actor");
  assert.equal(s.invocationRounds.find((r) => r.id === "r2").requestDigest, "other", "team_b content untouched");
  assert.deepEqual(s.events.map((e) => e.id), ["e1", "e2"], "team_b events untouched");
});

test("team scope with a foreign teamId deletes nothing", () => {
  const s = baseState();
  const actorA = { userId: "usr_a_owner", teamId: "team_a", role: "owner" };
  const result = deleteObservabilityData(s, { scope: "team", subjectId: "team_b", tier: "full", now, actor: actorA });
  assert.equal(result.invocationCount, 0);
  assert.equal(s.traces.length, 2, "team_b telemetry untouched");
});

test("a scoped actor deletes its own team's subject, and the audit records who deleted", () => {
  const s = baseState();
  const events = [];
  const actorA = { userId: "usr_a_owner", teamId: "team_a", role: "owner" };
  const result = deleteObservabilityData(s, { scope: "user", subjectId: "usr_1", tier: "operational", now, appendEvent: (e) => events.push(e), actor: actorA });
  assert.equal(result.invocationCount, 1, "team_a's own invocation is in scope");
  assert.equal(s.invocationRounds.find((r) => r.id === "r1").requestDigest, null, "own content erased");
  const audit = events.find((e) => e.type === "observability_data_deleted");
  assert.equal(audit.data.deletedBy, "usr_a_owner", "the deleting actor is recorded");
});

test("deletion is owner-gated", () => {
  assert.equal(canDeleteObservabilityData({ role: "owner" }), true);
  assert.equal(canDeleteObservabilityData({ role: "admin" }), true);
  assert.equal(canDeleteObservabilityData({ role: "operator" }), false);
  assert.equal(canDeleteObservabilityData({ role: "viewer" }), false);
  assert.equal(canDeleteObservabilityData(undefined), false);
});

/*
 * ADR 0019 B-3: per-subject erasure reaches the durable history table (outside the
 * mirrored snapshot). A small fake history store exercises the engine's wiring;
 * the real adapters are covered by the store contract suite.
 */
function fakeHistory(seed = []) {
  let rows = seed.map((r, i) => ({ seq: i + 1, ...r }));
  return {
    queryHistory: (collection, { invocationId = null } = {}) => ({
      rows: rows.filter((e) => e.collection === collection && (invocationId == null || String(e.invocationId) === String(invocationId))).map((e) => e.row),
      nextBefore: null,
    }),
    deleteHistory: (collection, scopeId) => {
      if (scopeId == null) return { deleted: 0 };
      const before = rows.length;
      rows = rows.filter((e) => !(e.collection === collection && String(e.invocationId) === String(scopeId)));
      return { deleted: before - rows.length };
    },
    redactHistory: (collection, scopeId, redactRow) => {
      let redacted = 0;
      for (const e of rows) {
        if (e.collection !== collection || String(e.invocationId) !== String(scopeId)) continue;
        const b = JSON.stringify(e.row);
        redactRow(e.row);
        if (JSON.stringify(e.row) !== b) redacted += 1;
      }
      return { redacted };
    },
    rows: () => rows,
  };
}

test("B-3 full deletion erases the subject's history telemetry, incl. spans of an evicted-only trace; other subject survives", () => {
  const s = baseState();
  const hist = fakeHistory([
    // Subject usr_1 (inv_u1). traces are scoped by subjectId=invocation.id; spans by traceId; events by invocationId.
    { collection: "traces", invocationId: "inv_u1", row: { id: "trc_1", subjectId: "inv_u1" } },
    { collection: "traces", invocationId: "inv_u1", row: { id: "trc_evicted", subjectId: "inv_u1" } }, // NOT in state.traces
    { collection: "spans", invocationId: "trc_1", row: { id: "sp_live", traceId: "trc_1" } },
    { collection: "spans", invocationId: "trc_evicted", row: { id: "sp_evicted", traceId: "trc_evicted" } },
    { collection: "events", invocationId: "inv_u1", row: { id: "ev_h", invocationId: "inv_u1" } },
    // Other subject usr_2 (inv_u2) — must survive.
    { collection: "traces", invocationId: "inv_u2", row: { id: "trc_2", subjectId: "inv_u2" } },
    { collection: "spans", invocationId: "trc_2", row: { id: "sp_other", traceId: "trc_2" } },
  ]);
  const events = [];
  const result = deleteObservabilityData(s, {
    scope: "user", subjectId: "usr_1", tier: "full", now, appendEvent: (e) => events.push(e),
    deleteHistory: hist.deleteHistory, redactHistory: hist.redactHistory, queryHistory: hist.queryHistory,
  });
  const remaining = hist.rows().map((e) => e.row.id).sort();
  assert.deepEqual(remaining, ["sp_other", "trc_2"], "only the OTHER subject's history rows survive");
  // 2 traces + 1 event + 2 spans (trc_1 live + trc_evicted gathered from history) = 5.
  assert.equal(result.counts.historyDeleted, 5);
  assert.equal(events[0].data.counts.historyDeleted, 5, "the audit event carries the history count");
});

test("B-3 operational deletion PII-scrubs shielded refusals in history (retained, not dropped); other subject untouched", () => {
  const s = baseState();
  const hist = fakeHistory([
    { collection: "refusals", invocationId: "inv_u1", row: { id: "ref_h", invocationId: "inv_u1", category: "policy", summary: "blocked send to bob@example.com", remedy: "call 13800138000" } },
    { collection: "refusals", invocationId: "inv_u2", row: { id: "ref_other", invocationId: "inv_u2", summary: "email carol@example.com" } },
  ]);
  const result = deleteObservabilityData(s, {
    scope: "user", subjectId: "usr_1", tier: "operational", now,
    deleteHistory: hist.deleteHistory, redactHistory: hist.redactHistory, queryHistory: hist.queryHistory,
  });
  assert.equal(result.counts.historyRedacted, 1);
  assert.equal(result.counts.historyDeleted, 0, "operational never deletes telemetry");
  const scrubbed = hist.rows().find((e) => e.row.id === "ref_h").row;
  assert.ok(scrubbed, "the refusal row is RETAINED, not deleted");
  assert.ok(!scrubbed.summary.includes("bob@example.com"), "summary PII scrubbed");
  assert.ok(!scrubbed.remedy.includes("13800138000"), "remedy PII scrubbed");
  assert.equal(scrubbed.piiRedacted, true);
  assert.ok(hist.rows().find((e) => e.row.id === "ref_other").row.summary.includes("carol@example.com"), "other subject's refusal untouched");
});

test("B-3 is a no-op without a store (memory backing): history counts stay 0, no throw", () => {
  const s = baseState();
  const result = deleteObservabilityData(s, { scope: "user", subjectId: "usr_1", tier: "full", now });
  assert.equal(result.counts.historyDeleted, 0);
  assert.equal(result.counts.historyRedacted, 0);
});
