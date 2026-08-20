import { describe, expect, it } from "vitest";
import {
  assertLearnerBoundary,
  completeIndependentCheck,
  createInitialLearnerState,
  DEMO_LEARNERS,
} from "@/features/private-tutor/private-tutor-model";
import { learnerStorageKey } from "@/features/private-tutor/private-tutor-storage";

describe("private tutor learner boundary", () => {
  it("creates separate error books and persistence keys for every child", () => {
    const first = createInitialLearnerState(DEMO_LEARNERS[0]);
    const second = createInitialLearnerState(DEMO_LEARNERS[1]);

    expect(assertLearnerBoundary(first, DEMO_LEARNERS[0].id)).toBe(true);
    expect(assertLearnerBoundary(second, DEMO_LEARNERS[1].id)).toBe(true);
    expect(first.errors.map((item) => item.id)).not.toEqual(second.errors.map((item) => item.id));
    expect(learnerStorageKey(first.learner.id)).not.toBe(learnerStorageKey(second.learner.id));
  });

  it("records an independent answer without prematurely marking mastery", () => {
    const original = createInitialLearnerState(DEMO_LEARNERS[0]);
    const updated = completeIndependentCheck(original);
    const balance = updated.knowledge.find((item) => item.id === "balance");

    expect(updated.independentAnswers).toBe(original.independentAnswers + 1);
    expect(balance?.mastery).toBeGreaterThan(original.knowledge.find((item) => item.id === "balance")?.mastery ?? 0);
    expect(balance?.level).toBe("learning");
    expect(updated.errors.find((item) => item.knowledgeId === "balance")?.nextReview).toBe("明天");
  });
});
