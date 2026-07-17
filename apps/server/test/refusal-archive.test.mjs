/*
 * Durable-state slice: over-cap refusals are ARCHIVED (durable, readable), not
 * silently dropped at the 200-row in-memory cap. Refusals are compliance/audit
 * evidence — they survive per-subject deletion (PII-scrubbed), so losing them to
 * the ring buffer was a real gap. Mirrors the round-telemetry / recovery-action
 * cap-with-archive pattern.
 */

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createRetentionArchive } from "../src/services/retention-archive.mjs";
import { createRefusalRuntime } from "../src/runtime/refusal-log.mjs";

test("over-cap refusals are archived (durable, readable), not silently dropped", () => {
  const dir = mkdtempSync(join(tmpdir(), "refusal-archive-"));
  let clock = 0;
  const archive = createRetentionArchive({
    stateStorePath: join(dir, "state.json"),
    now: () => `2026-07-17T00:00:${String(clock).padStart(2, "0")}.000Z`,
  });
  const state = { refusals: [] };
  let id = 0;
  const { refuse } = createRefusalRuntime({
    state,
    now: () => "2026-07-17T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_${(id += 1)}`,
    appendEvent: () => {},
    capWithArchive: archive.capWithArchive,
  });

  // Push 205 refusals; the cap is 200.
  for (let i = 0; i < 205; i += 1) {
    clock = i % 60;
    refuse({ category: "policy", code: "action_not_permitted", summary: `refusal ${i}` });
  }

  assert.equal(state.refusals.length, 200, "the in-memory ring stays bounded at the cap");
  const archived = archive.readArchive("refusals");
  assert.equal(archived.length, 5, "the 5 over-cap (oldest) refusals were archived, not dropped");
  assert.ok(archived.every((entry) => entry.row.category === "policy"), "archived rows are real refusals");
  assert.ok(archived.every((entry) => typeof entry.row.summary === "string"));
});

test("the default (no archive injected) still caps to newest — back-compat", () => {
  const state = { refusals: [] };
  let id = 0;
  const { refuse } = createRefusalRuntime({
    state,
    now: () => "2026-07-17T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_${(id += 1)}`,
    appendEvent: () => {},
    // no capWithArchive — falls back to the plain newest-keeps slice
  });
  for (let i = 0; i < 205; i += 1) refuse({ category: "policy", code: "action_not_permitted", summary: `r${i}` });
  assert.equal(state.refusals.length, 200);
});
