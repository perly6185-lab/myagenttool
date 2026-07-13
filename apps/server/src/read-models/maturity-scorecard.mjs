// Computed Maturity Scorecard. Encodes the "Recalibrated Ladder" gates from
// docs/engineering/MATURITY_CALIBRATION.md as CODE, so the L0–L6 status is
// COMPUTED from measured evidence (DORA + held-out eval + backlog + governance
// artifacts) instead of hand-typed prose in FULL_FLOW_AI_DELIVERY.md.
//
// HONEST BY CONSTRUCTION: a level whose gate can't be measured (no artifact, no
// data) is "indeterminate" — never a faked pass. This mirrors how dora.mjs refuses
// to invent a change-failure rate when no incident marker exists. And the ladder
// itself is an INTERNAL ROADMAP, not a calibrated industry rating: no vendor-neutral
// standard for autonomous AI delivery exists (MATURITY_CALIBRATION.md "Frontier
// Gaps"), so `disclaimer` rides on every scorecard.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readEvalTrend, summarizeEvalTrend } from "../services/eval-trend.mjs";
import { summarizeDeployments } from "../services/auto-run-deploy-metrics.mjs";
import { summarizeOrchestrationRecovery } from "../services/application-recovery-metrics.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const METRICS_DIR = resolve(REPO_ROOT, ".myagenttool/metrics");

// Held-out apply pass-rate floor (SWE-bench-style). Provisional: the shared
// PROVISIONAL_FLOORS.heldout, still n<3 real runs (eval-signals.mjs).
export const HELDOUT_FLOOR = 0.6;

export const MATURITY_DISCLAIMER =
  "Internal roadmap, not a calibrated industry rating — no vendor-neutral standard for autonomous AI delivery exists (see docs/engineering/MATURITY_CALIBRATION.md, Frontier Gaps).";

function pct(rate) {
  return rate == null ? null : `${Math.round(rate * 100)}%`;
}

// null measured → indeterminate; else met/unmet by the boolean gate.
function verdict(measured, ok) {
  if (measured == null || measured === undefined) return "indeterminate";
  return ok ? "met" : "unmet";
}

/**
 * Pure gate evaluation. Every input is optional; a missing input yields an
 * "indeterminate" verdict for the levels it feeds.
 */
