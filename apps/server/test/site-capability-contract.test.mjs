import test from "node:test";
import assert from "node:assert/strict";

import { normalizeSiteCapabilityManifest, siteCapabilityOperation } from "../src/services/site-capability-contract.mjs";

const manifest = {
  schemaVersion: 1,
  id: "wechat_official",
  name: "微信公众号",
  version: "0.1.0",
  kind: "site_capability",
  executorId: "builtin.wechat_official",
  hosts: ["mp.weixin.qq.com"],
  session: { required: true, authMethod: "persistent_profile", heartbeatTier: "manual", accountScoped: true },
  operations: [
    { id: "session.probe", mode: "read", riskLevel: "low" },
    { id: "draft.sync", mode: "write", riskLevel: "medium", requiresApproval: true, inputArtifactKinds: ["wechat_article_package"], outputArtifactKinds: ["wechat_draft_receipt"] },
  ],
};

test("normalizes a trusted site capability without accepting executable commands", () => {
  const normalized = normalizeSiteCapabilityManifest(manifest, { trustedExecutorIds: ["builtin.wechat_official"] });
  assert.equal(normalized.id, "wechat_official");
  assert.equal(normalized.session.accountScoped, true);
  assert.equal(siteCapabilityOperation(normalized, "draft.sync").requiresApproval, true);
  assert.equal("command" in normalized, false);
});

test("rejects untrusted executors and unapproved write operations", () => {
  assert.throws(() => normalizeSiteCapabilityManifest(manifest, { trustedExecutorIds: ["builtin.other"] }), /untrusted_site_capability_executor/);
  assert.throws(() => normalizeSiteCapabilityManifest({
    ...manifest,
    operations: [{ id: "draft.sync", mode: "write", riskLevel: "medium", requiresApproval: false }],
  }), /site_write_operation_approval_required/);
});
