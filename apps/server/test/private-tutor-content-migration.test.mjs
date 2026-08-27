import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPrivateTutorContentMigration,
  confirmPrivateTutorContentMigration,
  createPrivateTutorContentMigrationPreview,
  rollbackPrivateTutorContentMigration,
  updatePrivateTutorContentMigrationMapping,
} from "../src/services/private-tutor-content-migration.mjs";

test("previews, confirms, applies, and rolls back a version migration without rewriting history", () => {
  const state = fixture();
  const deps = sequenceDeps();
  const learner = state.privateTutorLearners[0];
  const created = createPrivateTutorContentMigrationPreview(state, learner, "usr_local", {
    idempotencyKey: "preview-1",
    sourcePackageId: "migration-source",
    sourcePackageVersion: "1.0.0",
    targetPackageId: "migration-target",
    targetPackageVersion: "2.0.0",
  }, deps);

  assert.equal(created.status, 201);
  assert.equal(created.preview.mappings.find((row) => row.sourceKnowledgeId === "stable").decision, "transfer");
  assert.equal(created.preview.mappings.find((row) => row.sourceKnowledgeId === "changed").decision, "provisional");
  assert.equal(created.preview.mappings.find((row) => row.sourceKnowledgeId === "removed").decision, "archive");
  assert.equal(created.preview.impact.activeRuntimeWillChange, false);
  assert.equal(created.preview.impact.targetActivationRequired, true);

  const unsafe = updatePrivateTutorContentMigrationMapping(state, learner, "usr_local", created.preview.id, {
    expectedRevision: 1,
    mappings: mappingInput(created.preview, { changed: { targetKnowledgeIds: ["changed", "extra"], decision: "transfer" } }),
  }, deps);
  assert.equal(unsafe.error, "private_tutor_content_migration_unsafe_transfer");
  assert.equal(state.privateTutorContentMigrationPreviews[0].revision, 1);

  const edited = updatePrivateTutorContentMigrationMapping(state, learner, "usr_local", created.preview.id, {
    expectedRevision: 1,
    mappings: mappingInput(created.preview, { changed: { targetKnowledgeIds: ["changed", "extra"], decision: "provisional" } }),
  }, deps);
  assert.equal(edited.preview.revision, 2);
  assert.equal(edited.preview.mappings.find((row) => row.sourceKnowledgeId === "changed").relation, "split");

  const unacknowledged = confirmPrivateTutorContentMigration(state, learner, "usr_local", created.preview.id, {
    expectedRevision: 2,
    previewFingerprint: edited.preview.previewFingerprint,
    acknowledgeHistoricalPreservation: true,
  }, deps);
  assert.equal(unacknowledged.error, "private_tutor_content_migration_risk_acknowledgement_required");

  const confirmed = confirmPrivateTutorContentMigration(state, learner, "usr_local", created.preview.id, {
    expectedRevision: 2,
    previewFingerprint: edited.preview.previewFingerprint,
    acknowledgeHistoricalPreservation: true,
    acknowledgeRiskyMappings: true,
  }, deps);
  assert.equal(confirmed.preview.status, "confirmed");

  const applied = applyPrivateTutorContentMigration(state, learner, "usr_local", created.preview.id, {
    idempotencyKey: "apply-1",
    previewFingerprint: edited.preview.previewFingerprint,
  }, deps);
  assert.equal(applied.application.status, "applied");
  assert.equal(state.privateTutorSnapshots[0].contentPackageId, "migration-source");
  assert.equal(state.privateTutorAttempts.length, 1);
  assert.equal(applied.application.rollbackReceipt.sourceFactsRewritten, 0);
  const targetState = state.privateTutorSnapshots[0].packageStates.find((row) => row.packageId === "migration-target");
  assert.deepEqual(targetState.knowledge.find((row) => row.id === "stable"), {
    id: "stable", mastery: 0.8, level: "proficient", evidenceCount: 3,
    migrationSources: [{ packageId: "migration-source", packageVersion: "1.0.0", knowledgeId: "stable", relation: "unchanged", decision: "transfer" }],
  });
  assert.equal(targetState.knowledge.find((row) => row.id === "changed").mastery, null);
  assert.equal(targetState.knowledge.find((row) => row.id === "changed").migratedEvidenceCount, 2);
  assert.equal(targetState.knowledge.find((row) => row.id === "extra").requiresReassessment, true);

  const replay = applyPrivateTutorContentMigration(state, learner, "usr_local", created.preview.id, {
    idempotencyKey: "apply-1",
    previewFingerprint: edited.preview.previewFingerprint,
  }, deps);
  assert.equal(replay.replayed, true);
  assert.equal(state.privateTutorSnapshots[0].packageStates.length, 1);

  const rolledBack = rollbackPrivateTutorContentMigration(state, learner, "usr_local", applied.application.id, {
    confirmRollback: true,
  }, deps);
  assert.equal(rolledBack.application.status, "rolled_back");
  assert.equal(state.privateTutorSnapshots[0].packageStates.length, 0);
  assert.equal(state.privateTutorAttempts.length, 1);
});

