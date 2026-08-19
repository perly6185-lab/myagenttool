import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { startAutomationScheduler } from "./runtime/automation-scheduler.mjs";
import { startAutoTriggerScheduler } from "./runtime/auto-trigger-scheduler.mjs";
import { createDingtalkClient } from "./gateway/dingtalk-client.mjs";
import { createDingtalkGateway, dingtalkGatewayConfigFromEnv } from "./gateway/dingtalk-gateway.mjs";
import { createFeishuClient } from "./gateway/feishu-client.mjs";
import { createFeishuGateway, feishuGatewayConfigFromEnv } from "./gateway/feishu-gateway.mjs";
import { createSlackClient } from "./gateway/slack-client.mjs";
import { createSlackGateway, slackGatewayConfigFromEnv } from "./gateway/slack-gateway.mjs";
import { createTeamsClient } from "./gateway/teams-client.mjs";
import { createTeamsGateway, teamsGatewayConfigFromEnv } from "./gateway/teams-gateway.mjs";
import { createWecomClient } from "./gateway/wecom-client.mjs";
import { createWecomGateway, wecomGatewayConfigFromEnv } from "./gateway/wecom-gateway.mjs";
import { createHttpServer } from "./runtime/http-server.mjs";
import { runProtocolSelfCheck } from "./runtime/self-check.mjs";
import { createServerRuntimeServices } from "./runtime/service-composer.mjs";
import { createServerState } from "./runtime/state-factory.mjs";
import { acquireStateLock } from "./runtime/state-lock.mjs";
import { applyRetentionPolicies } from "./services/retention.mjs";
import { createMailQueryIndex, mailQueryIndexPath, openMailQueryIndexDatabase } from "./services/mail-query-index.mjs";

const namespace = "com.myagenttool";
const protocolVersion = "0.0.0";
const host = process.env.SERVER_HOST ?? "127.0.0.1";
const port = Number(process.env.SERVER_PORT ?? 5001);
const dispatchLeaseMs = Number(process.env.SERVER_DISPATCH_LEASE_MS ?? 30_000);
const isSelfCheck = process.argv.includes("--check");
const persistenceEnabled = !isSelfCheck && process.env.MYAGENTTOOL_STATE_DISABLED !== "1";
const stateStorePath = resolve(process.env.MYAGENTTOOL_STATE_PATH ?? ".myagenttool/state/local-demo-state.json");
const stateSchemaVersion = 1;
const defaultProjectPath = resolve(process.env.MYAGENTTOOL_PROJECT_PATH ?? process.cwd());

// #890 single-writer lock: acquire BEFORE the composer restores/writes the state
// file, so a second live server on the same host refuses to start instead of
// clobbering this one's snapshot. Only when persistence is real (skips --check and
// MYAGENTTOOL_STATE_DISABLED); disable entirely with MYAGENTTOOL_STATE_LOCK=0.
let releaseStateLock = () => {};
if (persistenceEnabled && process.env.MYAGENTTOOL_STATE_LOCK !== "0") {
  const lock = acquireStateLock(stateStorePath, { now });
  if (!lock.ok) {
    const heldBy = lock.heldBy ? ` (held by pid ${lock.heldBy.pid} on ${lock.heldBy.hostname} since ${lock.heldBy.acquiredAt})` : "";
    console.error(`[server] another server already owns ${stateStorePath}${heldBy}. Refusing to start to avoid clobbering its state. Stop the other process, or set MYAGENTTOOL_STATE_LOCK=0 to override.`);
    process.exit(1);
  }
  releaseStateLock = lock.release;
}

