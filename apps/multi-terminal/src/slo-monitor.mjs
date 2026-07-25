import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class SloMonitor {
  constructor(file, {
    now = () => new Date().toISOString(),
    availabilityTarget = 99,
    staleTarget = 0,
    recoveryTargetHours = 24,
    operationSuccessTarget = 95,
    notify = async () => {},
  } = {}) {
    this.file = file;
    this.now = now;
    this.targets = { availabilityPercent: availabilityTarget, staleTerminals: staleTarget, recoveryHours: recoveryTargetHours, operationSuccessPercent: operationSuccessTarget };
    this.notify = notify;
    this.history = [];
    this.lastStatus = "unknown";
  }
  async load() {
    try {
      const rows = JSON.parse(await readFile(this.file, "utf8"));
      this.history = Array.isArray(rows) ? rows.slice(-2_000) : [];
      this.lastStatus = this.history.at(-1)?.status ?? "unknown";
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  async evaluate(overview, operationRecords = []) {
    const terminals = overview.terminals ?? [];
    const online = terminals.filter((row) => row.status === "online").length;
    const availabilityPercent = terminals.length ? round(online / terminals.length * 100) : null;
    const staleTerminals = terminals.filter((row) => row.stale).length;
    const recoveryValues = terminals.map((row) => row.recovery?.medianHours).filter(Number.isFinite);
    const recoveryHours = recoveryValues.length ? round(recoveryValues.reduce((sum, value) => sum + value, 0) / recoveryValues.length) : null;
    const recentOperations = operationRecords.slice(-100);
    const operationSuccessPercent = recentOperations.length
      ? round(recentOperations.filter((row) => row.status === "completed").length / recentOperations.length * 100)
      : null;
    const breaches = [];
    if (availabilityPercent != null && availabilityPercent < this.targets.availabilityPercent) breaches.push("availability");
    if (staleTerminals > this.targets.staleTerminals) breaches.push("stale_data");
    if (recoveryHours != null && recoveryHours > this.targets.recoveryHours) breaches.push("recovery_time");
    if (operationSuccessPercent != null && operationSuccessPercent < this.targets.operationSuccessPercent) breaches.push("operation_success");
    const status = breaches.length ? "breached" : terminals.length ? "healthy" : "insufficient_data";
    const result = {
      at: this.now(), status, breaches, targets: this.targets,
      metrics: { availabilityPercent, staleTerminals, recoveryHours, operationSuccessPercent },
    };
    const transition = status !== this.lastStatus;
    this.lastStatus = status;
    this.history.push(result);
    this.history = this.history.slice(-2_000);
    await this.persist();
    if (transition && ["breached", "healthy"].includes(status)) await this.notify({ type: `multi_terminal_slo_${status}`, ...result });
    return result;
  }
  summary(windowDays = 30) {
    const days = [7, 30, 90].includes(Number(windowDays)) ? Number(windowDays) : 30;
    const cutoff = Date.parse(this.now()) - days * 86_400_000;
    const trend = this.history.filter((row) => Date.parse(row.at) >= cutoff);
    return { current: trend.at(-1) ?? this.history.at(-1) ?? null, windowDays: days, trend };
  }
  async persist() {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.history)}\n`, { mode: 0o600 });
    await rename(temporary, this.file);
  }
}

export function webhookNotifier(url, fetchImpl = fetch) {
  if (!url) return async () => {};
  const endpoint = new URL(url);
  const localHttp = endpoint.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !localHttp) throw new Error("alert webhook must use HTTPS or loopback HTTP");
  if (endpoint.username || endpoint.password) throw new Error("alert webhook URL cannot contain credentials");
  return async (payload) => {
    await fetchImpl(endpoint, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(5_000),
    }).catch(() => {});
  };
}

function round(value) {
  return Math.round(value * 100) / 100;
}
