import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveVerifyCommandAllowlist, resolveAutoRunVerifyCommandFor } from "../src/services/worktree-verify.mjs";

const env = {
  MYAGENTTOOL_AUTORUN_VERIFY_COMMAND_JSON: JSON.stringify(["npm", "test"]),
  MYAGENTTOOL_AUTORUN_VERIFY_COMMANDS_JSON: JSON.stringify({ maven: ["mvn", "-q", "test"], bad: "notargv", empty: [], npm: ["npm", "run", "ci"] }),
};

test("resolveVerifyCommandAllowlist: keeps valid argv entries, drops the rest", () => {
  const allow = resolveVerifyCommandAllowlist(env);
  assert.deepEqual(allow.maven, ["mvn", "-q", "test"]);
  assert.deepEqual(allow.npm, ["npm", "run", "ci"]);
  assert.ok(!("bad" in allow) && !("empty" in allow), "non-argv entries dropped");
  assert.deepEqual(resolveVerifyCommandAllowlist({}), {});
  assert.deepEqual(resolveVerifyCommandAllowlist({ MYAGENTTOOL_AUTORUN_VERIFY_COMMANDS_JSON: "junk" }), {});
});

test("resolveAutoRunVerifyCommandFor: named → allowlist argv", () => {
  assert.deepEqual(resolveAutoRunVerifyCommandFor({ verifyCommandName: "maven", env }), ["mvn", "-q", "test"]);
});

test("resolveAutoRunVerifyCommandFor: unknown name falls back to the global command (never runs unlisted)", () => {
  assert.deepEqual(resolveAutoRunVerifyCommandFor({ verifyCommandName: "nope", env }), ["npm", "test"]);
});

test("resolveAutoRunVerifyCommandFor: no name → global command", () => {
  assert.deepEqual(resolveAutoRunVerifyCommandFor({ env }), ["npm", "test"]);
  assert.equal(resolveAutoRunVerifyCommandFor({ env: {} }), null);
});