export function computeMaturityScorecard({
  docsOk = null,
  backlog = null,
  dora = null,
  governance = null,
  evalSummary = null,
  release = null,
  feedback = null,
} = {}) {
  const levels = [];

  // L0 — docs exist + pass the docs/link check (enforced in CI).
  levels.push({
    level: 0,
    name: "Docs only",
    gate: "Source docs pass the link/docs check",
    anchor: null,
    measured: docsOk == null ? null : docsOk ? "core engineering docs present" : "core docs missing",
    verdict: verdict(docsOk, docsOk === true),
  });

  // L1 — 100% of active work items carry issue + Project fields.
  const l1Rate = backlog ? Math.min(backlog.labelCoverage?.rate ?? 0, backlog.milestoneCoverage?.rate ?? 0) : null;
  levels.push({
    level: 1,
    name: "Issues + Project exist",
    gate: "100% of active items have issue + Project fields",
    anchor: null,
    measured: l1Rate == null ? null : `${pct(l1Rate)} label+milestone coverage`,
    verdict: verdict(l1Rate, l1Rate >= 1),
  });

  // L2 — CI green on ≥95% of PRs that RAN CI AND DORA lead time < 1 day.
  // Re-anchored (activation window): a merge from before CI existed has no checks,
  // so it is N/A — not a CI failure. Measure green over PRs that actually ran CI
  // (greenPrs/prsWithChecks); keep the all-time rate visible as context. Falls back
  // to the all-time rate when the CI-run breakdown isn't in the artifact.
  const ci = dora?.ciChecks ?? null;
  const allTimeGreen = ci?.greenRate ?? null;
  const checkedGreen =
    ci && ci.prsWithChecks > 0 && Number.isFinite(ci.greenPrs) ? ci.greenPrs / ci.prsWithChecks : null;
  const green = checkedGreen ?? allTimeGreen;
  const leadH = dora?.leadTimeHours?.median ?? null;
  const l2Ok = green != null && leadH != null && green >= 0.95 && leadH < 24;
  const preCiMerges =
    ci && Number.isFinite(ci.mergedPrCount) && Number.isFinite(ci.prsWithChecks)
      ? ci.mergedPrCount - ci.prsWithChecks
      : null;
  levels.push({
    level: 2,
    name: "Branch, PR, CI, smoke",
    gate: "CI green ≥95% of PRs that ran CI; DORA lead time <1 day",
    anchor: "DORA lead time / change-failure rate",
    measured:
      green == null
        ? null
        : checkedGreen != null
          ? `CI-green ${pct(checkedGreen)} of ${ci.prsWithChecks} CI-run PRs${preCiMerges ? ` (all-time ${pct(allTimeGreen)} incl. ${preCiMerges} pre-CI merges)` : ""}, lead time ${leadH == null ? "?" : `${leadH}h`} (<24h)`
          : `CI-green ${pct(green)} (≥95%), lead time ${leadH == null ? "?" : `${leadH}h`} (<24h)`,
    verdict: verdict(green, l2Ok),
    detail:
      checkedGreen == null && green != null && green < 0.95
        ? "rolling window includes pre-CI-activation merges — provide ciChecks.greenPrs/prsWithChecks to measure green over PRs that actually ran CI"
        : undefined,
  });

  // L3 — 100% of PRs carry risk-evidence; 0 silent bypasses. (change-fail anchor)
  // Re-anchored (enforcement window): prefer the post-enforcement slice
  // (coverageSince) when the governance artifact carries one — the rolling window
  // holds pre-enforcement merges, so the slice shows current discipline (same
  // rationale as L2's CI-run rate). Falls back to the all-time rate. The slice
  // populates once the governance metrics are generated with `--since <date>`.
  const govSlice = governance?.coverageSince ?? null;
  const gcov = govSlice?.coverageRate ?? governance?.coverageRate ?? null;
  const bypass = govSlice ? govSlice.directPushCount : governance?.directPushCount;
  const l3Ok = gcov != null && gcov >= 1 && (bypass ?? 1) === 0;
  levels.push({
    level: 3,
    name: "Governance + drift checks",
    gate: "100% of PRs carry risk-evidence routes; 0 silent-bypass merges",
    anchor: "DORA change-failure rate ~5%",
    measured:
      gcov == null
        ? null
        : govSlice
          ? `risk-evidence ${pct(gcov)} since ${String(govSlice.since).slice(0, 10)} (all-time ${pct(governance.coverageRate)}), ${bypass ?? "?"} silent bypass(es)`
          : `risk-evidence ${pct(gcov)}, ${bypass ?? "?"} silent bypass(es)`,
    verdict: verdict(gcov, l3Ok),
    detail: dora && dora.changeFailures?.recorded === false ? "change-failure rate not yet recorded (the `Change-failure: #N` marker convention is unused)" : undefined,
    // Actionable team signal: which evidence routes drag coverage down, ranked —
    // "fix these first" (run `pnpm pr:evidence` locally to comply per-PR).
    topGaps: Array.isArray(governance?.topMissingRoutes) ? governance.topMissingRoutes.slice(0, 5) : undefined,
  });

  // L4 — held-out apply pass rate ≥ floor (local SWE-bench-style).
  const held = evalSummary?.heldout ?? null;
  const hp = held?.latest?.passRate ?? null;
  const hn = held?.latest?.total ?? null;
  const realRuns = held?.realRuns ?? null;
  levels.push({
    level: 4,
    name: "AI produces PM→issue→branch→code→PR→review",
    gate: `held-out apply pass rate ≥ ${Math.round(HELDOUT_FLOOR * 100)}%`,
    anchor: "SWE-bench Verified (local pass %)",
    frontier: "partial",
    measured: hp == null ? null : `${pct(hp)} held-out pass${hn ? ` (${Math.round(hp * hn)}/${hn})` : ""}`,
    verdict: verdict(hp, hp >= HELDOUT_FLOOR),
    detail: realRuns != null && realRuns < 3 ? `only ${realRuns} real held-out run(s) — the floor stays provisional until ≥3` : undefined,
  });

  // L5 — releases have rollback notes; deploy recovery time < 1h. With no deploy
  // data, a measured orchestration failure→success recovery stands in as a
  // labeled proxy (docs/design/APPLICATION_RECOVERY_CONVERGENCE.md) — the gate
  // becomes measured, and the measured string names the source honestly.
  // Recovery has three honestly-distinct sources — never label a non-deploy
  // number "deploy recovery". release wins (deploy > orchestration proxy); the
  // github Change-failure marker signal is a LAST resort and is a
  // change-failure-recovery time, not a deploy metric.
  let recoveryH = null;
  let recoverySource = null; // "deploy" | "orchestration" | "change_failure_marker"
  let recoveryCount = null;
  let openIncident = false;
  let deployPresentNoRecovery = false;
  if (release?.recoveryHours != null) {
    recoveryH = release.recoveryHours;
    recoverySource = release.source; // "deploy" or "orchestration"
    recoveryCount = release.recoveryCount ?? null;
    openIncident = Boolean(release.openIncident);
    deployPresentNoRecovery = Boolean(release.deployPresentNoRecovery);
  } else if (dora?.changeFailures?.recoveryHours?.median != null) {
    recoveryH = dora.changeFailures.recoveryHours.median;
    recoverySource = "change_failure_marker";
  }
  // Expose the recovery sample size (a "met" that rests on n=1 is not the same as
  // n=20) and any ACTIVE unrecovered incident (a median-only reading can hide a
  // live outage). And name the orchestration proxy honestly: "no deploy data" is
  // wrong when deploys exist but simply had no failure→recovery sample.
  const sampleSuffix = recoveryCount != null ? ` (n=${recoveryCount})` : "";
  const openSuffix = openIncident ? " · ⚠ open incident (currently unrecovered)" : "";
  const orchestrationNote = deployPresentNoRecovery ? "deploys present, no failure→recovery sample" : "no deploy data";
  const recoveryLabel = {
    deploy: `deploy recovery ${recoveryH}h${sampleSuffix}${openSuffix}`,
    orchestration: `orchestration recovery ${recoveryH}h${sampleSuffix} (${orchestrationNote} — orchestration proxy)`,
    change_failure_marker: `change-failure recovery ${recoveryH}h (from Change-failure markers — not deploy data)`,
  };
  levels.push({
    level: 5,
    name: "Human-approved merge + release + rollback",
    gate: "releases carry rollback notes; deploy recovery time <1h",
    anchor: "DORA recovery time; SLSA/SSDF",
    frontier: "partial",
    measured: recoveryH == null ? null : recoveryLabel[recoverySource],
    recoverySource: recoverySource ?? undefined,
    openIncident: openIncident || undefined,
    verdict: recoveryH == null ? "indeterminate" : verdict(recoveryH, recoveryH < 1),
    detail:
      recoveryH == null
        ? "recovery time not yet measured — enable the deploy stage (deployOnMerge + a deploy command), or record a failed→recovered orchestration run"
        : undefined,
  });

  // L6 — inbound feedback auto-triaged to tracked items (frontier local target).
  const conv = feedback?.conversionRate ?? null;
  levels.push({
    level: 6,
    name: "Feedback auto-becomes tracked items",
    gate: "≥X% inbound feedback auto-triaged; false-triage tracked",
    anchor: "none — frontier",
    frontier: "yes",
    measured: conv == null ? null : `${pct(conv)} conversion`,
    verdict: conv == null ? "indeterminate" : verdict(conv, conv > 0),
    detail: "frontier — local target only; no external standard for the autonomy claim",
  });

  // Current level = the highest level reached WITHOUT a gap ("reached only when the
  // gate is measured, not asserted"). A demonstrated-but-non-contiguous higher
  // level (e.g. L4 capability while L2's rolling CI gate lags) still shows its own
  // verdict in the table — the gap is the story.
  let currentLevel = -1;
  for (const l of levels) {
    if (l.verdict === "met") currentLevel = l.level;
    else break;
  }

  // The blocker to advancing: the first level that isn't met (== currentLevel+1 by
  // contiguity). Its gate-vs-measured IS the gap; `indeterminate` means "measure
  // this before you can claim the level" rather than "you fell short".
  const blocker = levels.find((l) => l.verdict !== "met") ?? null;
  const nextGap = blocker
    ? {
        level: blocker.level,
        name: blocker.name,
        verdict: blocker.verdict,
        gate: blocker.gate,
        measured: blocker.measured,
        detail: blocker.detail,
        action:
          blocker.verdict === "indeterminate"
            ? `Instrument the ${blocker.name} gate — it can't be measured yet.`
            : `Close the gap on the ${blocker.name} gate: ${blocker.gate}.`,
      }
    : null;

  return { levels, currentLevel, nextGap, disclaimer: MATURITY_DISCLAIMER };
}

