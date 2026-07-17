/*
 * M3 residual closed: the audit-export manifest checksum is a REAL sha256 content
 * digest of what it attests to (subjects + record refs), not the old synthetic
 * `count:subjects` token. A verifier can recompute it from the manifest and any
 * tamper of the attested set changes it.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { computeAuditExportChecksum } from "../src/services/m3.mjs";

const refs = [
  { subject: "invocation", id: "inv_1" },
  { subject: "ledger", id: "led_1" },
];

test("is a real 64-hex sha256 digest, not a synthetic count:subjects token", () => {
  const checksum = computeAuditExportChecksum(["invocation", "ledger"], refs);
  assert.match(checksum, /^sha256:[0-9a-f]{64}$/, "real sha256 hex digest");
  assert.ok(!/^sha256:\d+:/.test(checksum), "not the old `sha256:<count>:<subjects>` form");
});

test("a verifier can recompute it from the manifest's own subjects + recordRefs", () => {
  const subjects = ["invocation", "ledger"];
  const expected = `sha256:${createHash("sha256").update(JSON.stringify({ subjects, recordRefs: refs })).digest("hex")}`;
  assert.equal(computeAuditExportChecksum(subjects, refs), expected);
});

test("deterministic for the same content, and changes when the attested set changes", () => {
  const a = computeAuditExportChecksum(["invocation"], refs);
  const again = computeAuditExportChecksum(["invocation"], refs);
  assert.equal(a, again, "same content → same digest");

  assert.notEqual(a, computeAuditExportChecksum(["ledger"], refs), "different subjects → different digest");
  assert.notEqual(
    a,
    computeAuditExportChecksum(["invocation"], [...refs, { subject: "invocation", id: "inv_2" }]),
    "an added record ref → different digest (tamper-evident)",
  );
});

test("tolerates missing/non-array inputs without throwing", () => {
  assert.match(computeAuditExportChecksum(undefined, undefined), /^sha256:[0-9a-f]{64}$/);
});
