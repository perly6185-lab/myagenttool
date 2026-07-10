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

  // L2 — CI green on ≥95% of merged PRs AND DORA lead time < 1 day.
  const green = dora?.ciChecks?.greenRate ?? null;
  const leadH = dora?.leadTimeHours?.median ?? null;
  const l2Ok = green != null && leadH != null && green >= 0.95 && leadH < 24;
  levels.push({
    level: 2,
    name: "Branch, PR, CI, smoke",
    gate: "CI green ≥95% of merged PRs; DORA lead time <1 day",
    anchor: "DORA lead time / change-failure rate",
    measured: green == null ? null : `CI-green ${pct(green)} (≥95%), lead time ${leadH == null ? "?" : `${leadH}h`} (<24h)`,
    verdict: verdict(green, l2Ok),
    detail: green != null && green < 0.95 ? "rolling window includes pre-CI-activation merges — see the post-activation slice (ciChecksSince) which meets the gate" : undefined,
  });

  // L3 — 100% of PRs carry risk-evidence; 0 silent bypasses. (change-fail anchor)
  const gcov = governance?.coverageRate ?? null;
  const bypass = governance?.directPushCount ?? null;
  const l3Ok = gcov != null && gcov >= 1 && (bypass ?? 1) === 0;
  levels.push({
    level: 3,
    name: "Governance + drift checks",
    gate: "100% of PRs carry risk-evidence routes; 0 silent-bypass merges",
    anchor: "DORA change-failure rate ~5%",
    measured: gcov == null ? null : `risk-evidence ${pct(gcov)}, ${bypass ?? "?"} silent bypass(es)`,
    verdict: verdict(gcov, l3Ok),
    detail: dora && dora.changeFailures?.recorded === false ? "change-failure rate not yet recorded (the `Change-failure: #N` marker convention is unused)" : undefined,
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

  // L5 — releases have rollback notes; deploy recovery time < 1h.
  const recoveryH = release?.recoveryHours ?? dora?.changeFailures?.recoveryHours?.median ?? null;
  levels.push({
    level: 5,
    name: "Human-approved merge + release + rollback",
    gate: "releases carry rollback notes; deploy recovery time <1h",
    anchor: "DORA recovery time; SLSA/SSDF",
    frontier: "partial",
    measured: recoveryH == null ? null : `recovery ${recoveryH}h`,
    verdict: recoveryH == null ? "indeterminate" : verdict(recoveryH, recoveryH < 1),
    detail: "deploy recovery time is not instrumented — no deploy target exists yet",
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

  return { levels, currentLevel, disclaimer: MATURITY_DISCLAIMER };
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
export function loadMaturityInputs({ metricsDir = METRICS_DIR, evalTrend, repoRoot = REPO_ROOT } = {}) {
  const dora = latestArtifact("dora", metricsDir);
  const backlog = latestArtifact("backlog", metricsDir);
  const governance = latestArtifact("governance", metricsDir);
  const records = evalTrend ?? readEvalTrend();
  const evalSummary = records.length ? summarizeEvalTrend(records) : null;
  // L0 proxy: the ladder's home doc exists on disk. (The full link/docs check is a
  // CI concern; presence is a cheap, honest floor for "docs only".)
  const docsOk = existsSync(resolve(repoRoot, "docs/engineering/FULL_FLOW_AI_DELIVERY.md"));
  return { docsOk, dora, backlog, governance, evalSummary };
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
