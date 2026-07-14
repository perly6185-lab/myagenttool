import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { createApplicationInstallPlan } from "../../server/src/services/application-install-plans.mjs";
import { resolveApplicationInstallSpawnPlan, runApprovedApplicationInstall } from "../src/application-installer.mjs";

const nodePlatform = { windows: "win32", macos: "darwin", linux: "linux" };
const device = (platform) => ({ id: `dev_${platform}`, name: platform, platform, architecture: "x64" });

for (const platform of ["windows", "macos", "linux"]) {
  for (const name of ["git", "ccusage", "claude"]) {
    test(`P2 Desktop Bridge accepts the exact ${platform} ${name} plan`, () => {
      const target = device(platform);
      const plan = createApplicationInstallPlan({ name }, { device: target });
      const resolved = resolveApplicationInstallSpawnPlan(plan, { platform: nodePlatform[platform] });
      assert.ok(resolved);
      assert.equal(typeof resolved.command, "string");
      assert.ok(Array.isArray(resolved.args));
    });
  }
}

test("P2 Desktop Bridge rejects modified and stale plans before spawn", async () => {
  const target = device("windows");
  const plan = createApplicationInstallPlan({ name: "git" }, { device: target });
  let spawned = false;
  const result = await runApprovedApplicationInstall({
    plan: { ...plan, execution: { ...plan.execution, args: [...plan.execution.args, "--inject"] } },
    platform: "win32",
    spawnProcess: () => { spawned = true; },
  });
  assert.equal(result.status, "refused");
  assert.equal(spawned, false);

  const policyResult = await runApprovedApplicationInstall({
    plan: { ...plan, policy: { ...plan.policy, timeoutMs: 900_000 } },
    platform: "win32",
    spawnProcess: () => { spawned = true; },
  });
  assert.equal(policyResult.status, "refused");
  assert.equal(spawned, false);
});

test("P2 runs fixed discrete argv with shell disabled", async () => {
  const target = device("macos");
  const plan = createApplicationInstallPlan({ name: "ccusage" }, { device: target });
  const observed = [];
  const result = await runApprovedApplicationInstall({
    plan,
    platform: "darwin",
    spawnProcess: (command, args, options) => {
      observed.push({ command, args, options });
      const child = fakeChild();
      queueMicrotask(() => child.emit("close", 0));
      return child;
    },
  });
  assert.equal(result.status, "succeeded");
  assert.equal(observed[0].command, "npm");
  assert.deepEqual(observed[0].args, ["install", "--global", "ccusage@latest"]);
  assert.equal(observed[0].options.shell, false);
  assert.equal(observed[1].command, "ccusage");
  assert.deepEqual(observed[1].args, ["--version"]);
  assert.equal(observed[1].options.shell, false);
});

test("P3 probe failure is distinct from install failure", async () => {
  const target = device("macos");
  const plan = createApplicationInstallPlan({ name: "git" }, { device: target });
  let spawnCount = 0;
  const result = await runApprovedApplicationInstall({
    plan,
    platform: "darwin",
    spawnProcess: () => {
      const child = fakeChild();
      const code = spawnCount++ === 0 ? 0 : 1;
      queueMicrotask(() => child.emit("close", code));
      return child;
    },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.classification, "probe_failed");
});

test("P2 cancellation terminates the child and reports cancelled", async () => {
  const target = device("linux");
  const plan = createApplicationInstallPlan({ name: "claude" }, { device: target });
  const child = fakeChild();
  let polls = 0;
  const result = await runApprovedApplicationInstall({
    plan,
    platform: "linux",
    spawnProcess: () => child,
    pollCancellation: async () => ++polls >= 1,
    terminate: async () => {
      queueMicrotask(() => child.emit("close", null));
      return { ok: true };
    },
  });
  assert.equal(result.status, "cancelled");
});

test("P2 timeout terminates the child and reports timed_out", async () => {
  const target = device("linux");
  const plan = createApplicationInstallPlan({ name: "ccusage" }, { device: target });
  const child = fakeChild();
  const result = await runApprovedApplicationInstall({
    plan,
    platform: "linux",
    spawnProcess: () => child,
    scheduleTimeout: (callback) => {
      queueMicrotask(callback);
      return 1;
    },
    clearScheduledTimeout: () => {},
    terminate: async () => {
      queueMicrotask(() => child.emit("close", null));
      return { ok: true };
    },
  });
  assert.equal(result.status, "timed_out");
});

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  return child;
}
