import assert from "node:assert/strict";
import test from "node:test";
import { createKnownApplicationRegistration, listKnownApplications } from "../src/services/application-catalog.mjs";

test("known application catalog exposes governed entries and setup-only prerequisites", () => {
  assert.deepEqual(listKnownApplications().map((entry) => entry.name), ["git", "ccusage", "claude", "codex", "git-bash", "wsl", "officecli", "canvas"]);
  assert.deepEqual(
    listKnownApplications().filter((entry) => entry.setupOnly).map((entry) => entry.name),
    ["git-bash", "wsl"],
  );
});

test("known canvas registration is a built-in, runtime-less manual Application", () => {
  const resolved = createKnownApplicationRegistration("canvas");
  assert.equal(resolved.registration.id, "app_canvas");
  assert.equal(resolved.registration.source.type, "manual"); // no external runtime / bridge
  assert.equal(resolved.entry.installHint.includes("built in"), true);
  // Alias resolves too.
  assert.equal(createKnownApplicationRegistration("excalidraw").registration.id, "app_canvas");
});

test("known officecli registration resolves aliases; reads need no approval, the write does", () => {
  const resolved = createKnownApplicationRegistration("office-cli");
  assert.equal(resolved.registration.id, "app_officecli");
  assert.equal(resolved.entry.command, "officecli");
  const commands = resolved.registration.source.wrapper.commands;
  const reads = commands.filter((c) => c.filePolicy === "read_only");
  const writes = commands.filter((c) => c.filePolicy === "workspace_write");
  assert.equal(reads.length, 5);
  assert.ok(reads.every((c) => c.requiresApproval === false));
  // Every write verb is approval-gated (P3.1 currently ships `remove`).
  assert.ok(writes.length >= 1);
  assert.ok(writes.every((c) => c.requiresApproval === true && c.segment === "apply"));
});

test("known application registration resolves aliases and preserves project scope", () => {
  const resolved = createKnownApplicationRegistration(" Claude Code ", { projectId: "prj_demo" });
  assert.equal(resolved.registration.id, "app_claude");
  assert.equal(resolved.registration.projectId, "prj_demo");
  assert.equal(resolved.entry.command, "claude");
});

test("known ccusage registration uses the canonical governed descriptor", () => {
  const resolved = createKnownApplicationRegistration("ccusage");
  assert.equal(resolved.registration.id, "app_ccusage");
  assert.equal(resolved.registration.source.package, "ccusage");
  assert.equal(resolved.registration.source.wrapper.commands.length, 6);
});

test("unknown text cannot become an install or registration request", () => {
  assert.equal(createKnownApplicationRegistration("left-pad"), null);
});

test("Codex resolves to a governed registration while setup-only prerequisites do not", () => {
  assert.equal(createKnownApplicationRegistration("codex cli").registration.id, "app_codex");
  assert.equal(createKnownApplicationRegistration("git bash"), null);
  assert.equal(createKnownApplicationRegistration("wsl bash"), null);
});
