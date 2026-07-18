/*
 * Device-seam ratchet.
 *
 * `state.device` is a MIGRATION SEAM, not the routing model: it is a live alias
 * for the primary device (`state.devices[0]`, see `runtime/device.mjs`). It
 * survives so the ~110 singleton reads written before the fleet existed keep
 * working. But the seam must SHRINK, never grow — anything answering "which
 * machine is this?" must resolve the caller from its authenticated bridge
 * credential via `deviceForToken`, and anything addressing the fleet must use
 * `listDevices` / `findDevice`. An ownership gate that compares against the
 * primary alias is comparing a device to itself, which is exactly how such gates
 * stayed vacuously true while only one device existed.
 *
 * This test freezes the seam at its current size. New `state.device` reads fail
 * here, pushing new code onto the sanctioned accessors. When the count drops,
 * lower BUDGET to lock the win in — a ratchet only tightens.
 *
 * See docs/engineering/ADR_0020 (governed-run planes) and
 * docs/ARCHITECTURE_OVERVIEW.md §1 for the seam's place in the architecture.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";

// The frozen size of the single-device seam: CONSUMER reads of the alias
// `state.device` (the fleet array `state.devices` does not match) across
// apps/server/src. `runtime/device.mjs` is excluded — it defines the alias, so
// its own occurrences are the seam's machinery, not call sites. Measured
// 2026-07-18. Only ever lower this number.
const BUDGET = 102;

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const ALIAS_READ = /state\.device\b/g;
// The seam's own definition — not a consumer of it.
const SEAM_DEF = join(SRC_DIR, "runtime", "device.mjs");

function mjsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...mjsFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".mjs") && full !== SEAM_DEF) out.push(full);
  }
  return out;
}

function countAliasReads() {
  const perFile = [];
  let total = 0;
  for (const file of mjsFiles(SRC_DIR)) {
    const matches = readFileSync(file, "utf8").match(ALIAS_READ);
    const n = matches ? matches.length : 0;
    if (n > 0) {
      perFile.push([relative(SRC_DIR, file), n]);
      total += n;
    }
  }
  perFile.sort((a, b) => b[1] - a[1]);
  return { total, perFile };
}

test("state.device alias reads do not grow beyond the frozen budget", () => {
  const { total, perFile } = countAliasReads();
  const breakdown = perFile.map(([f, n]) => `  ${String(n).padStart(3)}  ${f}`).join("\n");
  assert.ok(
    total <= BUDGET,
    `state.device alias reads grew to ${total} (budget ${BUDGET}). New code must ` +
      `resolve the caller's device via deviceForToken, or the fleet via ` +
      `listDevices/findDevice — not the primary alias. Current distribution:\n${breakdown}`,
  );
});

test("budget stays tight — lower BUDGET when the seam shrinks", () => {
  const { total } = countAliasReads();
  // If this fails, the seam shrank (good): set BUDGET to the new total so the
  // ratchet keeps the reduction from silently reverting.
  assert.ok(
    total >= BUDGET - 5,
    `state.device alias reads dropped to ${total}; lower BUDGET (was ${BUDGET}) to lock it in.`,
  );
});
