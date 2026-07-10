/*
 * Auto-run intent heuristic: classify an issue as a change, an investigation, or
 * an open question from its title (and optionally body).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyIntentFromText, isAutoRunIntent } from "../src/services/auto-run-intent.mjs";

test("change is the default for ordinary work titles", () => {
  assert.equal(classifyIntentFromText("Add a retry to the dispatch loop"), "change");
  assert.equal(classifyIntentFromText("Fix the null crash in economics view"), "change");
  assert.equal(classifyIntentFromText(""), "change");
});

test("investigation titles are detected", () => {
  assert.equal(classifyIntentFromText("Investigate why CI is flaky"), "investigation");
  assert.equal(classifyIntentFromText("Research options for the queue backend"), "investigation");
  assert.equal(classifyIntentFromText("Spike: worktree cleanup approaches"), "investigation");
  // Also from the body when the title is neutral.
  assert.equal(classifyIntentFromText("Queue backend", "We should explore a few options and compare."), "investigation");
});

test("question titles are detected", () => {
  assert.equal(classifyIntentFromText("Should we adopt Postgres?"), "question");
  assert.equal(classifyIntentFromText("Which queue backend fits best"), "question");
  assert.equal(classifyIntentFromText("Is it worth caching the ledger?"), "question");
});

test("a trailing question mark wins over change wording", () => {
  assert.equal(classifyIntentFromText("Add caching?"), "question");
});

test("design-artifact titles (mockup/wireframe) classify as investigation → design path", () => {
  // Found by a live run: "Design a … mockup" used to fall through to change→develop.
  assert.equal(classifyIntentFromText("Design a Contact page mockup for the demo app"), "investigation");
  assert.equal(classifyIntentFromText("Create wireframes for the settings screen"), "investigation");
  // bare "design" stays a change — too ambiguous with "implement the design".
  assert.equal(classifyIntentFromText("Redesign the login button styles"), "change");
});

test("isAutoRunIntent guards the injected-classifier contract", () => {
  assert.equal(isAutoRunIntent("investigation"), true);
  assert.equal(isAutoRunIntent("nonsense"), false);
});
