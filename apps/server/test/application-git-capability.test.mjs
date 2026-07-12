/*
 * #776: register app_git and project the read-only git capability set. Every
 * command is flags-only, so this asserts the EXACT planned argv per capability,
 * the validated log inputs, and the refusal paths (unknown command / offline /
 * archived). Positional revs are #777.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createApplicationService,
  projectApplicationCapabilities,
  applicationWrapperExecutionPlan,
} from "../src/services/applications.mjs";
import { createGitApplicationRegistration, GIT_APPLICATION_ID } from "../src/services/git-application.mjs";

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

const EXPECTED_ARGV = {
  status: ["--no-pager", "status", "--porcelain=v2", "--branch"],
  log: ["--no-pager", "log", "--format=%H%x1f%an%x1f%aI%x1f%s%x1e", "--max-count=50"],
  diff_stat: ["--no-pager", "diff", "--stat", "--no-color"],
  branch_list: ["--no-pager", "branch", "--list", "--format=%(refname:short)%x1f%(objectname)"],
  head: ["--no-pager", "rev-parse", "HEAD"],
};

test("registering app_git projects its read-only capability set (kind binary_wrapper)", () => {
  const app = service().registerApplication(createGitApplicationRegistration());
  assert.equal(app.id, GIT_APPLICATION_ID);
  const caps = projectApplicationCapabilities(app).filter((c) => String(c.name).includes(".wrapper."));
  assert.equal(caps.length, 7); // 5 read-only + show/diff_ref (#777)
  for (const cap of caps) {
    assert.equal(cap.kind, "binary_wrapper");
    assert.equal(cap.riskLevel, "low");
    assert.deepEqual(cap.riskTags, ["local_execution", "binary_wrapper", "vcs", "read-only"]);
    assert.equal(cap.requiresApproval, false);
    assert.equal(cap.metadata.wrapper.filePolicy, "read_only");
    assert.equal(cap.metadata.wrapper.networkPolicy, "forbidden");
  }
});

test("each capability plans its EXACT argv, cwd:null (invocation_root), command git", () => {
  const app = service().registerApplication(createGitApplicationRegistration());
  for (const [id, argv] of Object.entries(EXPECTED_ARGV)) {
    const plan = applicationWrapperExecutionPlan(app, id);
    assert.ok(plan, `${id} must plan`);
    assert.equal(plan.command, "git");
    assert.deepEqual(plan.args, argv, `${id} argv`);
    assert.equal(plan.cwd, null, `${id} cwd is null`);
    assert.equal(plan.cwdPolicy, "invocation_root");
    assert.equal(plan.filePolicy, "read_only");
    assert.equal(plan.networkPolicy, "forbidden");
  }
});

test("log appends only validated since/until/author/maxCount flags; invalid values are dropped", () => {
  const app = service().registerApplication(createGitApplicationRegistration());
  const ok = applicationWrapperExecutionPlan(app, "log", {
    since: "2026-01-01",
    author: "octocat",
    maxCount: "10",
  });
  assert.deepEqual(ok.args, [
    ...EXPECTED_ARGV.log,
    "--since", "2026-01-01",
    "--author", "octocat",
    "--max-count", "10",
  ]);
  // Invalid / flag-shaped values never append.
  const dropped = applicationWrapperExecutionPlan(app, "log", {
    since: "not-a-date",
    author: "-evil",
    until: "--upload-pack=/x",
  });
  assert.deepEqual(dropped.args, EXPECTED_ARGV.log, "no invalid input reaches the argv");
});

test("an unknown git command does not plan (→ wrapper_command_not_found upstream)", () => {
  const app = service().registerApplication(createGitApplicationRegistration());
  assert.equal(applicationWrapperExecutionPlan(app, "push"), null);
});

test("planApplicationWrapperInvocation refuses unknown command (404) and offline/archived (409)", () => {
  const state = { applications: [] };
  const svc = service(state);
  svc.registerApplication(createGitApplicationRegistration());

  const unknown = svc.planApplicationWrapperInvocation({ applicationId: GIT_APPLICATION_ID, commandId: "push" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, "wrapper_command_not_found");

  const app = state.applications.find((a) => a.id === GIT_APPLICATION_ID);
  app.status = "offline";
  const offline = svc.planApplicationWrapperInvocation({ applicationId: GIT_APPLICATION_ID, commandId: "status" });
  assert.equal(offline.status, 409);
  assert.equal(offline.body.error, "application_offline");

  app.status = "archived";
  const archived = svc.planApplicationWrapperInvocation({ applicationId: GIT_APPLICATION_ID, commandId: "status" });
  assert.equal(archived.status, 409);
  assert.equal(archived.body.error, "application_archived");
});

test("a read-only git command raises no file/network policy ceiling", () => {
  const app = service().registerApplication(createGitApplicationRegistration());
  for (const id of Object.keys(EXPECTED_ARGV)) {
    const plan = applicationWrapperExecutionPlan(app, id);
    assert.equal(plan.filePolicy, "read_only");
    assert.equal(plan.networkPolicy, "forbidden");
  }
});

test("registration, capabilities, and argv survive a state serialize/restore round-trip", () => {
  const state = { applications: [] };
  service(state).registerApplication(createGitApplicationRegistration());
  const restored = JSON.parse(JSON.stringify(state));
  const app = restored.applications.find((a) => a.id === GIT_APPLICATION_ID);
  assert.equal(app.source.type, "binary");
  assert.equal(app.source.binary, "git");
  const caps = projectApplicationCapabilities(app).filter((c) => String(c.name).includes(".wrapper."));
  assert.equal(caps.length, 7);
  assert.deepEqual(applicationWrapperExecutionPlan(app, "status").args, EXPECTED_ARGV.status);
});
