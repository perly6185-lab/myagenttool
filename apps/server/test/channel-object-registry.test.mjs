import assert from "node:assert/strict";
import test from "node:test";

import { createChannelObjectRegistryService } from "../src/services/channel-object-registry.mjs";

const ACTOR = { userId: "usr_a", teamId: "team_a", role: "owner" };

function harness() {
  const state = {
    projects: [{ id: "prj_a", ownerTeamId: "team_a" }],
    channelObjectRecords: [],
  };
  let counter = 0;
  const events = [];
  const service = createChannelObjectRegistryService({
    state,
    now: () => "2026-08-17T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++counter}`,
    appendEvent: (event) => events.push(event),
    persistStateSoon: () => {},
  });
  return { state, events, service };
}

test("registers business objects with revisioned metadata and masks account numbers", () => {
  const h = harness();
  const created = h.service.upsertChannelObject({
    kind: "account",
    projectId: "prj_a",
    label: "公司付款账户",
    fields: { accountName: "公司付款账户", accountNumber: "6222000012345678", secret: "never-store" },
  }, ACTOR);
  assert.equal(created.status, 201);
  assert.equal(created.body.object.fields.accountNumber, "****5678");
  assert.equal(JSON.stringify(h.state).includes("6222000012345678"), false);
  assert.equal(JSON.stringify(h.state).includes("never-store"), false);
  const listed = h.service.listChannelObjects({ kind: "account" }, ACTOR);
  assert.equal(listed.body.count, 1);
  assert.equal(listed.body.objects[0].revision, 1);
  assert.equal(h.events.at(-1).type, "channel_object_created");
});

test("updates and disables with optimistic concurrency and hides foreign objects", () => {
  const h = harness();
  const created = h.service.upsertChannelObject({
    kind: "contact",
    projectId: "prj_a",
    label: "张三",
    businessKey: "customer-zhangsan",
    fields: { name: "张三", email: "zhangsan@example.test" },
  }, ACTOR);
  const id = created.body.object.id;
  assert.equal(h.service.setChannelObjectStatus(id, { status: "disabled", expectedRevision: 1 }, ACTOR).status, 200);
  assert.equal(h.service.setChannelObjectStatus(id, { status: "active", expectedRevision: 1 }, ACTOR).status, 409);
  assert.equal(h.service.listChannelObjects({}, { userId: "usr_b", teamId: "team_b" }).body.count, 0);
  assert.equal(h.service.upsertChannelObject({ kind: "order", projectId: "prj_a", label: "跨团队" }, { userId: "usr_b", teamId: "team_b" }).status, 404);
});

test("upsert reuses a same-team business key and increments revision", () => {
  const h = harness();
  const first = h.service.upsertChannelObject({
    kind: "order", projectId: "prj_a", label: "ORD-001", businessKey: "ORD-001", fields: { order_number: "ORD-001" },
  }, ACTOR);
  const second = h.service.upsertChannelObject({
    kind: "order", projectId: "prj_a", label: "ORD-001 已更新", businessKey: "ORD-001", expectedRevision: 1,
    fields: { order_number: "ORD-001", customer: "张三" },
  }, ACTOR);
  assert.equal(second.status, 200);
  assert.equal(second.body.object.id, first.body.object.id);
  assert.equal(second.body.object.revision, 2);
});
