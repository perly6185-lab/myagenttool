# ADR 0009: An Application descriptor is immutable — change means re-register

Status: accepted · 2026-07-13

Date: 2026-07-13

Related issue: [#850](https://github.com/perly6185-lab/myagenttool/issues/850)

## Context

An Application descriptor pins the security-relevant contract of every capability
it projects: the source, the wrapper `command`, the base `args`, the declared
`argInputs` (the only inputs that ever become argv), the `filePolicy` /
`networkPolicy` / `cwdPolicy`, and the approval requirement. Downstream, the
device allowlist and the server planner both trust that this contract is what it
was when the capability was approved.

The question (blocking the #757 editing slice and the #451 resurrection): may a
registered descriptor be **edited in place**, or must a change be a
re-registration?

The risk of in-place edits is **silent contract drift**: a capability approved
and observed as read-only `git status` could later have its argv or policy
mutated under the same id, and every prior audit record, evidence-ledger row, and
"what not to show" contract would now describe a command that no longer matches
what runs. Editing the security-relevant fields is indistinguishable, after the
fact, from having registered a different capability.

## Decision

**An Application descriptor is immutable after registration.** A change is a
**re-registration** — a new descriptor (new id, or an explicit governed
migration) — not an edit of the live one. There is no partial-edit path in this
revision: not for the source/command/argv/policy fields (the security contract),
and not for cosmetic fields either, so the rule is simple and has no "which fields
are safe" seam to get wrong.

Lifecycle transitions that are **not** descriptor edits remain available and are
unaffected: `registered → online/offline → archived`, health-driven auto-degrade,
and recovery. Those change an app's *state*, never its *contract*.

## Consequences

- Every audit / evidence / approval record for a capability describes a contract
  that provably never changed under it. A capability's argv and policy cannot
  drift beneath a running application.
- #757 (and any #451 resurrection) proceeds on a **replace, don't edit** model:
  updating an Application means registering the new descriptor and cutting over,
  not mutating the old one. This composes with ADR 0008 — executable descriptors
  are platform-shipped, so a git/ccusage contract change is already a reviewed
  platform release.
- Cosmetic fixes (a typo in a displayName) also require re-registration. Accepted
  as the cost of one simple, unambiguous rule; if this proves painful, a future
  revision may add a **cosmetic-only** editable subset (issue #850 option B) with
  governed fields hard-rejected — explicitly not full editability.

## Alternatives considered

- **Non-security fields editable (option B):** displayName/description/tags in
  place, contract fields immutable. Deferred — needs a field-partition and a
  validator that governed fields are rejected; a seam worth adding only if the
  re-register cost proves real.
- **Fully editable with re-approval (option C):** any field editable, editing a
  governed field resets the capability to draft + re-approval. Rejected for now —
  most surface and a re-approval state machine, for a mutability we do not yet
  need.
