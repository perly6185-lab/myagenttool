/*
 * OfficeCLI Application (P1, read-only). The file/path/selector/mode inputs are
 * POSITIONAL argv elements, so their validators are the only thing standing
 * between caller input and the binary. Test the refusals before the happy path.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createApplicationService, applicationWrapperExecutionPlan } from "../src/services/applications.mjs";
import {
  createOfficecliApplicationRegistration,
  OFFICECLI_APPLICATION_ID,
} from "../src/services/officecli-application.mjs";

function service(state = { applications: [] }) {
  return createApplicationService({
    state,
    now: () => "2026-07-20T00:00:00.000Z",
    nextId: (p) => `${p}_x`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    addProject: () => null,
    cloneProject: () => null,
    defaultProjectPath: "/tmp/repo",
  });
}

function register() {
  return service().registerApplication(createOfficecliApplicationRegistration());
}

test("registration projects the five read verbs, all read-only / no approval", () => {
  const app = register();
  assert.equal(app.id, OFFICECLI_APPLICATION_ID);
  const commands = app.source?.wrapper?.commands ?? [];
  assert.deepEqual(
    commands.map((c) => c.id).sort(),
    ["dump", "get", "query", "validate", "view"],
  );
  for (const command of commands) {
    assert.equal(command.filePolicy, "read_only", `${command.id} must be read-only`);
    assert.equal(command.networkPolicy, "forbidden", `${command.id} must be offline`);
    assert.equal(command.requiresApproval, false, `${command.id} needs no approval`);
    assert.equal(command.cwdPolicy, "invocation_root");
  }
});

test("read verbs append their positionals after the fixed base, in declaration order", () => {
  const app = register();
  assert.deepEqual(
    applicationWrapperExecutionPlan(app, "get", { file: "demo.xlsx", path: "/Sheet1/A1" }).args,
    ["get", "--json", "demo.xlsx", "/Sheet1/A1"],
  );
  assert.deepEqual(
    applicationWrapperExecutionPlan(app, "query", { file: "deck.pptx", selector: "shape" }).args,
    ["query", "--json", "deck.pptx", "shape"],
  );
  assert.deepEqual(
    applicationWrapperExecutionPlan(app, "view", { file: "report.docx", mode: "text" }).args,
    ["view", "report.docx", "text"],
  );
  // `html` is an in-set render mode (self-contained preview to stdout).
  assert.deepEqual(
    applicationWrapperExecutionPlan(app, "view", { file: "deck.pptx", mode: "html" }).args,
    ["view", "deck.pptx", "html"],
  );
  assert.deepEqual(
    applicationWrapperExecutionPlan(app, "validate", { file: "demo.xlsx" }).args,
    ["validate", "--json", "demo.xlsx"],
  );
});

test("an out-of-set view mode is DROPPED, never appended", () => {
  const app = register();
  // enum validation drops an unknown mode rather than passing it to the binary.
  assert.deepEqual(
    applicationWrapperExecutionPlan(app, "view", { file: "report.docx", mode: "screenshot" }).args,
    ["view", "report.docx"],
  );
  assert.deepEqual(
    applicationWrapperExecutionPlan(app, "view", { file: "report.docx", mode: "../../etc" }).args,
    ["view", "report.docx"],
  );
});

test("flag-shaped and control-character positionals are DROPPED (refusals before the happy path)", () => {
  const app = register();
  for (const file of ["-x.xlsx", "--help", "a\nb.xlsx", "x".repeat(201) + ".xlsx"]) {
    const plan = applicationWrapperExecutionPlan(app, "get", { file });
    assert.deepEqual(plan.args, ["get", "--json"], `file "${file}" must be dropped`);
  }
});
