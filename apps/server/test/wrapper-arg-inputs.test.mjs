/*
 * #355 full-unification Slice 1: wrapper capabilities accept validated
 * per-invocation flag inputs (e.g. ccusage since/until/timezone/offline) that map
 * to appended args. Only DECLARED inputs with a passing type validator become
 * args — execution stays an allowlist; undeclared or flag-shaped values never leak.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createApplicationService, applicationWrapperExecutionPlan } from "../src/services/applications.mjs";

function appWithArgInputs() {
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
  return svc.registerApplication({
    id: "app_rep",
    name: "rep",
    autoOnline: false,
    source: {
      type: "npm",
      package: "rep",
      version: "1.0.0",
      wrapper: {
        mode: "installed-wrapper",
        commands: [{
          id: "daily",
          command: "rep",
          args: ["daily", "--json"],
          status: "approved",
          argInputs: [
            { key: "since", flag: "--since", type: "date" },
            { key: "timezone", flag: "--timezone", type: "token" },
            { key: "offline", flag: "--offline", type: "boolean-flag" },
            { key: "mode", flag: "--mode", type: "enum", values: ["fast", "full"] },
          ],
        }],
      },
    },
  });
}

test("appends declared, validated inputs as flag+value (and boolean as a bare flag)", () => {
  const app = appWithArgInputs();
  const plan = applicationWrapperExecutionPlan(app, "daily", { since: "2026-07-01", offline: true, mode: "fast" });
  assert.deepEqual(plan.args, ["daily", "--json", "--since", "2026-07-01", "--offline", "--mode", "fast"]);
});

test("base args are unchanged when no inputs are supplied", () => {
  const app = appWithArgInputs();
  assert.deepEqual(applicationWrapperExecutionPlan(app, "daily", {}).args, ["daily", "--json"]);
});

test("rejects invalid values and undeclared keys (allowlist)", () => {
  const app = appWithArgInputs();
  const plan = applicationWrapperExecutionPlan(app, "daily", {
    since: "not-a-date",      // fails date validator → skipped
    mode: "sneaky",          // not in enum → skipped
    evil: "rm -rf /",         // undeclared → ignored
    timezone: "America/Sao_Paulo",
  });
  assert.deepEqual(plan.args, ["daily", "--json", "--timezone", "America/Sao_Paulo"]);
});

test("a value that looks like a flag can never inject an option", () => {
  const app = appWithArgInputs();
  const plan = applicationWrapperExecutionPlan(app, "daily", { timezone: "--dangerously" });
  assert.deepEqual(plan.args, ["daily", "--json"]); // leading "-" refused
});

test("reserved control-plane input keys cannot become wrapper argv", () => {
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
  assert.throws(() => svc.registerApplication({
    id: "app_bad",
    name: "bad",
    autoOnline: false,
    source: {
      type: "npm",
      package: "bad",
      version: "1.0.0",
      wrapper: {
        mode: "installed-wrapper",
        commands: [{
          id: "run",
          command: "bad",
          args: ["run"],
          status: "approved",
          argInputs: [{ key: "approvalToken", flag: "--token", type: "token" }],
        }],
      },
    },
  }), /reserved control-plane key/);
});
