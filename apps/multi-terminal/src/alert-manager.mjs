import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class AlertManager {
  constructor(file, { now = () => new Date().toISOString(), notify = async () => {} } = {}) {
    this.file = file;
    this.now = now;
    this.notify = notify;
    this.rows = [];
  }
  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8"));
      this.rows = Array.isArray(parsed) ? parsed.slice(-2_000) : [];
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  async ingest(alert) {
    const key = `${alert.terminalId}:${alert.code ?? alert.message}`;
    const active = [...this.rows].reverse().find((row) => row.key === key && row.status !== "resolved");
    if (active) {
      active.lastSeenAt = this.now();
      active.occurrences += 1;
      await this.persist();
      return active;
    }
    const row = { id: `alt_${Date.now().toString(36)}`, key, severity: alert.severity ?? "warning", status: "open", firstSeenAt: this.now(), lastSeenAt: this.now(), occurrences: 1, ...alert };
    this.rows.push(row);
    await this.persist();
    await this.notify({ type: "alert_opened", alert: publicAlert(row) });
    return row;
  }
  async update(id, action, { minutes = 60 } = {}) {
    const row = this.rows.find((item) => item.id === id);
    if (!row) return null;
    if (action === "acknowledge") row.status = "acknowledged";
    else if (action === "silence") {
      row.status = "silenced";
      row.silencedUntil = new Date(Date.parse(this.now()) + Math.min(1_440, Math.max(1, Number(minutes) || 60)) * 60_000).toISOString();
    } else if (action === "resolve") {
      row.status = "resolved";
      row.resolvedAt = this.now();
      await this.notify({ type: "alert_recovered", alert: publicAlert(row) });
    } else return null;
    await this.persist();
    return row;
  }
  list() { return this.rows.slice(-500).map(publicAlert); }
  async persist() {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.rows)}\n`, { mode: 0o600 });
    await rename(temporary, this.file);
  }
}

function publicAlert(row) {
  const { key: _key, ...safe } = row;
  return safe;
}
