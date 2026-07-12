import assert from "node:assert/strict";
import { test } from "node:test";

import { extractClaudeFileAccesses } from "../src/claude-file-access.mjs";

test("extracts reads and writes from an assistant message's tool_use parts", () => {
  const event = {
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "let me look" },
        { type: "tool_use", name: "Read", input: { file_path: "/wt/apps/server/a.mjs" } },
        { type: "tool_use", name: "Edit", input: { file_path: "/wt/apps/server/b.mjs" } },
        { type: "tool_use", name: "Write", input: { file_path: "/wt/apps/server/c.mjs" } },
        { type: "tool_use", name: "NotebookEdit", input: { notebook_path: "/wt/nb.ipynb" } },
      ],
    },
  };
  assert.deepEqual(extractClaudeFileAccesses(event), [
    { tool: "Read", path: "/wt/apps/server/a.mjs", mode: "read" },
    { tool: "Edit", path: "/wt/apps/server/b.mjs", mode: "write" },
    { tool: "Write", path: "/wt/apps/server/c.mjs", mode: "write" },
    { tool: "NotebookEdit", path: "/wt/nb.ipynb", mode: "write" },
  ]);
});

test("ignores non-file tools (Bash/Grep/Glob) and paths-less tool_use", () => {
  const event = {
    message: {
      content: [
        { type: "tool_use", name: "Bash", input: { command: "cat secrets" } },
        { type: "tool_use", name: "Grep", input: { pattern: "x", path: "/wt" } },
        { type: "tool_use", name: "Read", input: {} }, // no path → skipped
      ],
    },
  };
  assert.deepEqual(extractClaudeFileAccesses(event), []);
});

test("returns [] for non-message events and malformed content", () => {
  assert.deepEqual(extractClaudeFileAccesses({ type: "result", result: "done" }), []);
  assert.deepEqual(extractClaudeFileAccesses({ message: { content: "plain string" } }), []);
  assert.deepEqual(extractClaudeFileAccesses(null), []);
});

test("reads content from event.content when there is no event.message", () => {
  const event = { content: [{ type: "tool_use", name: "Read", input: { file_path: "/wt/x" } }] };
  assert.deepEqual(extractClaudeFileAccesses(event), [{ tool: "Read", path: "/wt/x", mode: "read" }]);
});