// #1003 Phase C: SQLite is the DEFAULT durable backing (set MYAGENTTOOL_STORE=memory
// to opt back into the legacy JSON-only snapshot). The in-memory `state` stays the
// live view; its commit mirrors to SQLite and boot hydrates from it, and the JSON
// snapshot is kept current too as a warm fallback (Phase C step 3 retires it).
// Opened here (index has top-level await) since node:sqlite loads lazily; the
// composer stays synchronous. Degrades LOUDLY to the JSON backing if the runtime
// lacks node:sqlite — the server stays up rather than refusing to boot.
let sqliteStore = null;
let closeSqliteStore = () => {};
if (persistenceEnabled && (process.env.MYAGENTTOOL_STORE ?? "sqlite").toLowerCase() === "sqlite") {
  const sqlitePath = `${stateStorePath.replace(/\.json$/, "")}.sqlite`;
  try {
    // The persistence runtime creates the state dir on its first write, which is
    // AFTER this open — so ensure it exists now, or node:sqlite can't create the file.
    mkdirSync(dirname(sqlitePath), { recursive: true });
    const { openSqliteStore } = await import("./runtime/store/sqlite-store.mjs");
    sqliteStore = await openSqliteStore({ path: sqlitePath });
    closeSqliteStore = () => sqliteStore.close();
    console.log(`[store:sqlite] durable backing at ${sqlitePath}`);
  } catch (error) {
    console.warn(`[store:sqlite] requested but unavailable (${error?.message ?? error}); falling back to the JSON snapshot backing.`);
    sqliteStore = null;
  }
}

// M7: a separate, derived mailbox read index. It is never the source of truth;
// failure only disables the large-mailbox fast path and leaves the mailbox on
// its existing in-memory projection.
let mailQueryIndex = null;
if (persistenceEnabled && process.env.MYAGENTTOOL_MAIL_QUERY_INDEX !== "0") {
  const queryPath = mailQueryIndexPath(stateStorePath);
  try {
    const database = await openMailQueryIndexDatabase({ path: queryPath });
    mailQueryIndex = createMailQueryIndex({
      database,
      now: () => new Date().toISOString(),
      onDiagnostic: ({ kind, reason, errorCode }) => console.warn(
        `[mail-query] ${kind}: ${reason}${errorCode ? ` (${errorCode})` : ""}; rebuilding from local facts.`,
      ),
    });
    console.log(`[mail-query] derived index at ${queryPath}`);
  } catch (error) {
    console.warn(`[mail-query] index unavailable (${error?.message ?? error}); using the in-memory mailbox projection.`);
  }
}

const { defaultProject, state } = createServerState({ defaultProjectPath, now });
const {
  httpDependencies,
  savePersistentState,
  exportJsonSnapshot,
  selfCheckDependencies,
  appendEvent,
  startLocalContentIndexing,
  closeRuntimeServices,
} = createServerRuntimeServices({
  namespace,
  protocolVersion,
  state,
  defaultProject,
  defaultProjectPath,
  persistenceEnabled,
  stateStorePath,
  stateSchemaVersion,
  dispatchLeaseMs,
  now,
  sqliteStore,
  mailQueryIndex,
});

if (isSelfCheck) {
  await runProtocolSelfCheck(selfCheckDependencies);
  console.log("[server:check] local demo server check OK");
  process.exit(0);
}

const server = createHttpServer({
  host,
  port,
  namespace,
  protocolVersion,
  ...httpDependencies,
});

server.listen(port, host, () => {
  console.log(`[server] http://${host}:${port}`);
  void startLocalContentIndexing().catch((error) => {
    console.warn(`[local-content] automatic indexing could not start: ${error?.message ?? error}`);
  });
});

