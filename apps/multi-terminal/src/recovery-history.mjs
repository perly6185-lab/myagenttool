import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const MAX_ROWS = 10_000;
const WINDOWS = new Set([7, 30, 90]);

export class RecoveryHistory {
  constructor(file, { now = () => new Date().toISOString() } = {}) {
    this.file = file;
    this.now = now;
    this.rows = [];
  }
  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8"));
      this.rows = Array.isArray(parsed) ? parsed.filter(validRow).slice(-MAX_ROWS) : [];
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  async observe(terminals) {
    const observedAt = this.now();
    const bucket = observedAt.slice(0, 16);
    let changed = false;
    for (const terminal of terminals) {
      const medianHours = terminal?.recovery?.medianHours;
      if (terminal.status !== "online" || !Number.isFinite(medianHours)) continue;
      const duplicate = this.rows.some((row) => row.terminalId === terminal.id && row.observedAt.startsWith(bucket));
      if (!duplicate) {
        this.rows.push({ terminalId: terminal.id, observedAt, medianHours, sampleCount: terminal.recovery.sampleCount });
        changed = true;
      }
    }
    if (changed) {
      this.rows = this.rows.slice(-MAX_ROWS);
      await this.persist();
    }
  }
  summary(terminalId, windowDays = 30) {
    const days = WINDOWS.has(Number(windowDays)) ? Number(windowDays) : 30;
    const cutoff = Date.parse(this.now()) - days * 86_400_000;
    const points = this.rows.filter((row) => row.terminalId === terminalId && Date.parse(row.observedAt) >= cutoff);
    const latest = points.at(-1) ?? null;
    return {
      windowDays: days,
      points,
      latestMedianHours: latest?.medianHours ?? null,
      alert: latest?.medianHours > 24 ? { severity: "warning", code: "recovery_objective_missed", thresholdHours: 24 } : null,
    };
  }
  async persist() {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.rows)}\n`, { mode: 0o600 });
    await rename(temporary, this.file);
  }
}

function validRow(row) {
  return typeof row?.terminalId === "string"
    && typeof row?.observedAt === "string"
    && Number.isFinite(row?.medianHours)
    && Number.isFinite(Date.parse(row.observedAt));
}
