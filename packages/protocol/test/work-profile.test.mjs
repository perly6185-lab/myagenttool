import assert from "node:assert/strict";
import { test } from "node:test";

import {
  workProfileAuthorizationPermissions,
  workProfileConfidenceLevels,
  workProfileEvidenceSourceKinds,
  workProfileInferenceKinds,
} from "../src/index.mjs";

test("work profile covers every supported inference category", () => {
  assert.deepEqual(workProfileInferenceKinds, [
    "category",
    "recurring_activity",
    "document_pattern",
    "preferred_output",
  ]);
});

test("work profile confidence and evidence vocabularies are closed", () => {
  assert.deepEqual(workProfileConfidenceLevels, ["low", "medium", "high"]);
  assert.deepEqual(workProfileEvidenceSourceKinds, [
    "explicit_user_input",
    "invocation",
    "document",
    "project",
    "routine",
  ]);
});

test("work profile authorization separates reading, updating, and personalization", () => {
  assert.deepEqual(workProfileAuthorizationPermissions, [
    "read",
    "update",
    "use_for_personalization",
  ]);
});
