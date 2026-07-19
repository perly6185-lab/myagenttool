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
    { command: "git", capabilityPrefix: "app.app_git.wrapper.", status: "available", version: "git version 2.50.0 secret second line", checkedAt: "2026-07-13T00:00:00.000Z" },
    { command: "ccusage", capabilityPrefix: "app.app_ccusage.wrapper.", status: "absent", version: null, checkedAt: "2026-07-13T00:00:00.000Z" },
  ]);
});

test("the bridge manifest reports readiness for Claude Application capabilities", async () => {
  const rows = await collectApplicationBinaryReadiness(createLocalExecutionPolicyManifest(), {
    now: () => "2026-07-14T00:00:00.000Z",
    resolveBinary: (command) => command === "claude",
    runVersion: async () => "2.1.0",
  });
  const claude = rows.find((row) => row.command === "claude");
  assert.deepEqual(claude, {
    command: "claude",
    capabilityPrefix: "app.app_claude.",
    status: "available",
    version: "2.1.0",
    checkedAt: "2026-07-14T00:00:00.000Z",
  });
});

test("candidate probes mark setup-only tools available when a fallback succeeds", async () => {
  const rows = await collectApplicationBinaryReadiness(createLocalExecutionPolicyManifest(), {
    now: () => "2026-07-14T00:00:00.000Z",
    resolveBinary: (command) => command === "git",
    runVersion: async (command) => command === "git" ? "git version 2.50.1.windows.1" : "",
  });
  const gitBash = rows.find((row) => row.command === "git-bash");
  assert.deepEqual(gitBash, {
    command: "git-bash",
    capabilityPrefix: "app.setup.git_bash.",
    status: "available",
    version: "git version 2.50.1.windows.1",
    checkedAt: "2026-07-14T00:00:00.000Z",
  });
});
