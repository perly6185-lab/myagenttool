import { MAIL_CLASSIFIER_VERSION, mailMessageKey } from "./mail-header-classifier.mjs";

const MIN_QUALITY_SAMPLE = 50;
const MIN_MOVE_SAMPLE = 10;
const THRESHOLDS = Object.freeze({
  coverageRate: 0.9,
  unknownRate: 0.35,
  correctionRate: 0.15,
  jobFailureRate: 0.05,
  moveUnconfirmedRate: 0.05,
});

export function buildMailClassificationQuality({ state, messages = [], actor = null, now = () => new Date().toISOString() } = {}) {
  const teamId = actor?.teamId ?? "team_local";
  const currentKeys = new Set(messages.map(mailMessageKey));
  const records = (state?.mailClassifications ?? [])
    .filter((row) => (row.ownerTeamId ?? "team_local") === teamId && currentKeys.has(row.messageKey));
  const byKey = new Map(records.map((row) => [row.messageKey, row]));
  const current = [...currentKeys].map((key) => byKey.get(key)).filter(Boolean);
  const classified = current.length;
  const unknown = current.filter((row) => (row.manualOverride ?? row).attention === "unknown").length;
  const corrected = current.filter((row) => row.manualOverride || row.confirmationState === "corrected").length;
  const semantic = current.filter((row) => row.stage === "semantic").length;
  const stale = current.filter((row) => row.classifierVersion !== MAIL_CLASSIFIER_VERSION).length;

  const jobs = (state?.mailClassificationJobs ?? [])
    .filter((job) => (job.ownerTeamId ?? "team_local") === teamId && ["succeeded", "degraded", "cancelled", "interrupted"].includes(job.status))
    .sort((left, right) => String(right.completedAt ?? right.updatedAt ?? "").localeCompare(String(left.completedAt ?? left.updatedAt ?? "")))
    .slice(0, 50);
  const jobProcessed = sum(jobs, "processed");
  const jobFailed = sum(jobs, "failed");

  const signals = [];
  const coverageRate = rate(classified, currentKeys.size);
  const unknownRate = rate(unknown, classified);
  const correctionRate = rate(corrected, classified);
  const jobFailureRate = rate(jobFailed, jobProcessed);
  if (classified < MIN_QUALITY_SAMPLE) signals.push("insufficient_sample");
  if (coverageRate != null && coverageRate < THRESHOLDS.coverageRate) signals.push("low_coverage");
  if (unknownRate != null && unknownRate > THRESHOLDS.unknownRate) signals.push("high_unknown_rate");
  if (correctionRate != null && correctionRate > THRESHOLDS.correctionRate) signals.push("high_correction_rate");
  if (jobFailureRate != null && jobFailureRate > THRESHOLDS.jobFailureRate) signals.push("high_job_failure_rate");
  if (stale) signals.push("stale_classifier_results");

  const moveJobs = (state?.mailFolderMoveJobs ?? [])
    .filter((job) => (job.ownerTeamId ?? "team_local") === teamId && ["succeeded", "unconfirmed"].includes(job.status));
  const unconfirmedMoves = moveJobs.filter((job) => job.status === "unconfirmed").length;
  const moveUnconfirmedRate = rate(unconfirmedMoves, moveJobs.length);

  return {
    status: classified < MIN_QUALITY_SAMPLE ? "collecting" : signals.some((signal) => signal !== "insufficient_sample") ? "needs_attention" : "healthy",
    generatedAt: now(),
    sampleSize: classified,
    minimumSample: MIN_QUALITY_SAMPLE,
    signals,
    metrics: {
      coverage: metric(classified, currentKeys.size, coverageRate, THRESHOLDS.coverageRate, "at_least"),
      unknown: metric(unknown, classified, unknownRate, THRESHOLDS.unknownRate, "at_most"),
      corrections: metric(corrected, classified, correctionRate, THRESHOLDS.correctionRate, "at_most"),
      jobFailures: metric(jobFailed, jobProcessed, jobFailureRate, THRESHOLDS.jobFailureRate, "at_most"),
      semantic: { count: semantic },
      stale: { count: stale },
    },
    organization: {
      status: moveJobs.length < MIN_MOVE_SAMPLE ? "collecting" : moveUnconfirmedRate > THRESHOLDS.moveUnconfirmedRate ? "needs_attention" : "healthy",
      completedBatches: moveJobs.length,
      unconfirmedBatches: unconfirmedMoves,
      unconfirmedRate: moveUnconfirmedRate,
      minimumSample: MIN_MOVE_SAMPLE,
    },
    privacy: { localOnly: true, includesMessageContent: false, includesSenderIdentity: false },
  };
}

function metric(numerator, denominator, value, target, direction) {
  return { numerator, denominator, value, target, direction };
}

function rate(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 10_000 : null;
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + Math.max(0, Number(row?.[key]) || 0), 0);
}
