# Code Review: Economics / Coding Agents / Execution Stack

Date: 2026-06-23

Scope: `git diff main...HEAD` on `feat/budgets-and-chargeback` (the stacked work:
web migration → Codex/Claude integration → economic ledger → budgets/chargeback →
execution hardening). High-effort, recall-biased review: 8 independent finder
angles (3 correctness, reuse, simplification, efficiency, altitude, conventions)
→ dedup → verify.

Fixes landed in commit `663d708`. This record is for traceability — it lists
every finding, its disposition, and the verification.

## Correctness — money & enforcement (fixed)

The cluster sat in the economics/budget logic (the differentiator) and was
mutually related: the ledger summary and budget enforcement applied *different*
inclusion rules to the same entries.

1. **Estimated spend counted against budgets, inconsistently.** `ownerSpentUsd`
   summed any numeric `amountUsd` (reported AND token-estimated), while
   `summarizeLedger` carefully separated them and the UI said estimates "never
   count as finalized spend." → Resolved: one shared rule (`ledgerEntrySpend`);
   counting estimates toward the *cap* is now explicit and shown in the Budgets
   card ("includes ~$X token-estimated spend"). Finalized vs estimated are
   exposed in the budget status.
2. **Voided (cancelled) entries counted as spend.** `recordLedgerEntry` set
   `status: "voided"` for cancelled runs but kept `amountUsd`; both the summary
   and budget enforcement summed it, so cancelled work inflated spend and could
   block an owner. → Fixed: `ledgerEntrySpend` returns 0 for voided; summary adds
   a `voidedEntries` count; `recordAgentUsage` skips cancelled cost.
3. **Budget was post-hoc with no reservation (TOCTOU).** Enforcement read
   accumulated spend at admission, but spend is only recorded at completion, so a
   concurrent burst (or one expensive run) passed the same snapshot. → Fixed:
   admission projects `committed spend + per-in-flight reservation`
   (`BUDGET_RESERVATION_USD`), bounding concurrent bursts. Documented as
   best-effort (true per-run cost is unknown until completion).
4. **Non-finite reported amount disabled enforcement.** `typeof x === "number"`
   accepts `NaN`/`Infinity`/negative; a `NaN` amount made `spent` NaN, so
   `over = NaN >= limit` was `false` — silently turning enforcement off. → Fixed:
   `finiteUsd()` guards reported and estimated amounts everywhere.

## Correctness — edge / robustness (fixed)

5. **0-limit budget blocked at zero spend** (`spent >= limit` → `0 >= 0`). →
   Kept `>=` and documented `limit 0 = freeze` (block every run) as the
   intentional meaning.
6. **Claude health probe false-positive.** `probeClaudeCli` matched
   `\d+\.\d+\.\d+` over stdout+stderr, so a stray version token in a stderr
   warning read as healthy. → Fixed: require a version **and** a `claude` token in
   **stdout**.
7. **Forced-kill event could race/precede completion.** The `cancel_force_killed`
   event is posted from the async cancel/timeout path. → Fixed: the forced-SIGKILL
   fact is also carried into the terminal completion summary, so the audit records
   it even if the separate event is lost or late.

## Cleanup / altitude (fixed)

8. **Codex/Claude special-cases in `createCliAgent`** (id, mode key, args,
   timeout, risk, notes, output — 6 parallel branches) collapsed into one
   `CODING_AGENTS` descriptor; `recordLedgerEntry`'s provider set now derives from
   `TOKEN_PRICING`. Adding a provider = one descriptor entry + one pricing row.
9. **`usd()` money formatter duplicated in 3 views** → one `lib/money.ts`
   `formatUsd`.
10. **`estimateCostUsd` inlined its pricing table to dodge a const TDZ** (the
    self-check runs at module load). → `TOKEN_PRICING` is a module const declared
    before the self-check; the bandaid is gone. Also `budgetStatuses` now reuses
    the single `summarizeLedger` pass instead of re-scanning the ledger per budget
    on every `/api/state` poll.

## Accepted as-is (no change)

- **SPA 404 → 200 fallback** in the static server: standard single-page-app
  routing, not a security regression (the path-traversal guard is preserved).
- **`console-state.ts` mirrors `@myagenttool/protocol` types**: a deliberate M0
  pragmatism, noted in the file header. Revisit if/when the web imports the
  protocol package's types directly.

## Clean angles

Cross-file tracing (server↔web field shapes, bridge cost fields, API verbs) and
conventions (CLAUDE.md / STYLEGUIDE.md — naming, design tokens) returned no
findings.

## Verification

`server --check`, `desktop --check`, local smoke, m0 acceptance, web `tsc` +
`vite build` — all green. Live: coding-agent descriptor registration (Codex /
Claude args, output format, risk), zero-limit freeze returning `409`, and the
in-flight reservation behavior.
