# Maturity Calibration (Proposal)

Status: proposal / draft. This document calibrates the L0–L6 maturity ladder in
[FULL_FLOW_AI_DELIVERY.md](FULL_FLOW_AI_DELIVERY.md) against external industry
references, and attaches quantitative acceptance gates to each level.

## Why This Exists

The current L0–L6 ladder is a useful internal roadmap, but an audit found two
honesty gaps:

1. **It is self-authored.** No external framework is cited anywhere in `docs/`
   (no DORA, CMMI, SWE-bench, SSDF). The only "reference" is Orca, an internal
   architecture borrow. So the ladder should be treated as a shared roadmap,
   not as an externally calibrated maturity claim.
2. **Its status column was self-graded.** "Mostly complete / Partially
   complete" were qualitative ticks, and at audit time
   [DEFINITION_OF_DONE.md](DEFINITION_OF_DONE.md) had zero numeric thresholds —
   a level counted as "reached" when a structure existed, not when a measured
   bar was cleared. (Both have since been updated to cite the measured gates.)

This proposal fixes both by adding, per level: a **quantitative gate**, an
**external anchor**, and an explicit **frontier flag** where no industry
standard exists yet.

## Three Calibration Principles

1. **Quantify.** Every level gets at least one measurable gate (a rate, a
   count, a pass %). "Structure exists" is necessary but not sufficient.
2. **Anchor externally where a standard exists.** Delivery health → DORA. AI
   coding capability → SWE-bench-style pass rate. Supply-chain / provenance →
   SLSA / NIST SSDF. Do not invent a bar when a public one exists.
