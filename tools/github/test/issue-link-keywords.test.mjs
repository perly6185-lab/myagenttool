/*
 * #1314: PR/issue link detection must recognize GitHub's full set of
 * issue-closing keywords, not only `refs|closes|fixes`. "Fixed #12" or
 * "Resolves #7" in a PR body previously read as "no linked issue" and tripped a
 * false pr-governance failure.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { mentionsLinkedIssue, extractLinkedIssueNumbers } from "../src/pr-evidence.mjs";

test("mentionsLinkedIssue recognizes every GitHub closing keyword plus refs", () => {
  for (const kw of ["Closes", "closed", "Fix", "fixes", "Fixed", "Resolve", "resolves", "Resolved", "Refs"]) {
    assert.equal(mentionsLinkedIssue(`${kw} #42`), true, `${kw} should link`);
  }
});

test("mentionsLinkedIssue ignores non-link mentions", () => {
  assert.equal(mentionsLinkedIssue("see #42"), false);
  assert.equal(mentionsLinkedIssue("fixing #42"), false); // not "fix" + whitespace
  assert.equal(mentionsLinkedIssue("prefix #42"), false); // word-boundary guards against substrings
  assert.equal(mentionsLinkedIssue(""), false);
  assert.equal(mentionsLinkedIssue(null), false);
});

test("extractLinkedIssueNumbers pulls every linked number across keywords", () => {
  assert.deepEqual(extractLinkedIssueNumbers("Fixed #12 and resolves #7\nRefs #3"), [12, 7, 3]);
  assert.deepEqual(extractLinkedIssueNumbers("no links here"), []);
});

test("a fresh regex per call — no leaked global lastIndex between calls", () => {
  const body = "Closes #1 fixes #2";
  assert.deepEqual(extractLinkedIssueNumbers(body), [1, 2]);
  assert.deepEqual(extractLinkedIssueNumbers(body), [1, 2]);
});
