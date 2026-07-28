/*
 * Auto-run config: persisted safe-knob settings overlay the env defaults;
 * command argv stays env-only. normalize validates/clamps; the overlay maps set
 * fields back to env keys; resolveAutoRunConfig reports effective values +
 * per-command "configured" flags (never the argv).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  autoRunSettingsEnvOverlay,
  normalizeAutoRunSettings,
  resolveAutoRunConfig,
} from "../src/services/auto-run-config.mjs";

test("normalize: clamps/validates and drops out-of-range to null", () => {
  const s = normalizeAutoRunSettings({
    autoTriggerEnabled: "1",
    autoTriggerLabel: "  Auto Label  ",
    autoTriggerMaxConcurrent: 99, // clamp to 10
    decisionMinConfidence: 1.5, // clamp to 1
    deciderTimeoutMs: 500, // clamp up to the 1000ms floor
    judgeTimeoutMs: 60000,
    spawnIssues: true,
  });
  assert.equal(s.autoTriggerEnabled, true);
  assert.equal(s.autoTriggerLabel, "Auto Label");
  assert.equal(s.autoTriggerMaxConcurrent, 10, "clamped to max");
  assert.equal(s.decisionMinConfidence, 1, "1.5 clamped into [0,1]");
  assert.equal(s.deciderTimeoutMs, 1000, "clamped up to the floor");
  assert.equal(s.judgeTimeoutMs, 60000);
  assert.equal(s.spawnIssues, true);
});

test("normalize: absent fields carry prior; explicit null clears", () => {
  const prev = { autoTriggerEnabled: true, spawnIssues: true, statusWriteback: true };
  const s = normalizeAutoRunSettings({ spawnIssues: null }, prev);
  assert.equal(s.autoTriggerEnabled, true, "absent field kept from prev");
  assert.equal(s.spawnIssues, null, "explicit null clears the override");
  assert.equal(s.statusWriteback, true, "absent field kept from prev");
});

test("overlay: set fields override env keys; unset fields leave env untouched", () => {
  const base = {
    MYAGENTTOOL_AUTOTRIGGER_ENABLED: "0",
    MYAGENTTOOL_AUTOTRIGGER_LABEL: "env-label",
    MYAGENTTOOL_AUTORUN_DECIDER_COMMAND_JSON: '["node","x.mjs"]',
  };
  const env = autoRunSettingsEnvOverlay(
    { autoTriggerEnabled: true, decisionMinConfidence: 0.8 },
    base,
  );
  assert.equal(env.MYAGENTTOOL_AUTOTRIGGER_ENABLED, "1", "set bool overrides");
  assert.equal(env.MYAGENTTOOL_AUTORUN_DECISION_MIN_CONFIDENCE, "0.8", "set number overrides");
  assert.equal(env.MYAGENTTOOL_AUTOTRIGGER_LABEL, "env-label", "unset field keeps env");
  assert.equal(
    env.MYAGENTTOOL_AUTORUN_DECIDER_COMMAND_JSON,
    '["node","x.mjs"]',
    "command argv is never touched by the overlay (trust boundary)",
  );
});

test("empty settings overlay === base env (byte-for-byte, zero behavior change)", () => {
  const base = { MYAGENTTOOL_AUTOTRIGGER_ENABLED: "1", MYAGENTTOOL_AUTORUN_STATUS_WRITEBACK: "1" };
  const env = autoRunSettingsEnvOverlay({}, base);
  assert.deepEqual(env, base);
});

test("resolveAutoRunConfig: settings win over env; commands report configured, never argv", () => {
  const baseEnv = {
    MYAGENTTOOL_AUTOTRIGGER_ENABLED: "0",
    MYAGENTTOOL_AUTORUN_DECIDER_COMMAND_JSON: '["node","decide.mjs"]', // configured
    // no judge/verify command → not configured
  };
  const state = { autoRunSettings: { autoTriggerEnabled: true, spawnIssues: true, decisionMinConfidence: 0.9 } };
  const cfg = resolveAutoRunConfig(state, baseEnv);
  assert.equal(cfg.autoTrigger.enabled, true, "saved setting overrides env off");
  assert.equal(cfg.spawnIssues, true);
  assert.equal(cfg.decision.minConfidence, 0.9);
  assert.equal(cfg.commands.decider, true, "decider command present → configured");
  assert.equal(cfg.commands.judge, false, "no judge command → not configured");
  assert.ok(!("command" in cfg.commands) && typeof cfg.commands.decider === "boolean", "only booleans, never argv");
  assert.equal(cfg.settings.autoTriggerEnabled, true, "raw saved overrides echoed for the edit form");
});

test("resolveAutoRunConfig with empty state reflects env defaults", () => {
  const cfg = resolveAutoRunConfig({}, { MYAGENTTOOL_AUTOTRIGGER_ENABLED: "1" });
  assert.equal(cfg.autoTrigger.enabled, true);
  assert.equal(cfg.autoTrigger.label, "auto", "env/default label");
  assert.equal(cfg.commands.verify, false);
});

test("requireChecksGreenToMerge: normalized bool + exposed in effective config", () => {
  const s = normalizeAutoRunSettings({ requireChecksGreenToMerge: "1" });
  assert.equal(s.requireChecksGreenToMerge, true);
  const cfg = resolveAutoRunConfig({ autoRunSettings: { requireChecksGreenToMerge: true } }, {});
  assert.equal(cfg.requireChecksGreenToMerge, true);
  assert.equal(resolveAutoRunConfig({}, {}).requireChecksGreenToMerge, false, "default off");
});

test("autonomyKillSwitch: normalized bool + exposed in effective config", () => {
  assert.equal(normalizeAutoRunSettings({ autonomyKillSwitch: "1" }).autonomyKillSwitch, true);
  assert.equal(resolveAutoRunConfig({ autoRunSettings: { autonomyKillSwitch: true } }, {}).autonomyKillSwitch, true);
  assert.equal(resolveAutoRunConfig({}, {}).autonomyKillSwitch, false, "default off");
});

test("autoApproveNonCodePaths: normalized bool + exposed", () => {
  assert.equal(normalizeAutoRunSettings({ autoApproveNonCodePaths: "1" }).autoApproveNonCodePaths, true);
  assert.equal(resolveAutoRunConfig({ autoRunSettings: { autoApproveNonCodePaths: true } }, {}).autoApproveNonCodePaths, true);
  assert.equal(resolveAutoRunConfig({}, {}).autoApproveNonCodePaths, false, "default off");
});

test("alertWebhookUrl: validated http(s) in normalize; exposed as configured boolean", () => {
  assert.equal(normalizeAutoRunSettings({ alertWebhookUrl: "https://h.co/x" }).alertWebhookUrl, "https://h.co/x");
  assert.equal(normalizeAutoRunSettings({ alertWebhookUrl: "nope" }).alertWebhookUrl, null);
  const resolved = resolveAutoRunConfig({ autoRunSettings: { alertWebhookUrl: "https://user:secret@h.co/x" } }, {});
  assert.equal(resolved.alertWebhookConfigured, true);
  assert.equal("alertWebhookUrl" in resolved.settings, false);
  assert.equal(JSON.stringify(resolved).includes("user:secret@h.co"), false);
  assert.equal(resolveAutoRunConfig({}, {}).alertWebhookConfigured, false);
});

test("A3 knobs: clamped in normalize + exposed", () => {
  const s = normalizeAutoRunSettings({ globalMaxConcurrent: 999, breakerFailureThreshold: -1, breakerCooldownMinutes: 5 });
  assert.equal(s.globalMaxConcurrent, 100, "clamped to max");
  assert.equal(s.breakerFailureThreshold, 0, "clamped to floor 0");
  assert.equal(s.breakerCooldownMinutes, 5);
  const cfg = resolveAutoRunConfig({ autoRunSettings: { globalMaxConcurrent: 3 } }, {});
  assert.equal(cfg.globalMaxConcurrent, 3);
  assert.equal(cfg.breakerCooldownMinutes, 15, "default cooldown");
});

test("A4: verifyCommandNames exposes the allowlist keys (never argv)", () => {
  const cfg = resolveAutoRunConfig({}, { MYAGENTTOOL_AUTORUN_VERIFY_COMMANDS_JSON: JSON.stringify({ maven: ["mvn", "test"], npm: ["npm", "test"] }) });
  assert.deepEqual(cfg.verifyCommandNames.sort(), ["maven", "npm"]);
  assert.equal(resolveAutoRunConfig({}, {}).verifyCommandNames.length, 0);
});

test("tunable SLO targets: normalize validates + drops out-of-range; empty → null", () => {
  const s = normalizeAutoRunSettings({ sloTargets: { prSuccessRate: 0.9, failureRate: 5, timeToPrMedianSeconds: 600, junk: 1 } });
  assert.deepEqual(s.sloTargets, { prSuccessRate: 0.9, timeToPrMedianSeconds: 600 }, "failureRate 5 dropped, junk dropped");
  assert.equal(normalizeAutoRunSettings({ sloTargets: {} }).sloTargets, null);
  assert.equal(normalizeAutoRunSettings({ sloTargets: "x" }).sloTargets, null);
});

test("routing health thresholds are configurable and bounded", () => {
  const settings = normalizeAutoRunSettings({
    routingThresholds: { minSamples: 10, windowDays: 45, fallbackRate: 0.15, lowConfidenceRate: 2, latencyP90Ms: 8000 },
  });
  assert.deepEqual(settings.routingThresholds, {
    minSamples: 10,
    windowDays: 45,
    fallbackRate: 0.15,
    latencyP90Ms: 8000,
  });
  assert.equal(normalizeAutoRunSettings({ routingThresholds: {} }).routingThresholds, null);
});
