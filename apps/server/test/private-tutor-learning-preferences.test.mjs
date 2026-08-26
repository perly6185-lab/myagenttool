import assert from "node:assert/strict";
import { test } from "node:test";

import {
  defaultLearningPreferences,
  privateTutorLearningPreferences,
  setPrivateTutorPackageDeactivated,
  updatePrivateTutorLearningPreferences,
  LEARNING_PREFERENCES_SCHEMA_VERSION,
} from "../src/services/private-tutor-learning-preferences.mjs";

function makeState() {
  return { privateTutorLearningPreferences: [] };
}

const now = () => "2026-08-25T00:00:00.000Z";
let idCounter = 0;
const nextId = (prefix) => `${prefix}_${++idCounter}`;

test("default preferences are returned when no row exists", () => {
  const state = makeState();
  const prefs = privateTutorLearningPreferences(state, "lrn_1");
  assert.equal(prefs.captions, true);
  assert.equal(prefs.reducedMotion, false);
  assert.equal(prefs.dailyMinutes, 20);
  assert.equal(prefs.planIntensity, "standard");
  assert.equal(prefs.teacherStyle, "heuristic_guidance");
  assert.equal(prefs.explanationDepth, "concise_then_expand");
  assert.equal(prefs.followUpStyle, "gentle_probe");
  assert.equal(prefs.voicePreference, "push_to_talk");
  assert.equal(prefs.revision, 0);
  assert.equal(prefs.schemaVersion, LEARNING_PREFERENCES_SCHEMA_VERSION);
  // Reading defaults must not persist anything
  assert.equal(state.privateTutorLearningPreferences.length, 0);
});

test("update persists a new row and bumps revision", () => {
  const state = makeState();
  const result = updatePrivateTutorLearningPreferences(state, "lrn_1", { captions: false, dailyMinutes: 45 }, { now, nextId });
  assert.equal(result.ok, true);
  assert.equal(result.preferences.captions, false);
  assert.equal(result.preferences.dailyMinutes, 45);
  assert.equal(result.preferences.revision, 1);
  assert.equal(result.preferences.teacherStyle, "heuristic_guidance"); // untouched default
  assert.equal(state.privateTutorLearningPreferences.length, 1);
});

test("second update mutates in place and increments revision", () => {
  const state = makeState();
  updatePrivateTutorLearningPreferences(state, "lrn_1", { captions: false }, { now, nextId });
  const result = updatePrivateTutorLearningPreferences(state, "lrn_1", { teacherStyle: "socratic_questioning" }, { now, nextId });
  assert.equal(result.ok, true);
  assert.equal(result.preferences.captions, false); // preserved
  assert.equal(result.preferences.teacherStyle, "socratic_questioning");
  assert.equal(result.preferences.revision, 2);
  assert.equal(state.privateTutorLearningPreferences.length, 1); // still one row
});

test("invalid enum values reject the whole update", () => {
  const state = makeState();
  const result = updatePrivateTutorLearningPreferences(state, "lrn_1", { teacherStyle: "drill_sergeant" }, { now, nextId });
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid_teacher_style");
  assert.equal(state.privateTutorLearningPreferences.length, 0);
});

test("invalid boolean rejects", () => {
  const state = makeState();
  const result = updatePrivateTutorLearningPreferences(state, "lrn_1", { captions: "yes" }, { now, nextId });
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid_captions");
});

test("dailyMinutes is clamped to [5, 180] and rounded", () => {
  const state = makeState();
  const low = updatePrivateTutorLearningPreferences(state, "lrn_1", { dailyMinutes: 1 }, { now, nextId });
  assert.equal(low.preferences.dailyMinutes, 5);
  const high = updatePrivateTutorLearningPreferences(state, "lrn_1", { dailyMinutes: 999 }, { now, nextId });
  assert.equal(high.preferences.dailyMinutes, 180);
  const frac = updatePrivateTutorLearningPreferences(state, "lrn_1", { dailyMinutes: 30.7 }, { now, nextId });
  assert.equal(frac.preferences.dailyMinutes, 31);
  const bad = updatePrivateTutorLearningPreferences(state, "lrn_1", { dailyMinutes: "abc" }, { now, nextId });
  assert.equal(bad.ok, false);
});

test("unknown keys are ignored", () => {
  const state = makeState();
  const result = updatePrivateTutorLearningPreferences(state, "lrn_1", { unknownField: "x", captions: false }, { now, nextId });
  assert.equal(result.ok, true);
  assert.equal(result.preferences.captions, false);
  assert.equal("unknownField" in result.preferences, false);
});

