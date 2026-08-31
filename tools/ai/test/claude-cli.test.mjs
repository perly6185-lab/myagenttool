import assert from "node:assert/strict";
import test from "node:test";
import { buildClaudeArgs, inspectClaudeProbeOutput } from "../src/evals/claude-cli.mjs";

test("Claude eval calls isolate project settings and MCP configuration", () => {
  assert.deepEqual(
    buildClaudeArgs(["-p", "task"], {}),
    ["-p", "task", "--setting-sources", "user", "--strict-mcp-config"],
  );
});

test("Claude eval calls preserve model and explicit setting-source overrides", () => {
  assert.deepEqual(
    buildClaudeArgs(["-p", "task"], { model: "sonnet", settingSources: "user,project" }),
    [
      "-p", "task",
      "--model", "sonnet",
      "--setting-sources", "user,project",
      "--strict-mcp-config",
    ],
  );
});

test("Claude eval probes accept only an identified Claude model family", () => {
  assert.deepEqual(
    inspectClaudeProbeOutput(JSON.stringify({ modelUsage: { "claude-sonnet-4-5": {} } })),
    { parsed: true, models: ["claude-sonnet-4-5"], claudeModelsOnly: true },
  );
  assert.deepEqual(
    inspectClaudeProbeOutput(JSON.stringify({ modelUsage: { "compatible-model": {} } })),
    { parsed: true, models: ["compatible-model"], claudeModelsOnly: false },
  );
  assert.deepEqual(
    inspectClaudeProbeOutput("not json"),
    { parsed: false, models: [], claudeModelsOnly: false },
  );
});
