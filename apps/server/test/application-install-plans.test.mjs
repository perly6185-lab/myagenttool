import assert from "node:assert/strict";
import { test } from "node:test";
import { applicationInstallPlanMatchesCurrent, createApplicationInstallPlan, listApplicationInstallCatalog } from "../src/services/application-install-plans.mjs";

const device = (platform, architecture = "x64") => ({ id: `dev_${platform}`, name: `${platform} device`, platform, architecture });
const fixedNow = () => "2026-07-14T09:00:00.000Z";
const supported = {
  windows: ["git", "git-bash", "wsl", "ccusage", "claude", "codex", "excalidraw-cli"],
  macos: ["git", "ccusage", "claude", "codex", "excalidraw-cli"],
  linux: ["git", "ccusage", "claude", "codex", "excalidraw-cli"],
};

test("P1 catalog exposes only supported applications and safe policy metadata", () => {
  const catalog = listApplicationInstallCatalog();
  assert.deepEqual(catalog.map((entry) => entry.name), ["git", "git-bash", "wsl", "ccusage", "claude", "codex", "excalidraw-cli"]);
  assert.ok(catalog.every((entry) => entry.approvalRequired));
  assert.deepEqual(catalog.find((entry) => entry.name === "git").supportedPlatforms, ["windows", "macos", "linux"]);
  assert.deepEqual(catalog.find((entry) => entry.name === "git-bash").supportedPlatforms, ["windows"]);
  assert.deepEqual(catalog.find((entry) => entry.name === "wsl").supportedPlatforms, ["windows"]);
  assert.ok(!JSON.stringify(catalog).includes("argv"));
});

for (const platform of ["windows", "macos", "linux"]) {
  for (const name of supported[platform]) {
    test(`P1 creates an immutable ${platform} plan for ${name}`, () => {
      const target = device(platform);
      const first = createApplicationInstallPlan({ name, deviceId: target.id, projectId: "proj_a" }, { device: target, projectId: "proj_a", now: fixedNow });
      const second = createApplicationInstallPlan({ name, deviceId: target.id, projectId: "proj_a" }, { device: target, projectId: "proj_a", now: fixedNow });
      assert.equal(first.planId, second.planId);
      assert.equal(first.fingerprint, second.fingerprint);
      assert.equal(first.execution.shell, false);
      assert.ok(Array.isArray(first.execution.args));
      assert.equal(first.approval.required, true);
      assert.equal(first.policy.cancellable, true);
      assert.equal(applicationInstallPlanMatchesCurrent(first, { device: target, projectId: "proj_a", now: fixedNow }), true);
      assert.equal(applicationInstallPlanMatchesCurrent({ fingerprint: first.fingerprint, ...first }, { device: target, projectId: "proj_a", now: fixedNow }), true);
      assert.equal(applicationInstallPlanMatchesCurrent({ ...first, fingerprint: "modified" }, { device: target, projectId: "proj_a", now: fixedNow }), false);
    });
  }
}

test("P4 pins npm packages and registry without latest aliases", () => {
  for (const name of ["ccusage", "claude", "codex"]) {
    const plan = createApplicationInstallPlan({ name }, { device: device("linux"), now: fixedNow });
    assert.equal(plan.package.versionPolicy.kind, "exact");
    assert.equal(plan.package.source.registry, "https://registry.npmjs.org/");
    assert.doesNotMatch(plan.package.resolvedIdentifier, /@latest$/);
    assert.ok(plan.execution.args.includes(`--registry=${plan.package.source.registry}`));
  }
});

test("P5 plans Windows shell prerequisites without treating caller input as command text", () => {
  const gitBash = createApplicationInstallPlan({ name: "git-bash" }, { device: device("windows"), now: fixedNow });
  assert.equal(gitBash.package.identifier, "Git.Git");
  assert.equal(gitBash.execution.executable, "winget");
  assert.equal(gitBash.postInstallProbe.executable, "C:\\Program Files\\Git\\bin\\bash.exe");
  assert.ok(gitBash.postInstallProbe.candidates.some((candidate) => candidate.executable === "git"));
  assert.ok(gitBash.risk.reasons.includes("adds_shell_runtime"));

  const wsl = createApplicationInstallPlan({ name: "wsl" }, { device: device("windows"), now: fixedNow });
  assert.equal(wsl.execution.executable, "wsl.exe");
  assert.deepEqual(wsl.execution.args, ["--install", "--no-launch"]);
  assert.deepEqual(wsl.postInstallProbe.args, ["--status"]);
  assert.equal(wsl.risk.level, "high");
  assert.ok(wsl.risk.reasons.includes("may_require_reboot"));
});

test("P4 rejects expired plans; Linux Git now plans as an ELEVATED apt-get install (#994/ADR 0015)", () => {
  const target = device("windows");
  const plan = createApplicationInstallPlan({ name: "git" }, { device: target, now: fixedNow });
  assert.equal(applicationInstallPlanMatchesCurrent(plan, { device: target, now: () => "2026-07-14T09:10:00.000Z" }), true);
  assert.equal(applicationInstallPlanMatchesCurrent(plan, { device: target, now: () => "2026-07-14T09:10:00.001Z" }), false);
  // ADR 0015 slice 1: the Linux git plan exists, records the REAL command
  // (pkexec is the bridge's business), and is honest about elevation + risk.
  const linuxPlan = createApplicationInstallPlan({ name: "git" }, { device: device("linux"), now: fixedNow });
  assert.equal(linuxPlan.execution.executable, "apt-get");
  assert.deepEqual(linuxPlan.execution.args, ["install", "--yes", "git"]);
  assert.equal(linuxPlan.execution.elevated, true);
  assert.equal(linuxPlan.risk.level, "high");
  assert.ok(linuxPlan.risk.reasons.includes("requires_elevation"));
  assert.equal(linuxPlan.package.versionPolicy.kind, "provider-managed", "apt cannot pin portably — explicit decision, like Homebrew");
  // Every other platform stays unelevated.
  assert.equal(plan.execution.elevated, false);
});

test("P1 rejects unknown applications, unsupported platforms, and target mismatch", () => {
  assert.throws(() => createApplicationInstallPlan({ name: "unknown" }, { device: device("windows") }), { code: "known_application_not_supported" });
  assert.throws(() => createApplicationInstallPlan({ name: "git" }, { device: device("freebsd") }), { code: "install_platform_not_supported" });
  assert.throws(() => createApplicationInstallPlan({ name: "git", platform: "linux" }, { device: device("windows") }), { code: "install_plan_target_mismatch" });
});

test("P1 rejects caller-controlled execution and version fields", () => {
  for (const field of ["command", "executable", "args", "argv", "version", "package", "provider", "planId", "fingerprint"]) {
    assert.throws(
      () => createApplicationInstallPlan({ name: "git", [field]: field === "args" || field === "argv" ? ["evil"] : "evil" }, { device: device("windows") }),
      { code: "install_plan_fields_not_allowed" },
    );
  }
});

test("P1 public plan contains no secrets or internal wrapper paths", () => {
  const plan = createApplicationInstallPlan({ name: "ccusage" }, { device: device("windows") });
  const serialized = JSON.stringify(plan);
  assert.doesNotMatch(serialized, /token|secret|credential|wrapper/i);
  assert.doesNotMatch(serialized, /[A-Z]:\\|\/Users\/|\/home\//);
});