// Channel gateways (#1090/#1110; ADR 0012 rule 1 + ADR 0013): each provider is
// its OWN public listener serving nothing but its callback path — off unless
// fully configured. Secrets stay in this process's env; each gateway forwards
// verified, decrypted, normalized events into the shared importChannelEvent, and
// the control-plane API is never reachable on any gateway port.
{
  let anySenderBound = false;
  let channelDeliverySweepStarted = false;
  const startChannelDeliverySweep = () => {
    if (channelDeliverySweepStarted) return;
    channelDeliverySweepStarted = true;
    const sweep = () => httpDependencies.sweepChannelDeliveries().catch(() => {});
    sweep();
    setInterval(sweep, 15_000).unref?.();
  };
  let channelNotificationSweepStarted = false;
  const startChannelNotificationSweep = () => {
    if (channelNotificationSweepStarted || typeof httpDependencies.sweepChannelNotifications !== "function") return;
    channelNotificationSweepStarted = true;
    const sweep = () => Promise.resolve(httpDependencies.sweepChannelNotifications()).catch(() => {});
    sweep();
    setInterval(sweep, 30_000).unref?.();
  };

  // WeCom (#1090).
  const wecomConfig = wecomGatewayConfigFromEnv();
  // receiveId (CorpID) is REQUIRED to activate: the crypto's tenant-binding check
  // is skipped when it's unset (#channel-audit), so a missing WECOM_CORP_ID would
  // silently run with cross-corp isolation disabled. Fail closed — don't start.
  if (wecomConfig.port && wecomConfig.token && wecomConfig.encodingAesKey && wecomConfig.channelId && wecomConfig.receiveId) {
    startChannelNotificationSweep();
    createWecomGateway({
      token: wecomConfig.token,
      encodingAesKey: wecomConfig.encodingAesKey,
      receiveId: wecomConfig.receiveId,
      channelId: wecomConfig.channelId,
      importChannelEvent: httpDependencies.importChannelEvent,
    }).createServer().listen(wecomConfig.port, wecomConfig.host, () => {
      console.log(`[wecom-gateway] callback listener on ${wecomConfig.host}:${wecomConfig.port} → channel ${wecomConfig.channelId}`);
    });
    const corpSecret = String(process.env.WECOM_CORP_SECRET ?? "").trim();
    const agentId = String(process.env.WECOM_AGENT_ID ?? "").trim();
    if (corpSecret && agentId && wecomConfig.receiveId) {
      const client = createWecomClient({ corpId: wecomConfig.receiveId, corpSecret, agentId });
      httpDependencies.setChannelDeliverySender("wecom", client.sendApplicationMessage);
      anySenderBound = true;
    }
  }

  // Feishu / Lark (#1110).
  const feishuConfig = feishuGatewayConfigFromEnv();
  if (feishuConfig.port && feishuConfig.verificationToken && feishuConfig.encryptKey && feishuConfig.channelId) {
    createFeishuGateway({
      verificationToken: feishuConfig.verificationToken,
      encryptKey: feishuConfig.encryptKey,
      channelId: feishuConfig.channelId,
      importChannelEvent: httpDependencies.importChannelEvent,
    }).createServer().listen(feishuConfig.port, feishuConfig.host, () => {
      console.log(`[feishu-gateway] callback listener on ${feishuConfig.host}:${feishuConfig.port} → channel ${feishuConfig.channelId}`);
    });
    const appId = String(process.env.FEISHU_APP_ID ?? "").trim();
    const appSecret = String(process.env.FEISHU_APP_SECRET ?? "").trim();
    const baseUrl = String(process.env.FEISHU_BASE_URL ?? "").trim() || undefined;
    if (appId && appSecret) {
      const client = createFeishuClient({ appId, appSecret, baseUrl });
      httpDependencies.setChannelDeliverySender("feishu", client.sendApplicationMessage);
      anySenderBound = true;
    }
  }

  // DingTalk / 钉钉 (#1119).
  const dingtalkConfig = dingtalkGatewayConfigFromEnv();
  if (dingtalkConfig.port && dingtalkConfig.appSecret && dingtalkConfig.channelId) {
    createDingtalkGateway({
      appSecret: dingtalkConfig.appSecret,
      channelId: dingtalkConfig.channelId,
      importChannelEvent: httpDependencies.importChannelEvent,
    }).createServer().listen(dingtalkConfig.port, dingtalkConfig.host, () => {
      console.log(`[dingtalk-gateway] callback listener on ${dingtalkConfig.host}:${dingtalkConfig.port} → channel ${dingtalkConfig.channelId}`);
    });
    const appKey = String(process.env.DINGTALK_APP_KEY ?? "").trim();
    const robotCode = String(process.env.DINGTALK_ROBOT_CODE ?? "").trim();
    const baseUrl = String(process.env.DINGTALK_BASE_URL ?? "").trim() || undefined;
    if (appKey && robotCode) {
      const client = createDingtalkClient({ appKey, appSecret: dingtalkConfig.appSecret, robotCode, baseUrl });
      httpDependencies.setChannelDeliverySender("dingtalk", client.sendApplicationMessage);
      anySenderBound = true;
    }
  }

  // Slack (#1128).
  const slackConfig = slackGatewayConfigFromEnv();
  if (slackConfig.port && slackConfig.signingSecret && slackConfig.channelId) {
    createSlackGateway({
      signingSecret: slackConfig.signingSecret,
      channelId: slackConfig.channelId,
      importChannelEvent: httpDependencies.importChannelEvent,
    }).createServer().listen(slackConfig.port, slackConfig.host, () => {
      console.log(`[slack-gateway] callback listener on ${slackConfig.host}:${slackConfig.port} → channel ${slackConfig.channelId}`);
    });
    const botToken = String(process.env.SLACK_BOT_TOKEN ?? "").trim();
    if (botToken) {
      const client = createSlackClient({ botToken });
      httpDependencies.setChannelDeliverySender("slack", client.sendApplicationMessage);
      anySenderBound = true;
    }
  }

  // Microsoft Teams (#1135).
  const teamsConfig = teamsGatewayConfigFromEnv();
  if (teamsConfig.port && teamsConfig.appId && teamsConfig.channelId) {
    createTeamsGateway({
      appId: teamsConfig.appId,
      channelId: teamsConfig.channelId,
      importChannelEvent: httpDependencies.importChannelEvent,
    }).createServer().listen(teamsConfig.port, teamsConfig.host, () => {
      console.log(`[teams-gateway] callback listener on ${teamsConfig.host}:${teamsConfig.port} → channel ${teamsConfig.channelId}`);
    });
    const appPassword = String(process.env.TEAMS_APP_PASSWORD ?? "").trim();
    if (appPassword) {
      const client = createTeamsClient({ appId: teamsConfig.appId, appPassword });
      httpDependencies.setChannelDeliverySender("teams", client.sendApplicationMessage);
      anySenderBound = true;
    }
  }

  // One delivery sweep serves every provider (delivery routes by channel.provider).
  if (anySenderBound) {
    startChannelDeliverySweep(); // restart recovery: resume queued/retrying deliveries on boot
    startChannelNotificationSweep();
  }

  // WeChat ClawBot / iLink is a client-side long-poll channel, not a public
  // callback listener. Its worker owns the provider credential and routes only
  // normalized events into the shared channel pipeline.
  if (typeof httpDependencies.sendIlinkApplicationMessage === "function") {
    httpDependencies.setChannelDeliverySender("wechat_ilink", httpDependencies.sendIlinkApplicationMessage);
    startChannelDeliverySweep();
    startChannelNotificationSweep();
  }
  httpDependencies.startIlink?.();
}

