# PR Stack: Merge Order and Verification

This series of stacked PRs rebuilds the web console and layers the real
coding-agent + economics work on top. Each PR's base is the previous branch, so
its diff shows only its own changes. **Merge strictly bottom-to-top** — rebase
each onto `main` (or retarget its base) as the one below it merges.

## Stack

| # | Branch | Base | Scope |
| - | ------ | ---- | ----- |
| 1 | `feat/web-react-control-plane-console` | `main` | React + Vite control-plane console (migration) |
| 2 | `feat/codex-writable-sandbox` | #1 | Writable Codex sandbox selector + governed registration; ADR 0006 |
| 3 | `feat/claude-agent-integration` | #2 | First-class Claude Code; register-button states; dedup; auto-health |
| 4 | `feat/economic-ledger` | #3 | Economic ledger + AI usage metering; Economics view |
| 5 | `feat/budgets-and-chargeback` | #4 | Budget pools + quota enforcement; per-token pricing; chargeback/CSV |

```
main ← 1 migration ← 2 codex ← 3 claude ← 4 ledger ← 5 budgets
```

## Merge order

1. Merge **#1** into `main`.
2. Retarget **#2** base to `main` (or rebase), confirm CI, merge.
3. Repeat for **#3 → #4 → #5**, each retargeted to `main` after the one below lands.

Governance (`github:check:pr`) requires each PR to `Closes #<issue>` a dedicated
task issue carrying a `## Project Fields` block; web PRs need Visual QA evidence
attached to the PR conversation (screenshots, not committed).

## Per-PR verification

Run from the repo root. All commands must pass before merge.

**Shared (every PR):**

```text
node apps/server/src/index.mjs --check
node apps/desktop/src/index.mjs --check
node apps/web/src/index.mjs --check
node tools/dev/local-smoke.mjs
node tools/dev/m0-acceptance.mjs
# web PRs also:
( cd apps/web && pnpm typecheck && pnpm build )
```

**#1 migration** — web tsc + build; `web:check`; m0-acceptance asserts product
strings in the built bundle; screenshot the three-pane shell.

**#2 Codex** — register Codex `workspace-write` from the console (sandbox only,
no args) → server emits `codex exec --json --sandbox workspace-write`, risk=high;
a real run writes a file only after approval. Smoke confirms read-only stays the
default.

**#3 Claude** — register Claude `acceptEdits` → `claude -p ... --permission-mode
acceptEdits`, risk=high; a real run writes a file and returns Claude's summary
after approval. Confirm register button states (Register / Register another /
Update) and that re-registering the same mode does not duplicate.

**#4 ledger** — a real Claude run records a finalized ledger entry with the
reported `total_cost_usd` attributed to a cost owner; a demo run records as
unmetered. `costSummary` reflects the real amount.

**#5 budgets/chargeback** — set a `block` budget for a cost owner → that owner's
next invocation returns `409 budget_exceeded`; `require_approval` forces the
approval gate; a quota decision is recorded. Codex/token runs show a `~$`
estimate (status `estimated`), distinct from finalized spend. Chargeback CSV
exports the ledger. Smoke is unaffected (no budgets are seeded).
