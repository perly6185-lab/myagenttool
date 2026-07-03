# ADR 0007: Re-home ccusage as an Application

Status: accepted

Date: 2026-07-03

Related issue: [#355](https://github.com/perly6185-lab/myagenttool/issues/355)

## Context

ccusage is today modeled as a **governed tool** (`ccusage.report`) whose
execution identities are six **bespoke agent records**
(`agt_ccusage_daily`, `_weekly`, `_monthly`, `_session`, `_codex_daily`,
`_claude_daily`), with the pinned `ccusage@20.0.14` install handled by a separate
lifecycle recipe. This shape predates the Application Capability Registry.

On the current object model, ccusage is a poor fit for "agent" and a natural fit
for "application":

```text
Application = asset under management        (ccusage IS an npm CLI asset)
Agent       = execution identity            (who runs it)
Capability  = discoverable/invokable contract (the six reports)
Routine     = orchestration built from capabilities
```

The `agt_ccusage_*` records are not autonomous agents — they are execution
identities forced into the agent registry, which causes registry sprawl and a
concept mismatch. The Application model was itself built by copying ccusage's
governance pattern
([APPLICATION_CAPABILITY_REGISTRY.md](APPLICATION_CAPABILITY_REGISTRY.md):
"the same control-plane patterns used by governed tools such as
`ccusage.report`"), so two parallel governance paths now exist for the same
shape.

At the same time, `/api/tools/ccusage.report` is a **stable external-consumer
contract** ([TOOL_REGISTRY_EXTERNAL_CONSUMER_CONTRACT.md](TOOL_REGISTRY_EXTERNAL_CONSUMER_CONTRACT.md))
and the import path carries deliberate `non-authoritative` / `external_billed`
ledger semantics. Any change must not break either.

## Decision

Re-home ccusage onto the Application Capability Registry, **evolutionarily and
behind the existing tool facade**:

1. Model ccusage as an **Application** with `source.type = "npm"` (pinned
   `ccusage@20.0.14`) and the standard Application lifecycle
   (draft → registered → active → offline).
2. Project the six reports as **capabilities** of that application, executed by
   the **platform Application Control agent**, reusing the existing
   `wrapper:*` + `approvalToken` execution path.
3. **Keep `/api/tools/ccusage.report`** as a stable compatibility facade backed
   by the projected capability. `/api/capabilities` already unifies both
   `provider.type`s (`tool`, `application`), so no discovery or invocation
   contract changes for callers.
4. Retire the bespoke `agt_ccusage_*` agent records once the capability-backed
   path is authoritative.

## Rationale

- ccusage is an npm-sourced asset; its version/install/upgrade/offline lifecycle
  belongs to first-class Application lifecycle, not a one-off recipe.
- One governance path instead of two removes duplication and drift risk.
- Six report capabilities projected from one application beats six bespoke agent
  records plus a tool facade.
- Discovery is already unified at `/api/capabilities`, so the migration is
  invisible to consumers when the tool facade is preserved.

## Consequences

Positive:

- Agent registry stops carrying non-agent execution identities.
- ccusage becomes the reference implementation of the pattern it inspired,
  closing the loop.
- Lifecycle (pin, upgrade, offline) is first-class and auditable.

Tradeoffs:

- A migration touching three risk surfaces — the ledger import path
  (external-billed semantics), the approval policy, and the external consumer
  contract — must be sequenced carefully behind the preserved facade.
- Temporary dual representation (tool facade + application capability) until the
  bespoke agents are retired.

## Non-Goals

This decision does not change:

- What ccusage reports or how estimates are computed.
- The `non-authoritative` / `external_billed` treatment of imported estimates
  (they are never rolled into the metered ledger).
- The `/api/tools/ccusage.report` request/response contract.

## Implementation Notes

Migration order (each step a reviewable slice, facade preserved throughout):

1. Register ccusage as an npm-source Application + lifecycle (no behavior change).
2. Project the six reports as Application capabilities executed by the
   Application Control agent (reuse the wrapper path).
3. Back `/api/tools/ccusage.report` with the projected capability; assert the
   descriptor + invocation contract is byte-for-byte compatible.
4. Retire (or deprecate) the `agt_ccusage_*` agent records.
5. Regression: the `ccusage-agent-smoke` end-to-end checks (registration,
   wrapper, import, tool-facade loop, hardening) pass against the new path; docs
   updated.

## Acceptance Impact

Unblocks the phased work tracked in [#355](https://github.com/perly6185-lab/myagenttool/issues/355):
Application registration, capability projection, tool-facade backing, agent
retirement, and regression coverage.
