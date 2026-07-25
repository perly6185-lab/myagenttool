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
import { resolveReviewCommand } from "./auto-run-review.mjs";
import { resolveDeployCommand, resolveRollbackCommand } from "./auto-run-deploy.mjs";
import { resolveDesignRenderCommand } from "./design-render.mjs";
import { DEFAULT_SENSITIVE_PATHS } from "./auto-run-risk.mjs";
import { resolveStatusWritebackConfig } from "./issue-status.mjs";
import { resolveAutoRunVerifyCommand, resolveVerifyCommandAllowlist } from "./worktree-verify.mjs";
import { decisionConfig } from "./auto-run-decision.mjs";
import { spawnIssuesConfig } from "./auto-run-spawn.mjs";
import { normalizeAlertWebhookUrl } from "./auto-run-alerts.mjs";

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

// Validate operator SLO-target overrides: rates in [0,1], time in positive
// seconds. Unknown/invalid keys are dropped; empty → null (use all defaults).
function normalizeSloTargets(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  const rate = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined; };
  const posInt = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : undefined; };
  const pr = rate(value.prSuccessRate); if (pr !== undefined) out.prSuccessRate = pr;
  const fr = rate(value.failureRate); if (fr !== undefined) out.failureRate = fr;
  const ar = rate(value.attentionRate); if (ar !== undefined) out.attentionRate = ar;
  const tt = posInt(value.timeToPrMedianSeconds); if (tt !== undefined) out.timeToPrMedianSeconds = tt;
  return Object.keys(out).length ? out : null;
}

