import assert from "node:assert/strict";
import { test } from "node:test";
import { applicationInstallPlanMatchesCurrent, createApplicationInstallPlan, listApplicationInstallCatalog } from "../src/services/application-install-plans.mjs";

const device = (platform, architecture = "x64") => ({ id: `dev_${platform}`, name: `${platform} device`, platform, architecture });
const fixedNow = () => "2026-07-14T09:00:00.000Z";
const supported = {
  windows: ["git", "ccusage", "claude"],
  macos: ["git", "ccusage", "claude"],
  linux: ["ccusage", "claude"],
};

test("P1 catalog exposes only supported applications and safe policy metadata", () => {
  const catalog = listApplicationInstallCatalog();
  assert.deepEqual(catalog.map((entry) => entry.name), ["git", "ccusage", "claude"]);
  assert.ok(catalog.every((entry) => entry.approvalRequired));
  assert.deepEqual(catalog.find((entry) => entry.name === "git").supportedPlatforms, ["windows", "macos"]);
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
  for (const name of ["ccusage", "claude"]) {
    const plan = createApplicationInstallPlan({ name }, { device: device("linux"), now: fixedNow });
    assert.equal(plan.package.versionPolicy.kind, "exact");
    assert.equal(plan.package.source.registry, "https://registry.npmjs.org/");
    assert.doesNotMatch(plan.package.resolvedIdentifier, /@latest$/);
    assert.ok(plan.execution.args.includes(`--registry=${plan.package.source.registry}`));
  }
});

test("P4 rejects expired plans and Linux Git without an elevation broker", () => {
  const target = device("windows");
  const plan = createApplicationInstallPlan({ name: "git" }, { device: target, now: fixedNow });
  assert.equal(applicationInstallPlanMatchesCurrent(plan, { device: target, now: () => "2026-07-14T09:10:00.000Z" }), true);
  assert.equal(applicationInstallPlanMatchesCurrent(plan, { device: target, now: () => "2026-07-14T09:10:00.001Z" }), false);
  assert.throws(() => createApplicationInstallPlan({ name: "git" }, { device: device("linux"), now: fixedNow }), { code: "install_platform_not_supported" });
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
