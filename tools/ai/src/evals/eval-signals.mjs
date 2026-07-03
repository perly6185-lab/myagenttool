// Pure signal logic for the scheduled real-eval runner (#285/#286).
//
// Kept importable (no I/O, no process) so ai:check can test the detectors
// hermetically. tools/dev/eval-real-run.mjs supplies the run record + prior
// trend and turns the returned events into inbox lines.

// Infra-failure fingerprint: issue-gate cases are provider-INDEPENDENT (pure
// product logic, no model call), so a full issue-gate alongside a total wipe of
// the provider-backed kinds (pm-brief, review) means the provider/auth broke —
// not that capability regressed. This is what the first cron run looked like.
export function looksLikeInfraFailure(subcap) {
  if (!subcap || !subcap.byKind) return false;
  const gate = subcap.byKind["issue-gate"];
  const providerTotal = (subcap.byKind["pm-brief"]?.total ?? 0) + (subcap.byKind["review"]?.total ?? 0);
  const providerResolved = (subcap.byKind["pm-brief"]?.resolved ?? 0) + (subcap.byKind["review"]?.resolved ?? 0);
  return Boolean(gate) && gate.resolved === gate.total && providerTotal > 0 && providerResolved === 0;
}

// The most recent trend record that carries a real capability number (not an
// infra-failure run). #250's gate-line derivation must use these, never the
// noise rows.
export function lastCapabilityRecord(records) {
  for (let i = records.length - 1; i >= 0; i -= 1) {
    if (!records[i]?.infraFailure && Number.isFinite(records[i]?.subcap?.passRate)) return records[i];
  }
  return null;
}

// Build the L6 feedback events for one run. Deterministic; dedupeKeys are
// stable so nightly repeats of the same condition fold to one issue.
export function buildRunFeedbackEvents(record, priorRecords = [], { dropThreshold = 0.2 } = {}) {
  const events = [];
  const startedAt = record.startedAt ?? "";

  if (record.authFailure) {
    events.push({
      source: "eval-real", severity: "high",
      title: "Scheduled eval could not authenticate the Claude CLI",
      detail: `Run ${startedAt}: auth preflight failed (${record.authDetail || "not logged in"}); no paid eval was attempted. Fix the cron login (see eval-real-cron.sh header) and the next run recovers.`,
      dedupeKey: "eval-real:auth-preflight-failed",
    });
    return events; // an auth failure means no capability signal at all
  }

  if (looksLikeInfraFailure(record.subcap)) {
    events.push({
      source: "eval-real", severity: "high",
      title: "Scheduled eval hit an infrastructure failure (provider cases all failed)",
      detail: `Run ${startedAt}: issue-gate cases passed but every provider-backed case failed — a provider/environment fault, not a capability regression. This run is excluded from the capability trend.`,
      dedupeKey: "eval-real:infra-failure",
    });
  } else {
    // Only meaningful when this run produced a real capability number.
    if (record.subcap?.error) {
      events.push({
        source: "eval-real", severity: "high",
        title: "Real subcap eval failed to produce a summary",
        detail: `Run ${startedAt}: subcap eval error (${record.subcap.error}). See .myagenttool/evals/cron.log.`,
        dedupeKey: "eval-real:subcap-run-error",
      });
    }
    const gate = record.subcap?.byKind?.["issue-gate"];
    if (gate && gate.resolved < gate.total) {
      events.push({
        source: "eval-real", severity: "high",
        title: `Issue-gate cases failing in the real eval (${gate.resolved}/${gate.total})`,
        detail: `Run ${startedAt}: the product apply-gate cases must pass 100%; a miss here is a product bug, not a capability signal.`,
        dedupeKey: "eval-real:issue-gate-regression",
      });
    }
    const prev = lastCapabilityRecord(priorRecords);
    if (prev && Number.isFinite(record.subcap?.passRate) && record.subcap.passRate <= prev.subcap.passRate - dropThreshold) {
      events.push({
        source: "eval-real", severity: "medium",
        title: `Capability drop: subcap pass rate fell to ${(record.subcap.passRate * 100).toFixed(0)}%`,
        detail: `Run ${startedAt}: subcap pass rate ${(record.subcap.passRate * 100).toFixed(0)}% is >=${(dropThreshold * 100).toFixed(0)}pp below the prior ${(prev.subcap.passRate * 100).toFixed(0)}% (${prev.startedAt}). Investigate before hardening the gate line (#250).`,
        dedupeKey: "eval-real:capability-drop",
      });
    }
  }

  if (record.heldout?.error) {
    events.push({
      source: "eval-real", severity: "medium",
      title: "Real held-out eval failed to produce a summary",
      detail: `Run ${startedAt}: held-out eval error (${record.heldout.error}). See .myagenttool/evals/cron.log.`,
      dedupeKey: "eval-real:heldout-run-error",
    });
  }
  return events;
}
