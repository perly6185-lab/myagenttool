import type { IsoDateTime, JsonObject } from "./common.js";

/**
 * The refusal model — Epic #758, Phase 1 (#759).
 *
 * A refusal is a first-class, auditable reply: *this was refused, and here is
 * why*. It is NOT a failure (`failed` = the device tried and could not finish;
 * `refused` = the device declined to try) and NOT an incident.
 *
 * Design of record: `docs/vision/REFUSAL_MODEL.md`. The runtime mirror of these
 * arrays plus the completeness map (`refusalEventCatalog`) live in
 * `./index.mjs` and are asserted by `test/refusal.test.mjs`.
 *
 * Phase 1 is types + taxonomy only: no records are written yet.
 */

export type RefusalId = `ref_${string}`;

/**
 * The four categories, in evaluation order. Wrong order leaks capability
 * existence (`not_granted` must be first) or wakes the device owner for a
 * request that `policy`/`state` would refuse anyway (`human` must be last).
 */
export const refusalCategories = [
  "not_granted",
  "policy",
  "state",
  "human",
] as const;

export type RefusalCategory = (typeof refusalCategories)[number];

/**
 * The CLOSED code enum, versioned with the device API. Adding a code is a
 * deliberate protocol change — never a string literal at a call site. Each code
 * belongs to exactly one category (see `refusalCodesByCategory`).
 */
export const refusalCodes = [
  // not_granted
  "capability_not_granted",
  // policy
  "command_not_allowlisted",
  "cwd_outside_approved_root",
  "file_policy_exceeded",
  "network_policy_exceeded",
  "action_not_permitted",
  // state
  "subject_not_actionable",
  "over_budget",
  "over_quota",
  "undeliverable",
  "binary_unavailable",
  // human
  "approval_denied",
  "deliverable_rejected",
  "gate_rejected",
] as const;

export type RefusalCode = (typeof refusalCodes)[number];

/** Each code belongs to exactly one category. */
export const refusalCodesByCategory: Record<RefusalCategory, readonly RefusalCode[]> = {
  not_granted: ["capability_not_granted"],
  policy: [
    "command_not_allowlisted",
    "cwd_outside_approved_root",
    "file_policy_exceeded",
    "network_policy_exceeded",
    "action_not_permitted",
  ],
  state: [
    "subject_not_actionable",
    "over_budget",
    "over_quota",
    "undeliverable",
    // The device that would run a binary wrapper does not have the binary
    // installed (git is a per-device property) — an environment state, not a
    // policy rule (#802).
    "binary_unavailable",
  ],
  human: ["approval_denied", "deliverable_rejected", "gate_rejected"],
};

export const refusalSubjectKinds = [
  "invocation",
  "lifecycle_action",
  "capability_call",
  "worktree_action",
  "application_action",
  "registration",
] as const;

export type RefusalSubjectKind = (typeof refusalSubjectKinds)[number];

export const refusalRequesterKinds = [
  "local_user",
  "control_plane",
  "automation",
] as const;

export type RefusalRequesterKind = (typeof refusalRequesterKinds)[number];

export const refusalDeciderKinds = [
  "grant",
  "policy_engine",
  "arbiter",
  "user",
] as const;

export type RefusalDeciderKind = (typeof refusalDeciderKinds)[number];

export interface RefusalSubject {
  kind: RefusalSubjectKind;
  id: string;
}

export interface RefusalRequester {
  kind: RefusalRequesterKind;
  id: string;
}

export interface RefusalDecider {
  kind: RefusalDeciderKind;
  id: string;
}

/** The refusal record. Written into `state.refusals[]` starting in Phase 2. */
export interface Refusal {
  id: RefusalId;
  at: IsoDateTime;
  subject: RefusalSubject;
  requester: RefusalRequester;
  category: RefusalCategory;
  code: RefusalCode;
  decidedBy: RefusalDecider;
  /** One line, for a person. */
  summary: string;
  /** Gate-specific proof, verbatim, NOT normalized. Opaque drill-down. */
  evidence: JsonObject;
  /** What would make this succeed. */
  remedy: string;
  /** ISO time, or null if retry cannot help. */
  retryAfter: IsoDateTime | null;
  /** Who can overturn it, or null if nobody can. */
  appealTo: string | null;
}

/**
 * One row of the completeness map: an existing refusal event type (or blocking
 * HTTP error code) and the `(category, code)` it maps onto. Umbrella event types
 * that refuse for several reasons appear once per `reason`.
 */
export interface RefusalCatalogEntry {
  /** The existing event type or HTTP error code string. */
  eventType: string;
  /** Disambiguates umbrella events that refuse for several reasons. */
  reason?: string;
  category: RefusalCategory;
  code: RefusalCode;
  /** True for a protocol-declared type with no emitter yet (reserved). */
  reserved?: boolean;
  /** True for an HTTP error code rather than an emitted event. */
  httpErrorCode?: boolean;
}
