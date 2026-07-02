# L4 Held-out Evaluation

This is the minimal implementation of the L4 gate from
[MATURITY_CALIBRATION.md](MATURITY_CALIBRATION.md): replace the structural
"does a coding-adapter slot exist" check with a **measured pass rate on a local
held-out set of real issues**.

It borrows the SWE-bench *method* (held-out tasks, binary resolved/not-resolved,
a measured percentage) — not its public scoreboard. The set is ours, the oracle
is ours, and the number is a local capability signal, not an industry rating.

## What it measures

For each held-out case, a **resolver** attempts the change and reports which
files it touched. A deterministic **oracle** then decides `resolved` / not:

- every `expectedFiles` entry was touched, and
- no `forbiddenFiles` prefix was touched (scope discipline), and
- at least one file changed.

`passRate = resolved / total`. That single number is the L4 gate input.

## Running it

```text
pnpm ai:eval-heldout                          # mock resolver (hermetic, default)
pnpm ai:eval-heldout -- --min-pass-rate 0.75  # fail if below the bar (CI gate)
pnpm ai:eval-heldout -- --json --out eval.json
pnpm ai:eval-heldout -- --set tools/ai/evals/heldout
```

Evidence (JSON + Markdown) is always written to `.myagenttool/evals/<runId>/`
(gitignored). `--min-pass-rate <0..1>` makes the command exit non-zero when the
measured rate is below the bar, so it can gate CI once real resolvers are wired.

## Resolvers

| Resolver | Use | Hermetic |
| --- | --- | --- |
| `mock` (default) | Stands in for current capability; drives the offline `ai:check` sanity. | Yes |
| `command` | Real capability. Runs `--resolver-command-json` (or `MYAGENTTOOL_HELDOUT_RESOLVER_COMMAND_JSON`) once per case. | Depends on the command |

The `command` resolver receives the case as JSON on **stdin** and in
`MYAGENTTOOL_HELDOUT_CASE`, and must print `{"changedFiles": ["..."], "notes":
"..."}` to **stdout**. This is the extension point where a real coding adapter /
`ai:work-runner --apply` wrapper plugs in: run the adapter against the case,
then report the resulting `git diff --name-only`.

## The set

Cases live in `tools/ai/evals/heldout/*.json`, one file per case:

```json
{
  "id": "hb-001-example",
  "issue": "sim-1",
  "title": "Short human title",
  "spec": "What the change must accomplish.",
  "risk": "low",
  "oracle": {
    "expectedFiles": ["path/that/must/change"],
    "forbiddenFiles": ["apps/server/"]
  },
  "mock": {
    "changedFiles": ["path/that/must/change"],
    "note": "What the mock stands in for."
  }
}
```

**Keep at least one intentionally-unsolved case** (empty or wrong
`mock.changedFiles`). `ai:check` fails if the mock pass rate is 0% (harness
broken) or 100% (set no longer tests a real gap). The seed set is 4 cases with
one unsolved, so the mock rate is 75% — a deliberately honest, non-degenerate
baseline.

## How this feeds the maturity gate

L4 is "reached" only when a real (`command`) resolver clears an agreed
`--min-pass-rate` on this set, with the evidence file linked — not when a
wrapper contract merely exists. Grow the set with real issues over time;
`passRate` on a fixed set version is the trend line.

## Not in this slice

- A production coding-adapter resolver (wraps `ai:work-runner --apply`).
- Larger, versioned held-out sets and per-case difficulty tiers.
- Wiring `--min-pass-rate` into a CI gate (blocked on CI runner activation).
