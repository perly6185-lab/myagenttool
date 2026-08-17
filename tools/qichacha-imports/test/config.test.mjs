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

test("resolveConfig: reads QICHACHA_PROFILE_DIR (trimmed) and QICHACHA_CHANNEL", () => {
  const cfg = resolveConfig({ QICHACHA_PROFILE_DIR: "  /tmp/qichacha-profile  ", QICHACHA_CHANNEL: "chrome" });
  assert.equal(cfg.profileDir, "/tmp/qichacha-profile");
  assert.equal(cfg.channel, "chrome");
});

test("resolveConfig: blank profile/channel collapse to null", () => {
  const cfg = resolveConfig({ QICHACHA_PROFILE_DIR: "   ", QICHACHA_CHANNEL: "" });
  assert.equal(cfg.profileDir, null);
  assert.equal(cfg.channel, null);
});

test("resolveConfig: bounds pageTimeoutMs to the configured range", () => {
  assert.equal(resolveConfig({ QICHACHA_PAGE_TIMEOUT_MS: "9999999" }).limits.pageTimeoutMs, 300_000); // clamped to max
  assert.equal(resolveConfig({ QICHACHA_PAGE_TIMEOUT_MS: "10" }).limits.pageTimeoutMs, 5_000); // clamped to min
  assert.equal(resolveConfig({ QICHACHA_PAGE_TIMEOUT_MS: "120000" }).limits.pageTimeoutMs, 120_000);
  assert.equal(resolveConfig({ QICHACHA_PAGE_TIMEOUT_MS: "not-a-number" }).limits.pageTimeoutMs, LIMITS.pageTimeoutMs); // fallback
});

test("resolveConfig: headless toggle", () => {
  assert.equal(resolveConfig({ QICHACHA_HEADLESS: "false" }).headless, false);
  assert.equal(resolveConfig({ QICHACHA_HEADLESS: "0" }).headless, false);
  assert.equal(resolveConfig({ QICHACHA_HEADLESS: "yes" }).headless, true);
  assert.equal(resolveConfig({}).headless, true);
});

test("resolveConfig: scroll limits clamp and fall back", () => {
  assert.equal(resolveConfig({ QICHACHA_SCROLL_MAX_STEPS: "99999" }).limits.scrollMaxSteps, 2_000);
  assert.equal(resolveConfig({ QICHACHA_SCROLL_MAX_STEPS: "-5" }).limits.scrollMaxSteps, 0);
  assert.equal(resolveConfig({ QICHACHA_SCROLL_SETTLE_MS: "999999" }).limits.scrollSettleMs, 10_000);
  assert.equal(resolveConfig({ QICHACHA_SCROLL_SETTLE_MS: "bad" }).limits.scrollSettleMs, LIMITS.scrollSettleMs);
});
