import { resolve } from "node:path";
import { startAutomationScheduler } from "./runtime/automation-scheduler.mjs";
import { startAutoTriggerScheduler } from "./runtime/auto-trigger-scheduler.mjs";
import { createHttpServer } from "./runtime/http-server.mjs";
import { runProtocolSelfCheck } from "./runtime/self-check.mjs";
import { createServerRuntimeServices } from "./runtime/service-composer.mjs";
import { createServerState } from "./runtime/state-factory.mjs";

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
const { defaultProject, state } = createServerState({ defaultProjectPath, now });
const {
  httpDependencies,
  savePersistentState,
  selfCheckDependencies,
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
});

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

// Risk-based merge (opt-in): sweep open PRs on a slow tick and auto-merge the
// low-risk ones. No-op unless the operator enabled autoMergeLowRisk; respects
// the kill switch + breaker internally.
if (typeof httpDependencies.autoMergeSweep === "function") {
  setInterval(() => httpDependencies.autoMergeSweep().catch(() => {}), 60_000).unref?.();
}

process.on("SIGINT", () => {
  savePersistentState();
  process.exit(0);
});
process.on("SIGTERM", () => {
  savePersistentState();
  process.exit(0);
});

function now() {
  return new Date().toISOString();
}