// Fire due automations on a 30s tick (self-check exits above, so this only runs
// for a real server). Pulls the same composed helpers the routes use.
startAutomationScheduler({ now, ...httpDependencies });

// Phase 3 auto-trigger: scan labeled issues and start auto-runs. Off unless
// MYAGENTTOOL_AUTOTRIGGER_ENABLED is set — returns null (no timer) otherwise.
startAutoTriggerScheduler({ state, ...httpDependencies });

// O1 reliability: reconcile stuck/orphaned auto-runs once on boot (recover from
// a crash), then sweep on a slow tick so nothing lingers active forever.
if (typeof httpDependencies.reapStuckAutoRuns === "function") {
  httpDependencies.reapStuckAutoRuns().catch(() => {});
  setInterval(() => httpDependencies.reapStuckAutoRuns().catch(() => {}), 60_000).unref?.();
}
if (typeof httpDependencies.sweepWorkItemAutoRunBatches === "function") {
  httpDependencies.sweepWorkItemAutoRunBatches().catch(() => {});
  setInterval(() => httpDependencies.sweepWorkItemAutoRunBatches().catch(() => {}), 10_000).unref?.();
}
if (typeof httpDependencies.sweepWorkItemAutoScheduler === "function") {
  const sweepAutoScheduler = () => httpDependencies.sweepWorkItemAutoScheduler().catch(() => {});
  sweepAutoScheduler();
  setInterval(sweepAutoScheduler, 10_000).unref?.();
}
if (typeof httpDependencies.sweepChannelTaskThreads === "function") {
  const sweepChannelTaskThreads = () => {
    try { httpDependencies.sweepChannelTaskThreads(); } catch { /* best-effort channel timeout sweep */ }
  };
  sweepChannelTaskThreads();
  setInterval(sweepChannelTaskThreads, 60_000).unref?.();
}
if (typeof httpDependencies.reconcileWorkItemAutoRunUnderstanding === "function") {
  const reconcileUnderstanding = () =>
    httpDependencies.reconcileWorkItemAutoRunUnderstanding().catch(() => {});
  reconcileUnderstanding();
  setInterval(reconcileUnderstanding, 10_000).unref?.();
}
if (typeof httpDependencies.sweepWorkflowAdaptiveMonitors === "function") {
  const sweepAdaptiveMonitors = () =>
    httpDependencies.sweepWorkflowAdaptiveMonitors().catch((error) =>
      console.error(`[adaptive-monitor] ${error?.message ?? error}`));
  sweepAdaptiveMonitors();
  setInterval(sweepAdaptiveMonitors, 60_000).unref?.();
}

