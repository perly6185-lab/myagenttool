# ADR 0007: Re-home ccusage as an Application

Status: accepted · Revision 2 implemented 2026-07-03 (ccusage runs via the Application capability path; bespoke-agent registration retired)

Date: 2026-07-03

Related issue: [#355](https://github.com/perly6185-lab/myagenttool/issues/355)

## Revision 2 (2026-07-03) — current

Reverses Revision 1. We will proceed with the **full unification**: back
`/api/tools/ccusage.report` with the ccusage Application capability path and
retire the bespoke `agt_ccusage_*` agents. Revision 1 (keep the tool for
execution) is superseded; the three parity blockers it named are accepted as
**work to do**, not reasons to stop:

1. **Dynamic filters** — add a *validated* filter input (`since/until/timezone/
   offline`) to the wrapper-capability execution that maps to appended args
   (a small, constrained extension of the allowlist model; still no free-form
   args).
2. **`agentId` in the consumer contract** — the response `agentId` changes to the
   platform runner; documented as an intentional contract update.
3. **Descriptor from agents** — rebuild the `/api/tools` ccusage descriptor from
   the Application so it survives agent retirement.

Sequenced so ccusage keeps working between every slice; agents are retired only
in the final slice, once nothing depends on them:

1. Validated filter-input on wrapper-capability execution (additive).
2. The ccusage app wrapper command emits the ccusage RESULT shape and honors
   filters, so estimate import works natively.
3. `/api/tools` ccusage descriptor derived from the Application (prefer app,
   fall back to agents) — no behavior change.
4. Cut `ccusage.report` execution over to the capability path (agentId change).
5. Retire the `agt_ccusage_*` agents.
6. Regression: `ccusage-agent-smoke` parity on the new path; docs finalized.

Already-landed work that this builds on: the Application registration (#358),
the general execution runtime (#359), and ccusage import parity (#373).

## Revision 1 (2026-07-03) — superseded by Revision 2

The original decision was to make the Application capability path the **execution
backing** for `/api/tools/ccusage.report` and retire the bespoke `agt_ccusage_*`
agents. Implementing the cutover surfaced three parity blockers that make a
lossless swap impossible without new design:

1. **Dynamic filters vs a fixed command.** The tool accepts `since / until /
   timezone / offline`; an npm-wrapper capability runs a *fixed* registered
   command (the allowlist model has no per-invocation args by design). Routing
   the tool through it would drop filter support — a functional regression.
2. **`agentId` is in the locked consumer contract**
   ([TOOL_REGISTRY_EXTERNAL_CONSUMER_CONTRACT.md](TOOL_REGISTRY_EXTERNAL_CONSUMER_CONTRACT.md));
   the cutover would change it for every ccusage caller.
3. **The `/api/tools` descriptor is built from the agents**, so retiring them
   would remove the tool from discovery unless the descriptor were first reworked.

**Revised decision:** ccusage **keeps the governed tool for execution**
(parameterized reports, filters, `agentId`, and descriptor unchanged; the
`agt_ccusage_*` agents are retained as execution identities). The Application
registration and the projected wrapper capabilities remain as the **asset /
lifecycle / discovery** projection, unified at `/api/capabilities` — **not** the
tool's execution backing. This honors this ADR's own principle that
"`/api/tools` remains the stable tool-only compatibility surface," and avoids a
regression to a live, billing-adjacent feature.

What still shipped and stands:

- ccusage registered as an npm-source Application (#358) — asset + lifecycle +
  the six reports projected as discoverable capabilities.
- The application-capability **execution runtime** (#359: #364/#367/#368) — now
  **general infrastructure** any npm-wrapper application can use, not ccusage's
  execution path.
- ccusage **import parity** (#373) — if a ccusage report is ever produced via
  the application path, estimates import identically; a foreign app cannot spoof
  it. Non-destructive and retained.

`#355` Phases 3b (routing switch) and 4 (agent retirement) are **withdrawn** per
the above. The original decision below is kept for history.

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

## Decision (original — reinstated by Revision 2, with the added parity work it lists)

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
- The `/api/tools/ccusage.report` request contract and report semantics. (The
  response `agentId` intentionally changed to the platform runner
  `agt_platform_application_wrapper` — see Revision 2.)

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
