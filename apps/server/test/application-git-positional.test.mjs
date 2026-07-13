/*
 * #777: positional revision arguments. A rev is the first input that becomes an
 * argv element WITHOUT a --flag in front of it, so the validator is the only
 * thing standing between it and git. Test the refusals before the happy path.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createApplicationService, applicationWrapperExecutionPlan } from "../src/services/applications.mjs";
import { createGitApplicationRegistration } from "../src/services/git-application.mjs";

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

const SHOW_BASE = ["--no-pager", "show", "--stat", "--no-color"];
const DIFF_REF_BASE = ["--no-pager", "diff", "--stat", "--no-color"];

test("show / diff_ref append a valid rev as a trailing positional", () => {
  const app = service().registerApplication(createGitApplicationRegistration());
  assert.deepEqual(applicationWrapperExecutionPlan(app, "show", { rev: "HEAD" }).args, [...SHOW_BASE, "HEAD"]);
  assert.deepEqual(applicationWrapperExecutionPlan(app, "show", { rev: "v1.2.3" }).args, [...SHOW_BASE, "v1.2.3"]);
  assert.deepEqual(applicationWrapperExecutionPlan(app, "show", { rev: "0a1b2c3d4e5f" }).args, [...SHOW_BASE, "0a1b2c3d4e5f"]);
  assert.deepEqual(applicationWrapperExecutionPlan(app, "diff_ref", { rev: "main" }).args, [...DIFF_REF_BASE, "main"]);
  assert.deepEqual(
    applicationWrapperExecutionPlan(app, "show", { rev: "feature/thing-1.2_a" }).args,
    [...SHOW_BASE, "feature/thing-1.2_a"],
  );
});

test("an invalid rev is DROPPED, never appended (refusals before the happy path)", () => {
  const app = service().registerApplication(createGitApplicationRegistration());
  for (const rev of [
    "--upload-pack=/x",   // leading dash / flag-shaped
    "-evil",              // leading dash
    "a..b",               // range — out of scope until explicitly designed
    "../../etc/passwd",   // path traversal (contains ..)
    "a b",                // space
    "a;rm -rf",           // shell metachar
    "a$(x)",              // command substitution
    "a|b",                // pipe
    "HEAD~2",             // ~ excluded by the closed class (no rev arithmetic yet)
    "HEAD^",              // ^ excluded by the closed class
    "a".repeat(101),      // over 100 chars
    "",                   // empty
  ]) {
    const plan = applicationWrapperExecutionPlan(app, "show", { rev });
    assert.deepEqual(plan.args, SHOW_BASE, `rev "${rev}" must be dropped`);
  }
});

test("positionals are appended AFTER all flags, in declaration order", () => {
  // A synthetic command mixing a flag input and a positional input.
  const app = service().registerApplication({
    id: "app_mix",
    name: "mix",
    source: {
      type: "binary",
      binary: "git",
      wrapper: {
        mode: "installed-wrapper",
        commands: [
          {
            id: "mixed",
            command: "git",
            args: ["--no-pager", "log"],
            status: "approved",
            riskLevel: "low",
            requiresApproval: false,
            filePolicy: "read_only",
            networkPolicy: "forbidden",
            argInputs: [
              { key: "author", flag: "--author", type: "token" },
              { key: "rev", positional: true, type: "git-rev" },
            ],
          },
        ],
      },
    },
  });
  const plan = applicationWrapperExecutionPlan(app, "mixed", { rev: "HEAD", author: "octocat" });
  assert.deepEqual(plan.args, ["--no-pager", "log", "--author", "octocat", "HEAD"], "flag first, positional last");
});

test("an argInput cannot be both positional and a --flag", () => {
  const svc = service();
  assert.throws(
    () => svc.registerApplication({
      id: "app_bad",
      name: "bad",
      source: {
        type: "binary",
        binary: "git",
        wrapper: {
          mode: "installed-wrapper",
          commands: [{ id: "x", command: "git", args: ["--no-pager", "show"], status: "approved", argInputs: [{ key: "rev", positional: true, flag: "--rev", type: "git-rev" }] }],
        },
      },
    }),
    /cannot be both positional and a --flag/,
  );
});

test("the read-only git capabilities plan identical argv to before (no positionals declared)", () => {
  const app = service().registerApplication(createGitApplicationRegistration());
  assert.deepEqual(applicationWrapperExecutionPlan(app, "status").args, ["--no-pager", "status", "--porcelain=v2", "--branch"]);
  assert.deepEqual(applicationWrapperExecutionPlan(app, "log").args, ["--no-pager", "log", "-z", "--format=%H%x1f%an%x1f%aI%x1f%s", "--max-count=50"]);
  assert.deepEqual(applicationWrapperExecutionPlan(app, "head").args, ["--no-pager", "rev-parse", "HEAD"]);
});
