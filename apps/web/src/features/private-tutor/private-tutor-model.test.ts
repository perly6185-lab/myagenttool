import { describe, expect, it } from "vitest";
import {
  assertLearnerBoundary,
  completeIndependentCheck,
  createInitialLearnerState,
  type LearnerProfile,
} from "@/features/private-tutor/private-tutor-model";
import { learnerStorageKey } from "@/features/private-tutor/private-tutor-storage";

const PERSONAL_PROFILE: LearnerProfile = { id: "lrn_personal", displayName: "我的学习", grade: "自主学习", curriculum: "演示课程 · 方程基础", avatar: "我" };

describe("private tutor personal learning boundary", () => {
  it("keeps every record and persistence key inside the current learning profile", () => {
    const state = createInitialLearnerState(PERSONAL_PROFILE);

    expect(assertLearnerBoundary(state, PERSONAL_PROFILE.id)).toBe(true);
    expect(assertLearnerBoundary(state, "another-account-profile")).toBe(false);
    expect(state.errors.every((item) => item.learnerId === state.learner.id)).toBe(true);
    expect(learnerStorageKey(state.learner.id)).toContain(state.learner.id);
    expect(learnerStorageKey(state.learner.id)).toContain("myagenttool.private-tutor.profile.v2");
  });

  it("records an independent answer without prematurely marking mastery", () => {
    const original = createInitialLearnerState(PERSONAL_PROFILE);
    const updated = completeIndependentCheck(original);
    const balance = updated.knowledge.find((item) => item.id === "balance");

    expect(updated.independentAnswers).toBe(original.independentAnswers + 1);
    expect(balance?.mastery).toBeGreaterThan(original.knowledge.find((item) => item.id === "balance")?.mastery ?? 0);
    expect(balance?.level).toBe("learning");
    expect(updated.errors.find((item) => item.knowledgeId === "balance")?.nextReview).toBe("明天");
  });
});
