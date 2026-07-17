/*
 * M3 residual closed: the audit-export manifest checksum is a REAL sha256 content
 * digest of what it attests to. Each record ref carries a `contentHash` (a sha256
 * of the record's canonical content), so the checksum is content-tamper-evident:
 * altering a record's fields — not only adding/removing a record — changes it.
 * Subjects are canonicalized (deduped + sorted) so the digest is invariant to the
 * request's subject order. A verifier recomputes it from the manifest's own fields.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { computeAuditExportChecksum } from "../src/services/m3.mjs";

const refs = [
  { subject: "invocation", id: "inv_1", contentHash: "a".repeat(64) },
  { subject: "ledger", id: "led_1", contentHash: "b".repeat(64) },
];

test("is a real 64-hex sha256 digest, not a synthetic count:subjects token", () => {
  const checksum = computeAuditExportChecksum(["invocation", "ledger"], refs);
  assert.match(checksum, /^sha256:[0-9a-f]{64}$/, "real sha256 hex digest");
  assert.ok(!/^sha256:\d+:/.test(checksum), "not the old `sha256:<count>:<subjects>` form");
});

test("a verifier can recompute it from the manifest's own subjects + recordRefs", () => {
  const subjects = ["invocation", "ledger"];
  const canonicalSubjects = [...new Set(subjects.map(String))].sort();
  const expected = `sha256:${createHash("sha256").update(JSON.stringify({ subjects: canonicalSubjects, recordRefs: refs })).digest("hex")}`;
  assert.equal(computeAuditExportChecksum(subjects, refs), expected);
});

test("deterministic for the same content, and changes when the attested set changes", () => {
  const a = computeAuditExportChecksum(["invocation"], refs);
  const again = computeAuditExportChecksum(["invocation"], refs);
  assert.equal(a, again, "same content → same digest");

  assert.notEqual(a, computeAuditExportChecksum(["ledger"], refs), "different subjects → different digest");
  assert.notEqual(
    a,
    computeAuditExportChecksum(["invocation"], [...refs, { subject: "invocation", id: "inv_2", contentHash: "c".repeat(64) }]),
    "an added record ref → different digest (set-tamper-evident)",
  );
});

test("is content-tamper-evident: altering a ref's contentHash changes the digest", () => {
  const before = computeAuditExportChecksum(["invocation", "ledger"], refs);
  const tampered = [refs[0], { ...refs[1], contentHash: "f".repeat(64) }];
  assert.notEqual(before, computeAuditExportChecksum(["invocation", "ledger"], tampered), "a mutated record's content changes its leaf → changes the checksum");
});

test("subject order and duplicates do not change the digest (canonicalized)", () => {
  const ordered = computeAuditExportChecksum(["invocation", "ledger"], refs);
  assert.equal(computeAuditExportChecksum(["ledger", "invocation"], refs), ordered, "subject order is canonicalized away");
  assert.equal(computeAuditExportChecksum(["invocation", "ledger", "invocation"], refs), ordered, "duplicate subjects are deduped");
});

test("tolerates missing/non-array inputs without throwing", () => {
  assert.match(computeAuditExportChecksum(undefined, undefined), /^sha256:[0-9a-f]{64}$/);
});
