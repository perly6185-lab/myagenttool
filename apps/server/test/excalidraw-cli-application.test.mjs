/*
 * Excalidraw CLI Application (#1356, PR2 — the governed export write slice).
 * `export` renders a scene FILE to a PNG in place, so it is a workspace_write,
 * approval-gated `apply` verb. The input/output are POSITIONAL argv elements, so
 * their validators are the only thing between caller input and the binary — test
 * the refusals before the happy path.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createApplicationService, applicationWrapperExecutionPlan } from "../src/services/applications.mjs";
import {
  createExcalidrawCliApplicationRegistration,
  EXCALIDRAW_CLI_APPLICATION_ID,
} from "../src/services/excalidraw-cli-application.mjs";

function service(state = { applications: [] }) {
  return createApplicationService({
    state,
    now: () => "2026-07-21T00:00:00.000Z",
    nextId: (p) => `${p}_x`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    addProject: () => null,
    cloneProject: () => null,
    defaultProjectPath: "/tmp/repo",
  });
}

function register() {
  return service().registerApplication(createExcalidrawCliApplicationRegistration());
}

test("registration projects a single export write verb — workspace_write, approval-required, apply segment", () => {
  const app = register();
  assert.equal(app.id, EXCALIDRAW_CLI_APPLICATION_ID);
  const commands = app.source?.wrapper?.commands ?? [];
  assert.deepEqual(commands.map((c) => c.id), ["export"]);
  const exp = commands[0];
  assert.equal(exp.filePolicy, "workspace_write");
  assert.equal(exp.networkPolicy, "forbidden", "the offline renderer never touches the network");
  assert.equal(exp.requiresApproval, true, "a write must carry an approval token");
  assert.equal(exp.segment, "apply", "routes under the excalidrawCliApply write policy");
  assert.equal(exp.cwdPolicy, "invocation_root", "a write is confined to the worktree it runs in");
});

test("the export execution plan carries the apply capability + two worktree-safe positionals", () => {
  const app = register();
  const plan = applicationWrapperExecutionPlan(app, "export", { input: "diagrams/flow.excalidraw", output: "out/flow.png" });
  assert.equal(plan.capability, "app.app_excalidraw_cli.apply.export", "write commands use the .apply. segment");
  assert.deepEqual(plan.args, ["diagrams/flow.excalidraw", "out/flow.png"]);
  assert.equal(plan.filePolicy, "workspace_write");
  assert.equal(plan.cwdPolicy, "invocation_root");
});

test("unsafe or wrong-extension paths are DROPPED from the argv (never reach the binary)", () => {
  const app = register();
  // Traversal / absolute input, and a non-.png output, are each dropped.
  const escaped = applicationWrapperExecutionPlan(app, "export", { input: "../secret.excalidraw", output: "/etc/out.png" });
  assert.equal(escaped.args.includes("../secret.excalidraw"), false, "a traversal input never becomes an arg");
  assert.equal(escaped.args.includes("/etc/out.png"), false, "an absolute output never becomes an arg");

  const wrongExt = applicationWrapperExecutionPlan(app, "export", { input: "flow.png", output: "flow.svg" });
  assert.deepEqual(wrongExt.args, [], "an input that is not .excalidraw and an output that is not .png are both dropped");
});
