import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import {
  evaluateRiskReminderAcceptance,
  loadRiskReminderAcceptanceDataset,
} from "../../dev/work-item-risk-reminder-acceptance.mjs";

export const P414_KNOWN_LIMITATIONS = Object.freeze([
  Object.freeze({
    code: "unknown_evidence_blocks_write",
    behavior: "Unknown delivery or write state remains read-only until evidence is reconciled.",
  }),
  Object.freeze({
    code: "office_recovery_is_inspect_only",
    behavior: "The ordinary task page exposes recovery evidence but does not offer an ungoverned retry or manual rollback button.",
  }),
  Object.freeze({
    code: "external_high_risk_actions_require_separate_confirmation",
    behavior: "External sending, payment, deletion, and permission changes retain independent confirmation gates.",
  }),
]);

export const P414_ROLLBACK_POLICY = Object.freeze({
  strategy: "install_previous_candidate_without_deleting_evidence",
  preserve: Object.freeze(["delivery_evidence", "review_action_receipts", "office_batch_journal"]),
  steps: Object.freeze([
    "stop_new_writes",
    "install_previous_candidate",
    "restart_services",
    "verify_journal_readability",
    "inspect_pending_batches",
  ]),
});

function failureCategories(report) {
  const categories = report.validationErrors.map((error) => error.split(":", 1)[0]);
  if (!report.gates.minimumParticipants) categories.push("minimum_participants_not_met");
  if (!report.gates.completeScenarioCoverage) categories.push("scenario_coverage_incomplete");
  if (!report.gates.minimumAnswerAccuracy) categories.push("answer_accuracy_below_threshold");
  if (!report.gates.noCriticalMisconceptions) categories.push("critical_misconception_present");
  return [...new Set(categories)].sort();
}

export function projectRiskReminderAcceptanceReleaseEvidence(record, dataset = loadRiskReminderAcceptanceDataset()) {
  const report = evaluateRiskReminderAcceptance(record, dataset);
  return {
    datasetId: report.datasetId,
    datasetVersion: report.datasetVersion,
    datasetDigest: report.datasetDigest,
    surface: report.surface,
    releaseReady: report.releaseReady,
    gates: report.gates,
    failureCategories: failureCategories(report),
    metrics: {
      completedParticipants: report.metrics.completedParticipants,
      observationCount: report.metrics.observationCount,
      expectedObservationCount: report.metrics.expectedObservationCount,
      correctWithoutProfessionalDetails: report.metrics.correctWithoutProfessionalDetails,
      totalAnswers: report.metrics.totalAnswers,
      independentAnswerAccuracy: report.metrics.independentAnswerAccuracy,
      criticalMisconceptionCount: report.metrics.criticalMisconceptionCount,
    },
    findings: report.findings.map(({ scenarioId, issueCode, accuracy }) => ({ scenarioId, issueCode, accuracy })),
  };
}

function blockedRiskAcceptanceResult(started, error) {
  return {
    id: "risk-reminder-user-acceptance",
    status: "failed",
    evidence: "R5 aggregated ordinary-user comprehension gate",
    command: "bounded risk-reminder acceptance evaluator",
    durationMs: Date.now() - started,
    error,
    output: "",
    acceptance: null,
  };
}

export function runRiskReminderAcceptanceReleaseGate({ evidencePath, expectedProductCommit, platform = process.platform } = {}) {
  const started = Date.now();
  if (!evidencePath) return blockedRiskAcceptanceResult(started, "risk_acceptance_evidence_missing");
  try {
    const resolvedPath = resolve(evidencePath);
    const stats = statSync(resolvedPath);
    if (!stats.isFile()) return blockedRiskAcceptanceResult(started, "risk_acceptance_evidence_not_file");
    if (platform !== "win32" && (stats.mode & 0o077) !== 0) {
      return blockedRiskAcceptanceResult(started, "risk_acceptance_evidence_permissions_too_open");
    }
    const record = JSON.parse(readFileSync(resolvedPath, "utf8"));
    const acceptance = projectRiskReminderAcceptanceReleaseEvidence(record);
    const candidateCommitMatches = /^[a-f0-9]{40}$/.test(expectedProductCommit ?? "")
      && acceptance.surface?.productCommit === expectedProductCommit;
    const releaseReady = acceptance.releaseReady && candidateCommitMatches;
    acceptance.candidateCommitMatches = candidateCommitMatches;
    if (!candidateCommitMatches) acceptance.failureCategories = [...new Set([...acceptance.failureCategories, "acceptance_candidate_commit_mismatch"])].sort();
    return {
      id: "risk-reminder-user-acceptance",
      status: releaseReady ? "passed" : "failed",
      evidence: "R5 aggregated ordinary-user comprehension gate",
      command: "bounded risk-reminder acceptance evaluator",
      durationMs: Date.now() - started,
      error: releaseReady ? null : acceptance.releaseReady ? "risk_acceptance_candidate_commit_mismatch" : "risk_acceptance_gate_not_met",
      output: "",
      acceptance,
    };
  } catch {
    return blockedRiskAcceptanceResult(started, "risk_acceptance_evidence_unreadable");
  }
}

export function inspectP414CandidateSource({ repoRoot } = {}) {
  const started = Date.now();
  const commitResult = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8", windowsHide: true });
  const statusResult = spawnSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8", windowsHide: true });
  const commit = commitResult.status === 0 ? commitResult.stdout.trim() : null;
  const worktreeState = statusResult.status === 0 ? (statusResult.stdout.trim() ? "dirty" : "clean") : "unknown";
  const passed = Boolean(commit) && worktreeState === "clean";
  return {
    id: "candidate-source",
    status: passed ? "passed" : "failed",
    evidence: "immutable source commit and clean worktree",
    command: "git commit and worktree inspection",
    durationMs: Date.now() - started,
    error: passed ? null : commit ? "candidate_worktree_dirty" : "candidate_commit_unavailable",
    output: "",
    source: { commit, worktreeState },
  };
}

export function projectP414Conclusion(passed) {
  if (!passed) return "blocked";
  return P414_KNOWN_LIMITATIONS.length ? "passed_with_known_limitations" : "passed";
}