// Resume approved Project actions after a restart and keep draining the durable
// queue. Each execution is moved to running before awaiting external work, so a
// concurrent tick cannot consume it twice.
if (typeof httpDependencies.processPlanningRecommendedActions === "function") {
  const processPlanningActions = () =>
    httpDependencies.processPlanningRecommendedActions().catch((error) =>
      console.error(`[planning-actions] ${error?.message ?? error}`));
  processPlanningActions();
  setInterval(processPlanningActions, 30_000).unref?.();
}

// #6: issue-claim leases expire lazily (only when an admission path looks at
// them). A slow proactive sweep settles expired claims even when nobody re-claims
// or lists that project — so the issue_claim_expired event/history fire promptly
// and the GitHub assignee mirror is removed (admission was already expiry-safe).
// Self-durable via the service's runTx; persist only when something expired.
if (typeof httpDependencies.sweepExpiredClaims === "function") {
  const sweepClaims = () => {
    try {
      if (httpDependencies.sweepExpiredClaims() > 0) savePersistentState();
    } catch {
      /* best-effort claim sweep */
    }
  };
  sweepClaims();
  setInterval(sweepClaims, 60_000).unref?.();
}

if (typeof httpDependencies.sweepTaskMaterialDrafts === "function") {
  const sweepTaskMaterials = () => {
    try { httpDependencies.sweepTaskMaterialDrafts(); } catch { /* best-effort bounded cleanup */ }
  };
  sweepTaskMaterials();
  setInterval(sweepTaskMaterials, 60_000).unref?.();
}

// O5.2 follow-up: close the SLO → alert loop. Evaluate the loop's SLOs on a slow
// tick and dispatch an operational alert when the below-target set changes
// (throttled internally; no-op when SLOs are on target or there is no data).
if (typeof httpDependencies.sweepAutoRunSloAlerts === "function") {
  setInterval(() => {
    try {
      httpDependencies.sweepAutoRunSloAlerts();
    } catch {
      /* best-effort SLO alert sweep */
    }
  }, 60_000).unref?.();
}

if (typeof httpDependencies.sweepWorkItemOperationalAlerts === "function") {
  const sweepWorkItemAlerts = () => {
    try {
      httpDependencies.sweepWorkItemOperationalAlerts();
    } catch {
      /* best-effort work item alert sweep */
    }
  };
  sweepWorkItemAlerts();
  setInterval(sweepWorkItemAlerts, 60_000).unref?.();
}

if (typeof httpDependencies.sweepWorkItemFollowUpReminders === "function") {
  const sweepFollowUpReminders = () => {
    try {
      httpDependencies.sweepWorkItemFollowUpReminders();
    } catch {
      /* best-effort due reminder sweep */
    }
  };
  sweepFollowUpReminders();
  setInterval(sweepFollowUpReminders, 60_000).unref?.();
}

if (typeof httpDependencies.sweepAlertOutbox === "function") {
  const sweepAlerts = () => httpDependencies.sweepAlertOutbox().catch(() => {});
  sweepAlerts();
  setInterval(sweepAlerts, 15_000).unref?.();
}

// ADR 0017: opt-in OTLP trace export. Flush completed spans to the operator-set
// OTLP endpoint on a slow tick. No-op unless OTEL_EXPORTER_OTLP_ENDPOINT is set.
if (typeof httpDependencies.flushTraceExport === "function") {
  setInterval(() => {
    try {
      httpDependencies.flushTraceExport();
    } catch {
      /* best-effort trace export */
    }
  }, 60_000).unref?.();
}