function normalizeRoutingThresholds(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  const rate = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined; };
  const positive = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : undefined; };
  const minSamples = positive(value.minSamples); if (minSamples !== undefined) out.minSamples = Math.min(1000, minSamples);
  const windowDays = positive(value.windowDays); if (windowDays !== undefined) out.windowDays = Math.min(365, windowDays);
  const fallbackRate = rate(value.fallbackRate); if (fallbackRate !== undefined) out.fallbackRate = fallbackRate;
  const lowConfidenceRate = rate(value.lowConfidenceRate); if (lowConfidenceRate !== undefined) out.lowConfidenceRate = lowConfidenceRate;
  const latencyP90Ms = positive(value.latencyP90Ms); if (latencyP90Ms !== undefined) out.latencyP90Ms = Math.min(300_000, latencyP90Ms);
  return Object.keys(out).length ? out : null;
}

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
    // UI-only guard (no env twin): block the in-tool merge unless PR checks are
    // green. Null/false = allow the informed-but-unblocked human merge.
    requireChecksGreenToMerge: keep("requireChecksGreenToMerge", asBool),
    // Fail closed before publishing code when the operator requires a real
    // project verification command. Default off preserves existing projects.
    requireVerification: keep("requireVerification", asBool),
    // O0 kill switch (UI-only): when true, halt ALL autonomous runs (auto-trigger
    // stops scanning and startAutoRun refuses). The global emergency brake.
    autonomyKillSwitch: keep("autonomyKillSwitch", asBool),
    // O2 graduated approval (UI-only): auto-approve NON-CODE paths (design/
    // clarify/prototype). develop and merge always stay human. Default off.
    autoApproveNonCodePaths: keep("autoApproveNonCodePaths", asBool),
    // #1150 (UI-only, default off): mirror an issue's develop claim to the
    // GitHub assignee (gh issue edit --add/--remove-assignee @me). Best-effort;
    // the local claim stays authoritative. Off = no GitHub writes (the default
    // posture, same as statusWriteback).
    issueAssigneeMirror: keep("issueAssigneeMirror", asBool),
    // Self-repair: how many times a develop run may re-attempt after a verify
    // failure (feeding the failure back to the agent) before it blocks. 0 disables.
    maxRepairAttempts: keep("maxRepairAttempts", (v) => clampInt(v, 0, 3)),
    // #890 budget reservations (UI-only). The per-run USD hold placed at admission
    // so concurrent runs can't jointly exceed a hard block budget. 0 = disabled
    // (accounting-only, no admission holds — the default, byte-identical to before).
    reservationEstimateUsd: keep("reservationEstimateUsd", (v) => clampNum(v, 0, 1_000_000)),
    // A1 alerting (UI-only): operator webhook for real-time operational alerts.
    // Validated http(s); a typo/blank clears it (alerting disabled).
    alertWebhookUrl: keep("alertWebhookUrl", (v) => normalizeAlertWebhookUrl(v)),
    // Tail: operator-tunable SLO targets (partial object; unset keys keep the
    // defaults). Each value validated to its range; empty → null (all defaults).
    sloTargets: keep("sloTargets", (v) => normalizeSloTargets(v)),
    routingThresholds: keep("routingThresholds", (v) => normalizeRoutingThresholds(v)),
    // A3 reliability (UI-only). globalMaxConcurrent 0 = unlimited. Breaker
    // threshold 0 = disabled; cooldown in minutes.
    globalMaxConcurrent: keep("globalMaxConcurrent", (v) => clampInt(v, 0, 100)),
    breakerFailureThreshold: keep("breakerFailureThreshold", (v) => clampInt(v, 0, 50)),
    breakerCooldownMinutes: keep("breakerCooldownMinutes", (v) => clampInt(v, 1, 1440)),
    // D3 (UI-only, default off): a design run whose only changes live under
    // design/ delivers them as report + in-console mockup preview, not a PR.
    designArtifacts: keep("designArtifacts", asBool),
    // Layer B (UI-only, default off): render the design mockups to PNGs, push the
    // design branch, and embed the previews inline on the issue. Pushes a branch.
    designImagesToIssue: keep("designImagesToIssue", asBool),
    // Epic decomposition (UI-only, default off): an epic/initiative routes to the
    // decompose path (a proposed plan of child issues, not a diff). epicMaxChildren
    // caps the fan-out. EPIC_DECOMPOSITION_PLAN.md.
    epicDecomposition: keep("epicDecomposition", asBool),
    epicMaxChildren: keep("epicMaxChildren", (v) => clampInt(v, 1, 20)),
    // Risk-based merge (UI-only, default off): auto-merge low-risk PRs; the diff
    // line cap above which a PR is never auto-merged (falls to a human merge).
    autoMergeLowRisk: keep("autoMergeLowRisk", asBool),
    autoMergeMaxDiffLines: keep("autoMergeMaxDiffLines", (v) => clampInt(v, 1, 100_000)),
    // Sensitive-path guard: glob list; a diff touching any is never auto-merged.
    // Null = use the conservative DEFAULT_SENSITIVE_PATHS.
    autoMergeSensitivePaths: keep("autoMergeSensitivePaths", (v) => normalizeGlobList(v)),
    // Deploy stage (D1, UI-only opt-in, default off): after a PR merges, run the
    // operator's deploy command. Inert unless MYAGENTTOOL_AUTORUN_DEPLOY_COMMAND_JSON
    // is also set (a toggle with no command never deploys).
    deployOnMerge: keep("deployOnMerge", asBool),
    // Approval grants phase 2 (APPROVAL_GRANTS.md, default off): when true,
    // legacy free-text approvalTokens are rejected — only issued grants pass.
    // Flip once approvalTokenLegacyUses flatlines.
    requireIssuedApprovals: keep("requireIssuedApprovals", asBool),
    // Self-healing (H1, opt-in, default off): on a deploy FAILURE, run the
    // operator's rollback command to restore the last good version (the recovery).
    // Inert unless MYAGENTTOOL_AUTORUN_ROLLBACK_COMMAND_JSON is set.
    rollbackOnDeployFailure: keep("rollbackOnDeployFailure", asBool),
    // Self-healing (H2, opt-in, default off): on a deploy FAILURE, file a
    // remediation issue (labeled `auto`, carrying a Change-failure: #N marker) so
    // the loop fixes it forward and re-deploys. A GitHub write — off by default.
    remediateOnDeployFailure: keep("remediateOnDeployFailure", asBool),
  };
}

