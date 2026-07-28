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

test("codexResumeArgs refuses an implicit global resume when there is no exact id", () => {
  assert.equal(codexResumeArgs({}), null);
  assert.equal(codexResumeArgs({ codexResumeSessionId: null }), null);
});

test("codexResumeArgs rejects a hostile id without falling back to --last", () => {
  const args = codexResumeArgs({ codexResumeSessionId: "--dangerously-bypass-approvals-and-sandbox" });
  assert.equal(args, null);
});
