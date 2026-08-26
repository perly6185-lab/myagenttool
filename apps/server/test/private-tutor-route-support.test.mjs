import assert from "node:assert/strict";
import test from "node:test";
import {
  ensurePrivateTutorCollections,
  findAuthorizedPrivateTutorLearner,
  listAuthorizedPrivateTutorLearners,
  privateTutorLearnerNotFound,
  stablePrivateTutorHash,
} from "../src/routes/private-tutor-support.mjs";

test("private tutor route support initializes every collection and deterministic seed content", () => {
  const first = {};
  const second = {};

  ensurePrivateTutorCollections(first);
  ensurePrivateTutorCollections(second);

  assert.ok(Array.isArray(first.privateTutorLearners));
  assert.ok(first.privateTutorQuestionRevisions.length > 0);
  assert.ok(first.privateTutorContentEvents.length > 0);
  assert.deepEqual(first.privateTutorQuestionRevisions, second.privateTutorQuestionRevisions);
  assert.deepEqual(first.privateTutorContentEvents, second.privateTutorContentEvents);
});

test("private tutor route support applies guardian permission hierarchy without widening learner scope", () => {
  const state = {
    privateTutorLearners: [
      { id: "learner_a", ownerTeamId: "team_a", displayName: "小星", grade: "七年级", curriculumEditionId: null, status: "active", createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z" },
      { id: "learner_b", ownerTeamId: "team_a", displayName: "小月", grade: "七年级", curriculumEditionId: null, status: "active", createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z" },
    ],
    privateTutorGuardianLinks: [
      { learnerId: "learner_a", ownerTeamId: "team_a", guardianUserId: "guardian_read", permissions: ["read"], verifiedAt: "2026-08-23T00:00:00.000Z" },
      { learnerId: "learner_a", ownerTeamId: "team_a", guardianUserId: "guardian_write", permissions: ["write"], verifiedAt: "2026-08-23T00:00:00.000Z" },
      { learnerId: "learner_b", ownerTeamId: "team_a", guardianUserId: "guardian_manage", permissions: ["manage"], verifiedAt: "2026-08-23T00:00:00.000Z" },
    ],
  };

  assert.equal(findAuthorizedPrivateTutorLearner(state, { userId: "guardian_read" }, "learner_a", "read")?.id, "learner_a");
  assert.equal(findAuthorizedPrivateTutorLearner(state, { userId: "guardian_read" }, "learner_a", "write"), null);
  assert.equal(findAuthorizedPrivateTutorLearner(state, { userId: "guardian_write" }, "learner_a", "read")?.id, "learner_a");
  assert.equal(findAuthorizedPrivateTutorLearner(state, { userId: "guardian_manage" }, "learner_b", "manage")?.id, "learner_b");
  assert.equal(findAuthorizedPrivateTutorLearner(state, { userId: "guardian_manage", privateTutorLearnerId: "learner_b" }, "learner_a"), null);
  assert.deepEqual(listAuthorizedPrivateTutorLearners(state, { userId: "guardian_manage" }).map((learner) => learner.id), ["learner_b"]);
});

test("private tutor route support keeps hashes stable and not-found responses opaque", () => {
  assert.equal(stablePrivateTutorHash({ b: 2, a: 1 }), stablePrivateTutorHash({ b: 2, a: 1 }));
  assert.notEqual(stablePrivateTutorHash({ b: 2, a: 1 }), stablePrivateTutorHash({ a: 1, b: 2 }));
  assert.deepEqual(privateTutorLearnerNotFound(), { error: "private_tutor_learner_not_found" });
});
