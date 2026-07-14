/*
 * Phase 1 of ADR 0007 / #355: ccusage registers as an npm-source Application and
 * projects its six reports as governed npm-wrapper capabilities. Descriptor-only
 * slice — this asserts the canonical spec is a valid registration that the
 * Application service accepts and projects, without touching the tool/agent path.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createApplicationService } from "../src/services/applications.mjs";
import {
  CCUSAGE_APPLICATION_ID,
  CCUSAGE_DEFAULT_VERSION,
  CCUSAGE_REPORT_WRAPPERS,
  createCcusageApplicationRegistration,
} from "../src/services/ccusage-application.mjs";

function service(state = { applications: [] }, overrides = {}) {
  return createApplicationService({
    state,
    now: () => "2026-07-03T00:00:00.000Z",
    nextId: (p) => `${p}_x`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    addProject: () => null,
    cloneProject: () => null,
    defaultProjectPath: "/tmp/repo",
    ...overrides,
  });
}

test("ccusage registers as a pinned npm-source application", () => {
  const { registerApplication, findApplication } = service();
  const app = registerApplication(createCcusageApplicationRegistration());
  assert.equal(app.id, CCUSAGE_APPLICATION_ID);
  assert.equal(app.source.type, "npm");
  assert.equal(app.source.package, "ccusage");
  assert.equal(app.source.version, CCUSAGE_DEFAULT_VERSION); // pinned, not "latest"
  assert.equal(app.source.wrapper.mode, "installed-wrapper");
  assert.equal(app.source.wrapper.commands.length, CCUSAGE_REPORT_WRAPPERS.length);
  assert.ok(findApplication(CCUSAGE_APPLICATION_ID));
});

test("projects all six reports as read-only, low-risk npm-wrapper capabilities", () => {
  const { registerApplication, listApplicationCapabilities } = service();
  registerApplication(createCcusageApplicationRegistration());
  const caps = listApplicationCapabilities(CCUSAGE_APPLICATION_ID);
  const wrapperCaps = caps.filter((c) => c.name.includes(".wrapper."));
  assert.equal(wrapperCaps.length, 6);
  for (const report of CCUSAGE_REPORT_WRAPPERS) {
    const cap = wrapperCaps.find((c) => c.name === `app.app_ccusage.wrapper.${report.id}`);
    assert.ok(cap, `expected capability for ${report.id}`);
    assert.equal(cap.riskLevel, "low");
    assert.equal(cap.metadata.readiness.state, "needs_setup");
    assert.equal(cap.metadata.readiness.executionMode, "bridge_wrapper");
    assert.equal(cap.metadata.resultPath.outputCollection, "importedUsageEstimates");
    assert.equal(cap.metadata.resultPath.evidenceCenter, true);
    assert.equal(cap.metadata.execution.agentId, "agt_platform_application_wrapper");
    assert.equal(cap.metadata.compatibilityFacade.name, "ccusage.report");
    assert.equal(cap.metadata.outputCollection, "importedUsageEstimates");
    assert.equal(cap.metadata.billing.authoritative, false);
    assert.equal(cap.metadata.billing.externalBilled, true);
    assert.equal(cap.metadata.resultImport.source, "ccusage");
    assert.equal(cap.metadata.resultImport.amountSource, "imported_ccusage_report");
  }
});

test("ccusage capabilities accept the tool's date/timezone filters (offline baked in)", async () => {
  const { registerApplication } = service();
  const app = registerApplication(createCcusageApplicationRegistration());
  const { applicationWrapperExecutionPlan } = await import("../src/services/applications.mjs");
  const plan = applicationWrapperExecutionPlan(app, "daily", { since: "2026-07-01", until: "2026-07-02", timezone: "UTC" });
  assert.deepEqual(plan.args, ["daily", "--json", "--offline", "--since", "2026-07-01", "--until", "2026-07-02", "--timezone", "UTC"]);
  // An invalid date is refused, not passed through.
  const bad = applicationWrapperExecutionPlan(app, "daily", { since: "nope" });
  assert.deepEqual(bad.args, ["daily", "--json", "--offline"]);
});

test("re-registration is idempotent (same source, same id)", () => {
  const svc = service();
  const first = svc.registerApplication(createCcusageApplicationRegistration());
  const second = svc.registerApplication(createCcusageApplicationRegistration());
  assert.equal(first.id, second.id);
  assert.equal(svc.listApplications().length, 1);
  assert.match(first.descriptorFingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.equal(first.descriptorRevision, 1);
});

test("an identical re-registration with autoOnline enables a registered Application", () => {
  const svc = service();
  const first = svc.registerApplication(createCcusageApplicationRegistration({ autoOnline: false }));
  assert.equal(first.status, "registered");
  const enabled = svc.registerApplication(createCcusageApplicationRegistration({ autoOnline: true }));
  assert.equal(enabled.id, first.id);
  assert.equal(enabled.status, "active");
  assert.equal(enabled.lifecycle.lastOperation, "online");
  assert.equal(svc.listApplications().length, 1);
});

test("changed descriptors require explicit immutable replacement and preserve lineage", () => {
  const svc = service();
  const first = svc.registerApplication(createCcusageApplicationRegistration());
  const changed = createCcusageApplicationRegistration();
  changed.name = "ccusage Reports v2";
  changed.source.version = "99.0.0";
  assert.throws(() => svc.registerApplication(changed), /immutable revision/);

  const second = svc.registerApplication({ ...changed, id: "app_ccusage_v2", replacesApplicationId: first.id });
  assert.equal(second.descriptorRevision, 2);
  assert.equal(second.predecessorApplicationId, first.id);
  assert.equal(first.successorApplicationId, second.id);
  assert.equal(first.status, "offline");
  assert.notEqual(first.descriptorFingerprint, second.descriptorFingerprint);
  assert.equal(second.source.version, "99.0.0");
  assert.deepEqual(first.orchestrationIds, []);
});

test("unsupported descriptor schema versions are refused explicitly", () => {
  const svc = service();
  assert.throws(
    () => svc.registerApplication({ ...createCcusageApplicationRegistration(), descriptorSchemaVersion: 2 }),
    /Unsupported Application descriptor schema version/,
  );
});

test("foreign replacement targets are indistinguishable from missing targets", () => {
  const svc = service();
  const first = svc.registerApplication(createCcusageApplicationRegistration(), { teamId: "team_a", userId: "usr_a" });
  const changed = createCcusageApplicationRegistration({ version: "99.0.0" });
  assert.throws(
    () => svc.registerApplication({ ...changed, id: "app_ccusage_v2", replacesApplicationId: first.id }, { teamId: "team_b", userId: "usr_b" }),
    (error) => error?.code === "application_replacement_target_not_found",
  );
});

test("a Git descriptor replacement cannot silently change the checked-out ref", async () => {
  const svc = service({ applications: [] }, {
    cloneProject: async () => ({ id: "prj_git", path: "/tmp/repo" }),
  });
  const first = svc.registerApplication({
    id: "app_repo",
    name: "Repo",
    autoOnline: false,
    source: { type: "git", url: "https://github.com/example/repo.git", ref: "main" },
  });
  assert.throws(
    () => svc.registerApplication({
      id: "app_repo_release",
      name: "Repo",
      autoOnline: false,
      replacesApplicationId: first.id,
      source: { type: "git", url: "https://github.com/example/repo.git", ref: "release" },
    }),
    (error) => error?.code === "application_replacement_identity_mismatch",
  );
  await Promise.resolve();
});

test("does not touch project records (npm source creates no project)", () => {
  let addCalls = 0;
  const state = { applications: [] };
  const svc = createApplicationService({
    state,
    now: () => "2026-07-03T00:00:00.000Z",
    nextId: (p) => `${p}_x`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    addProject: () => { addCalls += 1; return null; },
    cloneProject: () => { addCalls += 1; return null; },
    defaultProjectPath: "/tmp/repo",
  });
  const app = svc.registerApplication(createCcusageApplicationRegistration());
  assert.equal(addCalls, 0);
  assert.equal(app.projectId, null);
});
