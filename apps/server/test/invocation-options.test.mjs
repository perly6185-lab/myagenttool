/*
 * Unit tests for invocationOptionsFromBody: the composer's "Permissions" choice
 * (permissionLevel) must reach metadata.permissionMode, which codex reads to
 * decide auto-approval. The web client nests permissionLevel inside `options`;
 * if the route only read it top-level, a "Full access" run would silently fall
 * back to "ask" and stall on every approval until it times out and fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { invocationOptionsFromBody } from "../src/routes/invocations.mjs";

test("permissionLevel nested in options (web composer shape) → metadata.permissionMode", () => {
  const out = invocationOptionsFromBody({
    task: "hello",
    agentId: "agt_codex_cli",
    projectId: "p",
    worktreeId: "w",
    options: { permissionLevel: "full" },
  });
  assert.equal(out.metadata.permissionMode, "full");
  assert.equal(out.metadata.projectId, "p");
  assert.equal(out.metadata.worktreeId, "w");
});

test("permissionLevel at the top level (legacy callers) still bridges", () => {
  const out = invocationOptionsFromBody({ permissionLevel: "auto" });
  assert.equal(out.metadata.permissionMode, "auto");
});

test("top-level permissionLevel wins over a nested one", () => {
  const out = invocationOptionsFromBody({ permissionLevel: "full", options: { permissionLevel: "ask" } });
  assert.equal(out.metadata.permissionMode, "full");
});

test("no permissionLevel leaves permissionMode unset (codex falls back to ask)", () => {
  const out = invocationOptionsFromBody({ options: {} });
  assert.equal(out.metadata.permissionMode, undefined);
});

test("an explicit metadata.permissionMode is preserved when no permissionLevel is given", () => {
  const out = invocationOptionsFromBody({ options: { metadata: { permissionMode: "auto" } } });
  assert.equal(out.metadata.permissionMode, "auto");
});
