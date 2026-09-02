import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  evaluateRiskReminderAcceptance,
  loadRiskReminderAcceptanceDataset,
  riskReminderAcceptanceDatasetDigest,
} from "../../dev/work-item-risk-reminder-acceptance.mjs";
import {
  P414_KNOWN_LIMITATIONS,
  P414_ROLLBACK_POLICY,
  inspectP414CandidateSource,
  projectP414Conclusion,
  projectRiskReminderAcceptanceReleaseEvidence,
  runRiskReminderAcceptanceReleaseGate,
} from "../src/p4-14-evidence.mjs";

const dataset = loadRiskReminderAcceptanceDataset();

function passingRecord() {
  const participants = Array.from({ length: 5 }, (_, index) => ({ id: `participant-${String(index + 1).padStart(2, "0")}`, profile: "ordinary_user" }));
  return {
    schemaVersion: 1,
    datasetId: dataset.datasetId,
    datasetVersion: dataset.datasetVersion,
    datasetDigest: riskReminderAcceptanceDatasetDigest(dataset),
    surface: {
      version: dataset.surface.version,
      productCommit: "a".repeat(40),
      sourceState: "clean",
      locale: dataset.surface.locale,
      viewport: { width: 1440, height: 900 },
    },
    study: { completedAt: "2026-09-01T10:00:00.000Z", facilitatorAttestation: true, notes: "Sanitized." },
    participants,
    observations: participants.flatMap((participant) => dataset.scenarios.map((scenario) => ({
      participantId: participant.id,
      scenarioId: scenario.id,
      professionalDetailsOpenedBeforeAnswers: false,
      durationBucket: "under_30s",
      answers: Object.fromEntries(dataset.questions.map((question) => [question.id, "correct"])),
      criticalMisconceptions: [],
    }))),
    findings: [],
  };
}

test("release evidence contains only the bounded R5 aggregate", () => {
  const record = passingRecord();
  const evidence = projectRiskReminderAcceptanceReleaseEvidence(record);
  assert.equal(evidence.releaseReady, true);
  assert.equal(evidence.metrics.completedParticipants, 5);
  assert.equal(evidence.metrics.totalAnswers, 160);
  assert.equal(evidence.surface.productCommit, "a".repeat(40));
  const serialized = JSON.stringify(evidence);
  assert.equal(serialized.includes("participant-01"), false);
  assert.equal(serialized.includes("observations"), false);
  assert.equal(serialized.includes("study"), false);
  assert.equal(serialized.includes("Sanitized."), false);
});

test("an incomplete R5 record remains blocked in the release projection", () => {
  const record = passingRecord();
  record.observations.pop();
  const evidence = projectRiskReminderAcceptanceReleaseEvidence(record);
  assert.equal(evaluateRiskReminderAcceptance(record).releaseReady, false);
  assert.equal(evidence.releaseReady, false);
  assert.ok(evidence.failureCategories.includes("scenario_coverage_incomplete"));
});

test("the release gate requires a private readable evidence file", (t) => {
  const root = mkdtempSync(join(tmpdir(), "p4-14-acceptance-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "observations.json");
  writeFileSync(path, JSON.stringify(passingRecord()), { mode: 0o600 });
  assert.equal(runRiskReminderAcceptanceReleaseGate({}).error, "risk_acceptance_evidence_missing");
  assert.equal(runRiskReminderAcceptanceReleaseGate({ evidencePath: path, expectedProductCommit: "a".repeat(40) }).status, "passed");
  assert.equal(runRiskReminderAcceptanceReleaseGate({ evidencePath: path, expectedProductCommit: "b".repeat(40) }).error, "risk_acceptance_candidate_commit_mismatch");
  chmodSync(path, 0o644);
  assert.equal(runRiskReminderAcceptanceReleaseGate({ evidencePath: path, platform: "darwin" }).error, "risk_acceptance_evidence_permissions_too_open");
});

test("P4.14 declares bounded limitations, evidence preservation, and conclusions", () => {
  assert.deepEqual(P414_KNOWN_LIMITATIONS.map((item) => item.code), [
    "unknown_evidence_blocks_write",
    "office_recovery_is_inspect_only",
    "external_high_risk_actions_require_separate_confirmation",
  ]);
  assert.deepEqual(P414_ROLLBACK_POLICY.preserve, ["delivery_evidence", "review_action_receipts", "office_batch_journal"]);
  assert.equal(projectP414Conclusion(false), "blocked");
  assert.equal(projectP414Conclusion(true), "passed_with_known_limitations");
});

test("candidate source evidence requires a commit and clean worktree without listing changed files", (t) => {
  const root = mkdtempSync(join(tmpdir(), "p4-14-source-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(git("init").status, 0);
  assert.equal(git("config", "user.name", "Release Test").status, 0);
  assert.equal(git("config", "user.email", "release-test@example.invalid").status, 0);
  writeFileSync(join(root, "fixture.txt"), "clean\n");
  assert.equal(git("add", "fixture.txt").status, 0);
  assert.equal(git("commit", "-m", "fixture").status, 0);
  const clean = inspectP414CandidateSource({ repoRoot: root });
  assert.equal(clean.status, "passed");
  assert.match(clean.source.commit, /^[a-f0-9]{40}$/);
  assert.equal(clean.source.worktreeState, "clean");
  writeFileSync(join(root, "fixture.txt"), "dirty\n");
  const dirty = inspectP414CandidateSource({ repoRoot: root });
  assert.equal(dirty.status, "failed");
  assert.equal(dirty.error, "candidate_worktree_dirty");
  assert.equal(JSON.stringify(dirty).includes("fixture.txt"), false);
});
