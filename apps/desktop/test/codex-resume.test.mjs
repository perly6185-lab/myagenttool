import { test } from "node:test";
import assert from "node:assert/strict";
import { codexResumeArgs, safeCodexSessionId } from "../src/codex-resume.mjs";

test("safeCodexSessionId accepts a provider session token", () => {
  assert.equal(safeCodexSessionId("0198f2a1-DEF_4.5"), "0198f2a1-DEF_4.5");
  assert.equal(safeCodexSessionId("abc123"), "abc123");
});

test("safeCodexSessionId rejects a token that could be an injected flag or is malformed", () => {
  assert.equal(safeCodexSessionId("--dangerously-bypass-approvals-and-sandbox"), null); // leading dash
  assert.equal(safeCodexSessionId("has space"), null);
  assert.equal(safeCodexSessionId("bad;rm -rf"), null);
  assert.equal(safeCodexSessionId(""), null);
  assert.equal(safeCodexSessionId(null), null);
  assert.equal(safeCodexSessionId("a".repeat(300)), null); // exceeds bound
});

test("codexResumeArgs resumes the resolved session BY ID, not --last", () => {
  const args = codexResumeArgs({ codexResumeSessionId: "0198f2a1-DEF_4.5" });
  assert.deepEqual(args, ["exec", "resume", "0198f2a1-DEF_4.5", "--skip-git-repo-check", "--json", "{{task}}"]);
  assert.ok(!args.includes("--last"));
});

test("codexResumeArgs falls back to --last when there is no resumable id", () => {
  assert.equal(codexResumeArgs({}).at(2), "--last");
  assert.equal(codexResumeArgs({ codexResumeSessionId: null }).at(2), "--last");
});

test("codexResumeArgs rejects a hostile id and falls back to --last (no flag injection)", () => {
  const args = codexResumeArgs({ codexResumeSessionId: "--dangerously-bypass-approvals-and-sandbox" });
  assert.equal(args.at(2), "--last");
  assert.ok(!args.includes("--dangerously-bypass-approvals-and-sandbox"));
});
