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
 * @returns {Array<object>} one rollup row per invocation that has substantive evidence, newest first
 */
export function evidenceLedger({
  invocations = [],
  reviewFindings = [],
  auditSummaries = [],
  troubleshootingReports = [],
  evidenceCenterRecords = [],
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

    // A run earns a ledger row only when there's something to evaluate — a plain
    // allowed run with no findings/evidence is not interesting for a trust surface
    // (and would just duplicate the Invocations list).
    const hasEvidence = findings.length > 0 || runtimeEvidence > 0 || Boolean(troubleshooting) || denied || failed;
    if (!hasEvidence) continue;

    const severity = countBy(findings, (f) => f?.severity);
    const high = severity.high ?? 0;

    const attentionReasons = [];
    if (high > 0) attentionReasons.push(`${high} high-severity finding${high > 1 ? "s" : ""}`);
    if (denied) attentionReasons.push("permission denied");
    if (failed) attentionReasons.push(`run ${inv.status}`);
    if (troubleshooting) attentionReasons.push("needs troubleshooting");

    rows.push({
      invocationId: id,
      task: truncate(inv.task ?? inv.input?.task ?? ""),
      agentId: inv.agentId ?? null,
      projectId: inv.projectId ?? findings[0]?.projectId ?? null,
      status: inv.status ?? null,
      createdAt: inv.createdAt ?? null,
      review: { total: findings.length, high, medium: severity.medium ?? 0, low: severity.low ?? 0 },
      audit: audit ? { permissionDecision: audit.permissionDecision ?? null, status: audit.status ?? null } : null,
      troubleshooting: { present: Boolean(troubleshooting), fixes: troubleshooting?.suggestedFixes?.length ?? 0 },
      runtimeEvidence,
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