// --- best-effort artifact loading (missing/garbage → null, never throws) ---

function latestArtifact(kind, metricsDir = METRICS_DIR) {
  try {
    if (!existsSync(metricsDir)) return null;
    const dirs = readdirSync(metricsDir)
      .filter((d) => d.endsWith(`-${kind}`))
      .sort()
      .reverse(); // timestamped run dirs sort lexically → newest first
    for (const d of dirs) {
      const file = resolve(metricsDir, d, `${kind}.json`);
      if (existsSync(file)) {
        try {
          return JSON.parse(readFileSync(file, "utf8"));
        } catch {
          /* try the next-newest */
        }
      }
    }
  } catch {
    /* best-effort */
  }
  return null;
}

/**
 * Gather the latest measured evidence for the scorecard. Best-effort: any input
 * that can't be read stays null (→ indeterminate levels). `metricsDir`/`evalTrend`
 * are injectable for tests.
 */
export function loadMaturityInputs({ metricsDir = METRICS_DIR, evalTrend, repoRoot = REPO_ROOT, deployments = null, invocations = null } = {}) {
  const dora = latestArtifact("dora", metricsDir);
  const backlog = latestArtifact("backlog", metricsDir);
  const governance = latestArtifact("governance", metricsDir);
  const records = evalTrend ?? readEvalTrend();
  const evalSummary = records.length ? summarizeEvalTrend(records) : null;
  // L0 proxy: the ladder's home doc exists on disk. (The full link/docs check is a
  // CI concern; presence is a cheap, honest floor for "docs only".)
  const docsOk = existsSync(resolve(repoRoot, "docs/engineering/FULL_FLOW_AI_DELIVERY.md"));
  // L5 recovery: the deploy stage (D1/D2) instruments deploy recovery time locally,
  // so the gate that was indeterminate "for lack of a deploy target" can now be
  // measured. Only a real median (a failure recovered by a later success) feeds it.
  // With no deploy data, a measured orchestration failure→success recovery stands
  // in as a labeled proxy — deploy wins when both exist (it is the gate's anchor).
  const deploy = Array.isArray(deployments) && deployments.length ? summarizeDeployments(deployments) : null;
  const orchestration = Array.isArray(invocations) && invocations.length ? summarizeOrchestrationRecovery(invocations) : null;
  const release = deploy && deploy.recoveryHours?.median != null
    ? { recoveryHours: deploy.recoveryHours.median, recoveryCount: deploy.recoveryHours.count, openIncident: Boolean(deploy.openIncident), source: "deploy" }
    : orchestration && orchestration.recoveryHours?.median != null
      ? { recoveryHours: orchestration.recoveryHours.median, recoveryCount: orchestration.recoveryHours.count, source: "orchestration", deployPresentNoRecovery: Boolean(deploy && deploy.total > 0) }
      : null;
  return { docsOk, dora, backlog, governance, evalSummary, release, deploy, orchestration };
}

/** Load inputs + compute — the read-model behind GET /api/maturity. */
export function maturityScorecard(opts = {}) {
  const inputs = loadMaturityInputs(opts);
  const scorecard = computeMaturityScorecard(inputs);
  return { ...scorecard, inputs };
}

/** The latest DORA report artifact (Four Keys), best-effort — behind GET /api/dora. */
export function latestDora({ metricsDir = METRICS_DIR } = {}) {
  return latestArtifact("dora", metricsDir);
}
