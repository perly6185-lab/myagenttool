import assert from "node:assert/strict";
import test from "node:test";

import {
  channelObjectValidationMatches,
  resolveChannelObjectRequests,
} from "../src/services/channel-object-resolver.mjs";

const context = { projectId: "prj_a", ownerTeamId: "team_a" };

function stateWithRecords() {
  return {
    channelObjectRecords: [
      {
        id: "acct_a",
        kind: "account",
        ownerTeamId: "team_a",
        projectId: "prj_a",
        label: "公司付款账户",
        fields: { accountName: "公司付款账户", accountNumber: "6222000012345678" },
        status: "active",
        revision: 2,
      },
      {
        id: "pub_a",
        kind: "publish_target",
        ownerTeamId: "team_a",
        projectId: "prj_a",
        label: "公司小红书",
        fields: { platform: "小红书", channel: "company" },
        status: "active",
        revision: 1,
      },
    ],
    businessEntities: [
      {
        id: "customer_a",
        ownerTeamId: "team_a",
        projectId: "prj_a",
        entityType: "customer",
        businessKey: "客户张三",
        fields: { name: "张三", email: "zhangsan@example.test" },
        revision: 3,
      },
      {
        id: "order_a",
        ownerTeamId: "team_a",
        projectId: "prj_a",
        entityType: "order",
        businessKey: "ORD-001",
        fields: { order_number: "ORD-001", customer: "张三" },
        revision: 4,
      },
    ],
    workflowArtifacts: [],
    channels: [],
  };
}

test("resolves customer, order, masked account and publish target without exposing secrets", () => {
  const state = stateWithRecords();
  const financial = resolveChannelObjectRequests({
    state,
    ...context,
    text: "请给客户张三汇款 100 元，使用公司付款账户",
    riskLevel: "financial",
  });
  assert.equal(financial.state, "verified");
  assert.deepEqual(financial.verifiedObjects.map((object) => object.kind), ["contact", "account"]);
  assert.equal(financial.verifiedObjects.find((object) => object.kind === "account").metadata.accountNumber, "********5678");
  assert.equal(JSON.stringify(financial).includes("6222000012345678"), false);

  const publish = resolveChannelObjectRequests({
    state,
    ...context,
    text: "把文章发布到小红书",
    riskLevel: "external_communication",
  });
  assert.equal(publish.state, "verified");
  assert.equal(publish.verifiedObjects[0].id, "pub_a");

  const order = resolveChannelObjectRequests({
    state,
    ...context,
    text: "跟踪订单 ORD-001",
    riskLevel: "low",
  });
  assert.equal(order.state, "verified");
  assert.equal(order.verifiedObjects[0].kind, "order");
});

test("ambiguous and foreign records fail closed", () => {
  const state = stateWithRecords();
  state.businessEntities.push({
    id: "customer_b",
    ownerTeamId: "team_a",
    projectId: "prj_a",
    entityType: "customer",
    businessKey: "客户张三-备用",
    fields: { name: "张三" },
    revision: 1,
  });
  const ambiguous = resolveChannelObjectRequests({
    state,
    ...context,
    text: "把报价单发给张三",
    riskLevel: "external_communication",
  });
  assert.equal(ambiguous.state, "ambiguous");
  assert.ok(ambiguous.requiredFields.includes("可验证的收件人"));

  state.businessEntities.push({
    id: "customer_foreign",
    ownerTeamId: "team_b",
    projectId: "prj_a",
    entityType: "customer",
    businessKey: "客户李四",
    fields: { name: "李四" },
    revision: 1,
  });
  const foreign = resolveChannelObjectRequests({
    state,
    ...context,
    text: "把报价单发给李四",
    riskLevel: "external_communication",
  });
  assert.equal(foreign.state, "forbidden");
  assert.equal(foreign.verifiedObjects.length, 0);
});

test("file attachment verification detects readiness and fingerprint drift", () => {
  const state = stateWithRecords();
  state.workflowArtifacts.push({
    id: "file_a",
    ownerTeamId: "team_a",
    projectId: "prj_a",
    relativePath: "报价单.docx",
    fingerprint: "sha256:current",
    availability: "available",
    revision: 2,
  });
  const verified = resolveChannelObjectRequests({
    state,
    ...context,
    text: "把报价单发给客户张三",
    riskLevel: "external_communication",
    inputAssets: [{ id: "file_a", projectId: "prj_a", hash: "sha256:current", readiness: { state: "ready" } }],
  });
  assert.equal(verified.state, "verified");
  assert.equal(verified.verifiedObjects[1].kind, "file");

  const stale = resolveChannelObjectRequests({
    state,
    ...context,
    text: "把报价单发给客户张三",
    riskLevel: "external_communication",
    inputAssets: [{ id: "file_a", projectId: "prj_a", hash: "sha256:old", readiness: { state: "ready" } }],
  });
  assert.equal(stale.state, "stale");
  assert.ok(stale.requiredFields.includes("可验证的输入文件"));
});

test("the confirmation snapshot changes when a verified object revision changes", () => {
  const state = stateWithRecords();
  const before = resolveChannelObjectRequests({
    state,
    ...context,
    text: "把报价单发给客户张三",
    riskLevel: "external_communication",
  });
  state.businessEntities.find((row) => row.id === "customer_a").revision = 4;
  const after = resolveChannelObjectRequests({
    state,
    ...context,
    text: "把报价单发给客户张三",
    riskLevel: "external_communication",
  });
  assert.equal(channelObjectValidationMatches(before, after), false);
});