function normalizeGlobList(v) {
  if (!Array.isArray(v)) return null;
  const list = v.map((s) => String(s).trim()).filter(Boolean).slice(0, 100);
  return list.length ? list : null;
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
  const { alertWebhookUrl: _alertWebhookUrl, ...publicSettings } = settings;
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
    // UI-only guard (not env-backed): require green PR checks before an in-tool merge.
    requireChecksGreenToMerge: Boolean(settings.requireChecksGreenToMerge),
    requireVerification: Boolean(settings.requireVerification),
    // O0 global kill switch (not env-backed): halts all autonomous runs.
    autonomyKillSwitch: Boolean(settings.autonomyKillSwitch),
    // Approval grants phase-2 (not env-backed): reject legacy free-text approvalTokens.
    requireIssuedApprovals: Boolean(settings.requireIssuedApprovals),
    // O2 graduated approval (not env-backed): auto-approve non-code paths.
    autoApproveNonCodePaths: Boolean(settings.autoApproveNonCodePaths),
    // Self-repair attempt cap (not env-backed); default 2, 0 disables the loop.
    maxRepairAttempts: Number.isInteger(settings.maxRepairAttempts) ? settings.maxRepairAttempts : 2,
    // #890 per-run budget hold at admission (not env-backed); 0 = disabled.
    reservationEstimateUsd: Number(settings.reservationEstimateUsd ?? 0) || 0,
    // A1 alerting: whether an operational-alert webhook is configured.
    alertWebhookConfigured: Boolean(settings.alertWebhookUrl),
    // A3 reliability knobs (effective values; 0 = off).
    globalMaxConcurrent: Number(settings.globalMaxConcurrent ?? 0) || 0,
    breakerFailureThreshold: Number(settings.breakerFailureThreshold ?? 0) || 0,
    breakerCooldownMinutes: Number(settings.breakerCooldownMinutes ?? 15) || 15,
    // D3: design runs deliver design/-only changes as in-console mockups.
    designArtifacts: Boolean(settings.designArtifacts),
    // Layer B: embed rendered mockup previews inline on the issue (pushes a branch).
    designImagesToIssue: Boolean(settings.designImagesToIssue),
    // Epic decomposition: route epics to a proposed child-issue plan; fan-out cap.
    epicDecomposition: Boolean(settings.epicDecomposition),
    epicMaxChildren: Number(settings.epicMaxChildren ?? 8) || 8,
    // Risk-based merge: opt-in auto-merge of low-risk PRs + the diff-size cap.
    autoMergeLowRisk: Boolean(settings.autoMergeLowRisk),
    autoMergeMaxDiffLines: Number(settings.autoMergeMaxDiffLines ?? 400) || 400,
    autoMergeSensitivePaths:
      Array.isArray(settings.autoMergeSensitivePaths) && settings.autoMergeSensitivePaths.length
        ? settings.autoMergeSensitivePaths
        : DEFAULT_SENSITIVE_PATHS,
    // Deploy stage: opt-in run of the operator deploy command after a merge.
    deployOnMerge: Boolean(settings.deployOnMerge),
    // Self-healing: opt-in auto-rollback when a deploy fails.
    rollbackOnDeployFailure: Boolean(settings.rollbackOnDeployFailure),
    // Self-healing: opt-in auto-remediation issue when a deploy fails.
    remediateOnDeployFailure: Boolean(settings.remediateOnDeployFailure),
    // Command knobs are env-only; expose only whether each is configured.
    commands: {
      verify: Boolean(resolveAutoRunVerifyCommand()),
      decider: Boolean(resolveDeciderCommand(env)),
      judge: Boolean(resolveJudgeCommand(env)),
      review: Boolean(resolveReviewCommand(env)),
      designRender: Boolean(resolveDesignRenderCommand(env)),
      deploy: Boolean(resolveDeployCommand(env)),
      rollback: Boolean(resolveRollbackCommand(env)),
    },
    // A4: named verify-command allowlist (keys only — never argv). A project
    // selects one of these by name; empty = only the global verify command (if any).
    verifyCommandNames: Object.keys(resolveVerifyCommandAllowlist(env)),
    // Saved safe overrides for the edit form. Webhook targets may contain
    // credentials, so only alertWebhookConfigured above crosses this boundary.
    settings: publicSettings,
  };
}
