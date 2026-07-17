/*
 * #890.2 — invocation acceptance & completion durability (unit-of-work boundary).
 *
 * Crash semantics are modelled by making persistStateSoon a NO-OP (the 20ms
 * debounce that a crash would eat) while persistStateNow is the real synchronous
 * flush. So a record is on disk after the call ONLY IF the synchronous barrier
 * fired. Under the pre-#890.2 code the rejection returns and the whole completion
 * path used persistStateSoon only — a crash there lost the rejection, or (worse)
 * lost a committed ledger entry and re-ran the invocation (double charge). These
 * tests reload from disk with the debounce disabled and prove each outcome
 * survived: accept, reject, and completion + ledger.
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createInvocationCompletionRuntime } from "../src/services/invocations/completion.mjs";
import { createInvocationCreationRuntime } from "../src/services/invocations/creation.mjs";
import { createM3Service } from "../src/services/m3.mjs";
import { sameProjectPath } from "../src/services/projects.mjs";

const now = () => "2026-07-14T00:00:00.000Z";
const TERMINAL = new Set(["succeeded", "failed", "timed_out", "cancelled", "rejected", "expired"]);
const isTerminal = (s) => TERMINAL.has(s);

const agent = {
  id: "agt_1",
  name: "Coder",
  adapter: { type: "cli" },
  location: { type: "local_device", deviceId: "dev_1" },
  economics: { model: "external_metered", costOwner: "usr_local", currency: "USD", budgetPoolId: null },
};

/**
 * A live runtime whose synchronous barrier (persistStateNow) writes to disk, but
 * whose debounce (persistStateSoon) is a NO-OP — the crash model above. Returns
 * the shared state + creation/completion services + a reload() that restores a
 * fresh state purely from the on-disk snapshot.
 */
function durableRuntime(projectPath, stateStorePath, { budgetGate = { blocked: false } } = {}) {
  const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now });
  const persistence = createPersistenceRuntime({
    state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject, sameProjectPath,
  });
  let n = 0;
  const nextId = (p) => `${p}_${++n}`;
  const persistStateNow = () => persistence.persistStateNow();
  const persistStateSoon = () => {}; // the debounce a crash eats
  const appendEvent = (event) => {
    state.events.unshift({ id: nextId("evt"), createdAt: now(), ...event });
    persistStateSoon();
  };
  const m3 = createM3Service({ state, now, nextId, appendEvent, findAgent: () => agent });

  const creation = createInvocationCreationRuntime({
    state, now, nextId, appendEvent, persistStateSoon, persistStateNow,
    defaultAgent: () => agent,
    currentProject: () => state.projects[0],
    worktreeForProject: () => null,
    normalizeCodexApprovalMode: () => null,
    normalizeCodexSessionMode: () => null,
    normalizeCodexWorkspacePolicy: () => null,
    createManagedCodexWorkspace: () => null,
    createManagedCodexSession: () => null,
    resolveResumeCodexSessionId: () => null,
    evaluateInvocationPolicy: () => ({ decision: "allow", reason: "ok", riskLevel: "low", riskTags: [] }),
    enforcePlatformAiQuota: () => null,
    createPolicyDecisionRecord: (invocation) => {
      const record = { id: `pdr_${invocation.id}`, decision: "allowed", reason: "ok" };
      state.policyDecisionRecords.push(record);
      return record;
    },
    createApprovalRequest: () => ({ id: "apr_1" }),
    completeRootSpan: () => {},
    createAuditSummary: (invocation) => ({ id: `aud_${invocation.id}`, invocationId: invocation.id }),
    recordAgentUsage: () => {},
    budgetGateForProject: () => budgetGate,
  });

  const completion = createInvocationCompletionRuntime({
    state, now, appendEvent, persistStateSoon, persistStateNow,
    namespace: "test", protocolVersion: "0.0.0",
    findAgent: () => agent,
    findInvocation: (id) => state.invocations.find((i) => i.id === id) ?? null,
    closeCodexSession: () => {},
    isTerminal,
    recordInvocationLedgerEntry: m3.recordInvocationLedgerEntry,
  });

  const reload = () => {
    const fresh = createServerState({ defaultProjectPath: projectPath, now });
    createPersistenceRuntime({
      state: fresh.state, enabled: true, stateStorePath, schemaVersion: 1, now,
      defaultProject: fresh.defaultProject, sameProjectPath,
    }).restorePersistentState();
    return fresh.state;
  };

  return { state, creation, completion, m3, reload };
}

