import { accessSync, constants, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { acquireStateLock } from "../../apps/server/src/runtime/state-lock.mjs";

const checks = [];
const add = (name, ok, detail, severity = "error") => checks.push({ name, ok, severity, detail });
const authEnabled = process.env.MYAGENT_REQUIRE_AUTH === "1";
const secret = String(process.env.MYAGENTTOOL_GITHUB_WEBHOOK_SECRET ?? "");
const persistenceEnabled = process.env.MYAGENTTOOL_STATE_DISABLED !== "1";
const statePath = resolve(process.env.MYAGENTTOOL_STATE_PATH ?? ".myagenttool/state/local-demo-state.json");
const stateLockEnabled = process.env.MYAGENTTOOL_STATE_LOCK !== "0";
const store = String(process.env.MYAGENTTOOL_STORE ?? "sqlite").toLowerCase();
const baseUrl = String(process.env.WORK_ITEMS_PREFLIGHT_URL ?? "").replace(/\/$/, "");

add("authentication", authEnabled, authEnabled ? "required" : "MYAGENT_REQUIRE_AUTH must be 1");
add("webhook_secret", secret.length >= 32, secret.length >= 32
  ? `configured (${secret.length} characters)`
  : "MYAGENTTOOL_GITHUB_WEBHOOK_SECRET must contain at least 32 characters");
add("persistent_state", persistenceEnabled, persistenceEnabled
  ? statePath
  : "MYAGENTTOOL_STATE_DISABLED must not be 1");
add("single_writer_lock", stateLockEnabled, stateLockEnabled
  ? "enabled"
  : "MYAGENTTOOL_STATE_LOCK=0 is unsafe for production");
add("durable_store", ["sqlite", "memory"].includes(store) && store !== "memory", store === "sqlite"
  ? "sqlite"
  : "MYAGENTTOOL_STORE must be sqlite for production");
if (persistenceEnabled) {
  try {
    mkdirSync(dirname(statePath), { recursive: true });
    accessSync(dirname(statePath), constants.R_OK | constants.W_OK);
    add("state_path_access", true, dirname(statePath));
  } catch (error) {
    add("state_path_access", false, error instanceof Error ? error.message : String(error));
  }
}
if (store === "sqlite") {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(":memory:");
    database.close();
    add("sqlite_runtime", true, "available");
  } catch (error) {
    add("sqlite_runtime", false, error instanceof Error ? error.message : String(error));
  }
}
if (persistenceEnabled && stateLockEnabled && !baseUrl) {
  const lock = acquireStateLock(statePath);
  add("single_writer_lock_acquisition", lock.ok && Boolean(lock.lockPath),
    lock.ok && lock.lockPath ? "acquired and released" : "could not acquire an exclusive state lock");
  lock.release?.();
}

if (baseUrl) {
  const token = String(process.env.WORK_ITEMS_PREFLIGHT_TOKEN ?? "");
  add("online_token", Boolean(token), token ? "configured" : "WORK_ITEMS_PREFLIGHT_TOKEN is required for online checks");
  if (token) {
    await onlineCheck("health_endpoint", `${baseUrl}/health`, null);
    await onlineCheck("github_diagnostics", `${baseUrl}/api/work-items/github/diagnostics`, (body) =>
      body?.secretConfigured === true && body?.health === "healthy" && Number(body?.failureRate ?? 1) < 0.01);
    await onlineCheck("attention_metrics", `${baseUrl}/api/work-items/attention`, (body) =>
      Number.isInteger(body?.metrics?.backlog) && body?.metrics?.breached === 0);
  }
}

const failures = checks.filter((check) => !check.ok && check.severity === "error");
const report = {
  schemaVersion: 1,
  ready: failures.length === 0,
  checkedAt: new Date().toISOString(),
  checks,
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;

async function onlineCheck(name, url, validate) {
  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${process.env.WORK_ITEMS_PREFLIGHT_TOKEN}` },
      signal: AbortSignal.timeout(5_000),
    });
    const body = await response.json();
    const valid = response.ok && (!validate || validate(body));
    add(name, valid, valid ? "ok" : `unexpected response (${response.status})`);
  } catch (error) {
    add(name, false, error instanceof Error ? error.message : String(error));
  }
}
