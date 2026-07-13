/*
 * #868: the parsed git repo_state the result importer stores must reach the web.
 * buildPublicState projects `state.applicationResults` — scoped by PROJECT (so a
 * result outlives its invocation aging out of the capped list), count-capped, and
 * with the raw `text` trimmed to a preview to keep the snapshot small.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPublicState } from "../src/read-models/state.mjs";

const TEAM_A = "team_a";
const TEAM_B = "team_b";

function build(actor, applicationResults) {
  return buildPublicState({
    namespace: "test",
    protocolVersion: "1",
    state: {
      projects: [
        { id: "proj_a", ownerTeamId: TEAM_A },
        { id: "proj_b", ownerTeamId: TEAM_B },
      ],
      invocations: [
        { id: "inv_a", projectId: "proj_a" },
        { id: "inv_b", projectId: "proj_b" },
      ],
      applicationResults,
    },
    defaultProjectPath: "/tmp",
    currentProject: () => null,
    defaultAgent: () => null,
    loopRoutineReadModel: () => null,
    codexApprovalQueue: () => [],
    evidenceCenterRecords: () => [],
    ledgerSummary: () => null,
    budgetStatuses: () => [],
    actor,
  });
}

const idsOf = (rows) => (rows ?? []).map((r) => r.id).sort();

test("applicationResults are scoped to the actor's team by project", () => {
  const rows = [
    { id: "res_a", invocationId: "inv_a", projectId: "proj_a", status: "parsed", data: { branch: { name: "main" } }, text: "raw a" },
    { id: "res_b", invocationId: "inv_b", projectId: "proj_b", status: "parsed", data: { branch: { name: "dev" } }, text: "raw b" },
  ];
  assert.deepEqual(idsOf(build({ teamId: TEAM_A }, rows).applicationResults), ["res_a"], "team A sees only its own project's result");
  assert.deepEqual(idsOf(build({ teamId: TEAM_B }, rows).applicationResults), ["res_b"]);
});

test("unscoped (single-team / no actor) passes every result through", () => {
  const rows = [
    { id: "res_a", invocationId: "inv_a", projectId: "proj_a", status: "parsed", data: {}, text: "x" },
    { id: "res_b", invocationId: "inv_b", projectId: "proj_b", status: "parsed", data: {}, text: "y" },
  ];
  assert.deepEqual(idsOf(build(null, rows).applicationResults), ["res_a", "res_b"]);
});

test("the raw text is trimmed to a preview, and the parsed data is kept whole", () => {
  const rows = [
    { id: "res_a", invocationId: "inv_a", projectId: "proj_a", status: "parsed", data: { commits: [{ hash: "a".repeat(40) }] }, text: "x".repeat(9000) },
  ];
  const [projected] = build({ teamId: TEAM_A }, rows).applicationResults;
  assert.equal(projected.text.length, 2000, "text is trimmed to a 2000-char preview");
  assert.deepEqual(projected.data.commits, [{ hash: "a".repeat(40) }], "structured data is not trimmed");
});

test("#776/#869: the invocation projection strips the wrapper's execCommand/execArgs", () => {
  const withWrapper = buildPublicState({
    namespace: "test",
    protocolVersion: "1",
    state: {
      projects: [{ id: "proj_a", ownerTeamId: TEAM_A }],
      invocations: [
        {
          id: "inv_a",
          projectId: "proj_a",
          options: {
            metadata: {
              capability: "app.app_git.wrapper.log",
              applicationWrapper: {
                capability: "app.app_git.wrapper.log",
                execCommand: "git",
                execArgs: ["--no-pager", "log", "--format=secret"],
                cwdPolicy: "invocation_root",
                resultImport: { source: "git", kind: "repo_state" },
              },
            },
          },
        },
      ],
    },
    defaultProjectPath: "/tmp",
    currentProject: () => null,
    defaultAgent: () => null,
    loopRoutineReadModel: () => null,
    codexApprovalQueue: () => [],
    evidenceCenterRecords: () => [],
    ledgerSummary: () => null,
    budgetStatuses: () => [],
    actor: { teamId: TEAM_A },
  });
  const wrapper = withWrapper.invocations[0].options.metadata.applicationWrapper;
  assert.equal(wrapper.execCommand, undefined, "the bridge argv must not reach the browser");
  assert.equal(wrapper.execArgs, undefined);
  // The public contract stays.
  assert.equal(wrapper.capability, "app.app_git.wrapper.log");
  assert.equal(wrapper.cwdPolicy, "invocation_root");
  assert.deepEqual(wrapper.resultImport, { source: "git", kind: "repo_state" });
});

test("the snapshot caps the number of results (newest-first survive)", () => {
  const rows = Array.from({ length: 130 }, (_, index) => ({
    id: `res_${index}`,
    invocationId: "inv_a",
    projectId: "proj_a",
    status: "parsed",
    data: {},
    text: "",
  }));
  const projected = build({ teamId: TEAM_A }, rows).applicationResults;
  assert.equal(projected.length, 100, "capped at 100");
  assert.equal(projected[0].id, "res_0", "the newest (index 0, stored newest-first) is kept");
});
