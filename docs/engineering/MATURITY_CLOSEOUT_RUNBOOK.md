# Maturity Closeout Runbook (#250, #256)

Status: runbook. Two maturity-ladder items need real execution with the
maintainer's credentials, not code. Everything they depend on is built and
verified; this doc is the exact procedure so the runs are repeatable and produce
comparable evidence.

- **#250** — calibrate the held-out / sub-capability `--min-pass-rate` gate from
  real scheduled-run data (today the gate line is a *suggested* `0.6`; the
  hardened line "comes from the scheduled-run trend", per
  [L4_HELDOUT_EVAL.md](L4_HELDOUT_EVAL.md)).
- **#256** — exercise the full L5 release path once, end to end, capturing real
  deploy evidence and rollback notes.

The no-cost harness paths (`--dry-run`, deploy `docs/preview`) were verified on
2026-07-03; the paid / real-target steps below are what still need maintainer
credentials.

---

## #250 — Calibrate `--min-pass-rate` from real runs

### What is already in place

- `pnpm eval:real` ([tools/dev/eval-real-run.mjs](../../tools/dev/eval-real-run.mjs))
  runs subcap + held-out against the **local logged-in `claude` CLI** (no API
  key stored anywhere) and appends one JSONL record per run to
  `.myagenttool/evals/trend.jsonl` (gitignored, local-only).
- Auth preflight parses CLI *output*, not exit code — a logged-out cron session
  fails fast and records an `infraFailure` trend row instead of burning paid
  cases on a misleading 40% (#285).
- `--min-pass-rate 0..1` is already wired into `eval-heldout` and `eval-subcap`
  ([tools/ai/src/index.mjs](../../tools/ai/src/index.mjs) `enforceMinPassRate`);
  calibration only sets the *number*, no code change.

### Procedure

1. **Verify prerequisites (free):**
   ```
   pnpm eval:real -- --dry-run
   ```
   Expect `auth ok · repo clean`. If it reports `auth FAILED`, fix the login
   (see [tools/dev/eval-real-cron.sh](../../tools/dev/eval-real-cron.sh)) before
   spending on paid cases.

2. **Gather 3–5 real runs (paid).** Either let the cron LaunchAgent run nightly
   (`pnpm eval:install-cron`) or run manually. Start cheap:
   ```
   pnpm eval:real -- --subcap-only     # ~10 min, subcap only
   pnpm eval:real                       # ~1–2 h, subcap + held-out
   ```
   Keep the repo **clean** — a dirty tree makes the held-out resolver skip
   (work-runner refuses dirty worktrees) and the run records `heldout skipped`.

3. **Read the trend:**
   ```
   pnpm eval:trend
   ```
   Ignore rows flagged `[infra — excluded from capability line]`; those are
   outages, not capability signal. Rates are only comparable **within the same
   set version**, so confirm set sizes match across the runs you compare.

4. **Derive the gate.** From the 3–5 clean (non-infra) runs, take the **minimum
   observed pass rate** per surface and set the gate one band below it so normal
   variance doesn't red the build:
   - `gate = floor((min_observed − 0.10) to the nearest 0.05)`, and never below
     the current suggested `0.6` for held-out.
   - Set subcap and held-out gates independently — they measure different sets.

5. **Wire the calibrated line.** Update the `--min-pass-rate` argument where the
   gate runs (the eval-gates job / `L4_HELDOUT_EVAL.md` example), commit with the
   trend evidence cited, and note the run count + date the number came from.

### What to record on the calibration PR

Sample size (N clean runs), date range, set version + sizes, min/median pass
rate per surface, chosen gate, and the margin rationale. Link the trend excerpt.

---

## #256 — Exercise the full L5 release path once

The L5 claim is "human-approved merge + release + rollback, 100% of releases have
rollback notes" ([MATURITY_CALIBRATION.md](MATURITY_CALIBRATION.md)). The
release tooling is built; #256 is exercising it once and keeping the evidence.

### Local dress rehearsal (no external service) — verified 2026-07-03

`docs/preview` is the M0 deploy target and uses the built-in
`builtin-docs-preview` adapter, so the whole path runs locally and writes a real
evidence bundle under `.myagenttool/deploy-runs` (gitignored) without publishing
anywhere. Run it to rehearse preflight → dry-run → apply → rollback:

```
node tools/deploy/src/index.mjs preflight --target docs --environment preview
node tools/deploy/src/index.mjs publish  --target docs --environment preview
node tools/deploy/src/index.mjs publish  --target docs --environment preview --apply
```

Expected: preflight OK; dry-run writes `…-dry-run.md`; `--apply` runs the builtin
adapter (exit 0) and writes `…-publish.md` + `.evidence.json` + artifact +
stdout/stderr, including the `Rollback:` line and environment responsibilities.
This confirms the mechanics; it is **not** the L5 sign-off (no human approval, no
real target).

### Real L5 run (needs maintainer credentials)

For a real target (`server`/`web`/`desktop`/`protocol`) and a gated environment:

1. **Configure the deploy adapter** — set the command JSON for the target /
   environment (preflight names the exact vars it wants), e.g.
   `MYAGENTTOOL_DEPLOY_SERVER_STAGING_COMMAND_JSON`. Without it, readiness fails
   with `No deploy adapter configured`.
2. **Preflight with a version** — staging/production require `--version` so
   rollback evidence can identify the previous artifact:
   ```
   node tools/deploy/src/index.mjs preflight --target <t> --environment staging --version vX.Y.Z
   ```
3. **Production approval gate** — production also requires
   `MYAGENTTOOL_DEPLOY_APPROVED=true` (set only after human approval) and a
   GitHub environment named `preview`/`staging`/`production`. Required reviewers /
   wait timers are tracked in #32 where repo entitlement blocks enforcement.
4. **Dry-run, then apply after approval:**
   ```
   node tools/deploy/src/index.mjs publish --target <t> --environment staging --version vX.Y.Z          # dry-run
   node tools/deploy/src/index.mjs publish --target <t> --environment staging --version vX.Y.Z --apply  # after approval
   ```
5. **Release notes** — draft with
   `node tools/release/src/index.mjs draft-notes --repo OWNER/REPO --pr N`
   (prints a draft; does not publish a GitHub release) and, after release, capture
   `retrospective --pr N`.
6. **Rollback** — actually run the documented rollback for the target once
   ([DEPLOYMENT_PIPELINE.md](DEPLOYMENT_PIPELINE.md) /
   [RELEASE_PROCESS.md](RELEASE_PROCESS.md)) so recovery-time is measured, not
   assumed (L5 target: < 1 hour).

### What to record for L5 sign-off

The deploy evidence bundle path, the version, who approved, the rollback command
that was exercised and its measured recovery time. That is the evidence the L5
row in [MATURITY_CALIBRATION.md](MATURITY_CALIBRATION.md) needs to move from
"partial frontier" to met.

---

## Why these can't be auto-closed in CI

Both intentionally stay off per-PR CI: #250 needs paid model calls against a
logged-in session (CI runs only the hermetic mock, by design), and #256 needs
human approval and real credentials. This runbook is the handoff so the
maintainer can execute them deterministically and drop the evidence back onto the
tracking issues.
