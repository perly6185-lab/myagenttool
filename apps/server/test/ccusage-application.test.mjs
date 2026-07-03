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

function service() {
  const state = { applications: [] };
  return createApplicationService({
    state,
    now: () => "2026-07-03T00:00:00.000Z",
    nextId: (p) => `${p}_x`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    addProject: () => null,
    cloneProject: () => null,
    defaultProjectPath: "/tmp/repo",
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
  }
});

test("re-registration is idempotent (same source, same id)", () => {
  const svc = service();
  const first = svc.registerApplication(createCcusageApplicationRegistration());
  const second = svc.registerApplication(createCcusageApplicationRegistration());
  assert.equal(first.id, second.id);
  assert.equal(svc.listApplications().length, 1);
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
