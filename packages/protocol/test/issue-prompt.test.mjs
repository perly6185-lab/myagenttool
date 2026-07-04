import assert from "node:assert/strict";
import { test } from "node:test";

import { githubItemKindLabel, worktreeAutoRunPrompt } from "../src/issue-prompt.mjs";

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
