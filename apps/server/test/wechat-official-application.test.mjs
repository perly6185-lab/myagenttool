import test from "node:test";
import assert from "node:assert/strict";

import {
  createWechatOfficialAgentRegistration,
  createWechatOfficialApplicationRegistration,
  WECHAT_OFFICIAL_AGENT_ID,
} from "../src/services/wechat-official-application.mjs";
import { draftSyncCapabilityReadiness, publicationCapabilityReadiness } from "../src/services/publication-readiness.mjs";
import { createApplicationService } from "../src/services/applications.mjs";

test("the WeChat Application exposes governed draft sync without public publish", () => {
  const registration = createWechatOfficialApplicationRegistration({ agentId: "agt_wechat" });
  assert.deepEqual(registration.capabilityFacades.map((facade) => facade.id), ["probe", "draft_sync"]);
  assert.equal(registration.capabilityFacades.find((facade) => facade.id === "draft_sync").requiresApproval, true);
  assert.equal(registration.source.manifest.publicPublish, false);

  const active = { ...registration, ownerTeamId: "team_local", status: "active" };
  assert.equal(draftSyncCapabilityReadiness({ applications: [active], platformTarget: { id: "wechat_official", label: "公众号" }, ownerTeamId: "team_local" }).state, "ready");
  assert.equal(publicationCapabilityReadiness({ applications: [active], platformTarget: { id: "wechat_official", label: "公众号" }, ownerTeamId: "team_local" }).state, "needs_setup");
});

test("the local WeChat agent registration is deterministic and least-privileged", () => {
  const registration = createWechatOfficialAgentRegistration({ serverScriptPath: "/opt/myagenttool/wechat/server.mjs" });
  assert.equal(registration.id, WECHAT_OFFICIAL_AGENT_ID);
  assert.equal(registration.command, process.execPath);
  assert.deepEqual(registration.args, ["/opt/myagenttool/wechat/server.mjs"]);
  assert.deepEqual(registration.allowedTools, ["wechat_official_probe", "wechat_official_draft_sync"]);
  assert.equal(registration.riskLevel, "medium");
});

test("the Application registry preserves the exact agent tools and approval boundary", () => {
  const state = { applications: [], invocations: [], device: { id: "dev_1", status: "online" } };
  const service = createApplicationService({
    state,
    now: () => "2026-08-24T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_1`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    addProject: () => null,
    cloneProject: () => null,
    defaultProjectPath: "/tmp/project",
  });
  service.registerApplication(createWechatOfficialApplicationRegistration({ agentId: "agt_wechat", autoOnline: true }));
  const capabilities = service.listApplicationCapabilities("app_wechat_official");
  const draft = capabilities.find((capability) => capability.name === "app.app_wechat_official.draft_sync");
  assert.equal(draft.metadata.execution.agentId, "agt_wechat");
  assert.equal(draft.metadata.execution.toolName, "wechat_official_draft_sync");
  assert.equal(draft.requiresApproval, true);
  assert.equal(capabilities.some((capability) => /publish/.test(capability.name)), false);
});
