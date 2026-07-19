import assert from "node:assert/strict";
import test from "node:test";
import { createKnownApplicationRegistration, listKnownApplications } from "../src/services/application-catalog.mjs";

test("known application catalog exposes governed entries and setup-only prerequisites", () => {
  assert.deepEqual(listKnownApplications().map((entry) => entry.name), ["git", "ccusage", "claude", "codex", "git-bash", "wsl"]);
  assert.deepEqual(
    listKnownApplications().filter((entry) => entry.setupOnly).map((entry) => entry.name),
    ["codex", "git-bash", "wsl"],
  );
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

test("setup-only entries can be installed but cannot become Application registrations", () => {
  assert.equal(createKnownApplicationRegistration("codex cli"), null);
  assert.equal(createKnownApplicationRegistration("git bash"), null);
  assert.equal(createKnownApplicationRegistration("wsl bash"), null);
});
