# Near-term backlog plan (2026-07)

This backlog supersedes the earlier #209-#213 sequencing. Auth and tenancy have
landed, and the latest ccusage/Application work moved the active product line
from "agent registry slices" toward governed Application capabilities.

The next phase should therefore stop adding new surface area and make the
existing control plane durable, locally enforceable, and easier to close out.

```text
re-baseline docs + tests
  -> durable state and audit/ledger history
  -> bridge credential + local execution gate
  -> Application capability runtime closeout
  -> M3 closeout and one lifecycle execution sample
```

See `docs/engineering/NEXT_PHASE_PLAN_2026-07.md` for the operating plan.

## P0 - Baseline and scope control

- **Update planning docs.** Keep this backlog, milestones, ADR 0007, M3 issue
  plan, and Application Capability Registry in sync with the latest code.
- **Run the local gate before new feature work.** Use:
  `pnpm docs:check`, `pnpm repo:check`, `pnpm typecheck`, `pnpm test`,
  `pnpm smoke:local`, and `git diff --check`.
- **File or update issue references for deferred work.** Any new runtime scope
  should map back to persistence, bridge trust, Application capabilities, M3
  closeout, or billing/reporting.
- **Recently landed baseline:** #212 broadened hermetic coverage for worktree
  naming, lifecycle, diff, and loop promotion gates. #213 CI activation remains
  the operational follow-up once hosted-runner cost approval and branch
  protection are ready.

## P1 - Durable control-plane state

Persistence is the highest-value foundation still missing from the architecture
review. The first slice should be intentionally small:

- Add a durable store boundary with an in-memory adapter kept for tests and
  self-checks.
- Persist tokens, users, teams, projects, invocations, events, approvals,
  application records, lifecycle records, quota decisions, usage, and ledger
  entries.
- Stop treating audit and ledger rows as capped demo arrays for any path that
  claims governance, billing, or export semantics.
- Use store transactions to close dispatch claim, budget admission, and
  idempotency races where practical.

## P2 - Bridge trust boundary

The Desktop Bridge should enforce local trust at the point of execution:

- Status: first slice started on `feat/bridge-trust-boundary`; bridge bearer
  credentialing and an auditable local execution policy manifest are now
  implemented for the demo bridge path.
- Context: the MCP bridge live client has landed; A2A/container contract slices
  stay later backlog until the trust boundary and durable evidence are closed.
- Issue or register a device-bound bridge credential.
- Require bridge credentials on bridge polling, completion, lifecycle, and
  dispatch endpoints.
- Add a local allowlist/approval check before the bridge starts a process.
- Preserve the principle that server policy approval does not by itself mean
  local execution consent.

## P3 - Application capability runtime

The latest ccusage work makes the Application path real enough to be the next
product-quality focus:

- Status: first slice started on `feat/application-capability-runtime-closeout`;
  ccusage Application wrapper capabilities now expose compatibility facade,
  output collection, external-billed, and import semantics through discovery and
  queued wrapper invocation metadata.
- Keep `/api/tools` stable while `/api/capabilities` becomes the unified
  discovery surface.
- Finish ccusage parity on the Application-backed tool facade, including
  descriptor, dynamic filters, import metadata, ledger semantics, and smoke
  coverage.
- Make recovery actions explainable after execution: selected action, refusal
  reason, result, next step, and duplicate-action guard evidence.
- Generalize only after ccusage remains green through the compatibility facade.

## P4 - M3 closeout

M3 should close around what is already implemented instead of expanding:

- Write `M3_ACCEPTANCE_CLOSEOUT.md` with accepted scope, evidence, residual
  risks, and explicit non-goals.
- Keep lifecycle execution to one allowlisted sample first, preferably the
  pinned ccusage npm lifecycle path.
- Keep billing work to enforceable quota decisions, ledger attribution,
  reporting shape, and chargeback export. Do not add payment, invoice, tax, or
  public marketplace flows in this phase.

## Later backlog

- MCP, A2A, and container live clients.
- Public marketplace and settlement.
- External SIEM/export delivery providers.
- Production identity providers, SSO, and full RBAC administration.
- Repeatable workflow productization once persistence and audit are reliable.
