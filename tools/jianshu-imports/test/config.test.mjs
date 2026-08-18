import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveConfig, LIMITS } from "../src/config.mjs";

test("resolveConfig: defaults to ephemeral profile and bundled chromium channel", () => {
  const cfg = resolveConfig({});
  assert.equal(cfg.profileDir, null);
  // Channel defaults to Playwright's bundled chromium for jianshu — no WAF
  // evidence against it (2026-08-17 probe, issue #1705: anonymous plain
  // fetches return 200 with the full __NEXT_DATA__ payload).
  assert.equal(cfg.channel, null);
  assert.equal(cfg.headless, true);
  assert.equal(cfg.limits.pageTimeoutMs, LIMITS.pageTimeoutMs);
  // No scroll limits exist: the body composes from the __NEXT_DATA__ JSON,
  // whose image attributes ship complete — nothing lazy to surface.
  assert.equal(cfg.limits.scrollMaxSteps, undefined);
  assert.ok(Object.isFrozen(cfg));
  assert.ok(Object.isFrozen(cfg.limits));
});

test("resolveConfig: reads JIANSHU_PROFILE_DIR (trimmed) and JIANSHU_CHANNEL override", () => {
  const cfg = resolveConfig({ JIANSHU_PROFILE_DIR: "  /tmp/jianshu-profile  ", JIANSHU_CHANNEL: "chrome" });
  assert.equal(cfg.profileDir, "/tmp/jianshu-profile");
  assert.equal(cfg.channel, "chrome");
});

test("resolveConfig: blank profile collapses to null; blank channel falls back to default", () => {
  const cfg = resolveConfig({ JIANSHU_PROFILE_DIR: "   ", JIANSHU_CHANNEL: "" });
  assert.equal(cfg.profileDir, null);
  assert.equal(cfg.channel, null);
});

test("resolveConfig: bounds pageTimeoutMs to the configured range", () => {
  assert.equal(resolveConfig({ JIANSHU_PAGE_TIMEOUT_MS: "9999999" }).limits.pageTimeoutMs, 300_000); // clamped to max
  assert.equal(resolveConfig({ JIANSHU_PAGE_TIMEOUT_MS: "10" }).limits.pageTimeoutMs, 5_000); // clamped to min
  assert.equal(resolveConfig({ JIANSHU_PAGE_TIMEOUT_MS: "120000" }).limits.pageTimeoutMs, 120_000);
  assert.equal(resolveConfig({ JIANSHU_PAGE_TIMEOUT_MS: "not-a-number" }).limits.pageTimeoutMs, LIMITS.pageTimeoutMs); // fallback
});

test("resolveConfig: headless toggle", () => {
  assert.equal(resolveConfig({ JIANSHU_HEADLESS: "false" }).headless, false);
  assert.equal(resolveConfig({ JIANSHU_HEADLESS: "0" }).headless, false);
  assert.equal(resolveConfig({ JIANSHU_HEADLESS: "yes" }).headless, true);
  assert.equal(resolveConfig({}).headless, true);
});
