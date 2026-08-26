import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServerRuntimeServices } from "../src/runtime/service-composer.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import {
  PRIVATE_TUTOR_LEARNER_COLLECTION_KEYS,
  deletePrivateTutorLearnerData,
  erasePrivateTutorLearnerData,
  preparePrivateTutorLearnerDeletion,
} from "../src/services/private-tutor-governance.mjs";
import { updatePrivateTutorGuardianPreferences } from "../src/services/private-tutor-family.mjs";

let openSqliteStore;
try {
  await import("node:sqlite");
  ({ openSqliteStore } = await import("../src/runtime/store/sqlite-store.mjs"));
} catch {
  openSqliteStore = null;
}
const skip = openSqliteStore ? false : "node:sqlite unavailable in this runtime";

test("private tutor data survives SQLite restart and full-media deletion cannot resurrect it", { skip }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "private-tutor-sqlite-"));
  const projectPath = join(directory, "project");
  const stateStorePath = join(directory, "state", "local.json");
  const sqlitePath = join(directory, "state", "local.sqlite");
  mkdirSync(projectPath, { recursive: true });
  mkdirSync(join(directory, "state"), { recursive: true });
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 7, 21, 12, 0, tick++)).toISOString();
  try {
    let store = await openSqliteStore({ path: sqlitePath });
    let runtime = boot({ projectPath, stateStorePath, sqliteStore: store, now });
    const learner = { id: "learner-sensitive", ownerTeamId: "family-sensitive", displayName: "敏感小名", grade: "七年级", status: "active", createdAt: now(), updatedAt: now() };
    runtime.state.privateTutorLearners.unshift(learner);
    runtime.state.privateTutorGuardianLinks.unshift({ id: "guardian-sensitive", learnerId: learner.id, ownerTeamId: learner.ownerTeamId, guardianUserId: "parent-sensitive", verifiedAt: now() });
    runtime.state.privateTutorVoiceTurns.unshift({ id: "voice-sensitive", learnerId: learner.id, ownerTeamId: learner.ownerTeamId, transcript: "敏感语音转写", createdAt: now() });
    runtime.state.privateTutorPilotCohorts.unshift({ id: "cohort-sensitive", status: "active", enrolledLearnerIds: [learner.id] });
    runtime.state.privateTutorPilotParticipations.unshift({ id: "participation-sensitive", cohortId: "cohort-sensitive", learnerId: learner.id, ownerTeamId: learner.ownerTeamId, status: "active", enrolledAt: now() });
    runtime.state.privateTutorPilotConsents.unshift({ id: "consent-sensitive", cohortId: "cohort-sensitive", learnerId: learner.id, ownerTeamId: learner.ownerTeamId, documentVersion: "2026-08-21.v1", acceptedAt: now() });
    runtime.state.privateTutorPilotIncidents.unshift({ id: "incident-sensitive", cohortId: "cohort-sensitive", learnerId: learner.id, ownerTeamId: learner.ownerTeamId, summary: "敏感试点异常说明", createdAt: now() });
    const savedPreferences = updatePrivateTutorGuardianPreferences(runtime.state, learner, "parent-sensitive", {
      notificationFrequency: "off",
      quietHours: { enabled: true, start: "21:30", end: "07:15" },
      weeklyProgressSummary: false,
    }, { at: now(), nextId: runtime.api.nextId });
    assert.equal(savedPreferences.ok, true);
    runtime.api.persistStateNow();
    assert.equal(store.query("privateTutorLearners").some((row) => row.id === learner.id), true);
    store.close();

    store = await openSqliteStore({ path: sqlitePath });
    runtime = boot({ projectPath, stateStorePath, sqliteStore: store, now });
    const restored = runtime.state.privateTutorLearners.find((row) => row.id === learner.id);
    assert.equal(restored.displayName, "敏感小名");
    assert.equal(runtime.state.privateTutorVoiceTurns.some((row) => row.transcript === "敏感语音转写"), true);
    assert.equal(runtime.state.privateTutorPilotParticipations.some((row) => row.learnerId === learner.id), true);
    const restoredPreferences = runtime.state.privateTutorGuardianPreferences.find((row) => row.learnerId === learner.id);
    assert.equal(restoredPreferences.notificationFrequency, "off");
    assert.deepEqual(restoredPreferences.quietHours, { enabled: true, start: "21:30", end: "07:15" });
    assert.equal(restoredPreferences.weeklyProgressSummary, false);

    const report = deletePrivateTutorLearnerData(runtime.state, restored, { actorId: "parent-sensitive", now, nextId: runtime.api.nextId });
    const job = runtime.state.privateTutorDeletionJobs.find((row) => row.reportId === report.id);
    const verification = runtime.api.finalizePrivateTutorLearnerDeletion({ learnerId: learner.id, collectionKeys: PRIVATE_TUTOR_LEARNER_COLLECTION_KEYS, report, job });
    assert.equal(verification.backing, "sqlite");
    assert.equal(verification.durableResidualCount, 0);
    assert.equal(verification.secureDelete, true);
    assert.equal(verification.walCheckpointed, true);
    assert.equal(verification.checkpointBusy, 0);
    assert.equal(verification.remainingLogFrames, 0);
    assert.equal(verification.logicalPersistenceSucceeded, true);
    assert.equal(verification.reportPersisted, true);
    assert.equal(verification.ok, true);
    assert.equal(job.status, "completed");
    assert.equal(job.subjectId, null);
    assert.equal(store.query("privateTutorVoiceTurns").some((row) => row.learnerId === learner.id), false);
    const rollbackArtifact = readFileSync(stateStorePath, "utf8");
    assert.equal(rollbackArtifact.includes("敏感小名"), false);
    assert.equal(rollbackArtifact.includes("敏感语音转写"), false);
    assert.equal(rollbackArtifact.includes("敏感试点异常说明"), false);
    store.close();

    for (const file of [sqlitePath, `${sqlitePath}-wal`]) {
      if (!existsSync(file)) continue;
      const bytes = readFileSync(file);
      assert.equal(bytes.includes(Buffer.from("敏感小名")), false, file);
      assert.equal(bytes.includes(Buffer.from("敏感语音转写")), false, file);
      assert.equal(bytes.includes(Buffer.from("敏感试点异常说明")), false, file);
    }

    store = await openSqliteStore({ path: sqlitePath });
    runtime = boot({ projectPath, stateStorePath, sqliteStore: store, now });
    assert.equal(runtime.state.privateTutorLearners.some((row) => row.id === learner.id), false);
    assert.equal(runtime.state.privateTutorVoiceTurns.some((row) => row.learnerId === learner.id), false);
    assert.equal(runtime.state.privateTutorPilotParticipations.some((row) => row.learnerId === learner.id), false);
    assert.equal(runtime.state.privateTutorPilotCohorts.some((row) => row.enrolledLearnerIds?.includes(learner.id)), false);
    assert.equal(runtime.state.privateTutorDeletionReports.some((row) => row.id === report.id && row.durableVerification?.durableResidualCount === 0), true);
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an interrupted SQLite erasure resumes on restart and scrubs its retry subject", { skip }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "private-tutor-erasure-retry-"));
  const projectPath = join(directory, "project");
  const stateStorePath = join(directory, "state", "local.json");
  const sqlitePath = join(directory, "state", "local.sqlite");
  mkdirSync(projectPath, { recursive: true });
  mkdirSync(join(directory, "state"), { recursive: true });
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 7, 22, 12, 0, tick++)).toISOString();
  try {
    let store = await openSqliteStore({ path: sqlitePath });
    let runtime = boot({ projectPath, stateStorePath, sqliteStore: store, now });
    const learner = { id: "learner-retry", ownerTeamId: "family-retry", displayName: "重试孩子", grade: "六年级", status: "active", createdAt: now(), updatedAt: now() };
    runtime.state.privateTutorLearners.unshift(learner);
    runtime.state.privateTutorGuardianLinks.unshift({ id: "guardian-retry", learnerId: learner.id, ownerTeamId: learner.ownerTeamId, guardianUserId: "parent-retry", verifiedAt: now(), permissions: ["read", "write", "manage"] });
    runtime.state.privateTutorVoiceTurns.unshift({ id: "voice-retry", learnerId: learner.id, ownerTeamId: learner.ownerTeamId, transcript: "应在重试后清除", createdAt: now() });
    runtime.api.persistStateNow();

    const prepared = preparePrivateTutorLearnerDeletion(runtime.state, learner, { actorId: "parent-retry", now, nextId: runtime.api.nextId });
    assert.equal(runtime.api.persistStateNow().ok, true);
    erasePrivateTutorLearnerData(runtime.state, learner.id, prepared.report, now());
    store.compactForErasure = () => ({ secureDelete: true, walCheckpointed: false, checkpointBusy: 1, remainingLogFrames: 1 });
    const failed = runtime.api.finalizePrivateTutorLearnerDeletion({ learnerId: learner.id, collectionKeys: PRIVATE_TUTOR_LEARNER_COLLECTION_KEYS, report: prepared.report, job: prepared.job });
    assert.equal(failed.ok, false);
    assert.equal(prepared.job.status, "erasure_failed");
    assert.equal(prepared.job.subjectId, learner.id);
    store.close();

    store = await openSqliteStore({ path: sqlitePath });
    runtime = boot({ projectPath, stateStorePath, sqliteStore: store, now });
    const recoveredJob = runtime.state.privateTutorDeletionJobs.find((row) => row.id === prepared.job.id);
    const recoveredReport = runtime.state.privateTutorDeletionReports.find((row) => row.id === prepared.report.id);
    assert.equal(recoveredJob.status, "completed");
    assert.equal(recoveredJob.subjectId, null);
    assert.equal(recoveredJob.attempts, 2);
    assert.equal(recoveredReport.status, "completed");
    assert.equal(recoveredReport.durableVerification.ok, true);
    assert.equal(runtime.state.privateTutorLearners.some((row) => row.id === learner.id), false);
    assert.equal(runtime.state.privateTutorVoiceTurns.some((row) => row.learnerId === learner.id), false);
    store.close();

    // A second restart proves that the final verification fields themselves,
    // not only the completed deletion job, crossed the durable barrier.
    store = await openSqliteStore({ path: sqlitePath });
    runtime = boot({ projectPath, stateStorePath, sqliteStore: store, now });
    const durableJob = runtime.state.privateTutorDeletionJobs.find((row) => row.id === prepared.job.id);
    const durableReport = runtime.state.privateTutorDeletionReports.find((row) => row.id === prepared.report.id);
    assert.equal(durableJob.status, "completed");
    assert.equal(durableJob.subjectId, null);
    assert.equal(durableReport.status, "completed");
    assert.equal(durableReport.durableVerification.ok, true);
    assert.equal(durableReport.durableVerification.jsonRollbackArtifactUpdated, true);
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function boot({ projectPath, stateStorePath, sqliteStore, now }) {
  const seed = createServerState({ defaultProjectPath: projectPath, now });
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "test",
    protocolVersion: "0.0.0",
    state: seed.state,
    defaultProject: seed.defaultProject,
    defaultProjectPath: projectPath,
    persistenceEnabled: true,
    stateStorePath,
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
    sqliteStore,
  });
  return { state: seed.state, api: httpDependencies };
}
