import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  applyCodexWorktreeContract,
  linkedWorktreeGitAdminDir,
} from "../src/codex-worktree-contract.mjs";

const root = mkdtempSync(join(tmpdir(), "myagenttool-codex-contract-"));
after(() => rmSync(root, { recursive: true, force: true }));

test("fresh exec gets workspace-write, explicit cwd, and only the linked-worktree git admin dir", () => {
  const worktree = join(root, "task-worktree");
  const gitAdmin = join(root, "source", ".git", "worktrees", "task-worktree");
  mkdirSync(worktree, { recursive: true });
  mkdirSync(gitAdmin, { recursive: true });
  writeFileSync(join(worktree, ".git"), `gitdir: ${gitAdmin}\n`);

  assert.equal(linkedWorktreeGitAdminDir(worktree), gitAdmin);
  const contract = applyCodexWorktreeContract(
    ["exec", "--skip-git-repo-check", "--json", "task"],
    { cwd: worktree },
  );
  assert.deepEqual(contract.additionalWritableRoots, [gitAdmin]);
  assert.deepEqual(contract.args.slice(0, 7), [
    "exec", "--sandbox", "workspace-write", "--cd", worktree, "--add-dir", gitAdmin,
  ]);
  assert.equal(contract.args.at(-1), "task");
});

test("normal repositories need no additional writable git root", () => {
  const repo = join(root, "normal-repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  const contract = applyCodexWorktreeContract(["exec", "--json", "task"], { cwd: repo });
  assert.deepEqual(contract.additionalWritableRoots, []);
  assert.equal(contract.args.includes("--add-dir"), false);
  assert.equal(contract.args.includes("workspace-write"), true);
});

test("explicit sandbox/cwd are preserved and resume receives no unsupported options", () => {
  const repo = join(root, "explicit-repo");
  mkdirSync(repo, { recursive: true });
  const explicit = applyCodexWorktreeContract(
    ["exec", "--sandbox", "read-only", "--cd", repo, "--json", "task"],
    { cwd: repo },
  );
  assert.equal(explicit.args.filter((arg) => arg === "--sandbox").length, 1);
  assert.equal(explicit.args.filter((arg) => arg === "--cd").length, 1);

  const resumed = applyCodexWorktreeContract(
    ["exec", "resume", "session-1", "--json", "task"],
    { cwd: repo },
  );
  assert.deepEqual(resumed.args, ["exec", "resume", "session-1", "--json", "task"]);

  const fullAccess = applyCodexWorktreeContract(
    ["exec", "--dangerously-bypass-approvals-and-sandbox", "--json", "task"],
    { cwd: repo },
  );
  assert.deepEqual(fullAccess.args, ["exec", "--dangerously-bypass-approvals-and-sandbox", "--json", "task"]);
  assert.deepEqual(fullAccess.additionalWritableRoots, []);
});
