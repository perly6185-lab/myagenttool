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
- at least one file changed, and
- when the case has a **behavior oracle** (`oracle.verify`), the probe holds.

`passRate = resolved / total`. That single number is the L4 gate input.

### Behavior oracle (`oracle.verify`)

The file-level checks only prove the agent touched the right places. The
optional verify probe judges behavior, in two modes:

- `"fail-to-pass"` — SWE-bench discipline: the command must **fail at the
  case's base** (proving it probes the missing behavior) and **pass after the
  agent's change**. A probe that already passes at base is **vacuous** and the
  case is judged unresolved so the set author fixes it.
- `"regression"` — the command must pass after the change; passing at base is
  fine. Weaker (guards "the agent broke the tool", not correctness) and results
  say so explicitly.

```json
"verify": { "mode": "fail-to-pass", "command": ["node", "probe.mjs"], "timeoutMs": 120000 }
```

The resolver runs the command inside the worktree at base (before the agent)
and again after, and reports `{baseStatus, status}`; the judge applies the mode
rules. The mock resolver simulates via `mock.verify`.

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
"..."}` to **stdout**.

### Production resolver: `tools/ai/src/evals/work-runner-resolver.mjs`

The real capability path is shipped. It runs `ai:work-runner --apply` for each
case **inside an isolated git worktree** (created off the base ref, force-removed
after, with the run-work branch deleted so nothing leaks), then reports the
files the coding adapter changed (`git diff` + untracked, minus gitignored run
evidence). It never touches the caller's checkout, branch, or other worktrees.

```text
# real Claude Code CLI as the adapter (edits code, we measure what it touched).
# IMPORTANT: the adapter command must use an ABSOLUTE path — the eval worktree
# is checked out at an old ref that may predate the adapter script.
MYAGENTTOOL_CODING_ADAPTER=claude \
MYAGENTTOOL_CLAUDE_COMMAND_JSON="[\"node\",\"$PWD/tools/ai/src/evals/claude-adapter.mjs\"]" \
MYAGENTTOOL_CLAUDE_TIMEOUT_MS=600000 \
pnpm ai:eval-heldout -- --set tools/ai/evals/heldout-real --resolver command \
  --resolver-command-json '["node","tools/ai/src/evals/work-runner-resolver.mjs"]' \
  --min-pass-rate 0.5
