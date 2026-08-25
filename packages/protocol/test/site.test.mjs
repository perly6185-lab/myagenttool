import assert from "node:assert/strict";
import { test } from "node:test";
import { siteAssetIdPrefix, siteBlockTypes, siteBounds, siteDeploymentProviderCapabilities } from "../src/site.mjs";

test("site protocol keeps bounded blocks and explicit deployment capabilities", () => {
  assert.ok(siteBounds.maxBlocksPerEntry > 0);
  assert.equal(siteAssetIdPrefix, "sat");
  assert.equal(siteBounds.maxAssetBytes, 10 * 1024 * 1024);
  assert.ok(siteBounds.maxAssetTotalBytes > siteBounds.maxAssetBytes);
  assert.ok(siteBlockTypes.includes("hero"));
  assert.equal(siteDeploymentProviderCapabilities.local_directory.atomicActivation, true);
  assert.equal(siteDeploymentProviderCapabilities.aliyun_oss_cdn.atomicActivation, true);
});
