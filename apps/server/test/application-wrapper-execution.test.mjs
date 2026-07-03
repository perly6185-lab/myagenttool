/*
 * #359 Slice A: the application-capability execution building blocks —
 *  1) applicationWrapperExecutionPlan: only approved+registered commands resolve
 *     (the server-side allowlist of WHAT may execute), and
 *  2) the application-wrapper runner: spawns only the exact command it is handed
 *     (no shell), refusing malformed/flag-shaped commands.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createApplicationService, applicationWrapperExecutionPlan } from "../src/services/applications.mjs";
import { createCcusageApplicationRegistration } from "../src/services/ccusage-application.mjs";

const RUNNER = fileURLToPath(new URL("../../../tools/agents/application-wrapper.mjs", import.meta.url));

function ccusageApp() {
  const state = { applications: [] };
  const svc = createApplicationService({
    state,
    now: () => "2026-07-03T00:00:00.000Z",
    nextId: (p) => `${p}_x`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    addProject: () => null,
    cloneProject: () => null,
    defaultProjectPath: "/tmp/repo",
  });
  return svc.registerApplication(createCcusageApplicationRegistration());
}

function runRunner(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [RUNNER, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function resultFrom(stdout) {
  const line = stdout.split(/\r?\n/).find((l) => l.startsWith("RESULT "));
  return line ? JSON.parse(line.slice("RESULT ".length)) : null;
}

test("execution plan resolves an approved, registered command", () => {
  const app = ccusageApp();
  const plan = applicationWrapperExecutionPlan(app, "daily");
  assert.ok(plan);
  assert.equal(plan.command, "ccusage");
  assert.deepEqual(plan.args, ["daily", "--json", "--offline"]);
  assert.equal(plan.capability, "app.app_ccusage.wrapper.daily");
});

test("execution plan refuses unknown, unapproved, or non-npm commands", () => {
  const app = ccusageApp();
  assert.equal(applicationWrapperExecutionPlan(app, "nope"), null); // unregistered
  const pending = { id: "a", name: "a", source: { type: "npm", wrapper: { mode: "installed-wrapper", commands: [{ id: "x", status: "draft", commandType: "bin", command: "ccusage", args: [] }] } } };
  assert.equal(applicationWrapperExecutionPlan(pending, "x"), null); // not approved
  const local = { id: "b", name: "b", source: { type: "local", path: "/tmp" } };
  assert.equal(applicationWrapperExecutionPlan(local, "x"), null); // not npm
});

test("execution plan returns a copy of args (no aliasing into the registry)", () => {
  const app = ccusageApp();
  const plan = applicationWrapperExecutionPlan(app, "daily");
  plan.args.push("--mutated");
  assert.deepEqual(applicationWrapperExecutionPlan(app, "daily").args, ["daily", "--json", "--offline"]);
});

test("runner spawns exactly the command it is handed and emits a structured RESULT", async () => {
  const { code, stdout } = await runRunner([
    "--capability", "app.app_ccusage.wrapper.daily",
    "--exec-command", process.execPath,
    "--exec-arg", "-e",
    "--exec-arg", "console.log(JSON.stringify({rows:1}))",
  ]);
  assert.equal(code, 0);
  const result = resultFrom(stdout);
  assert.equal(result.output.source, "application");
  assert.equal(result.output.capability, "app.app_ccusage.wrapper.daily");
  assert.deepEqual(result.output.report, { rows: 1 });
});

test("runner refuses a missing command and a flag-shaped command (no injection)", async () => {
  const missing = await runRunner(["--capability", "x"]);
  assert.equal(missing.code, 1);
  assert.match(resultFrom(missing.stdout).error, /Missing --exec-command/);

  const flag = await runRunner(["--exec-command", "--dangerously"]);
  assert.equal(flag.code, 1);
  assert.match(resultFrom(flag.stdout).error, /must be a program, not a flag/);
});

test("runner reports a non-zero child exit as a failure", async () => {
  const { code, stdout } = await runRunner([
    "--exec-command", process.execPath,
    "--exec-arg", "-e",
    "--exec-arg", "process.exit(3)",
  ]);
  assert.equal(code, 1);
  assert.match(resultFrom(stdout).error, /exited with code 3/);
});