```

`tools/ai/src/evals/claude-adapter.mjs` is the shipped Claude Code adapter: it
reads the case spec from `MYAGENTTOOL_HELDOUT_CASE` (the case IS the issue; the
oracle is never shown to the agent), runs `claude -p` with edit-only tools
(`Read,Glob,Grep,Edit,Write`, `acceptEdits`, no Bash), and writes the
adapter-result contract. Env knobs: `MYAGENTTOOL_CLAUDE_CLI`,
`MYAGENTTOOL_CLAUDE_MODEL`, `MYAGENTTOOL_CLAUDE_TIMEOUT_MS` (default 600000).
Keep the default 600s for sets containing `large`-tier cases: the baseline
run's only failure (hr-006) was an adapter timeout at 300s, and per SWE-bench
convention a timeout counts as unresolved.

## Difficulty tiers

Cases carry `difficulty: small|medium|large` (by the original change's size:
roughly ≤20 changed lines / ≤120 / beyond). The report breaks the pass rate
down per tier so "solves small, fails large" is visible instead of hidden in
one blended number. Unannotated cases report as `unrated`.

## Baseline

First real baseline (2026-07-02, 8-case snapshot, file-level oracle, Claude
Code CLI): **87.5% (7/8)** — sole failure was the hr-006 adapter timeout.
Suggested starting gate: `--min-pass-rate 0.6`. Later runs use the grown set
(13 cases) with behavior probes, so rates are comparable only within the same
set version — record the set size and probe count alongside any number.

Env: `MYAGENTTOOL_CODING_ADAPTER` (default `mock` — changes nothing, so pass
rate is 0%; use a real adapter to measure capability), `MYAGENTTOOL_HELDOUT_PROVIDER`
(code-plan provider, default `mock`), `MYAGENTTOOL_HELDOUT_BASE` (worktree base
ref, default `HEAD`), plus the adapter's own `*_COMMAND_JSON`. Scope drift is
allowed inside the run because the held-out **oracle** — not work-runner's
scope-check — is what judges the case.

## The sets

Two sets exist:

- `tools/ai/evals/heldout/` — the **seed synthetic set** (6 cases: one
  intentionally unsolved, one intentionally-vacuous verify probe). Drives the
  hermetic `ai:check` sanity; mock rate 4/6 ≈ 66.7%.
- `tools/ai/evals/heldout-real/` — the **real set**: 8 cases mined from this
  repo's git history. Each case's `base` pins the resolver's worktree to the
  **parent of the original fix commit**, so the fix is absent from the tree the
  agent sees (the SWE-bench base-commit structure). Specs are written
  issue-style from the original intent; `expectedFiles` is the minimal core
  file the real fix touched. The mock baseline here is **0%** — only a real
  coding agent can score.

Cases are one JSON file each:

```json
{
  "id": "hb-001-example",
  "issue": "sim-1",
  "title": "Short human title",
  "spec": "What the change must accomplish (issue-style; never reveal the oracle files).",
  "risk": "low",
  "base": "<optional git ref — real cases pin the parent of the original fix commit>",
  "oracle": {
    "expectedFiles": ["path/that/must/change"],
    "forbiddenFiles": ["apps/server/"]
  },
  "mock": {
    "changedFiles": ["path/that/must/change"],
    "note": "Synthetic cases only; real cases omit mock (baseline 0%)."
  }
}
```

**Keep at least one intentionally-unsolved case** (empty or wrong
`mock.changedFiles`). `ai:check` fails if the mock pass rate is 0% (harness
broken) or 100% (set no longer tests a real gap). The seed set keeps two cases
deliberately unresolved (an unsolved case and a vacuous-probe case), so the
mock rate stays a non-degenerate baseline (currently 4/6 ≈ 66.7%).

## How this feeds the maturity gate

L4 is "reached" only when a real (`command`) resolver clears an agreed
`--min-pass-rate` on this set, with the evidence file linked — not when a
wrapper contract merely exists. Grow the set with real issues over time;
`passRate` on a fixed set version is the trend line.

## Sub-capability gates (`pnpm ai:eval-subcap`)

The held-out gate measures the branch/code/PR slice of L4. The sub-capability
eval (`tools/ai/src/evals/subcap.mjs`, cases in `tools/ai/evals/subcap/`)
covers the two L4 sub-capabilities it does not exercise:

- **`pm-brief` cases** (capability): given an idea, the provider must produce a
  PM brief that is structurally complete AND classifies risk the way the
  product's gates demand — a deterministic oracle checks required risk-flag
  substrings, minimum acceptance criteria, and allowed risk levels. `--provider
  mock` is the hermetic plumbing baseline (mock scores 4/6: it defaults
  low-risk ideas to medium — a real mock limitation, honestly surfaced);
  `--provider command` with `tools/ai/src/evals/claude-provider.mjs` (absolute
  path in `MYAGENTTOOL_AI_COMMAND`) measures real capability.
- **`issue-gate` cases** (product behavior, provider-independent): the
  issue-tree apply gate must block or allow exactly when it should across the
  gated categories (high/critical risk, billing, release/deploy, roadmap;
  approved high-risk passes; low-risk passes). These must pass **100%** — a
  failure is a product regression, not a capability signal — and the command
  exits non-zero if any fails, independent of `--min-pass-rate`. The same
  check runs hermetically inside `ai:check`.

- **`review` cases** (capability, planted-defect detection): each case carries
  a small fixture PR (`pr.title/body/diff`) with **known planted defects**; the
  review must flag every planted file (`mustFlagFiles`), name each defect
  mechanism (`mustMention` — any-of synonym groups, so wording is free but the
  mechanism must be named), and withhold approval. The mock reviewer finds
  nothing, so the review kind's mock baseline is **0%** — only a real reviewer
  scores (`ai:check` enforces this as an anti-degeneracy rule: a review case
  the mock passes demands nothing and fails the check).

With this, all three L4 sub-capability surfaces (PM brief, issue-creation
apply, review evidence) have measured gates.

## Not in this slice

- A packaged smoke test / adapter command for a specific real agent (Claude,
  Codex). The resolver is agent-agnostic; wiring a named agent is follow-up.
- Larger, versioned held-out sets and per-case difficulty tiers.
- Wiring `--min-pass-rate` into a CI gate (blocked on CI runner activation).
