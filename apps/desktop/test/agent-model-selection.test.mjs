import assert from "node:assert/strict";
import { test } from "node:test";

import { applyAgentModelArgs } from "../src/agent-model-selection.mjs";

test("Codex model is inserted after exec and replaces an adapter default", () => {
  assert.deepEqual(
    applyAgentModelArgs(["exec", "--model", "old", "--json", "task"], { command: "codex" }, "gpt-5.6-sol"),
    ["exec", "--model", "gpt-5.6-sol", "--json", "task"],
  );
});

test("Claude model is passed before print-mode arguments", () => {
  assert.deepEqual(
    applyAgentModelArgs(["-p", "task"], { command: "claude.cmd" }, "sonnet"),
    ["--model", "sonnet", "-p", "task"],
  );
});

test("unsafe or unsupported model selections do not change argv", () => {
  assert.deepEqual(applyAgentModelArgs(["exec", "task"], { command: "codex" }, "x --help"), ["exec", "task"]);
  assert.deepEqual(applyAgentModelArgs(["task"], { command: "demo-agent" }, "gpt-5.6-sol"), ["task"]);
});
