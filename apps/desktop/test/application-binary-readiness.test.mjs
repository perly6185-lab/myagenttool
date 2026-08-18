import assert from "node:assert/strict";
import { test } from "node:test";
import { collectApplicationBinaryReadiness } from "../src/application-binary-readiness.mjs";
import { createLocalExecutionPolicyManifest } from "../src/local-execution-policy.mjs";

test("reports only allowlisted application binaries with sanitized versions", async () => {
  const rows = await collectApplicationBinaryReadiness({ applicationWrapperCommands: [
    { command: "git", capabilityPrefix: "app.app_git.wrapper." },
    { command: "ccusage", capabilityPrefix: "app.app_ccusage.wrapper." },
    { command: "ignored", capabilityPrefix: "not-an-app" },
  ] }, {
    now: () => "2026-07-13T00:00:00.000Z",
    resolveBinary: (command) => command === "git",
    // async runVersion — the collector must await it (order still preserved).
    runVersion: async () => "git version 2.50.0\nsecret second line",
  });

  assert.deepEqual(rows, [
    { runtimeId: "runtime_git", command: "git", capabilityPrefix: "app.app_git.wrapper.", status: "available", version: "git version 2.50.0 secret second line", checkedAt: "2026-07-13T00:00:00.000Z" },
    { runtimeId: "runtime_ccusage", command: "ccusage", capabilityPrefix: "app.app_ccusage.wrapper.", status: "absent", version: null, checkedAt: "2026-07-13T00:00:00.000Z" },
  ]);
});

test("the bridge manifest reports readiness for Claude Application capabilities", async () => {
  const rows = await collectApplicationBinaryReadiness(createLocalExecutionPolicyManifest(), {
    now: () => "2026-07-14T00:00:00.000Z",
    resolveBinary: (command) => command === "claude",
    runVersion: async () => "2.1.0",
    runAuthentication: async () => ({ status: "authenticated", method: "oauth" }),
  });
  const claude = rows.find((row) => row.command === "claude");
  assert.deepEqual(claude, {
    runtimeId: "runtime_claude",
    command: "claude",
    capabilityPrefix: "app.app_claude.",
    status: "available",
    version: "2.1.0",
    authenticationStatus: "authenticated",
    authenticationMethod: "oauth",
    checkedAt: "2026-07-14T00:00:00.000Z",
  });
});

test("#1356: the bridge manifest detects the excalidraw-cli runtime — available when present, absent (degraded) when not", async () => {
  const present = await collectApplicationBinaryReadiness(createLocalExecutionPolicyManifest(), {
    now: () => "2026-07-21T00:00:00.000Z",
    resolveBinary: (command) => command === "excalidraw-cli",
    runVersion: async (command, args) => (command === "excalidraw-cli" && args[0] === "--version" ? "excalidraw-cli/0.5.0" : ""),
  });
  assert.deepEqual(present.find((row) => row.command === "excalidraw-cli"), {
    runtimeId: "runtime_excalidraw_cli",
    command: "excalidraw-cli",
    capabilityPrefix: "app.app_excalidraw_cli.wrapper.",
    status: "available",
    version: "excalidraw-cli/0.5.0",
    checkedAt: "2026-07-21T00:00:00.000Z",
  });

  // Absent binary → readiness "absent", never a false-positive; this is what the
  // Canvas export capability (PR2) keys on to degrade to browser export.
  const absent = await collectApplicationBinaryReadiness(createLocalExecutionPolicyManifest(), {
    now: () => "2026-07-21T00:00:00.000Z",
    resolveBinary: () => false,
    runVersion: async () => "",
  });
  assert.deepEqual(absent.find((row) => row.command === "excalidraw-cli"), {
    runtimeId: "runtime_excalidraw_cli",
    command: "excalidraw-cli",
    capabilityPrefix: "app.app_excalidraw_cli.wrapper.",
    status: "absent",
    version: null,
    checkedAt: "2026-07-21T00:00:00.000Z",
  });
});

test("authentication probes publish only normalized status and method", async () => {
  const calls = [];
  const codexEnvironment = {
    CODEX_HOME: "C:\\Users\\demo\\.codex",
    USERPROFILE: "C:\\Users\\demo",
  };
  const rows = await collectApplicationBinaryReadiness(createLocalExecutionPolicyManifest(), {
    now: () => "2026-07-19T00:00:00.000Z",
    resolveBinary: (command) => command === "codex",
    environmentForCommand: (command) => command === "codex" ? codexEnvironment : undefined,
    runVersion: async (command, args, env) => {
      assert.equal(command, "codex");
      assert.deepEqual(args, ["--version"]);
      assert.equal(env, codexEnvironment);
      return "codex-cli 0.144.6";
    },
    runAuthentication: async (...args) => {
      calls.push(args);
      return { status: "authenticated", method: "api_key" };
    },
  });
  const codex = rows.find((row) => row.command === "codex");
  assert.deepEqual(codex, {
    runtimeId: "runtime_codex",
    command: "codex",
    capabilityPrefix: "app.setup.codex.",
    status: "available",
    version: "codex-cli 0.144.6",
    authenticationStatus: "authenticated",
    authenticationMethod: "api_key",
    checkedAt: "2026-07-19T00:00:00.000Z",
  });
  assert.deepEqual(calls, [["codex", ["login", "status"], "exit-code", codexEnvironment]]);
});

test("candidate probes mark setup-only tools available when a fallback succeeds", async () => {
  const rows = await collectApplicationBinaryReadiness(createLocalExecutionPolicyManifest(), {
    now: () => "2026-07-14T00:00:00.000Z",
    resolveBinary: (command) => command === "git",
    runVersion: async (command) => command === "git" ? "git version 2.50.1.windows.1" : "",
  });
  const gitBash = rows.find((row) => row.command === "git-bash");
  assert.deepEqual(gitBash, {
    runtimeId: "runtime_git_bash",
    command: "git-bash",
    capabilityPrefix: "app.setup.git_bash.",
    status: "available",
    version: "git version 2.50.1.windows.1",
    checkedAt: "2026-07-14T00:00:00.000Z",
  });
});
