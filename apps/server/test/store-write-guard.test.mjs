/*
 * #1001 (Phase A #6) — anti-regression guard for the read-through-store cutover.
 *
 * The Phase A sweep routed every durable `state.<collection>` write across the
 * services through the Store's unit-of-work (`runTx` from makeRunTx), so a crash
 * between the persistStateSoon debounce and its flush no longer loses the write.
 * This test freezes that property so a future PR cannot silently reintroduce a
 * bare, non-transactional durable write.
 *
 * Two checks:
 *  (A) INVARIANT — any service file that imports `makeRunTx` must contain ZERO
 *      bare `persistStateSoon()` calls. Every durable write in a migrated service
 *      goes through runTx; a bare persist is the exact regression we're guarding.
 *      This is dynamic: it covers every migrated service today and any added later.
 *  (B) WHITELIST — the only bare `persistStateSoon()` calls left live in services
 *      that use a DIFFERENT (also store-backed) transaction wrapper, not makeRunTx.
 *      Each is enumerated with its reason; a new bare persist in one of these files
 *      (or a brand-new un-migrated service) breaks the frozen count.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SERVICES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "services");

// Bare persists that are exempt because their file uses a store-backed transaction
// wrapper OTHER than makeRunTx (so the invariant in check A does not apply). Keyed
// by path relative to src/services → expected count. Adding a row is a conscious
// decision that must come with a reason.
const WHITELIST = {
  // m3 defines its own inline runTx fallback (line ~52) and persists the `blocked`
  // state on the queueLifecycleAction guard-throw path (outside any transaction by
  // design — it throws immediately after).
  "m3.mjs": 2,
  // updateCompareRun + recordAgentUsage are helpers called from within
  // completeInvocation's runStateTransaction (the enclosing tx commits on exit);
  // their persistStateSoon is a redundant fallback for the no-store path.
  "invocations/completion.mjs": 2,
  // state.invocations.unshift inside createInvocation's runStateTransaction.
  "invocations/creation.mjs": 1,
  // recordProbe/recordReauth update one observational state.sessions row each
  // (probe verdicts + timestamps — no cross-record invariants to keep atomic).
  // Single writer per site by the withSiteLock mutex, so there is no concurrent
  // read-modify-write to protect; the debounce persist is the durability path on
  // both backings (JSON snapshot + the SQLite mirror's afterFlush hook).
  "session-manager.mjs": 2,
};

function listMjs(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMjs(full));
    else if (entry.name.endsWith(".mjs") && !entry.name.endsWith(".test.mjs")) out.push(full);
  }
  return out;
}

const barePersistCount = (src) => (src.match(/persistStateSoon\(\)/g) ?? []).length;

test("#1001 (A) no makeRunTx-backed service has a bare persistStateSoon()", () => {
  const violations = [];
  for (const file of listMjs(SERVICES_DIR)) {
    const src = readFileSync(file, "utf8");
    if (!src.includes("makeRunTx")) continue;
    const count = barePersistCount(src);
    if (count > 0) violations.push(`${relative(SERVICES_DIR, file)} — ${count} bare persistStateSoon()`);
  }
  assert.deepEqual(
    violations,
    [],
    `A service that routes writes through runTx must not also persist bare. Wrap the write in runTx():\n${violations.join("\n")}`,
  );
});

test("#1001 (B) the only bare persistStateSoon() calls are the whitelisted ones", () => {
  const actual = {};
  for (const file of listMjs(SERVICES_DIR)) {
    const src = readFileSync(file, "utf8");
    if (src.includes("makeRunTx")) continue; // covered by check A
    const count = barePersistCount(src);
    if (count > 0) actual[relative(SERVICES_DIR, file).split("\\").join("/")] = count;
  }
  assert.deepEqual(
    actual,
    WHITELIST,
    "A new bare persistStateSoon() appeared in a non-makeRunTx service (or a whitelisted count changed). " +
      "Route the durable write through a transaction, or update WHITELIST with the reason.",
  );
});