3. **Flag the frontier honestly.** For "autonomous product delivery" there is
   **no accepted industry maturity standard** (see [Frontier Gaps](#frontier-gaps-no-accepted-standard-yet)).
   Where we set a bar in that zone, label it as a **local target**, not an
   industry norm.

## External Reference Anchors

### DORA — delivery health (has authoritative benchmarks)

The DORA / State of DevOps four keys, with representative *elite* thresholds
(the 2024 four-cluster snapshot):

| Metric | Definition | Elite (2024 snapshot) |
| --- | --- | --- |
| Deployment frequency | How often code reaches production | On-demand (multiple/day) |
| Lead time for changes | Commit → running in production | < 1 day |
| Change failure rate | % of deploys causing degraded service | ~5% |
| Failed deployment recovery time | Time to restore after a bad deploy | < 1 hour |

Two caveats that matter for using these as gates: (1) **the tiers are not fixed
benchmarks** — DORA re-derives clusters each year by statistical analysis of that
year's survey, so cutoffs drift, and the **2025 report dropped the
Elite/High/Medium/Low tiers entirely** in favor of seven team archetypes. Use
the four keys as *directional* targets, not certified bars. (2) **AI is not a
free delivery-health win**: DORA 2024 found rising AI adoption tracked a −1.5%
throughput and −7.2% stability change; DORA 2025 saw throughput flip positive
but **stability still negative**, framing AI as an *amplifier* of existing
strengths/weaknesses. Directly relevant to us: automating the pipeline does not
raise delivery health by default — the gates below must measure it.

Sources: [2024 DORA highlights (getdx)](https://getdx.com/blog/2024-dora-report/),
[Google Cloud Four Keys](https://cloud.google.com/blog/products/devops-sre/using-the-four-keys-to-measure-your-devops-performance),
[Octopus DORA metrics](https://octopus.com/devops/metrics/dora-metrics/).

### SWE-bench — AI coding capability (has a public benchmark, fast-moving)

Resolve real GitHub issues; scored as **% of issues resolved** (patch makes the
repo's tests pass).

| Set | Size | Notes |
| --- | --- | --- |
| SWE-bench (full) | 2,294 tasks | Original set, 12 Python repos |
| SWE-bench Verified | 500 tasks | Human-validated as solvable (OpenAI + Princeton, Aug 2024); the standard headline set |
| SWE-bench Lite | 300 tasks | Cheaper subset |

State of the art on SWE-bench Verified has climbed from ~2% (2023 baseline) to
roughly **30–50% (late 2024)** to the **~80s–low-90s%** range by mid-2026 — and
it moves month to month, so **cite it as a range with a date, never a fixed
number**. Two hard caveats: (1) scores are **scaffold-dependent** — the same
model scores very differently by agent harness / tool budget (Epoch's tracker
did a scaffold reset in Feb 2026 that shifted results enough they hide older
runs), so only compare within the same harness generation; (2) the very top
scores carry **contamination and test-design caveats**. Related evals: SWE-agent
/ OpenHands (agent scaffolds), SWE-bench Pro and Live-SWE-agent (harder /
contamination-resistant), Aider polyglot (225 tasks, 6 languages — code-edit
correctness), Terminal-Bench 2.0 (89 shell tasks, frontier still < ~65%).

Sources: [SWE-bench](https://www.swebench.com/),
[SWE-bench Verified announcement (OpenAI)](https://openai.com/index/introducing-swe-bench-verified/),
[Epoch AI tracker](https://epoch.ai/benchmarks/swe-bench-verified),
[Aider polyglot](https://aider.chat/docs/leaderboards/),
[Terminal-Bench](https://www.tbench.ai/).

Takeaway for us: **do not chase the public number.** L4's honest gate is a
*local* pass % on a held-out set of our own real issues — the SWE-bench *method*
(held-out tasks, binary resolved/not, measured %), not its scoreboard.

### Supply-chain / provenance — gating AI-generated changes

For "trust the change enough to merge," the relevant public standards are
**SLSA** (build provenance, Build Levels L0–L3), **NIST SSDF (SP 800-218)**
(secure development practices; the AI companion **SP 800-218A** governs securing
AI *model* development, not gating AI-*authored* diffs — adjacent, not on-point),
and **sigstore / GitHub Artifact Attestations** (keyless signing + provenance;
attestations alone = SLSA Build L2, with reusable workflows = L3). These are the
anchors for the review/merge/release gates, not a bespoke checklist.

Sources: [SLSA levels](https://slsa.dev/spec/v1.0/levels),
[NIST SSDF](https://csrc.nist.gov/projects/ssdf),
[GitHub Artifact Attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations).

### The human gate — where industry actually converges (best evidence we have)

There is **no ratified standard for AI-generated-code provenance**, but there is
a clear *de-facto* pattern worth copying. Every major agentic coding tool
(Devin, GitHub Copilot coding agent, Claude Code, Cursor Cloud Agents,
OpenHands) automates **issue → code → tests → PR**, and **none auto-merges or
deploys to production without a human gate**. GitHub's Copilot coding agent
codifies the sharpest version:

- The agent **cannot mark its own PR ready, approve, or merge** it.
- The person who **prompted** the agent **cannot** be the approving reviewer
  (forces an independent human).
- The agent's PR **does not run CI/CD workflows until a human approves**.

This is the strongest external validation of myagenttool's own model: `--apply`
flags, human-approval evidence, and "commands generate drafts, humans gate
mutation." We should cite this convergence rather than a nonexistent standard.

Sources: [GitHub coding agent risks/mitigations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations),
[Reviewing agent PRs (GitHub blog)](https://github.blog/ai-and-ml/generative-ai/agent-pull-requests-are-everywhere-heres-how-to-review-them/),
[DORA 2025 AI Capabilities Model](https://dora.dev/dora-report-2025/).

## Recalibrated Ladder

Each level keeps its original intent, and adds a measurable gate + anchor. A
level is **reached only when the gate is measured, not asserted**.

| Level | Intent | Quantitative gate (proposed) | External anchor | Frontier? |
| --- | --- | --- | --- | --- |
| L0 | Docs only | Source docs exist and pass link/docs check (already enforced) | — | No |
| L1 | Issues + Project exist | 100% of active work items have issue + Project fields; backlog health report emitted | — | No |
| L2 | Branch, PR, CI, smoke | CI+smoke green on ≥95% of merged PRs; DORA lead time measured (target: < 1 day) | DORA lead time; change failure rate | No |
| L3 | Governance + drift checks | 100% of PRs carry required risk-evidence routes; 0 silent-bypass merges; scope-drift false-positive rate tracked | DORA change failure rate ~5% | No |
| L4 | AI produces PM→issue→branch→code→PR→review evidence | `ai:work-runner --apply` succeeds on ≥X% of a **held-out real-issue set** (a local SWE-bench-style harness), evidence links back to PR 100% of runs | SWE-bench Verified as the capability model (local pass %) | **Partial frontier** |
| L5 | Human-approved merge + release + rollback | 100% of releases have rollback notes; required checks technically enforced on `main`; deploy recovery time measured (target < 1 hour) | DORA recovery time; SLSA/SSDF for release provenance | **Partial frontier** |
| L6 | Feedback auto-becomes tracked bugs/risk/roadmap | ≥X% of inbound feedback auto-triaged to a tracked item within N hours; false-triage rate tracked | — (no standard) | **Frontier — local target only** |

Notes on the frontier flags:

- **L4** borrows SWE-bench's *idea* (held-out tasks, measured pass rate) rather
  than the "does a wrapper contract slot exist" test used today. We do not need
  to run public SWE-bench — we need a **local held-out set of real issues** and
  a measured apply success %.
- **L5/L6** have partial or no external standard for the *autonomy* claim; the
  gates there are deliberately marked as local targets.

## Frontier Gaps (No Accepted Standard Yet)

State plainly in any external-facing maturity claim (each point is now
evidenced, not asserted):

- **No rigorous, vendor-neutral standard exists for autonomous AI software
  delivery** (verified mid-2026). What exists is a patchwork:
  [DORA 2025](https://dora.dev/dora-report-2025/) ships an *AI Capabilities
  Model* — capabilities/enablers, explicitly **not** an autonomy ladder, and it
  finds AI adoption still correlates *negatively* with delivery stability;
  Gartner's "Maturity Model for AI-Native Software Engineering" (Mar 2026) is
  **paywalled proprietary research**, not an open standard; Thoughtworks keeps
  autonomous coding agents at **"Trial"** and calls fully-autonomous agents
  **"unconvincing"**
  ([Tech Radar](https://www.thoughtworks.com/radar/tools/software-engineering-agents)).
  No IEEE/ISO standard surfaced.
- **"Autonomy levels" (the SAE L0–L5 self-driving analogy) have no canonical
  version** — at least five mutually-inconsistent variants exist across
  preprints and vendor blogs (UW/Knight user-role model, Tessl blog, Kang
  preprint's 3 oversight tiers, Cloud Security Alliance, etc.). **Our L0–L6 is
  in exactly this category** and must be described as an internal roadmap, not a
  calibrated industry rating.
- **No end-to-end standard for AI-generated-code provenance gating.** SLSA/SSDF
  cover build/release integrity, not "an agent authored this diff, here is the
  human gate it passed." The GitHub Copilot-agent guardrail pattern (above) is
  the closest codified practice — and even it became configurable in Mar 2026.
- **Benchmark ↔ product-value gap.** A high SWE-bench score does not certify
  end-to-end delivery; no public benchmark measures the full idea→feedback loop.
- **Industry does converge on one thing** (see [human gate](#the-human-gate--where-industry-actually-converges-best-evidence-we-have)):
  automate up to the PR, keep a human gate on merge/deploy. That convergence —
  not a maturity number — is the defensible external claim.

## How To Adopt

This proposal is inert until measurement exists. Minimum instrumentation:

1. **DORA counters** from git/PR/deploy events — feeds L2/L3/L5 gates. A
   minimal slice now exists (`pnpm github:dora`): PR-based lead time and a
   merge-frequency proxy are measured; change failure rate and recovery time
   are reported as **not instrumented** (they need a real deploy target +
   incident signal) rather than proxied. First reading (2026-07-02, 30-day
   window): 73 merged PRs, median lead time 0.02h, 17 merges/week.
2. **A local held-out issue set + measured pass %** — the honest replacement
   for L4's structural check. Implemented ([L4_HELDOUT_EVAL.md](L4_HELDOUT_EVAL.md),
   `pnpm ai:eval-heldout`): a real set mined from git history (base-commit
   pinned, SWE-bench structure), a production resolver running
   `ai:work-runner --apply` in isolated worktrees, a real Claude Code adapter,
   and file-level + behavior-level (fail-to-pass / regression) oracles.
   **First real baseline (2026-07-02): 87.5% (7/8) with the Claude Code CLI on
   the history-mined set, file-level oracle; the one failure was an adapter
   timeout, counted against per SWE-bench convention.** Suggested starting gate:
   `--min-pass-rate 0.6` (below baseline: 8-case variance is high and the set
   has since grown to 13 cases with behavior probes, which only get stricter).
3. **Backlog + evidence-coverage reports** — feeds L1/L3 gates. The L3 slice
   now exists (`pnpm github:governance`): every merged PR in the window is
   re-judged with the same predicates the per-PR gate enforces
   (`pr-evidence.mjs`, shared with `check-pr` so measurement cannot drift), and
   silent-bypass merges are counted from first-parent non-merge commits on the
   default branch. **First reading (2026-07-02, 30-day window): coverage 29.1%
   (23/79) vs 100% target; 56 bypass commits vs 0 target** — the gate exists
   but was not enforced at merge time (CI activation + branch protection is the
   enforcement lever; see tools/dev/ci-activate.mjs). Scope-drift
   false-positive rate is reported as not instrumented (needs a labeled
   corpus of scope-check verdicts).

Then update [FULL_FLOW_AI_DELIVERY.md](FULL_FLOW_AI_DELIVERY.md)'s status column
to cite measured numbers, and replace qualitative ticks in
[DEFINITION_OF_DONE.md](DEFINITION_OF_DONE.md) with the gates above where they
apply.

## Change Rule

Treat this as a proposal until reviewed. When adopted, this document becomes the
source of truth for what each maturity level *means*, and
`FULL_FLOW_AI_DELIVERY.md` links here for its bars.
