// The Evidence Center's data: a per-run TRUST LEDGER. It answers "can I trust what
// this agent run produced?" by rolling up, per invocation, the evidence that today
// is scattered across the Review, Audit, and per-invocation inspector surfaces:
// code-review findings, the audit/permission record, a troubleshooting report, and
// Codex/terminal runtime evidence.
//
// PURE over the already team-scoped read-model locals, so it inherits tenancy for
// free (rows are only ever built for invocations the viewer can see; evidence whose
// invocationId isn't a visible run simply never attaches). Mirrors the
// pending-decisions aggregator.
//
// Not per-invocation, so intentionally NOT folded in here: eval capability trend
// (global, its own Capability section) and agent health checks (agent-keyed, shown
// in Audit). Those stay where they are; this ledger is about per-run change evidence.

const ATTENTION_STATUSES = new Set(["failed", "timed_out", "expired", "rejected"]);

function truncate(text, max = 90) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function countBy(list, pick) {
  const out = {};
  for (const item of list) {
    const k = pick(item);
    if (k == null) continue;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/**
 * @param {object} sources - already team-scoped read-model locals
 * @param {Array<object>} sources.invocations - visible invocations (the row subjects)
 * @param {Array<object>} sources.reviewFindings - codex+claude merged findings
 * @param {Array<object>} sources.auditSummaries - per-invocation audit records
 * @param {Array<object>} sources.troubleshootingReports
 * @param {Array<object>} sources.evidenceCenterRecords - codex/terminal runtime evidence aggregate
 * @param {Array<object>} sources.applicationRecoveryActions - application recovery requests (attest both the failed run and its recovery result)
 * @returns {Array<object>} one rollup row per invocation that has substantive evidence, newest first
 */
export function evidenceLedger({
  invocations = [],
  reviewFindings = [],
  auditSummaries = [],
  troubleshootingReports = [],
  evidenceCenterRecords = [],
  applicationRecoveryActions = [],
  runTranscripts = [],
} = {}) {
  // Index every evidence source by the invocation it attests to.
  const findingsByInv = new Map();
  for (const f of reviewFindings) {
    if (f?.invocationId == null) continue;
    const list = findingsByInv.get(f.invocationId);
    if (list) list.push(f);
    else findingsByInv.set(f.invocationId, [f]);
  }
  const auditByInv = new Map();
  for (const a of auditSummaries) if (a?.invocationId != null) auditByInv.set(a.invocationId, a);
  const troubleshootByInv = new Map();
  for (const t of troubleshootingReports) if (t?.invocationId != null && !troubleshootByInv.has(t.invocationId)) troubleshootByInv.set(t.invocationId, t);
  const runtimeCountByInv = new Map();
  for (const e of evidenceCenterRecords) {
    if (e?.invocationId == null) continue;
    runtimeCountByInv.set(e.invocationId, (runtimeCountByInv.get(e.invocationId) ?? 0) + 1);
  }
  // Recovery requests attest two runs: the failed run they recover (invocationId)
  // and the run they produced (resultInvocationId — provenance).
  const recoveryByInv = new Map();
  const recoveryResultByInv = new Map();
  for (const r of applicationRecoveryActions) {
    if (r?.invocationId != null) {
      const list = recoveryByInv.get(r.invocationId);
      if (list) list.push(r);
      else recoveryByInv.set(r.invocationId, [r]);
    }
    if (r?.resultInvocationId != null && !recoveryResultByInv.has(r.resultInvocationId)) {
      recoveryResultByInv.set(r.resultInvocationId, r);
    }
  }
  // #1085: transcript SUMMARY metadata per run (hash/counts — never blocks).
  const transcriptByInv = new Map();
  for (const t of runTranscripts) if (t?.invocationId != null && !transcriptByInv.has(t.invocationId)) transcriptByInv.set(t.invocationId, t);

  const stamp = (r) => r?.updatedAt ?? r?.createdAt ?? "";

  const rows = [];
  for (const inv of invocations) {
    const id = inv?.id;
    if (id == null) continue;
    const findings = findingsByInv.get(id) ?? [];
    const audit = auditByInv.get(id) ?? null;
    const troubleshooting = troubleshootByInv.get(id) ?? null;
    const runtimeEvidence = runtimeCountByInv.get(id) ?? 0;
    const failed = ATTENTION_STATUSES.has(inv.status);
    const denied = audit?.permissionDecision === "denied";
    const recoveryRequests = recoveryByInv.get(id) ?? [];
    const latestRecovery = recoveryRequests.reduce(
      (latest, r) => (latest == null || stamp(r) > stamp(latest) ? r : latest),
      null,
    );
    const recoveryResultOf = recoveryResultByInv.get(id) ?? null;
    const metadata = inv.options?.metadata ?? {};
    const application = metadata.source === "application_orchestration" || metadata.applicationId
      ? {
          id: metadata.applicationId ?? null,
          name: metadata.applicationName ?? null,
          routineId: metadata.routineId ?? null,
        }
      : null;

    const transcriptRecord = transcriptByInv.get(id) ?? null;
    const transcriptSuperseded = Boolean(transcriptRecord?.supersededHash);

    // A run earns a ledger row only when there's something to evaluate — a plain
    // allowed run with no findings/evidence is not interesting for a trust surface
    // (and would just duplicate the Invocations list). Recovery evidence counts:
    // a recovered run's resolution story, and a recovery result's provenance, are
    // exactly what a trust surface is for. A transcript's mere PRESENCE does not
    // create a row (every claude run has one — that's the Invocations list), but
    // a SUPERSEDED transcript does: replaced-after-delivery is a trust signal.
    const hasEvidence = findings.length > 0 || runtimeEvidence > 0 || Boolean(troubleshooting) || denied || failed
      || recoveryRequests.length > 0 || Boolean(recoveryResultOf) || transcriptSuperseded;
    if (!hasEvidence) continue;

    const severity = countBy(findings, (f) => f?.severity);
    const high = severity.high ?? 0;

    const attentionReasons = [];
    if (high > 0) attentionReasons.push(`${high} high-severity finding${high > 1 ? "s" : ""}`);
    if (denied) attentionReasons.push("permission denied");
    if (failed) attentionReasons.push(`run ${inv.status}`);
    if (troubleshooting) attentionReasons.push("needs troubleshooting");
    if (latestRecovery?.status === "approval_pending") attentionReasons.push("recovery awaiting approval");
    else if (latestRecovery?.status === "failed") attentionReasons.push("recovery failed");
    else if (latestRecovery?.status === "approval_denied") attentionReasons.push("recovery denied");
    else if (latestRecovery?.status === "approval_timed_out") attentionReasons.push("recovery approval timed out");
    if (transcriptSuperseded) attentionReasons.push("transcript superseded after delivery");

    rows.push({
      invocationId: id,
      task: truncate(inv.task ?? inv.input?.task ?? ""),
      agentId: inv.agentId ?? null,
      terminalId: inv.terminalId ?? inv.delivery?.deviceId ?? audit?.terminalId ?? audit?.deviceId ?? null,
      projectId: inv.projectId ?? findings[0]?.projectId ?? null,
      status: inv.status ?? null,
      createdAt: inv.createdAt ?? null,
      review: { total: findings.length, high, medium: severity.medium ?? 0, low: severity.low ?? 0 },
      audit: audit ? { permissionDecision: audit.permissionDecision ?? null, status: audit.status ?? null } : null,
      troubleshooting: { present: Boolean(troubleshooting), fixes: troubleshooting?.suggestedFixes?.length ?? 0 },
      transcript: transcriptRecord
        ? {
            present: true,
            contentHash: transcriptRecord.contentHash ?? null,
            blocks: transcriptRecord.blocks?.length ?? 0,
            truncated: transcriptRecord.truncated === true,
            payloadReaped: transcriptRecord.payloadReaped === true,
            superseded: transcriptSuperseded,
          }
        : null,
      runtimeEvidence,
      application,
      recovery: latestRecovery
        ? {
            total: recoveryRequests.length,
            latestStatus: latestRecovery.status ?? null,
            latestActionType: latestRecovery.actionType ?? null,
            executed: recoveryRequests.some((r) => r?.status === "executed"),
          }
        : null,
      recoveryResultOf: recoveryResultOf
        ? {
            invocationId: recoveryResultOf.invocationId ?? null,
            actionType: recoveryResultOf.actionType ?? null,
            recoveryActionRequestId: recoveryResultOf.id ?? null,
          }
        : null,
      attention: attentionReasons.length > 0,
      attentionReasons,
    });
  }

  // Newest run first (deterministic tiebreak on invocationId).
  return rows.sort((a, b) => {
    const at = a.createdAt ?? "";
    const bt = b.createdAt ?? "";
    if (at !== bt) return at > bt ? -1 : 1;
    return a.invocationId < b.invocationId ? -1 : a.invocationId > b.invocationId ? 1 : 0;
  });
}
