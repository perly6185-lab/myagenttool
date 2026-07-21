/*
 * Stage 5 (#1342/#1459): a governed local REPAIR re-verifies an Application in
 * place, and no lifecycle operation touches the backing Runtime — repair and
 * archive keep runtimeRequirements intact, and uninstall is not supported anywhere.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createApplicationService } from "../src/services/applications.mjs";
import { createCcusageApplicationRegistration } from "../src/services/ccusage-application.mjs";
import { createApplicationInstallPlan } from "../src/services/application-install-plans.mjs";

function service() {
  return createApplicationService({
    state: { applications: [] },
    now: () => "2026-07-21T00:00:00.000Z",
    nextId: (p) => `${p}_x`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    addProject: () => null,
    cloneProject: () => null,
    defaultProjectPath: "/tmp/repo",
  });
}

function registerCcusage(svc) {
  return svc.registerApplication({
    ...createCcusageApplicationRegistration(),
    runtimeRequirements: [{ runtimeId: "runtime_ccusage", required: true }],
  });
}

test("repair re-verifies in place: re-probes, re-enables, records the op, keeps the Runtime requirement", () => {
  const svc = service();
  const app = registerCcusage(svc);

  const repaired = svc.repairApplication(app.id);
  assert.equal(repaired.status, "active", "repair re-enables the Application");
  assert.equal(repaired.lifecycle.lastOperation, "repair");
  assert.equal(repaired.probe.status, "completed", "repair re-probes the descriptor");
  // The backing Runtime requirement is left untouched — never removed or replaced.
  assert.deepEqual(repaired.runtimeRequirements, [{ runtimeId: "runtime_ccusage", required: true }]);
});

test("repair never removes the Application and is idempotent", () => {
  const svc = service();
  const app = registerCcusage(svc);
  svc.repairApplication(app.id);
  const again = svc.repairApplication(app.id);
  assert.equal(again.id, app.id);
  assert.deepEqual(again.runtimeRequirements, [{ runtimeId: "runtime_ccusage", required: true }]);
  assert.equal(svc.repairApplication("app_missing"), null); // unknown app is a no-op, not a throw
});

test("archiving an Application keeps its Runtime requirement (removal ≠ uninstall)", () => {
  const svc = service();
  const app = registerCcusage(svc);
  const archived = svc.transitionApplication(app.id, "archive");
  assert.equal(archived.status, "archived");
  assert.deepEqual(archived.runtimeRequirements, [{ runtimeId: "runtime_ccusage", required: true }], "archive never touches the Runtime");
  // Repairing an archived app re-probes but respects the archive (does not silently re-enable).
  const repaired = svc.repairApplication(app.id);
  assert.equal(repaired.status, "archived");
  assert.equal(repaired.lifecycle.lastOperation, "repair");
});

test("Runtime uninstall is structurally unsupported — no lifecycle path can uninstall", () => {
  const plan = createApplicationInstallPlan(
    { name: "ccusage", deviceId: "dev_x", projectId: "proj_a" },
    { device: { id: "dev_x", name: "d", platform: "linux", architecture: "x64" }, projectId: "proj_a", now: () => "2026-07-14T09:00:00.000Z" },
  );
  assert.equal(plan.rollback.uninstallSupported, false, "install plans never offer an uninstall");
});
