import assert from "node:assert/strict";
import { test } from "node:test";

import { mergeFileAccesses } from "../src/read-models/file-ledger.mjs";

test("mergeFileAccesses: classifies read vs write, dedupes, keeps first-seen order", () => {
  const l = mergeFileAccesses({ reads: [], writes: [] }, [
    { tool: "Read", path: "/wt/a.mjs", mode: "read" },
    { tool: "Read", path: "/wt/b.mjs", mode: "read" },
    { tool: "Read", path: "/wt/a.mjs", mode: "read" }, // dup read
    { tool: "Edit", path: "/wt/b.mjs", mode: "write" }, // b is read AND written
    { tool: "Write", path: "/wt/c.mjs", mode: "write" },
  ]);
  assert.deepEqual(l.reads, ["/wt/a.mjs", "/wt/b.mjs"], "reads deduped, ordered");
  assert.deepEqual(l.writes, ["/wt/b.mjs", "/wt/c.mjs"], "a read file can also be a write");
  assert.equal(l.truncated, false);
});

test("mergeFileAccesses: accumulates across calls without mutating the input ledger", () => {
  const first = mergeFileAccesses(undefined, [{ path: "/wt/a", mode: "read" }]);
  const second = mergeFileAccesses(first, [
    { path: "/wt/a", mode: "read" }, // still deduped against the prior call
    { path: "/wt/d", mode: "write" },
  ]);
  assert.deepEqual(first.reads, ["/wt/a"], "the earlier ledger is not mutated");
  assert.deepEqual(second.reads, ["/wt/a"]);
  assert.deepEqual(second.writes, ["/wt/d"]);
});

test("mergeFileAccesses: caps each side and marks truncated; ignores blank/missing paths", () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ path: `/wt/r${i}`, mode: "read" }));
  const l = mergeFileAccesses({ reads: [], writes: [] }, [...many, { path: "  ", mode: "read" }, { mode: "read" }], { cap: 3 });
  assert.equal(l.reads.length, 3, "capped at 3");
  assert.equal(l.truncated, true, "overflow flagged");
  assert.deepEqual(l.reads, ["/wt/r0", "/wt/r1", "/wt/r2"], "keeps the first-seen within the cap");
});
