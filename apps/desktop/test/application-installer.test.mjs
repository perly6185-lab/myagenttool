import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApplicationInstallPlan } from "../../server/src/services/application-install-plans.mjs";
import { resolveApplicationInstallSpawnPlan, runApprovedApplicationInstall, setPolkitProbeForTests } from "../src/application-installer.mjs";

const nodePlatform = { windows: "win32", macos: "darwin", linux: "linux" };
const device = (platform) => ({ id: `dev_${platform}`, name: platform, platform, architecture: "x64" });
const supported = {
  windows: ["git", "git-bash", "wsl", "ccusage", "claude", "codex", "excalidraw-cli", "pdfcpu"],
  macos: ["git", "ccusage", "claude", "codex", "excalidraw-cli", "pdfcpu"],
  linux: ["ccusage", "claude", "codex", "excalidraw-cli", "pdfcpu"],
};

for (const platform of ["windows", "macos", "linux"]) {
  for (const name of supported[platform]) {
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
    preInstallProbe: false,
    spawnProcess: () => { spawned = true; },
  });
  assert.equal(result.status, "refused");
  assert.equal(spawned, false);

  const policyResult = await runApprovedApplicationInstall({
    plan: { ...plan, policy: { ...plan.policy, timeoutMs: 900_000 } },
    platform: "win32",
    preInstallProbe: false,
    spawnProcess: () => { spawned = true; },
  });
  assert.equal(policyResult.status, "refused");
  assert.equal(spawned, false);
});

test("pdfcpu installer refuses a checksum mismatch before extraction or destination writes", async () => {
  const target = { id: "dev_pdf", name: "pdf device", platform: "macos", architecture: "arm64" };
  const plan = createApplicationInstallPlan({ name: "pdfcpu" }, { device: target });
  const runtimeBinDirectory = mkdtempSync(join(tmpdir(), "pdfcpu-runtime-test-"));
  let spawned = false;
  try {
    const result = await runApprovedApplicationInstall({
      plan,
      platform: "darwin",
      preInstallProbe: false,
      runtimeBinDirectory,
      fetchImpl: async () => ({ ok: true, headers: { get: () => null }, arrayBuffer: async () => Buffer.from("tampered artifact") }),
      spawnProcess: () => { spawned = true; throw new Error("must not extract"); },
    });
    assert.equal(result.status, "failed");
    assert.equal(result.classification, "checksum_mismatch");
    assert.equal(spawned, false);
    assert.deepEqual(readdirSync(runtimeBinDirectory), []);
  } finally {
    rmSync(runtimeBinDirectory, { recursive: true, force: true });
  }
});

test("P2 runs fixed discrete argv with shell disabled", async () => {
  const target = device("macos");
  const plan = createApplicationInstallPlan({ name: "ccusage" }, { device: target });
  const observed = [];
  const result = await runApprovedApplicationInstall({
    plan,
    platform: "darwin",
    preInstallProbe: false,
    spawnProcess: (command, args, options) => {
      observed.push({ command, args, options });
      const child = fakeChild();
      queueMicrotask(() => child.emit("close", 0));
      return child;
    },
  });
  assert.equal(result.status, "succeeded");
  assert.equal(observed[0].command, "npm");
  assert.deepEqual(observed[0].args, ["install", "--global", "--registry=https://registry.npmjs.org/", "ccusage@20.0.14"]);
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
    preInstallProbe: false,
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
    preInstallProbe: false,
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
    preInstallProbe: false,
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
  assert.equal(result.classification, "install_timeout");
});

test("P4 rejects expired and elevated plans before spawn", async () => {
  const target = device("windows");
  const plan = createApplicationInstallPlan({ name: "git" }, { device: target, now: () => "2026-07-14T09:00:00.000Z" });
  let spawned = false;
  const expired = await runApprovedApplicationInstall({
    plan,
    platform: "win32",
    now: () => Date.parse("2026-07-14T09:10:00.001Z"),
    preInstallProbe: false,
    spawnProcess: () => { spawned = true; },
  });
  assert.equal(expired.status, "refused");
  const elevated = await runApprovedApplicationInstall({
    plan: { ...plan, execution: { ...plan.execution, elevated: true } },
    platform: "win32",
    now: () => Date.parse("2026-07-14T09:00:00.000Z"),
    preInstallProbe: false,
    spawnProcess: () => { spawned = true; },
  });
  assert.equal(elevated.status, "refused");
  assert.equal(spawned, false);
});

