import assert from "node:assert/strict";
import test from "node:test";
import { createKnownApplicationRegistration, listKnownApplications } from "../src/services/application-catalog.mjs";
import { listKnownRuntimes } from "../src/services/runtime-catalog.mjs";

test("known application catalog exposes only user-facing applications", () => {
  assert.deepEqual(listKnownApplications().map((entry) => entry.name), ["markdown", "git", "ccusage", "claude", "codex"]);
  assert.deepEqual(listKnownApplications().find((entry) => entry.name === "codex").runtimeRequirements, [
    { runtimeId: "runtime_codex", required: true },
  ]);
});

test("runtime catalog keeps shell infrastructure separate from Applications", () => {
  assert.deepEqual(listKnownRuntimes().map((entry) => entry.id), [
    "runtime_git", "runtime_ccusage", "runtime_claude", "runtime_codex", "runtime_git_bash", "runtime_wsl",
  ]);
  assert.deepEqual(listKnownRuntimes().filter((entry) => entry.kind === "shell").map((entry) => entry.applicationIds), [[], []]);
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

test("Markdown is a built-in local Application with no Runtime requirement", () => {
  const resolved = createKnownApplicationRegistration("md");
  assert.equal(resolved.registration.id, "app_markdown");
  assert.equal(resolved.registration.source.type, "builtin");
  assert.equal(resolved.registration.executionScope, "local");
  assert.deepEqual(resolved.registration.runtimeRequirements, []);
});

test("unknown text cannot become an install or registration request", () => {
  assert.equal(createKnownApplicationRegistration("left-pad"), null);
});

test("Codex resolves to a governed registration while runtime-only shells do not", () => {
  assert.equal(createKnownApplicationRegistration("codex cli").registration.id, "app_codex");
  assert.equal(createKnownApplicationRegistration("git bash"), null);
  assert.equal(createKnownApplicationRegistration("wsl bash"), null);
});
