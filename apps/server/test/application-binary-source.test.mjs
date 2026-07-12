/*
 * #774: decouple the wrapper descriptor from npm sources. A `binary` source
 * (a bare program name like `git`) may carry an installed-wrapper and project
 * executable capabilities (kind `binary_wrapper`). ccusage's npm projection stays
 * BYTE-IDENTICAL — the guard now keys on the wrapper mode, not the source type.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createApplicationService,
  projectApplicationCapabilities,
  applicationWrapperExecutionPlan,
} from "../src/services/applications.mjs";
import { createCcusageApplicationRegistration } from "../src/services/ccusage-application.mjs";

function service(state = { applications: [] }) {
  return createApplicationService({
    state,
    now: () => "2026-07-12T00:00:00.000Z",
    nextId: (p) => `${p}_x`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    addProject: () => null,
    cloneProject: () => null,
    defaultProjectPath: "/tmp/repo",
  });
}

function binaryReg(over = {}) {
  return {
    id: "app_gitdemo",
    name: "gitdemo",
    source: {
      type: "binary",
      binary: "git",
      wrapper: {
        mode: "installed-wrapper",
        commands: [
          { id: "status", command: "git", args: ["--no-pager", "status"], status: "approved", riskLevel: "low", riskTags: ["vcs", "read-only"], requiresApproval: false, filePolicy: "read_only", networkPolicy: "forbidden", cwdPolicy: "invocation_root" },
          { id: "wip", command: "git", args: ["--no-pager", "log"], status: "draft" },
        ],
      },
    },
    ...over,
  };
}

test("a binary source with an installed-wrapper projects its approved commands as binary_wrapper capabilities", () => {
  const app = service().registerApplication(binaryReg());
  const caps = projectApplicationCapabilities(app).filter((c) => String(c.name).includes(".wrapper."));
  assert.equal(caps.length, 1, "only the approved command projects");
  const status = caps[0];
  assert.equal(status.name, "app.app_gitdemo.wrapper.status");
  assert.equal(status.kind, "binary_wrapper");
  assert.deepEqual(status.riskTags, ["local_execution", "binary_wrapper", "vcs", "read-only"]);
  assert.equal(status.metadata.readiness.reason, "system_binary");
  assert.equal(status.metadata.readiness.executionMode, "bridge_wrapper");
});

test("a draft command stays non-invokable (as today)", () => {
  const app = service().registerApplication(binaryReg());
  const names = projectApplicationCapabilities(app).map((c) => c.name);
  assert.ok(!names.includes("app.app_gitdemo.wrapper.wip"), "draft command is not projected");
});

test("a binary source naming a PATH (not a bare program) is rejected at registration", () => {
  const svc = service();
  for (const bad of ["/usr/bin/git", "../git", "git;rm", "git rm", "GIT", "./git", "sub/git"]) {
    assert.throws(
      () => svc.registerApplication(binaryReg({ source: { type: "binary", binary: bad, wrapper: { mode: "installed-wrapper", commands: [] } } })),
      /bare program name/,
      `expected "${bad}" to be rejected`,
    );
  }
});

test("a binary wrapper command plans its argv + cwd (invocation_root) through the same allowlist", () => {
  const app = service().registerApplication(binaryReg());
  const plan = applicationWrapperExecutionPlan(app, "status");
  assert.equal(plan.command, "git");
  assert.deepEqual(plan.args, ["--no-pager", "status"]);
  assert.equal(plan.cwd, null, "invocation_root plans cwd:null");
  assert.equal(plan.cwdPolicy, "invocation_root");
});

test("a bin command's riskLevel defaults to high, and is respected when set explicitly", () => {
  const app = service().registerApplication({
    id: "app_bins",
    name: "bins",
    source: {
      type: "binary",
      binary: "git",
      wrapper: {
        mode: "installed-wrapper",
        commands: [
          { id: "defaulted", command: "git", commandType: "bin", args: ["--version"], status: "approved" },
          { id: "explicit", command: "git", commandType: "bin", args: ["--version"], status: "approved", riskLevel: "low" },
        ],
      },
    },
  });
  const cmds = app.source.wrapper.commands;
  assert.equal(cmds.find((c) => c.id === "defaulted").riskLevel, "high", "bin default is high");
  assert.equal(cmds.find((c) => c.id === "explicit").riskLevel, "low");
});

test("ccusage's projected npm_wrapper capability is BYTE-IDENTICAL (fixture, not by eye)", () => {
  const app = service().registerApplication(createCcusageApplicationRegistration());
  const daily = projectApplicationCapabilities(app).find((c) => c.name === "app.app_ccusage.wrapper.daily");
  assert.deepEqual(daily, {
    name: "app.app_ccusage.wrapper.daily",
    version: "1",
    displayName: "ccusage Daily Report",
    description: "ccusage Daily Report for ccusage.",
    provider: { type: "application", id: "app_ccusage" },
    kind: "npm_wrapper",
    source: "managed",
    riskLevel: "low",
    riskTags: ["local_execution", "npm_wrapper", "usage-report", "read-only"],
    requiresApproval: false,
    invocationMode: "gateway",
    status: "available",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    outputSchema: { structuredResult: true, provider: "application" },
    metadata: {
      readiness: {
        state: "needs_setup",
        reason: "wrapper_not_confirmed_installed",
        applicationStatus: "registered",
        installState: "unknown",
        executionMode: "bridge_wrapper",
      },
      resultPath: {
        outputCollection: "importedUsageEstimates",
        resultImport: { source: "ccusage", kind: "usage_estimates", amountSource: "imported_ccusage_report" },
        evidenceCenter: true,
      },
      wrapper: {
        mode: "installed-wrapper",
        installState: "unknown",
        commandId: "daily",
        commandType: "bin",
        timeoutSeconds: 30,
        cancellation: "best_effort",
        envPolicy: { allow: [], redact: [], inherit: false },
        filePolicy: "read_only",
        networkPolicy: "forbidden",
      },
      compatibilityFacade: { type: "tool", name: "ccusage.report", invocationMode: "tool-facade" },
      execution: { mode: "bridge_wrapper", agentId: "agt_platform_application_wrapper" },
      outputCollection: "importedUsageEstimates",
      billing: { authoritative: false, externalBilled: true, amountSource: "imported_ccusage_report" },
      resultImport: { source: "ccusage", kind: "usage_estimates", amountSource: "imported_ccusage_report" },
    },
  });
});

test("a registered binary source survives a state serialize/restore round-trip", () => {
  const state = { applications: [] };
  service(state).registerApplication(binaryReg());
  // Simulate persistence: JSON round-trip the whole state, then re-project.
  const restored = JSON.parse(JSON.stringify(state));
  const app = restored.applications.find((a) => a.id === "app_gitdemo");
  assert.equal(app.source.type, "binary");
  assert.equal(app.source.binary, "git");
  assert.equal(app.source.wrapper.mode, "installed-wrapper");
  const caps = projectApplicationCapabilities(app).filter((c) => String(c.name).includes(".wrapper."));
  assert.equal(caps.length, 1);
  assert.equal(caps[0].kind, "binary_wrapper");
});