test("P4 reports probe timeout separately", async () => {
  const target = device("linux");
  const plan = createApplicationInstallPlan({ name: "ccusage" }, { device: target });
  let spawnCount = 0;
  const children = [fakeChild(), fakeChild()];
  const result = await runApprovedApplicationInstall({
    plan,
    platform: "linux",
    preInstallProbe: false,
    spawnProcess: () => {
      const child = children[spawnCount++];
      if (spawnCount === 1) queueMicrotask(() => child.emit("close", 0));
      return child;
    },
    scheduleTimeout: (callback, timeoutMs) => {
      if (timeoutMs === 15_000) queueMicrotask(callback);
      return timeoutMs;
    },
    clearScheduledTimeout: () => {},
    terminate: async (child) => {
      queueMicrotask(() => child.emit("close", null));
      return { ok: true };
    },
  });
  assert.equal(result.status, "timed_out");
  assert.equal(result.classification, "probe_timeout");
});

test("P4 does not expose spawn error details", async () => {
  const plan = createApplicationInstallPlan({ name: "ccusage" }, { device: device("windows") });
  const result = await runApprovedApplicationInstall({
    plan,
    platform: "win32",
    preInstallProbe: false,
    spawnProcess: () => { throw new Error("token=secret C:\\Users\\alice\\private"); },
  });
  assert.equal(result.classification, "spawn_failed");
  assert.doesNotMatch(result.summary, /secret|alice|token/i);
});

