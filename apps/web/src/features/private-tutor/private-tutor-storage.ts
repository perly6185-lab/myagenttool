import {
  createInitialLearnerState,
  type LearnerProfile,
  type LearnerTutorState,
} from "@/features/private-tutor/private-tutor-model";

const STORAGE_PREFIX = "myagenttool.private-tutor.profile.v2";
const LEGACY_STORAGE_PREFIX = "myagenttool.private-tutor.learner.v1";

export function learnerStorageKey(learnerId: string) {
  return `${STORAGE_PREFIX}.${learnerId}`;
}

function legacyLearnerStorageKey(learnerId: string) {
  return `${LEGACY_STORAGE_PREFIX}.${learnerId}`;
}

export function loadLearnerState(learner: LearnerProfile): LearnerTutorState {
  if (typeof window === "undefined") return createInitialLearnerState(learner);
  const saved = window.localStorage.getItem(learnerStorageKey(learner.id));
  if (!saved) return createInitialLearnerState(learner);
  try {
    const parsed = JSON.parse(saved) as LearnerTutorState;
    if (parsed.learner?.id !== learner.id || parsed.errors?.some((item) => item.learnerId !== learner.id)) {
      return createInitialLearnerState(learner);
    }
    return parsed;
  } catch {
    return createInitialLearnerState(learner);
  }
}

export function saveLearnerState(state: LearnerTutorState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(learnerStorageKey(state.learner.id), JSON.stringify(state));
  // M1 单档案迁移：写入 v2 缓存时顺手淘汰 v1 旧键。
  window.localStorage.removeItem(legacyLearnerStorageKey(state.learner.id));
}