function withTmp(fn) {
  const root = join(tmpdir(), `myagenttool-inv-durability-${Date.now()}-${Math.floor(process.hrtime()[1] % 1e6)}`);
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPath, { recursive: true });
  try {
    return fn({ projectPath, stateStorePath });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("#890.2 an accepted invocation + its idempotency key survive a crash (debounce disabled)", () => {
  withTmp(({ projectPath, stateStorePath }) => {
    const rt = durableRuntime(projectPath, stateStorePath);
    const inv = rt.creation.createInvocation("do the thing", agent, { idempotencyKey: "k1", actor: { userId: "u1" } });

    const restored = rt.reload();
    const found = restored.invocations.find((i) => i.id === inv.id);
    assert(found, "the accepted invocation is on disk from the synchronous barrier, not the debounce");
    assert.equal(found.idempotencyKey, "k1", "its client idempotency key is durable with it");
    assert(found.delivery, "the dispatch-claim fields are durable with it");
    assert.equal(found.policyDecisionId, `pdr_${inv.id}`, "the policy record link is durable");
    assert(restored.traces.some((t) => t.subjectId === inv.id), "its trace is durable");
    assert(restored.events.some((e) => e.invocationId === inv.id && e.type === "invocation_created"), "its events are durable");
  });
});

test("#890.2 idempotency dedup holds across restart", () => {
  withTmp(({ projectPath, stateStorePath }) => {
    const rt = durableRuntime(projectPath, stateStorePath);
    const first = rt.creation.createInvocation("t", agent, { idempotencyKey: "k1", actor: { userId: "u1" } });

    // A fresh runtime restored from disk — a retried create with the same key
    // must return the SAME run, not spawn a second.
    const rt2 = durableRuntime(projectPath, stateStorePath);
    // seed rt2's state from disk so the dedup scan sees the prior run
    const restored = rt.reload();
    rt2.state.invocations = restored.invocations;
    const retry = rt2.creation.createInvocation("t", agent, { idempotencyKey: "k1", actor: { userId: "u1" } });
    assert.equal(retry.id, first.id, "the retry after restart returns the original run");
    assert.equal(rt2.state.invocations.filter((i) => i.idempotencyKey === "k1").length, 1, "no duplicate run");
  });
});

test("#890.2 a REJECTED invocation survives a crash (W1 — was debounce-only)", () => {
  withTmp(({ projectPath, stateStorePath }) => {
    const rt = durableRuntime(projectPath, stateStorePath, { budgetGate: { blocked: true, reason: "Project budget exceeded." } });
    const inv = rt.creation.createInvocation("t", agent, { actor: { userId: "u1" } });
    assert.equal(inv.status, "rejected");

    const restored = rt.reload();
    const found = restored.invocations.find((i) => i.id === inv.id);
    assert(found, "the rejection is durable (pre-#890.2 it would be lost with the eaten debounce)");
    assert.equal(found.status, "rejected");
    assert(restored.refusals.some((r) => r.subject?.id === inv.id), "the refusal evidence is durable");
    assert(restored.auditSummaries.some((a) => a.invocationId === inv.id), "the audit summary is durable");
  });
});

test("#890.2 completion + ledger entry survive a crash — no lost charge, no re-run (W3)", () => {
  withTmp(({ projectPath, stateStorePath }) => {
    const rt = durableRuntime(projectPath, stateStorePath);
    const inv = rt.creation.createInvocation("t", agent, { actor: { userId: "u1" } });

    rt.completion.completeInvocation(inv, {
      status: "succeeded",
      summary: "done",
      result: { cost: { amountUsd: 2.5, currency: "USD", model: "demo", billable: true } },
    });

    const restored = rt.reload();
    const found = restored.invocations.find((i) => i.id === inv.id);
    assert.equal(found.status, "succeeded", "the terminal status is durable — the run will NOT be re-dispatched");
    const ledger = restored.ledgerEntries.filter((e) => e.sourceRecordId === inv.id);
    assert.equal(ledger.length, 1, "the committed ledger entry is durable (exactly one charge)");
    assert.equal(ledger[0].amountUsd, 2.5);
  });
});

test("#890.2 completing an already-terminal invocation is a no-op (idempotent completion)", () => {
  withTmp(({ projectPath, stateStorePath }) => {
    const rt = durableRuntime(projectPath, stateStorePath);
    const inv = rt.creation.createInvocation("t", agent, { actor: { userId: "u1" } });
    const cost = { status: "succeeded", result: { cost: { amountUsd: 2.5, currency: "USD", model: "demo", billable: true } } };
    rt.completion.completeInvocation(inv, cost);
    rt.completion.completeInvocation(inv, cost); // a redelivered completion must not double-charge

    const restored = rt.reload();
    assert.equal(restored.ledgerEntries.filter((e) => e.sourceRecordId === inv.id).length, 1, "no second ledger entry");
  });
});
