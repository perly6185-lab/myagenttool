/*
 * Unit tests for the shared Project-field planner.
 *
 * The bug these pin down: `normalizeValue` is a COMPARISON key (so `in-progress`
 * matches the `in progress` option), and `sync-project-fields` was writing that
 * key back as the VALUE. Single-selects survived it — both sides normalize — but
 * text fields were silently mangled: `Source Doc: docs/engineering/ADR_0010_X.md`
 * landed in the Project as `docs/engineering/adr 0010 x.md`.
 *
 * `sync-project` did it correctly, `sync-project-fields` did not. They now share
 * one planner, and these tests hold both halves of the rule at once: match on the
 * key, write the raw string.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildProjectFieldMap,
  currentProjectFields,
  parseProjectFields,
  planProjectFieldOperations,
} from "../src/project-fields.mjs";

const fieldMap = buildProjectFieldMap([
  { name: "Status", type: "ProjectV2SingleSelectField", id: "f-status", options: [
    { name: "backlog", id: "o-backlog" },
    { name: "in progress", id: "o-in-progress" },
  ] },
  { name: "Area", type: "ProjectV2SingleSelectField", id: "f-area", options: [
    { name: "cross-cutting", id: "o-cross-cutting" },
    { name: "security", id: "o-security" },
  ] },
  { name: "Source Doc", type: "ProjectV2Field", id: "f-source-doc" },
]);

const body = [
  "## Project Fields",
  "Milestone: M2",
  "Status: in-progress",
  "Area: cross-cutting",
  "Source Doc: docs/engineering/ADR_0010_EXTERNAL_CREDENTIAL_READINESS.md",
].join("\n");

test("a text field is written verbatim, not as the comparison key", () => {
  const { operations } = planProjectFieldOperations({
    desired: parseProjectFields(body),
    current: {},
    fieldMap,
  });

  const sourceDoc = operations.find((operation) => operation.field === "sourceDoc");
  assert.equal(sourceDoc.type, "text");
  assert.equal(
    sourceDoc.to,
    "docs/engineering/ADR_0010_EXTERNAL_CREDENTIAL_READINESS.md",
    "underscores and case must survive: this is a repo path, not an option name",
  );
});

test("a single-select still matches its option through the comparison key", () => {
  const { operations } = planProjectFieldOperations({
    desired: parseProjectFields(body),
    current: {},
    fieldMap,
  });

  // "in-progress" in the body vs. "in progress" as the option name.
  assert.equal(operations.find((operation) => operation.field === "status").optionId, "o-in-progress");
  // "cross-cutting" keeps its hyphen in the option name; the key strips it.
  assert.equal(operations.find((operation) => operation.field === "area").optionId, "o-cross-cutting");
});

test("Milestone is never written as a Project field", () => {
  const { operations, warnings } = planProjectFieldOperations({
    desired: parseProjectFields(body),
    current: {},
    fieldMap,
  });

  assert.equal(operations.some((operation) => operation.field === "milestone"), false);
  assert.equal(warnings.some((warning) => warning.field === "milestone"), false, "it is a native issue field, not a missing one");
});

test("a value already correct on the item produces no operation", () => {
  const current = currentProjectFields({
    status: { name: "in progress" },
    area: { name: "cross-cutting" },
    "source Doc": "docs/engineering/ADR_0010_EXTERNAL_CREDENTIAL_READINESS.md",
  });

  const { operations } = planProjectFieldOperations({ desired: parseProjectFields(body), current, fieldMap });
  assert.deepEqual(operations, [], "a raw path already in place must not be rewritten on the next sync");
});

test("an item being added in the same run has nothing to compare against", () => {
  const { operations } = planProjectFieldOperations({
    desired: parseProjectFields(body),
    current: {},
    fieldMap,
    compareCurrent: false,
  });

  assert.equal(operations.length, 3, "status, area, and source doc are all writes");
});

test("an unknown field or option warns instead of writing", () => {
  const { operations, warnings } = planProjectFieldOperations({
    desired: parseProjectFields([
      "## Project Fields",
      "Status: nonexistent-option",
      "Cadence: weekly",
    ].join("\n")),
    current: {},
    fieldMap,
  });

  assert.deepEqual(operations, []);
  assert.deepEqual(
    warnings.map((warning) => [warning.field, warning.reason]).sort(),
    [["cadence", "field-not-found"], ["status", "option-not-found"]],
  );
});
