import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const KEY = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/;

export class OwnerOperationRuntime {
  constructor(file, { now = () => new Date().toISOString(), retryLimit = 2, circuitFailures = 3, circuitMs = 30_000 } = {}) {
    this.file = file;
    this.now = now;
    this.retryLimit = retryLimit;
    this.circuitFailures = circuitFailures;
    this.circuitMs = circuitMs;
    this.audit = [];
    this.results = new Map();
    this.circuits = new Map();
  }
  async load() {
    try {
      const rows = JSON.parse(await readFile(this.file, "utf8"));
      this.audit = Array.isArray(rows) ? rows.slice(-2_000) : [];
      for (const row of this.audit) if (row.status === "completed" && row.result) this.results.set(row.idempotencyKey, { result: row.result, fingerprint: row.fingerprint });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  async execute({ terminal, operation, idempotencyKey, action, localResourceId, request }) {
    if (!KEY.test(idempotencyKey ?? "")) return { ok: false, status: 400, code: "idempotency_key_required" };
    const fingerprint = `${terminal.id}:${action}:${localResourceId}:${operation.path}`;
    const cached = this.results.get(idempotencyKey);
    if (cached && cached.fingerprint !== fingerprint) return { ok: false, status: 409, code: "idempotency_key_conflict" };
    if (cached) return { ...cached.result, replayed: true };
    const circuit = this.circuits.get(terminal.id);
    if (circuit?.openUntil > Date.now()) {
      return { ok: false, status: 503, code: "owner_circuit_open", retryAfterMs: circuit.openUntil - Date.now(), migrated: false };
    }

    const startedAt = this.now();
    let last;
    for (let attempt = 1; attempt <= this.retryLimit + 1; attempt += 1) {
      try {
        const response = await request(terminal, operation);
        const result = sanitize(await response.json());
        last = { ok: response.ok, status: response.status, terminalId: terminal.id, localResourceId, result, attempts: attempt };
        if (response.ok || response.status < 500 && response.status !== 429) break;
      } catch {
        last = { ok: false, status: 503, code: "owning_terminal_unavailable", terminalId: terminal.id, localResourceId, migrated: false, attempts: attempt };
      }
    }
    const failures = last.ok ? 0 : (circuit?.failures ?? 0) + 1;
    this.circuits.set(terminal.id, {
      failures,
      openUntil: failures >= this.circuitFailures ? Date.now() + this.circuitMs : 0,
    });
    const record = {
      idempotencyKey, fingerprint, terminalId: terminal.id, localResourceId, action,
      status: last.ok ? "completed" : "failed", startedAt, completedAt: this.now(), result: last,
    };
    this.audit.push(record);
    this.audit = this.audit.slice(-2_000);
    if (last.ok) this.results.set(idempotencyKey, { result: last, fingerprint });
    await this.persist();
    return last;
  }
  records() {
    return this.audit.map(({ result: _result, ...row }) => ({ ...row }));
  }
  async persist() {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.audit)}\n`, { mode: 0o600 });
    await rename(temporary, this.file);
  }
}

function sanitize(value, depth = 0) {
  if (depth > 6) return "[truncated]";
  if (typeof value === "string") return value.slice(0, 2_000);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(token|secret|password|credential|authorization|cookie)/i.test(key))
    .slice(0, 100)
    .map(([key, item]) => [key, sanitize(item, depth + 1)]));
}
