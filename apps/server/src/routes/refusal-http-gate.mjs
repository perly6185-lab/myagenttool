import { refusalCodesByCategory } from "@myagenttool/protocol";

// Refusal model (#758): some gates deny via an HTTP error response
// (lifecycle_gate_blocked, rollback_gate_blocked, project_remove_blocked) rather
// than an emitted event, so Phase 2's refuse() chokepoint never saw them and they
// were invisible in the refusal ledger. This records them.
//
// The HTTP error already surfaces the veto to the operator, so these fire NO
// event (`event: null`) — purely additive auditability into the owner-only
// state.refusals[] (the Evidence Center refusal lens). Best-effort: a route
// constructed without refuse() (some unit tests) is a no-op.

const CATEGORY_OF = Object.fromEntries(
  Object.entries(refusalCodesByCategory).flatMap(([category, codes]) => codes.map((code) => [code, category])),
);

export function recordHttpGateRefusal(refuse, { subjectKind, subjectId, code, summary, evidence = {}, remedy = "", requester = null }) {
  if (typeof refuse !== "function") return;
  refuse({
    subject: { kind: subjectKind, id: subjectId ?? null },
    requester: requester ?? { kind: "local_user", id: null },
    category: CATEGORY_OF[code] ?? "policy",
    code,
    decidedBy: { kind: "policy_engine", id: "http_gate" },
    summary,
    evidence,
    remedy,
    retryAfter: null,
    appealTo: "device_owner",
    event: null,
  });
}
