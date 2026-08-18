import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveConfig, LIMITS } from "../src/config.mjs";

test("resolveConfig: defaults to ephemeral (no profile, no channel)", () => {
  const cfg = resolveConfig({});
  assert.equal(cfg.profileDir, null);
  assert.equal(cfg.channel, null);
  assert.equal(cfg.headless, true);
  assert.equal(cfg.limits.pageTimeoutMs, LIMITS.pageTimeoutMs);
  assert.ok(Object.isFrozen(cfg));
  assert.ok(Object.isFrozen(cfg.limits));
});

test("resolveConfig: reads ZHIHU_PROFILE_DIR (trimmed) and ZHIHU_CHANNEL", () => {
  const cfg = resolveConfig({ ZHIHU_PROFILE_DIR: "  /tmp/zhihu-profile  ", ZHIHU_CHANNEL: "chrome" });
  assert.equal(cfg.profileDir, "/tmp/zhihu-profile");
  assert.equal(cfg.channel, "chrome");
});

test("resolveConfig: blank profile/channel collapse to null", () => {
  const cfg = resolveConfig({ ZHIHU_PROFILE_DIR: "   ", ZHIHU_CHANNEL: "" });
  assert.equal(cfg.profileDir, null);
  assert.equal(cfg.channel, null);
});

test("resolveConfig: bounds pageTimeoutMs to the configured range", () => {
  assert.equal(resolveConfig({ ZHIHU_PAGE_TIMEOUT_MS: "9999999" }).limits.pageTimeoutMs, 300_000); // clamped to max
  assert.equal(resolveConfig({ ZHIHU_PAGE_TIMEOUT_MS: "10" }).limits.pageTimeoutMs, 5_000); // clamped to min
  assert.equal(resolveConfig({ ZHIHU_PAGE_TIMEOUT_MS: "120000" }).limits.pageTimeoutMs, 120_000);
  assert.equal(resolveConfig({ ZHIHU_PAGE_TIMEOUT_MS: "not-a-number" }).limits.pageTimeoutMs, LIMITS.pageTimeoutMs); // fallback
});

test("resolveConfig: headless toggle", () => {
  assert.equal(resolveConfig({ ZHIHU_HEADLESS: "false" }).headless, false);
  assert.equal(resolveConfig({ ZHIHU_HEADLESS: "0" }).headless, false);
  assert.equal(resolveConfig({ ZHIHU_HEADLESS: "yes" }).headless, true);
  assert.equal(resolveConfig({}).headless, true);
});
