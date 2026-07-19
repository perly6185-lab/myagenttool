import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { gitStatusMap } from "../src/services/projects.mjs";

test("gitStatusMap flags `unavailable` when git fails — not a silent clean tree (#905)", () => {
  const map = gitStatusMap("/definitely/not/a/git/repo/xyz", { fresh: true });
  assert.ok(map instanceof Map);
  assert.equal(map.unavailable, true, "a failed status is unavailable, not an empty (clean) map");
});

test("gitStatusMap reads a real repo without the unavailable flag", (t) => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-git-status-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });

  const map = gitStatusMap(root, { fresh: true });
  assert.ok(map instanceof Map);
  assert.ok(!map.unavailable, "a readable repo is not flagged unavailable");
});