test("all enum fields validate against their allowed sets", () => {
  const state = makeState();
  assert.equal(updatePrivateTutorLearningPreferences(state, "lrn_1", { planIntensity: "intensive" }, { now, nextId }).ok, true);
  assert.equal(updatePrivateTutorLearningPreferences(state, "lrn_1", { planIntensity: "extreme" }, { now, nextId }).ok, false);
  assert.equal(updatePrivateTutorLearningPreferences(state, "lrn_1", { explanationDepth: "professional_depth" }, { now, nextId }).ok, true);
  assert.equal(updatePrivateTutorLearningPreferences(state, "lrn_1", { followUpStyle: "none" }, { now, nextId }).ok, true);
  assert.equal(updatePrivateTutorLearningPreferences(state, "lrn_1", { voicePreference: "text_only" }, { now, nextId }).ok, true);
  assert.equal(updatePrivateTutorLearningPreferences(state, "lrn_1", { voicePreference: "telepathy" }, { now, nextId }).ok, false);
});

test("per-learner isolation", () => {
  const state = makeState();
  updatePrivateTutorLearningPreferences(state, "lrn_1", { captions: false }, { now, nextId });
  const other = privateTutorLearningPreferences(state, "lrn_2");
  assert.equal(other.captions, true); // unaffected default
  assert.equal(privateTutorLearningPreferences(state, "lrn_1").captions, false);
});

test("defaultLearningPreferences returns a fresh copy", () => {
  const a = defaultLearningPreferences();
  a.captions = false;
  assert.equal(defaultLearningPreferences().captions, true);
});

test("learning goal accepts a well-formed object and rejects malformed ones", () => {
  const state = makeState();
  const set = updatePrivateTutorLearningPreferences(state, "lrn_1", {
    learningGoal: { targetTopicIds: ["topic-a", "topic-a", " topic-b "], weeklyMinutes: 120, targetDate: "2026-12-31", note: "期末前学完" },
  }, { now, nextId });
  assert.equal(set.ok, true);
  assert.deepEqual(set.preferences.learningGoal.targetTopicIds, ["topic-a", "topic-b"]); // deduped + trimmed
  assert.equal(set.preferences.learningGoal.weeklyMinutes, 120);
  assert.equal(set.preferences.learningGoal.targetDate, "2026-12-31");

  const cleared = updatePrivateTutorLearningPreferences(state, "lrn_1", { learningGoal: null }, { now, nextId });
  assert.equal(cleared.preferences.learningGoal, null);

  assert.equal(updatePrivateTutorLearningPreferences(state, "lrn_1", { learningGoal: "下周" }, { now, nextId }).ok, false);
  assert.equal(updatePrivateTutorLearningPreferences(state, "lrn_1", { learningGoal: { weeklyMinutes: "很多" } }, { now, nextId }).ok, false);
  assert.equal(updatePrivateTutorLearningPreferences(state, "lrn_1", { learningGoal: { targetDate: "31/12/2026" } }, { now, nextId }).ok, false);
});

test("package deactivation toggles ids without touching other preferences", () => {
  const state = makeState();
  const off = setPrivateTutorPackageDeactivated(state, "lrn_1", "pkg-a", true, { now, nextId });
  assert.equal(off.ok, true);
  assert.deepEqual(off.preferences.deactivatedPackageIds, ["pkg-a"]);
  assert.equal(off.preferences.captions, true); // default untouched

  const second = setPrivateTutorPackageDeactivated(state, "lrn_1", "pkg-b", true, { now, nextId });
  assert.deepEqual(second.preferences.deactivatedPackageIds.sort(), ["pkg-a", "pkg-b"]);

  const again = setPrivateTutorPackageDeactivated(state, "lrn_1", "pkg-a", true, { now, nextId });
  assert.equal(again.unchanged, true); // idempotent
  assert.equal(again.preferences.revision, second.preferences.revision); // no spurious revision bump

  const backOn = setPrivateTutorPackageDeactivated(state, "lrn_1", "pkg-a", false, { now, nextId });
  assert.deepEqual(backOn.preferences.deactivatedPackageIds, ["pkg-b"]);

  const other = privateTutorLearningPreferences(state, "lrn_2");
  assert.deepEqual(other.deactivatedPackageIds, []); // isolation
});
