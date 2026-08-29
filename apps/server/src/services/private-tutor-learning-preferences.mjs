// Learning preferences: per-profile user-controlled settings that shape the
// tutoring experience (captions, motion, pacing, AI teacher style) WITHOUT
// affecting deterministic grading or mastery evidence. Persisted so settings
// survive across devices and sessions. See M4 (MY_PRIVATE_TUTOR_DEVELOPMENT_PLAN).

export const LEARNING_PREFERENCES_SCHEMA_VERSION = 1;

export const TEACHER_STYLES = ["heuristic_guidance", "direct_concept", "case_driven", "socratic_questioning"];
export const EXPLANATION_DEPTHS = ["concise_then_expand", "from_foundations", "key_difficulties_only", "professional_depth"];
export const FOLLOW_UP_STYLES = ["gentle_probe", "direct_check", "none"];
export const VOICE_PREFERENCES = ["push_to_talk", "hands_free", "text_only"];
export const PLAN_INTENSITIES = ["relaxed", "standard", "intensive"];

const DEFAULTS = Object.freeze({
  captions: true,
  reducedMotion: false,
  dailyMinutes: 20,
  planIntensity: "standard",
  teacherStyle: "heuristic_guidance",
  explanationDepth: "concise_then_expand",
  followUpStyle: "gentle_probe",
  voicePreference: "push_to_talk",
  deactivatedPackageIds: [],
  learningGoal: null,
});

const MAX_GOAL_TEXT_LENGTH = 200;

export function sanitizePrivateTutorLearningGoal(input) {
  if (input == null) return null;
  if (typeof input !== "object") return { __invalid: true };
  const targetTopicIds = Array.isArray(input.targetTopicIds)
    ? [...new Set(input.targetTopicIds.map((id) => String(id).trim()).filter(Boolean))]
    : [];
  const goal = {
    contentPackageId: typeof input.contentPackageId === "string" ? input.contentPackageId.trim().slice(0, 200) || null : null,
    targetTopicIds,
    weeklyMinutes: input.weeklyMinutes != null ? clampWeeklyMinutes(input.weeklyMinutes) : null,
    targetDate: validDateOnly(input.targetDate) ? input.targetDate : null,
    note: typeof input.note === "string" ? input.note.slice(0, MAX_GOAL_TEXT_LENGTH) : "",
  };
  if (input.weeklyMinutes != null && goal.weeklyMinutes === null) return { __invalid: true };
  if (input.targetDate != null && goal.targetDate === null) return { __invalid: true };
  return goal;
}

function clampDailyMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(180, Math.max(5, Math.round(n)));
}

function clampWeeklyMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(1_260, Math.max(5, Math.round(n)));
}

function validDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function defaultLearningPreferences() {
  return { ...DEFAULTS };
}

export function privateTutorLearningPreferences(state, learnerId) {
  const row = state.privateTutorLearningPreferences?.find((entry) => entry.learnerId === learnerId);
  if (!row) return { learnerId, ...DEFAULTS, revision: 0, schemaVersion: LEARNING_PREFERENCES_SCHEMA_VERSION, updatedAt: null };
  return { ...row };
}

// Applies a partial update; unknown keys are ignored, invalid enum/boolean
// values reject the whole update so a malformed client cannot silently persist
// a half-valid row. Returns { ok, preferences, error }.
export function updatePrivateTutorLearningPreferences(state, learnerId, patch, { now, nextId }) {
  state.privateTutorLearningPreferences ??= [];
  const current = state.privateTutorLearningPreferences.find((entry) => entry.learnerId === learnerId);
  const base = current ? { ...current } : {
    id: nextId("lpref"),
    learnerId,
    ...DEFAULTS,
    revision: 0,
    schemaVersion: LEARNING_PREFERENCES_SCHEMA_VERSION,
    createdAt: now(),
    updatedAt: null,
  };

  if (patch.captions !== undefined) {
    if (typeof patch.captions !== "boolean") return { ok: false, error: "invalid_captions" };
    base.captions = patch.captions;
  }
  if (patch.reducedMotion !== undefined) {
    if (typeof patch.reducedMotion !== "boolean") return { ok: false, error: "invalid_reduced_motion" };
    base.reducedMotion = patch.reducedMotion;
  }
  if (patch.dailyMinutes !== undefined) {
    const minutes = clampDailyMinutes(patch.dailyMinutes);
    if (minutes === null) return { ok: false, error: "invalid_daily_minutes" };
    base.dailyMinutes = minutes;
  }
  if (patch.planIntensity !== undefined) {
    if (!PLAN_INTENSITIES.includes(patch.planIntensity)) return { ok: false, error: "invalid_plan_intensity" };
    base.planIntensity = patch.planIntensity;
  }
  if (patch.teacherStyle !== undefined) {
    if (!TEACHER_STYLES.includes(patch.teacherStyle)) return { ok: false, error: "invalid_teacher_style" };
    base.teacherStyle = patch.teacherStyle;
  }
  if (patch.explanationDepth !== undefined) {
    if (!EXPLANATION_DEPTHS.includes(patch.explanationDepth)) return { ok: false, error: "invalid_explanation_depth" };
    base.explanationDepth = patch.explanationDepth;
  }
  if (patch.followUpStyle !== undefined) {
    if (!FOLLOW_UP_STYLES.includes(patch.followUpStyle)) return { ok: false, error: "invalid_follow_up_style" };
    base.followUpStyle = patch.followUpStyle;
  }
  if (patch.voicePreference !== undefined) {
    if (!VOICE_PREFERENCES.includes(patch.voicePreference)) return { ok: false, error: "invalid_voice_preference" };
    base.voicePreference = patch.voicePreference;
  }
  if (patch.learningGoal !== undefined) {
    const goal = sanitizePrivateTutorLearningGoal(patch.learningGoal);
    if (goal?.__invalid) return { ok: false, error: "invalid_learning_goal" };
    base.learningGoal = goal;
  }

  base.revision += 1;
  base.updatedAt = now();

  if (current) {
    const index = state.privateTutorLearningPreferences.findIndex((entry) => entry.learnerId === learnerId);
    state.privateTutorLearningPreferences[index] = base;
  } else {
    state.privateTutorLearningPreferences.unshift(base);
  }
  return { ok: true, preferences: { ...base } };
}

// Deactivation hides a package from the learner's picker but never deletes its
// package, snapshot, attempts, or review history — switching back restores the
// exact prior knowledge state (M4 isolation requirement).
export function setPrivateTutorPackageDeactivated(state, learnerId, packageId, deactivated, { now, nextId }) {
  const current = privateTutorLearningPreferences(state, learnerId);
  const next = new Set(current.deactivatedPackageIds);
  if (deactivated) next.add(packageId); else next.delete(packageId);
  const already = next.size === current.deactivatedPackageIds.length
    && current.deactivatedPackageIds.every((id) => next.has(id));
  if (already) return { ok: true, preferences: { ...current }, unchanged: true };
  // Reuse the update path so revision/audit semantics stay identical.
  const result = updatePrivateTutorLearningPreferences(state, learnerId, {}, { now, nextId });
  if (!result.ok) return result;
  const row = state.privateTutorLearningPreferences.find((entry) => entry.learnerId === learnerId);
  row.deactivatedPackageIds = [...next];
  result.preferences = { ...row };
  return result;
}
