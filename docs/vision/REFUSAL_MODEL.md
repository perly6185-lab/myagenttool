# The Refusal Model

> Epic #758. This document is the design of record for the refusal model. Phase 1
> (#759) lands the record shape, the closed code taxonomy, and the map below —
> **no behavior change**. Phase 2 (#760) routes every gate through a single
> `refuse()` writer. Phase 3 (#761) gives the veto one console view.

## Why

The device's veto is **built but not named**. The same idea — *this was refused,
and here is why* — is expressed today by ~30 distinct event types and HTTP error
codes, in four different data shapes, with no shared vocabulary and no single
place to look. An operator cannot answer *"what did this machine refuse this week,
and why?"* from any one surface.

A refusal is a **first-class, auditable reply** — not an error, not an incident.
`failed` = the device tried and could not finish. `refused` = the device declined
to try. Conflating the two teaches operators to route around the device's
judgment, which defeats the sovereignty model the veto exists to serve.

## The record

Emitted (Phase 2) into `state.refusals[]` and typed in `@myagenttool/protocol`
(`src/refusal.ts`). Shape:

```jsonc
{
  "id": "ref_...",
  "at": "2026-07-12T00:00:00.000Z",
  "subject":   { "kind": "invocation|lifecycle_action|capability_call|worktree_action|application_action|registration", "id": "..." },
  "requester": { "kind": "local_user|control_plane|automation", "id": "..." },
  "category":  "not_granted|policy|state|human",
  "code":      "cwd_outside_approved_root",   // CLOSED enum — see below
  "decidedBy": { "kind": "grant|policy_engine|arbiter|user", "id": "..." },
  "summary":   "...",     // one line, for a person
  "evidence":  { /* gate-specific, verbatim, NOT normalized */ },
  "remedy":    "...",     // what would make this succeed
  "retryAfter": null,     // ISO time, or null if retry cannot help
  "appealTo":  "device_owner"   // who can overturn it, or null if nobody can
}
```

`remedy` / `retryAfter` / `appealTo` deliberately **replace a boolean
`appealable`** — that flag was derivable from `category` and would only have
drifted out of agreement with it.

`evidence` stays free-form **on purpose**: a policy refusal and a budget refusal
carry different proof, and flattening them destroys the proof. Consumers render
`code` / `summary` / `remedy` and treat `evidence` as an opaque drill-down.

## The four categories, and their evaluation order

Gates are evaluated in this order (Phase 2 pins it with a test). Wrong order
either leaks capability existence or wakes the device owner to approve a request
that budget would have refused anyway.

1. **`not_granted`** — the requester holds no grant for the capability. Evaluated
   first: revealing *why* an ungranted request failed would leak the existence and
   shape of a capability the requester was never entitled to see.
2. **`policy`** — a policy rule forbids it (command/cwd/file/network allowlists,
   an action a recipe/recovery model does not permit). Deterministic; retry never
   helps without changing the request.
3. **`state`** — the subject is not in a state where the action is valid (not
   owned by the actor, not in an actionable status, over budget, over quota,
   undeliverable). Retry *may* help once the state changes.
4. **`human`** — a person declined (an approval, a produced deliverable, a
   workflow gate). Only a human can overturn it.

> An ungranted **and** over-budget request reports `not_granted`, never
> `over_budget`.

## The closed code taxonomy

The code is a **CLOSED enum, versioned with the device API**. This is the one hard
constraint in the design and the one most likely to be quietly violated: a
free-form `code` gives us 40 codes in a year — the same 23-dialect disease one
level down. **Adding a code is a deliberate protocol change** (edit
`refusalCodes` in the protocol package), never a string literal at a call site.

Each code belongs to exactly one category.

| category | code | meaning |
|---|---|---|
| `not_granted` | `capability_not_granted` | The requester holds no grant for this capability. **Never surfaced to the requester** (recorded with no event — see Phase 4). |
| `policy` | `command_not_allowlisted` | The command, adapter, or argv is not on the local-execution allowlist. |
| `policy` | `cwd_outside_approved_root` | The resolved working directory is outside `approvedRoots`. |
| `policy` | `file_policy_exceeded` | Requested file access exceeds the command's allowed file policy. |
| `policy` | `network_policy_exceeded` | Requested network access exceeds the command's allowed network policy. |
| `policy` | `action_not_permitted` | The requested action is not permitted for this subject by a recipe / recovery / lifecycle policy. |
| `state` | `subject_not_actionable` | The subject is not owned by the actor, or not in a status where this action is valid. |
| `state` | `over_budget` | The request would exceed a spend/economics budget. |
| `state` | `over_quota` | The request would exceed a quota. |
| `state` | `undeliverable` | The device cannot deliver/execute the dispatched work (adapter unavailable, redelivery exhausted). |
| `human` | `approval_denied` | A human approver denied the request. |
| `human` | `deliverable_rejected` | A human rejected a produced deliverable (a design report, a decomposition plan). |
| `human` | `gate_rejected` | A human rejected a workflow / promotion gate. |

### Not refusals

- **Concurrency-cap queuing is not a refusal.** The work is queued and the device
  is holding it. No code is minted for it; Phase 2 pins this with a test.
- **`failed`** events (the device tried and could not finish) are not refusals and
  are not in this taxonomy.

## The map — every existing refusal expressed once

Proof the taxonomy is complete: every existing refusal event type and blocking
HTTP error code maps onto exactly one `(category, code)`. Where one event type is
emitted by several gates (an umbrella event), each gate's `reason` maps
independently — the taxonomy must express every gate, not just every name. This
table is mirrored by the machine-checked `refusalEventCatalog` in
`packages/protocol/src/index.mjs`, asserted by `test/refusal.test.mjs`.

| existing event type / error code | reason | category | code |
|---|---|---|---|
| `bridge_delivery_refused` | not_owned / not_active | `state` | `subject_not_actionable` |
| `bridge_lifecycle_refused` | not_owned / not_running | `state` | `subject_not_actionable` |
| `bridge_operation_refused` | not_owned / bad_status | `state` | `subject_not_actionable` |
| `delivery_refused` | bridge self-reported undeliverable | `state` | `undeliverable` |
| `device_dispatch_blocked` *(reserved)* | no device can take it | `state` | `undeliverable` |
| `project_remove_blocked` *(http)* | project in use / invariant | `state` | `subject_not_actionable` |
| `local_execution_refused` | command / adapter not allowlisted | `policy` | `command_not_allowlisted` |
| `local_execution_refused` | cwd outside approvedRoots | `policy` | `cwd_outside_approved_root` |
| `local_execution_refused` | file policy exceeded | `policy` | `file_policy_exceeded` |
| `local_execution_refused` | network policy exceeded | `policy` | `network_policy_exceeded` |
| `policy_blocked` *(http/errorCode)* | local-exec policy refusal | `policy` | `command_not_allowlisted` |
| `application_orchestration_recovery_action_rejected` | action_not_suggested / blocked | `policy` | `action_not_permitted` |
| `recovery_action_blocked` *(http)* | recovery availability blocked | `policy` | `action_not_permitted` |
| `lifecycle_gate_blocked` *(http)* | lifecycle recipe gate | `policy` | `action_not_permitted` |
| `rollback_gate_blocked` *(http)* | rollback queue rejected | `policy` | `action_not_permitted` |
| `loop_worktree_promotion_pr_merge_prep_blocked` | merge preflight blockers | `policy` | `action_not_permitted` |
| `invocation_rejected` | quota gate | `state` | `over_quota` |
| `invocation_rejected` | budget gate (`over_budget`) | `state` | `over_budget` |
| `invocation_rejected` | after local-approval denial | `human` | `approval_denied` |
| `local_approval_denied` | human denied at local gate | `human` | `approval_denied` |
| `codex_approval_denied` | broker deny / timeout-deny | `human` | `approval_denied` |
| `auto_run_denied` | human denied the auto-run | `human` | `approval_denied` |
| `permission_denied` *(reserved)* | no grant | `not_granted` | `capability_not_granted` |
| `auto_run_design_rejected` | human rejected the design | `human` | `deliverable_rejected` |
| `auto_run_decomposition_rejected` | human rejected the plan | `human` | `deliverable_rejected` |
| `loop_human_gate_rejected` | human rejected the gate | `human` | `gate_rejected` |
| `loop_worktree_cleanup_refused` | promotion/cleanup gate | `human` | `gate_rejected` |
| `loop_worktree_promotion_refused` and every `loop_worktree_promotion_*_refused` stage | promotion gate | `human` | `gate_rejected` |

Every `loop_worktree_*_refused` event and the one `_blocked` merge-prep event are
enumerated structurally by the test (it filters `loopEventTypes` for
`/_refused$/` / `/_blocked$/`), so a newly-added loop refusal fails the suite
until it is mapped here.

## What Phase 1 does **not** do

- No new records are written. `state.refusals[]` is defined but unpopulated.
- The 23+ existing event types keep firing unchanged.
- `capability_not_granted` is in the enum but unreachable until Phase 4.

## Phase 4 — `capability_not_granted` becomes reachable

When a requester invokes a capability that **exists but is not granted to their
team** (tenancy/ownership), `createCapabilityInvocation` records a `not_granted`
refusal. Two properties make this safe:

- **It is evaluated first.** The grant/visibility check precedes every policy,
  state, and human gate, so an ungranted request never reveals downstream
  (approval/budget) detail — the evaluation order exists for exactly this.
- **It carries no event.** `capability_not_granted` must never surface to the
  requester: the response stays an opaque `capability_not_found` whether the
  capability is unknown or merely not granted, and the refusal lands **only** in
  the owner's ledger (`state.refusals[]`, the Evidence Center refusal lens). A
  genuinely-unknown name mints nothing — a typo is a client error, not a veto.
