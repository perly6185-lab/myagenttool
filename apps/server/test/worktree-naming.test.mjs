/*
 * Unit tests for worktree naming/normalization. These validate untrusted input
 * that becomes a git branch, a worktree directory name, and a PR/issue link, so
 * their guards (path traversal, absolute paths, bad characters, length) are
 * security-relevant — a regression could let a crafted branch escape the tree.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normalizeWorktreeBase,
  normalizeWorktreeBranch,
  normalizeWorktreeLink,
  repoNameFromGitUrl,
  slugify,
} from "../src/services/projects.mjs";

test("repoNameFromGitUrl: extracts the repo name and strips .git", () => {
  assert.equal(repoNameFromGitUrl("git@github.com:acme/myrepo.git"), "myrepo");
  assert.equal(repoNameFromGitUrl("https://github.com/acme/my-repo"), "my-repo");
  assert.equal(repoNameFromGitUrl("https://x/a/b/c.git/"), "c");
  assert.equal(repoNameFromGitUrl(""), "");
});

test("normalizeWorktreeBranch: accepts safe names, rejects traversal/absolute/bad chars", () => {
  assert.equal(normalizeWorktreeBranch("feature/x-1"), "feature/x-1");
  assert.equal(normalizeWorktreeBranch("a\\b"), "a/b", "backslashes become slashes");
  for (const bad of ["", "../evil", "a..b", "/abs", "trailing/", "has space", "semi;colon", "x".repeat(97)]) {
    assert.throws(() => normalizeWorktreeBranch(bad), /invalid|letters, numbers/i, `should reject: ${JSON.stringify(bad)}`);
  }
});

test("normalizeWorktreeBase: empty → null, else validated like a ref", () => {
  assert.equal(normalizeWorktreeBase(""), null);
  assert.equal(normalizeWorktreeBase("origin/main"), "origin/main");
  assert.throws(() => normalizeWorktreeBase("../x"), /invalid/i);
  assert.throws(() => normalizeWorktreeBase("a b"), /invalid/i);
});

test("normalizeWorktreeLink: keeps well-formed pr/issue links, drops junk", () => {
  assert.deepEqual(
    normalizeWorktreeLink({ type: "pr", number: "42", title: "T", url: "u", state: "open" }),
    { type: "pr", number: 42, title: "T", url: "u", state: "open" },
  );
  const issue = normalizeWorktreeLink({ type: "issue", number: 7 });
  assert.equal(issue.type, "issue");
  assert.equal(issue.title, "ISSUE #7", "defaults a title");
  assert.equal(normalizeWorktreeLink(null), null);
  assert.equal(normalizeWorktreeLink({ type: "pr", number: 0 }), null, "number must be positive");
  assert.equal(normalizeWorktreeLink({ type: "nope", number: 1 }), null, "unknown type dropped");
});

test("slugify: lowercases, dashes unsafe runs, caps length, never empty", () => {
  assert.equal(slugify("My Feature!! #2"), "my-feature-2");
  assert.equal(slugify("  ---  "), "worktree", "all-unsafe falls back");
  assert.equal(slugify(undefined), "worktree");
  assert.ok(slugify("x".repeat(100)).length <= 48);
});
