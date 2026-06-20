# M0 Acceptance Closeout

This document records the M0 Remote Invocation Loop acceptance evidence after
the staged implementation work.

## Stage Results

| Stage | Scope | PR | Closed issues |
| --- | --- | --- | --- |
| 1 | Architecture ADR baseline | #69 | #12, #13, #14, #15 |
| 2 | Core protocol and service loop | #70 | #6, #7, #10, #16 |
| 3 | Desktop Bridge and agent registration | #71 | #2, #3, #4, #8, #17 |
| 4 | Web Console user loop | #72 | #5, #18, #35 |
| 5 | Governance and M0 closeout | Current PR | #9, #11, #20, #21, #22, #32 |

## Acceptance Matrix

| M0 capability | Evidence |
| --- | --- |
| Desktop Bridge links one user-owned device | `apps/server/src/index.mjs`, `apps/desktop/src/index.mjs`, `pnpm smoke:local` |
| Device online/offline state is visible | `apps/web/public/app.js`, `apps/web/public/index.html` |
| Manual CLI agent registration | `POST /api/agents`, `tools/dev/local-smoke.mjs` |
| Manual HTTP agent registration | `POST /api/agents`, `tools/dev/local-smoke.mjs` |
| Plain-language task entry | `apps/web/public/index.html` |
| Offline queue and reconnect dispatch | `docs/engineering/M0_CORE_PROTOCOL_SERVICE.md`, `pnpm smoke:local` |
| Dispatch lease and redelivery | `apps/server/src/index.mjs --check` |
| Running and queued cancellation | `apps/server/src/index.mjs`, `apps/desktop/src/index.mjs`, `pnpm smoke:local` |
| Device unlink blocks dispatch and revokes credentials | `apps/server/src/index.mjs --check` |
| Audit and trace creation | `apps/server/src/index.mjs --check`, `pnpm smoke:local` |
| Unknown cost is visible before run | `packages/protocol/src/economics.ts`, `apps/web/public/app.js` |
| Non-professional UI hides advanced details by default | `apps/web/public/index.html`, `apps/web/src/index.mjs --check` |
| Local engineering scripts baseline | `pnpm docs:check`, `pnpm repo:check`, `pnpm github:check`, `pnpm smoke:local` |
| Issue hygiene and project-field dry-run | `tools/github/src/index.mjs` |
| Required-check governance fallback | `docs/engineering/M0_GOVERNANCE_CLOSEOUT.md` |

## Verification Commands

Use this command set before claiming M0 local acceptance:

```text
pnpm docs:check
pnpm repo:check
pnpm github:check
pnpm github:check:issues
pnpm typecheck
pnpm test
pnpm smoke:local
git diff --check
```

For PRs, GitHub Actions should report:

- `Docs / markdown-basic`
- `CI / verify`
- `CI / desktop-smoke (ubuntu-latest)`
- `CI / desktop-smoke (macos-latest)`
- `CI / desktop-smoke (windows-latest)`
- `Governance / pull-request-governance`
- `AI Review / ai-review`

Risk-gate evidence covered by the staged PRs:

- Visual QA screenshot path: M0 currently uses lightweight visual QA from
  [VISUAL_QA.md](VISUAL_QA.md); browser screenshot automation remains a
  documented follow-up.
- Cross-platform execution/cancellation evidence: `CI / desktop-smoke` passed
  on Ubuntu, macOS, and Windows for PR #72 after PR #71 added the matrix.
- Protocol/state-machine compatibility evidence: server and protocol self-checks
  cover invocation, delivery, cancellation, trace, audit, and unlink semantics.
- Adapter success/failure/cancel evidence: `pnpm smoke:local` covers CLI
  success, HTTP success, HTTP failure, and CLI cancellation.
- Security/data review evidence: device unlink credential revocation, queued
  cleanup audit, unknown-cost visibility, and audit summaries are covered by
  server self-check and local smoke.

## Current M0 Boundaries

- Server state is still in-memory for the local demo.
- Authentication and real user/team membership are not implemented.
- Device credentials are represented as revocation state, not OS credential
  store records.
- Web visual QA is lightweight until browser screenshot automation is added.
- Branch protection may remain advisory if private-repository entitlement blocks
  required checks.

These boundaries are acceptable for M0 because the milestone proves the local
remote-invocation loop and records the production hardening path.
