import test from "node:test";
import assert from "node:assert/strict";
import { draftSyncCapabilityReadiness, publicationCapabilityReadiness } from "../src/services/publication-readiness.mjs";

const target = { id: "wechat_official", label: "公众号" };

test("publication stays unavailable without a target-specific governed connection", () => {
  assert.deepEqual(publicationCapabilityReadiness({ platformTarget: target, ownerTeamId: "team_a" }), {
    state: "needs_setup", reason: "publication_connection_missing", platformId: "wechat_official", connection: null,
  });
});

test("publication requires an active target-specific facade with approval", () => {
  const application = {
    id: "app_wechat", name: "公众号连接", ownerTeamId: "team_a", status: "active",
    capabilityFacades: [{
      id: "publish", displayName: "发布公众号文章", toolName: "wechat_official.publish",
      directInvocation: true, requiresApproval: false, riskTags: ["content_publish", "wechat_official"],
      siteOperationContract: { platformId: "wechat_official", operation: "publish", inputArtifactKinds: ["wechat_article_package"], outputArtifactKinds: ["publication_receipt"] },
    }],
  };
  const ungated = publicationCapabilityReadiness({ applications: [application], platformTarget: target, ownerTeamId: "team_a" });
  assert.equal(ungated.state, "needs_setup");
  assert.equal(ungated.reason, "publication_approval_gate_required");
  application.capabilityFacades[0].requiresApproval = true;
  const ready = publicationCapabilityReadiness({ applications: [application], platformTarget: target, ownerTeamId: "team_a" });
  assert.equal(ready.state, "ready");
  assert.equal(ready.connection.applicationId, "app_wechat");
});

test("publication connections never cross tenant or platform boundaries", () => {
  const applications = [{
    id: "app_douyin", name: "抖音发布", ownerTeamId: "team_b", status: "active",
    capabilityFacades: [{ id: "publish", toolName: "douyin.publish", requiresApproval: true, riskTags: ["content_publish", "douyin"], siteOperationContract: { platformId: "douyin", operation: "publish", inputArtifactKinds: ["platform_package"], outputArtifactKinds: ["publication_receipt"] } }],
  }];
  const readiness = publicationCapabilityReadiness({ applications, platformTarget: target, ownerTeamId: "team_a" });
  assert.equal(readiness.state, "needs_setup");
  assert.equal(readiness.connection, null);
});

test("WeChat draft synchronization resolves independently from public publishing", () => {
  const application = {
    id: "app_wechat_draft", name: "公众号草稿连接", ownerTeamId: "team_a", status: "active",
    capabilityFacades: [{
      id: "draft_sync", displayName: "保存公众号草稿", toolName: "wechat_official.draft_sync",
      directInvocation: true, requiresApproval: true, riskTags: ["wechat_official", "draft_sync"],
      siteOperationContract: { platformId: "wechat_official", operation: "draft_sync", inputArtifactKinds: ["wechat_article_package"], outputArtifactKinds: ["wechat_draft_receipt"] },
    }],
  };
  const draft = draftSyncCapabilityReadiness({ applications: [application], platformTarget: target, ownerTeamId: "team_a" });
  const publish = publicationCapabilityReadiness({ applications: [application], platformTarget: target, ownerTeamId: "team_a" });
  assert.equal(draft.state, "ready");
  assert.equal(publish.state, "needs_setup");
  assert.equal(publish.reason, "publication_connection_missing");
});

test("publication names and risk tags cannot impersonate a site operation contract", () => {
  const application = {
    id: "app_fake", name: "公众号发布神器", ownerTeamId: "team_a", status: "active",
    capabilityFacades: [{ id: "publish", toolName: "wechat_official.publish", directInvocation: true, requiresApproval: true, riskTags: ["content_publish", "wechat_official"] }],
  };
  const readiness = publicationCapabilityReadiness({ applications: [application], platformTarget: target, ownerTeamId: "team_a" });
  assert.equal(readiness.state, "needs_setup");
  assert.equal(readiness.reason, "publication_connection_missing");
});

test("publication refuses unhealthy or expired site sessions", () => {
  const application = {
    id: "app_expired", name: "失效公众号", ownerTeamId: "team_a", status: "active",
    health: { status: "unhealthy" }, sessionStatus: "expired",
    capabilityFacades: [{
      id: "publish", toolName: "wechat_official.publish", directInvocation: true, requiresApproval: true,
      siteOperationContract: { platformId: "wechat_official", operation: "publish", inputArtifactKinds: ["wechat_article_package"], outputArtifactKinds: ["publication_receipt"] },
    }],
  };
  const readiness = publicationCapabilityReadiness({ applications: [application], platformTarget: target, ownerTeamId: "team_a" });
  assert.equal(readiness.state, "needs_setup");
  assert.equal(readiness.reason, "publication_connection_unhealthy");
});

test("publication resolves an explicitly selected account instead of taking the first platform match", () => {
  const application = (id, accountId) => ({
    id, accountId, name: id, ownerTeamId: "team_a", status: "active", health: { status: "healthy" },
    capabilityFacades: [{
      id: "publish", toolName: `${id}.publish`, directInvocation: true, requiresApproval: true,
      siteOperationContract: { platformId: "wechat_official", operation: "publish", inputArtifactKinds: ["wechat_article_package"], outputArtifactKinds: ["publication_receipt"] },
    }],
  });
  const readiness = publicationCapabilityReadiness({
    applications: [application("app_one", "account_1"), application("app_two", "account_2")],
    platformTarget: { ...target, accountId: "account_2" },
    ownerTeamId: "team_a",
  });
  assert.equal(readiness.state, "ready");
  assert.equal(readiness.connection.applicationId, "app_two");
  assert.equal(readiness.connection.accountId, "account_2");

  const selectedByApplication = publicationCapabilityReadiness({
    applications: [application("app_one", "account_1"), application("app_two", "account_2")],
    platformTarget: { ...target, applicationId: "app_two" },
    ownerTeamId: "team_a",
  });
  assert.equal(selectedByApplication.state, "ready");
  assert.equal(selectedByApplication.connection.applicationId, "app_two");
  assert.equal(selectedByApplication.connection.accountId, "account_2");

  const missing = publicationCapabilityReadiness({
    applications: [application("app_one", "account_1")],
    platformTarget: { ...target, accountId: "account_missing" },
    ownerTeamId: "team_a",
  });
  assert.equal(missing.reason, "publication_account_connection_missing");

  const missingApplication = publicationCapabilityReadiness({
    applications: [application("app_one", "account_1")],
    platformTarget: { ...target, applicationId: "app_missing" },
    ownerTeamId: "team_a",
  });
  assert.equal(missingApplication.reason, "publication_account_connection_missing");
});
