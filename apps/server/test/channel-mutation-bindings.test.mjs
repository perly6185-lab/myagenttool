import assert from "node:assert/strict";
import test from "node:test";

import { createChannelMutationBindingService } from "../src/services/channel-mutation-bindings.mjs";

const OWNER = { userId: "usr_a", teamId: "team_a", role: "owner" };

function harness() {
  const state = {
    channelObjectFileSources: [{
      id: "csrc_customers",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      fileName: "customers.csv",
      revision: 3,
      status: "active",
    }],
    ledgerDefinitions: [{
      id: "ldg_customers",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      state: "active",
      format: "csv",
      relativePath: "ledgers/customers.csv",
      sourceId: "wfs_customers",
      revision: 4,
    }],
    workflowSources: [{
      id: "wfs_customers",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      state: "active",
    }],
    channelMutationBindings: [],
  };
  let sequence = 0;
  const events = [];
  const service = createChannelMutationBindingService({
    state,
    now: () => "2026-08-17T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++sequence}`,
    appendEvent: (event) => events.push(event),
    persistStateSoon: () => {},
  });
  return { state, events, service };
}

test("binds one local file source to a compatible active ledger definition", () => {
  const h = harness();
  const created = h.service.upsertBinding({
    projectId: "prj_a",
    fileSourceId: "csrc_customers",
    ledgerDefinitionId: "ldg_customers",
  }, OWNER);
  assert.equal(created.status, 201);
  assert.equal(created.body.binding.fileName, "customers.csv");
  assert.equal(h.service.resolveBinding({ projectId: "prj_a", fileSourceId: "csrc_customers" }, OWNER).ok, true);
  assert.equal(h.events.at(-1).type, "channel_mutation_binding_created");
});

test("rejects cross-project, wrong-format, and stale bindings", () => {
  const h = harness();
  h.state.ledgerDefinitions.push({
    id: "ldg_wrong_format",
    ownerTeamId: "team_a",
    projectId: "prj_a",
    state: "active",
    format: "xlsx",
    relativePath: "ledgers/customers.xlsx",
    sourceId: "wfs_customers",
    revision: 1,
  });
  assert.equal(h.service.upsertBinding({
    projectId: "prj_a", fileSourceId: "csrc_customers", ledgerDefinitionId: "ldg_wrong_format",
  }, OWNER).status, 409);
  assert.equal(h.service.upsertBinding({
    projectId: "prj_other", fileSourceId: "csrc_customers", ledgerDefinitionId: "ldg_customers",
  }, OWNER).status, 409);

  const created = h.service.upsertBinding({
    projectId: "prj_a", fileSourceId: "csrc_customers", ledgerDefinitionId: "ldg_customers",
  }, OWNER);
  h.state.channelObjectFileSources[0].revision = 4;
  const resolved = h.service.resolveBinding({ projectId: "prj_a", fileSourceId: "csrc_customers" }, OWNER);
  assert.equal(resolved.ok, false);
  assert.equal(resolved.reason, "channel_mutation_binding_stale");
  assert.equal(h.service.listBindings({ projectId: "prj_a" }, OWNER).body.bindings[0].stale, true);
  assert.equal(h.service.setBindingStatus(created.body.binding.id, { status: "disabled", expectedRevision: 1 }, OWNER).status, 200);
});
