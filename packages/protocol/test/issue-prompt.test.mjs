import assert from "node:assert/strict";
import { test } from "node:test";

import { branchFromIssue, githubItemKindLabel, slugifyIssueTitle, worktreeAutoRunPrompt } from "../src/issue-prompt.mjs";

test("githubItemKindLabel labels PRs and issues", () => {
  assert.equal(githubItemKindLabel("pr"), "PR");
  assert.equal(githubItemKindLabel("issue"), "Issue");
  assert.equal(githubItemKindLabel(undefined), "Issue", "defaults to Issue");
});

test("worktreeAutoRunPrompt builds the issue task prompt with the url line", () => {
  const prompt = worktreeAutoRunPrompt({
    type: "issue",
    number: 42,
    title: "Add the thing",
    url: "https://github.com/o/r/issues/42",
  });
  assert.match(prompt, /^Make progress on GitHub Issue #42: Add the thing\./);
  assert.match(prompt, /https:\/\/github\.com\/o\/r\/issues\/42/);
  assert.match(prompt, /do the next useful step/);
});

test("worktreeAutoRunPrompt handles PRs and omits the url line when absent", () => {
  const prompt = worktreeAutoRunPrompt({ type: "pr", number: 7, title: "Fix bug", url: null });
  assert.match(prompt, /^Make progress on GitHub PR #7: Fix bug\./);
  // No url → the title line is directly followed by the instruction line.
  assert.ok(!prompt.includes("null"), "a null url is never rendered");
  assert.equal(prompt.split("\n").length, 2, "exactly title line + instruction line");
});

test("slugifyIssueTitle lowercases, dashes unsafe runs, caps length, never empty", () => {
  assert.equal(slugifyIssueTitle("Add the Widget!"), "add-the-widget");
  assert.equal(slugifyIssueTitle("  Foo / Bar  "), "foo-bar");
  assert.equal(slugifyIssueTitle("!!!"), "work", "no safe chars → work");
  assert.ok(slugifyIssueTitle("x".repeat(80)).length <= 40, "capped at 40");
});

test("branchFromIssue builds issue-<n>-<slug>", () => {
  assert.equal(branchFromIssue({ number: 12, title: "Add the Widget" }), "issue-12-add-the-widget");
});