test("rejects stale previews and rollback after migrated state changes", () => {
  const state = fixture();
  const deps = sequenceDeps();
  const learner = state.privateTutorLearners[0];
  const created = createPrivateTutorContentMigrationPreview(state, learner, "usr_local", {
    idempotencyKey: "preview-2",
    sourcePackageId: "migration-source",
    sourcePackageVersion: "1.0.0",
    targetPackageId: "migration-target",
    targetPackageVersion: "2.0.0",
  }, deps);
  const confirmed = confirmPrivateTutorContentMigration(state, learner, "usr_local", created.preview.id, {
    expectedRevision: 1,
    previewFingerprint: created.preview.previewFingerprint,
    acknowledgeHistoricalPreservation: true,
    acknowledgeRiskyMappings: true,
  }, deps);
  const applied = applyPrivateTutorContentMigration(state, learner, "usr_local", created.preview.id, {
    idempotencyKey: "apply-2",
    previewFingerprint: confirmed.preview.previewFingerprint,
  }, deps);
  state.privateTutorSnapshots[0].packageStates[0].knowledge[0].evidenceCount += 1;
  const rollback = rollbackPrivateTutorContentMigration(state, learner, "usr_local", applied.application.id, { confirmRollback: true }, deps);
  assert.equal(rollback.error, "private_tutor_content_migration_rollback_state_changed");

  const staleState = fixture();
  const stalePreview = createPrivateTutorContentMigrationPreview(staleState, staleState.privateTutorLearners[0], "usr_local", {
    idempotencyKey: "preview-stale",
    sourcePackageId: "migration-source",
    sourcePackageVersion: "1.0.0",
    targetPackageId: "migration-target",
    targetPackageVersion: "2.0.0",
  }, deps).preview;
  staleState.privateTutorContentPackages.find((row) => row.id === "migration-target").contentChecksum = "changed";
  const stale = confirmPrivateTutorContentMigration(staleState, staleState.privateTutorLearners[0], "usr_local", stalePreview.id, {
    expectedRevision: 1,
    previewFingerprint: stalePreview.previewFingerprint,
    acknowledgeHistoricalPreservation: true,
    acknowledgeRiskyMappings: true,
  }, deps);
  assert.equal(stale.error, "private_tutor_content_migration_preview_stale");
});

function mappingInput(preview, overrides) {
  return preview.mappings.map((row) => ({
    sourceKnowledgeId: row.sourceKnowledgeId,
    targetKnowledgeIds: overrides[row.sourceKnowledgeId]?.targetKnowledgeIds ?? row.targetKnowledgeIds,
    decision: overrides[row.sourceKnowledgeId]?.decision ?? row.decision,
  }));
}

function sequenceDeps() {
  let id = 0;
  let time = 0;
  return {
    nextId: (prefix) => `${prefix}_${++id}`,
    now: () => `2026-08-26T00:00:0${time++}.000Z`,
  };
}

function fixture() {
  const knowledge = (id, objectives = [id]) => ({
    id, name: id, learningObjectives: objectives, prerequisiteKnowledgeIds: [], sourceRefs: [], tutoringQuestions: [],
  });
  return {
    privateTutorLearners: [{ id: "learner_1", ownerTeamId: "team_local", activePackageId: "migration-source" }],
    privateTutorSnapshots: [{
      id: "snapshot_1", learnerId: "learner_1", contentPackageId: "migration-source", contentPackageVersion: "1.0.0",
      revision: 1, packageStates: [], knowledge: [
        { id: "stable", mastery: 0.8, level: "proficient", evidenceCount: 3 },
        { id: "changed", mastery: 0.5, level: "developing", evidenceCount: 2 },
        { id: "removed", mastery: 0.4, level: "developing", evidenceCount: 1 },
      ],
    }],
    privateTutorAttempts: [{ id: "attempt_1", learnerId: "learner_1", contentPackageId: "migration-source", contentPackageVersion: "1.0.0" }],
    privateTutorLearningPlans: [{ learnerId: "learner_1", contentPackageId: "migration-source", contentPackageVersion: "1.0.0", status: "active" }],
    privateTutorSessions: [{ learnerId: "learner_1", contentPackageId: "migration-source", contentPackageVersion: "1.0.0", status: "paused" }],
    privateTutorContentMigrationPreviews: [],
    privateTutorContentMigrationApplications: [],
    privateTutorContentPackages: [
      { id: "migration-source", version: "1.0.0", name: "Source", subjectId: "general", domain: "test", sourceType: "textbook", status: "published", contentChecksum: "source-v1", knowledgeComponents: [knowledge("stable"), knowledge("changed", ["old"]), knowledge("removed")] },
      { id: "migration-target", version: "2.0.0", name: "Target", subjectId: "general", domain: "test", sourceType: "textbook", status: "published", contentChecksum: "target-v2", knowledgeComponents: [knowledge("stable"), knowledge("changed", ["new"]), knowledge("extra")] },
    ],
    privateTutorModules: [], privateTutorTopics: [], privateTutorKnowledgeComponents: [], privateTutorSubjectPlugins: [],
  };
}