test("P5 skips installer spawn when the target is already present", async () => {
  const plan = createApplicationInstallPlan({ name: "codex" }, { device: device("windows") });
  const observed = [];
  const result = await runApprovedApplicationInstall({
    plan,
    platform: "win32",
    spawnProcess: (command, args, options) => {
      observed.push({ command, args, options });
      const child = fakeChild();
      queueMicrotask(() => child.emit("close", 0));
      return child;
    },
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.classification, "already_installed");
  assert.equal(observed.length, 1);
  assert.equal(observed[0].command, "codex");
  assert.deepEqual(observed[0].args, ["--version"]);
  assert.equal(observed[0].options.shell, false);
});

test("P5 git-bash pre-install probe accepts a Git-for-Windows fallback", async () => {
  const plan = createApplicationInstallPlan({ name: "git-bash" }, { device: device("windows") });
  const observed = [];
  const result = await runApprovedApplicationInstall({
    plan,
    platform: "win32",
    spawnProcess: (command, args) => {
      observed.push({ command, args });
      if (command === "winget") throw new Error("installer should be skipped");
      const child = fakeChild();
      queueMicrotask(() => child.emit("close", command === "git" ? 0 : 1));
      return child;
    },
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.classification, "already_installed");
  assert.deepEqual(observed.map((item) => item.command), [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    "git",
  ]);
  assert.deepEqual(observed.at(-1).args, ["--version"]);
});

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  return child;
}

// --- #994 / ADR 0015: the Linux elevation broker ---

test("adr0015: the mirrored Linux git plan spawns through pkexec with the exact wrapped argv", () => {
  setPolkitProbeForTests(() => true);
  try {
    const plan = createApplicationInstallPlan({ name: "git" }, { device: { id: "dev_linux", name: "linux device", platform: "linux", architecture: "x64" }, now: () => "2026-07-14T09:00:00.000Z" });
    const spawnPlan = resolveApplicationInstallSpawnPlan(plan, { platform: "linux", now: () => Date.parse("2026-07-14T09:01:00.000Z") });
    assert.ok(spawnPlan && !spawnPlan.refusal, "the mirrored elevated plan is accepted");
    assert.equal(spawnPlan.command, "/usr/bin/pkexec");
    assert.deepEqual(spawnPlan.args, ["apt-get", "install", "--yes", "git"], "pkexec wraps exactly the mirrored argv");
    assert.equal(spawnPlan.elevated, true);
    assert.equal(spawnPlan.elevation.mechanism, "polkit-pkexec");
  } finally {
    setPolkitProbeForTests(null);
  }
});

test("adr0015: polkit absent -> a coded pre-privilege refusal, never an opaque spawn failure", async () => {
  setPolkitProbeForTests(() => false);
  try {
    const plan = createApplicationInstallPlan({ name: "git" }, { device: { id: "dev_linux", name: "linux device", platform: "linux", architecture: "x64" }, now: () => "2026-07-14T09:00:00.000Z" });
    const result = await runApprovedApplicationInstall({
      plan,
      platform: "linux",
      now: () => Date.parse("2026-07-14T09:01:00.000Z"),
      preInstallProbe: false,
      spawnProcess: () => { throw new Error("must never spawn without polkit"); },
    });
    assert.equal(result.status, "refused");
    assert.equal(result.classification, "elevation_unavailable");
    assert.match(result.summary, /pkexec/);
  } finally {
    setPolkitProbeForTests(null);
  }
});

test("adr0015: elevation expectations are exact in BOTH directions", () => {
  setPolkitProbeForTests(() => true);
  try {
    const linuxDevice = { id: "dev_linux", name: "linux device", platform: "linux", architecture: "x64" };
    const winDevice = { id: "dev_windows", name: "windows device", platform: "windows", architecture: "x64" };
    const fixedNow = () => "2026-07-14T09:00:00.000Z";
    const resolveAt = { now: () => Date.parse("2026-07-14T09:01:00.000Z") };

    // A de-elevated Linux git plan (tampered) is refused.
    const linuxPlan = createApplicationInstallPlan({ name: "git" }, { device: linuxDevice, now: fixedNow });
    assert.equal(resolveApplicationInstallSpawnPlan({ ...linuxPlan, execution: { ...linuxPlan.execution, elevated: false } }, { platform: "linux", ...resolveAt }), null);

    // An elevated plan for an unelevated recipe (windows git) is refused.
    const winPlan = createApplicationInstallPlan({ name: "git" }, { device: winDevice, now: fixedNow });
    assert.equal(resolveApplicationInstallSpawnPlan({ ...winPlan, execution: { ...winPlan.execution, elevated: true } }, { platform: "windows", ...resolveAt }), null);

    // The untampered windows plan still resolves unelevated.
    const winSpawn = resolveApplicationInstallSpawnPlan(winPlan, { platform: "windows", ...resolveAt });
    assert.ok(winSpawn && !winSpawn.refusal);
    assert.equal(winSpawn.elevated, false);
    assert.equal(winSpawn.command, "winget");
  } finally {
    setPolkitProbeForTests(null);
  }
});

test("adr0015: every outcome of an elevated run is audited as elevated", async () => {
  setPolkitProbeForTests(() => true);
  try {
    const plan = createApplicationInstallPlan({ name: "git" }, { device: { id: "dev_linux", name: "linux device", platform: "linux", architecture: "x64" }, now: () => "2026-07-14T09:00:00.000Z" });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    const result = await (async () => {
      const promise = runApprovedApplicationInstall({
        plan,
        platform: "linux",
        now: () => Date.parse("2026-07-14T09:01:00.000Z"),
        preInstallProbe: false,
        spawnProcess: (command, args) => {
          assert.equal(command, "/usr/bin/pkexec");
          assert.equal(args[0], "apt-get");
          queueMicrotask(() => child.emit("close", 1)); // provider failed (installer listens on "close")
          return child;
        },
      });
      return promise;
    })();
    assert.equal(result.elevated, true, "the failure is audited AS elevated");
    assert.equal(result.elevation.mechanism, "polkit-pkexec");
    assert.equal(result.elevation.wrappedExecutable, "apt-get");
    assert.notEqual(result.status, "succeeded");
  } finally {
    setPolkitProbeForTests(null);
  }
});
