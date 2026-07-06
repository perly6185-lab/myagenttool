/*
 * Auto-run configuration: a persisted settings overlay over the env-var knobs,
 * plus an effective-config resolver for the console panel.
 *
 * The auto-run line has ~13 env knobs (docs/engineering/AUTORUN_PILOT_RUNBOOK).
 * This lets an operator edit the SAFE ones (toggles + thresholds) in the UI
 * instead of the shell, while the three COMMAND knobs (verify/decider/judge
 * argv) deliberately STAY env-only — they choose what subprocess runs, a trust
 * boundary that must not be settable from the client. The panel shows them
 * read-only as "configured / not".
 *
 * Model: settings are a flat object; a field left null/undefined inherits the
 * env value (so an empty settings object === today's behavior, byte-for-byte).
 * The overlay maps set fields back to their env keys and hands the result to the
 * existing `resolve*Config(env)` functions — no resolver internals change.
 * Applied at composer time, so edits take effect on the next server start.
 */

import { resolveAutoTriggerConfig } from "./auto-trigger.mjs";
import { deciderTimeoutMs, resolveDeciderCommand } from "./decision-command.mjs";
import { judgeTimeoutMs, resolveJudgeCommand } from "./auto-run-judge.mjs";
import { resolveStatusWritebackConfig } from "./issue-status.mjs";
import { resolveAutoRunVerifyCommand } from "./worktree-verify.mjs";
import { decisionConfig } from "./auto-run-decision.mjs";
import { spawnIssuesConfig } from "./auto-run-spawn.mjs";

// The env key each safe setting maps onto, so the overlay and the panel agree.
const SETTING_ENV = {
  autoTriggerEnabled: "MYAGENTTOOL_AUTOTRIGGER_ENABLED",
  autoTriggerLabel: "MYAGENTTOOL_AUTOTRIGGER_LABEL",
  autoTriggerMaxConcurrent: "MYAGENTTOOL_AUTOTRIGGER_MAX_CONCURRENT",
  autoTriggerRequireProjectFields: "MYAGENTTOOL_AUTOTRIGGER_REQUIRE_PROJECT_FIELDS",
  statusWriteback: "MYAGENTTOOL_AUTORUN_STATUS_WRITEBACK",
  spawnIssues: "MYAGENTTOOL_AUTORUN_SPAWN_ISSUES",
  decisionMinConfidence: "MYAGENTTOOL_AUTORUN_DECISION_MIN_CONFIDENCE",
  deciderFastPath: "MYAGENTTOOL_AUTORUN_DECIDER_FAST_PATH",
  deciderTimeoutMs: "MYAGENTTOOL_AUTORUN_DECIDER_TIMEOUT_MS",
  judgeTimeoutMs: "MYAGENTTOOL_AUTORUN_JUDGE_TIMEOUT_MS",
};

const asBool = (v) => v === true || v === "1" || v === "true";
const clampInt = (v, lo, hi) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};
const clampNum = (v, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};

/**
 * Validate a settings patch into a clean flat object, carrying prior values for
 * fields not present in the patch. A field explicitly set to null clears the
 * override (back to env inheritance); an out-of-range value is dropped (null).
 */
export function normalizeAutoRunSettings(patch = {}, prev = {}) {
  const p = patch && typeof patch === "object" ? patch : {};
  const has = (k) => Object.prototype.hasOwnProperty.call(p, k);
  const keep = (k, coerce) => {
    if (!has(k)) return prev[k] ?? null;
    if (p[k] === null || p[k] === undefined) return null;
    return coerce(p[k]);
  };
  const label = keep("autoTriggerLabel", (v) => {
    const s = String(v).trim();
    return s ? s.slice(0, 64) : null;
  });
  return {
    autoTriggerEnabled: keep("autoTriggerEnabled", asBool),
    autoTriggerLabel: label,
    autoTriggerMaxConcurrent: keep("autoTriggerMaxConcurrent", (v) => clampInt(v, 1, 10)),
    autoTriggerRequireProjectFields: keep("autoTriggerRequireProjectFields", asBool),
    statusWriteback: keep("statusWriteback", asBool),
    spawnIssues: keep("spawnIssues", asBool),
    decisionMinConfidence: keep("decisionMinConfidence", (v) => clampNum(v, 0, 1)),
    deciderFastPath: keep("deciderFastPath", asBool),
    deciderTimeoutMs: keep("deciderTimeoutMs", (v) => clampInt(v, 1000, 300_000)),
    judgeTimeoutMs: keep("judgeTimeoutMs", (v) => clampInt(v, 1000, 300_000)),
  };
}

/**
 * Build an env-like object where each SET safe knob overrides its env key.
 * Unset (null/undefined) fields are left to `baseEnv` — so an empty settings
 * object returns baseEnv's values unchanged. Command argv keys are never
 * touched (they stay env-only, the trust boundary).
 */
export function autoRunSettingsEnvOverlay(settings = {}, baseEnv = process.env) {
  const env = { ...baseEnv };
  const s = settings && typeof settings === "object" ? settings : {};
  const setBool = (key, val) => {
    if (val === undefined || val === null) return;
    env[key] = val ? "1" : "0";
  };
  const setRaw = (key, val) => {
    if (val === undefined || val === null) return;
    env[key] = String(val);
  };
  setBool(SETTING_ENV.autoTriggerEnabled, s.autoTriggerEnabled);
  setRaw(SETTING_ENV.autoTriggerLabel, s.autoTriggerLabel);
  setRaw(SETTING_ENV.autoTriggerMaxConcurrent, s.autoTriggerMaxConcurrent);
  setBool(SETTING_ENV.autoTriggerRequireProjectFields, s.autoTriggerRequireProjectFields);
  setBool(SETTING_ENV.statusWriteback, s.statusWriteback);
  setBool(SETTING_ENV.spawnIssues, s.spawnIssues);
  setRaw(SETTING_ENV.decisionMinConfidence, s.decisionMinConfidence);
  setBool(SETTING_ENV.deciderFastPath, s.deciderFastPath);
  setRaw(SETTING_ENV.deciderTimeoutMs, s.deciderTimeoutMs);
  setRaw(SETTING_ENV.judgeTimeoutMs, s.judgeTimeoutMs);
  return env;
}

/**
 * The effective auto-run config for the console panel: every knob's resolved
 * value (settings overlaid on env) plus a `configured` boolean for each command
 * knob. NEVER returns the command argv itself — that stays server-side.
 */
export function resolveAutoRunConfig(state = {}, baseEnv = process.env) {
  const settings = state?.autoRunSettings ?? {};
  const env = autoRunSettingsEnvOverlay(settings, baseEnv);
  const autoTrigger = resolveAutoTriggerConfig(env);
  const decision = decisionConfig(env);
  return {
    autoTrigger,
    statusWriteback: resolveStatusWritebackConfig(env).enabled,
    spawnIssues: spawnIssuesConfig(env).enabled,
    decision,
    deciderTimeoutMs: deciderTimeoutMs(env),
    judgeTimeoutMs: judgeTimeoutMs(env),
    // Command knobs are env-only; expose only whether each is configured.
    commands: {
      verify: Boolean(resolveAutoRunVerifyCommand()),
      decider: Boolean(resolveDeciderCommand(env)),
      judge: Boolean(resolveJudgeCommand(env)),
    },
    // The raw saved overrides, so the edit form can show what's explicitly set
    // (null field = inheriting the env default).
    settings,
  };
}