// Risk-based merge (opt-in): sweep open PRs on a slow tick and auto-merge the
// low-risk ones. No-op unless the operator enabled autoMergeLowRisk; respects
// the kill switch + breaker internally.
if (typeof httpDependencies.autoMergeSweep === "function") {
  setInterval(() => httpDependencies.autoMergeSweep().catch(() => {}), 60_000).unref?.();
}

// Application health probe (opt-in per app): check source availability on a slow
// tick; the sweep throttles per application by its own intervalMinutes.
if (typeof httpDependencies.applicationHealthSweep === "function") {
  setInterval(() => {
    try {
      httpDependencies.applicationHealthSweep();
    } catch {
      /* best-effort sweep */
    }
  }, 60_000).unref?.();
}

// Session keep-alive sweep (login-managed site profiles, e.g. zhihu). Strictly
// opt-in: without the env gate NO browser is ever spawned from the sweep, and
// the sweep itself throttles per site by its registry intervalMinutes (default
// 180 — a too-regular heartbeat is itself a bot signal to the very WAFs these
// profiles exist to pass).
if (process.env.MYAGENTTOOL_SESSION_MANAGER_ENABLED === "1" && typeof httpDependencies.sessionHealthSweep === "function") {
  setInterval(() => {
    httpDependencies.sessionHealthSweep().catch(() => {});
  }, 60_000).unref?.();
}

// Bridge liveness + executor deadline watchdog. A short tick bounds the window
// where an online bridge with a dead child process can leave a zombie "running"
// invocation. Restore is symmetric on any authenticated bridge request.
if (typeof httpDependencies.bridgeLivenessSweep === "function") {
  setInterval(() => {
    try {
      httpDependencies.bridgeLivenessSweep();
    } catch {
      /* best-effort sweep */
    }
  }, 15_000).unref?.();
}

// Scheduled work-report → channel push: on a slow tick, post the configured
// day/week report once per period when due. No-op unless a schedule is armed.
if (typeof httpDependencies.sweepReportSchedule === "function") {
  setInterval(() => {
    try {
      httpDependencies.sweepReportSchedule();
    } catch {
      /* best-effort sweep */
    }
  }, 60_000).unref?.();
}

// #970 retention: reap telemetry (events/traces/spans) past the configured
// retention window on boot + a slow (hourly) tick. Time policy on top of the
// per-collection count caps; shielded evidence (ledger/audit/refusals) untouched.
{
  const sweepRetention = () => {
    try {
      // #1084: the sweep leaves one audit event per transcript reap batch.
      const { reaped } = applyRetentionPolicies(state, { now, appendEvent });
      if (reaped > 0) savePersistentState();
      // ADR 0019 B-3: the durable history table is OUTSIDE the mirrored snapshot,
      // so applyRetentionPolicies (state-only) never bounds it. Reap its DATED rows
      // past the same logsDays window. Self-durable (a direct DELETE), so no extra
      // savePersistentState. No-op when logsDays is off or on the memory backing.
      const days = Number(state?.retentionSettings?.logsDays);
      if (sqliteStore && typeof sqliteStore.reapHistory === "function" && Number.isFinite(days) && days > 0) {
        const cutoffMs = Date.parse(now()) - days * 86_400_000;
        if (Number.isFinite(cutoffMs)) sqliteStore.reapHistory({ before: new Date(cutoffMs).toISOString() });
      }
    } catch {
      /* best-effort retention sweep */
    }
  };
  sweepRetention();
  setInterval(sweepRetention, 3_600_000).unref?.();
}

// Clean shutdown: flush the durable backing (SQLite mirror, or JSON on the memory
// path — both via savePersistentState), then write a JSON EXPORT as a rollback/backup
// artifact (#1042 — a no-op-duplicate on the memory path where JSON is the backing),
// then release the lock.
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  httpDependencies.stopIlink?.();
  savePersistentState();
  exportJsonSnapshot?.();
  await closeRuntimeServices?.();
  closeSqliteStore();
  releaseStateLock();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
// Best-effort release on any other clean exit so a crash-free shutdown never
// leaves a stale lock the next start has to reclaim.
process.on("exit", () => releaseStateLock());

function now() {
  return new Date().toISOString();
}
