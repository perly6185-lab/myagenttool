import assert from "node:assert/strict";
import test from "node:test";
import { createKnownApplicationRegistration, listKnownApplications } from "../src/services/application-catalog.mjs";
import { listKnownRuntimes } from "../src/services/runtime-catalog.mjs";

test("known application catalog exposes only user-facing applications", () => {
  assert.deepEqual(listKnownApplications().map((entry) => entry.name), ["markdown", "git", "ccusage", "claude", "codex", "officecli", "canvas", "excalidraw-cli"]);
  assert.deepEqual(listKnownApplications().find((entry) => entry.name === "codex").runtimeRequirements, [
    { runtimeId: "runtime_codex", required: true },
  ]);
  // Governed binary Applications (officecli, excalidraw-cli) are backed by tool
  // runtimes; the built-in Canvas needs none (like Markdown).
  assert.deepEqual(listKnownApplications().find((entry) => entry.name === "excalidraw-cli").runtimeRequirements, [
    { runtimeId: "runtime_excalidraw_cli", required: true },
  ]);
  assert.deepEqual(listKnownApplications().find((entry) => entry.name === "canvas").runtimeRequirements, []);
});

test("runtime catalog keeps shell infrastructure separate from Applications", () => {
  assert.deepEqual(listKnownRuntimes().map((entry) => entry.id), [
    "runtime_git", "runtime_ccusage", "runtime_officecli", "runtime_excalidraw_cli", "runtime_claude", "runtime_codex", "runtime_git_bash", "runtime_wsl",
  ]);
  assert.deepEqual(listKnownRuntimes().filter((entry) => entry.kind === "shell").map((entry) => entry.applicationIds), [[], []]);
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

test("#1356: known excalidraw-cli registration resolves aliases as a governed binary write app (not the in-process canvas)", () => {
  const resolved = createKnownApplicationRegistration("excalidraw-cli");
  assert.equal(resolved.registration.id, "app_excalidraw_cli");
  assert.equal(resolved.entry.command, "excalidraw-cli");
  assert.equal(resolved.registration.source.type, "binary");
  const writes = resolved.registration.source.wrapper.commands.filter((c) => c.filePolicy === "workspace_write");
  assert.ok(writes.length >= 1 && writes.every((c) => c.requiresApproval === true && c.segment === "apply"));
  // The `excalidraw` alias still resolves to the in-process Canvas app, never this one.
  assert.equal(createKnownApplicationRegistration("excalidraw").registration.id, "app_canvas");
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
