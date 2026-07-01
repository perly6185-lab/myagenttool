# Issue Tracker Reconciliation — 2026-07-01

The 56 open issues had all last been touched 2026-06-20/21 and had drifted from
the code: work marked done was still open, and the entire tenancy + identity
workstream shipped this session (PRs #195–#205) had no tracking at all. This is
the reconciliation plan. **The tracker mutations below require explicit
authorization** — closing/creating issues is an outward action the agent will
not do on a general instruction.

## Open issues by status

| status | count | numbers |
|---|---|---|
| done | 16 | 139–143, 145–149, 152–157 |
| review | 11 | 115, 119, 120, 126, 129–135 |
| in-progress | 5 | 116, 117, 118, 150, 151 |
| ready | 5 | 114, 158, 160, 161, 162 |
| backlog | 18 | 121–125, 128, 136–138, 144, 159, 163–169 |
| (none) | 1 | 127 |

## Close now — `status/done`, confirmed landed (16)

All are already labeled done and the subsystem exists in `main`:

Prototype Canvas (#139–143), managed terminal protocol + PTY + detail pane +
Codex terminal mode + SSH connector (#145–149), Orca IA comparison + Agent
Workspace prototype/shell/placeholders/visual-QA/join-contract (#152–157).

## Close after a glance — `status/review`, landed in code (11)

The "Phase 1–7" managed-Codex / worktree / compare / diff / approval / evidence
epics (#129–135) and #115/#119/#120/#126 all have shipped implementations —
e.g. the codex approval-broker and Evidence Center were extended again this
session. Recommend closing after a quick owner confirmation.

## Needs owner triage (not auto-judged)

`in-progress` (5), `ready` (5), `backlog` (18), and #127 (no status). Several
backlog items (worktree registry, project registry, git status browser) look
implemented; the owner should walk these against `main` and re-label.

## Missing tracking — this session's workstream (PRs #195–#205)

No issue covered the tenancy + identity hardening. Recommend one epic
"Tenancy & identity hardening" linking: first hermetic unit tests + route matrix
(#195), P1.2 write guards + 403→404 (#199), existence-hiding (#197), codex
read-leak fix (#198), unknown-projectId + compare-runs review (#200), the
identity pass + tail (#201, #203), end-to-end tenancy integration (#202),
server-side multi-user plumbing (#204), and economics/dispatch unit coverage
(#205) — closed as delivered.

## New backlog to create (from the route matrix + roadmap gaps)

1. **Real auth + web login** — web login UI + bearer token, credential
   verification on `/api/session` (replace login-as-anyone), provisioning RBAC.
   The server APIs + guards are done; this is the client + auth (makes tenancy
   actually usable).
2. **Team-level cost allocation** — revisit m3 operator-level objects
   (catalog/bundles/recipes/quota/deployment/audit-export) and agent-skills
   tenancy once team cost allocation is real.
3. **Adapters: MCP / A2A / container** — `packages/adapters` is still minimal; a
   contract-defined MCP adapter is the first slice.
4. **Broaden unit tests** — extend the hermetic suite beyond tenancy/economics/
   dispatch to worktree + loop-engine.
5. **CI activation** — the workflows are gated behind a GitHub-hosted-runner repo
   variable (cost). Add a `pull_request` trigger + flip the variable + branch
   protection when runner spend is approved.

## Suggested actions (pending authorization)

- Close the 16 `status/done` (safe) and, after a glance, the 11 `status/review`.
- Create the "Tenancy & identity hardening" epic and close it as delivered.
- Open the 5 new backlog issues above.
- Owner triages in-progress/ready/backlog against `main`.
