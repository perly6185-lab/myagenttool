import assert from "node:assert/strict";
import { test } from "node:test";

import { gitStatusMap } from "../src/services/projects.mjs";

test("gitStatusMap flags `unavailable` when git fails — not a silent clean tree (#905)", () => {
  const map = gitStatusMap("/definitely/not/a/git/repo/xyz", { fresh: true });
  assert.ok(map instanceof Map);
  assert.equal(map.unavailable, true, "a failed status is unavailable, not an empty (clean) map");
});

test("gitStatusMap reads a real repo without the unavailable flag", () => {
  const map = gitStatusMap(process.cwd(), { fresh: true });
  assert.ok(map instanceof Map);
  assert.ok(!map.unavailable, "a readable repo is not flagged unavailable");
});
