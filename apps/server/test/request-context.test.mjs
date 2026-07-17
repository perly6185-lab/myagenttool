import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeRequestContext } from "../src/read-models/request-context.mjs";

// A representative claude stream-json `system/init` payload as the bridge relays it.
const initLike = {
  provider: "anthropic",
  model: "claude-opus-4-8[1m]",
  permissionMode: "acceptEdits",
  tools: ["Task", "Bash", "Read", "Edit", "Write"],
  mcp_servers: [{ name: "claude.ai Google Drive", status: "needs-auth" }],
  skills: ["deep-research", "dataviz"],
  agents: ["claude", "Explore"],
  slash_commands: ["a", "b", "c"],
  session_id: "3b9414ea-9bbf-1234",
};

test("sanitizeRequestContext maps a real init payload into the durable shape", () => {
  const ctx = sanitizeRequestContext(initLike);
  assert.equal(ctx.provider, "anthropic");
  assert.equal(ctx.model, "claude-opus-4-8[1m]");
  assert.equal(ctx.permissionMode, "acceptEdits");
  assert.deepEqual(ctx.tools, ["Task", "Bash", "Read", "Edit", "Write"]);
  assert.deepEqual(ctx.mcpServers, [{ name: "claude.ai Google Drive", status: "needs-auth" }]);
  assert.deepEqual(ctx.skills, ["deep-research", "dataviz"]);
  assert.deepEqual(ctx.agents, ["claude", "Explore"]);
  assert.equal(ctx.slashCommandCount, 3, "slash_commands array length becomes a count, not the list");
  assert.equal(ctx.sessionId, "3b9414ea-9bbf-1234");
});

test("an explicit slashCommandCount wins over a slash_commands array", () => {
  const ctx = sanitizeRequestContext({ ...initLike, slashCommandCount: 58, slash_commands: ["x"] });
  assert.equal(ctx.slashCommandCount, 58);
});

test("tool names are deduped and capped, long names clamped", () => {
  const ctx = sanitizeRequestContext({
    model: "m",
    tools: ["Read", "Read", "Read", "x".repeat(200)],
  });
  assert.deepEqual(ctx.tools.slice(0, 1), ["Read"]);
  assert.equal(ctx.tools.length, 2, "duplicate Read collapses to one; the long name is a second entry");
  assert.equal(ctx.tools[1].length, 80, "an over-long tool name is clamped to the cap");
});

test("malformed mcp entries are dropped; a nameless server is skipped", () => {
  const ctx = sanitizeRequestContext({
    model: "m",
    mcpServers: [null, "nope", { status: "ok" }, { name: "good", status: "connected" }],
  });
  assert.deepEqual(ctx.mcpServers, [{ name: "good", status: "connected" }]);
});

test("a payload with no usable signal returns null (records nothing)", () => {
  assert.equal(sanitizeRequestContext(null), null);
  assert.equal(sanitizeRequestContext("nope"), null);
  assert.equal(sanitizeRequestContext([]), null);
  assert.equal(sanitizeRequestContext({ tools: [], skills: [], slash_commands: [] }), null);
});

test("provider defaults to anthropic when absent", () => {
  const ctx = sanitizeRequestContext({ model: "m", tools: ["Read"] });
  assert.equal(ctx.provider, "anthropic");
});
