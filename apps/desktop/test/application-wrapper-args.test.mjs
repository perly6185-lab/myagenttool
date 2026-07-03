import { test } from "node:test";
import assert from "node:assert/strict";
import { applicationWrapperArgs, usesApplicationWrapper } from "../src/application-wrapper-args.mjs";

const BASE = ["tools/agents/application-wrapper.mjs"];
const payload = (applicationWrapper) => ({ options: { metadata: { applicationWrapper } } });

test("usesApplicationWrapper detects the runner script", () => {
  assert.equal(usesApplicationWrapper(BASE), true);
  assert.equal(usesApplicationWrapper(["tools/agents/ccusage-wrapper.mjs"]), false);
});

test("injects the server-resolved command as discrete argv", () => {
  const args = applicationWrapperArgs(BASE, payload({
    execCommand: "ccusage",
    execArgs: ["daily", "--json"],
    capability: "app.app_ccusage.wrapper.daily",
  }));
  assert.deepEqual(args, [
    "tools/agents/application-wrapper.mjs",
    "--exec-command", "ccusage",
    "--capability", "app.app_ccusage.wrapper.daily",
    "--exec-arg", "daily",
    "--exec-arg", "--json",
  ]);
});

test("each exec-arg is preceded by its own --exec-arg (a flag-shaped arg cannot inject a runner flag)", () => {
  const args = applicationWrapperArgs(BASE, payload({ execCommand: "x", execArgs: ["--exec-command", "evil"] }));
  // --exec-command evil must NOT appear as a standalone runner override; both
  // hostile tokens are values behind their own --exec-arg.
  assert.deepEqual(args, [
    "tools/agents/application-wrapper.mjs",
    "--exec-command", "x",
    "--exec-arg", "--exec-command",
    "--exec-arg", "evil",
  ]);
});

test("is a no-op when the agent is not the application-wrapper runner", () => {
  const other = ["tools/agents/ccusage-wrapper.mjs", "--report", "daily"];
  assert.deepEqual(applicationWrapperArgs(other, payload({ execCommand: "ccusage" })), other);
});

test("is a no-op when there is no applicationWrapper spec", () => {
  assert.deepEqual(applicationWrapperArgs(BASE, { options: { metadata: {} } }), BASE);
  assert.deepEqual(applicationWrapperArgs(BASE, {}), BASE);
});

test("injects --cwd only when resolveCwd yields a path", () => {
  const withCwd = applicationWrapperArgs(BASE, payload({ execCommand: "ccusage", cwd: "/repo" }), { resolveCwd: () => "/repo" });
  assert.ok(withCwd.includes("--cwd") && withCwd.includes("/repo"));
  const noCwd = applicationWrapperArgs(BASE, payload({ execCommand: "ccusage", cwd: "." }), { resolveCwd: () => null });
  assert.ok(!noCwd.includes("--cwd"));
});
