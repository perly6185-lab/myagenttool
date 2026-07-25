import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const ENV_REF = /^[A-Z][A-Z0-9_]{2,127}$/;

export function normalizeTerminal(input) {
  const id = String(input?.id ?? "");
  const name = String(input?.name ?? "").trim();
  if (!ID.test(id) || !name || name.length > 100) throw new Error("invalid terminal identity");
  const apiUrl = safeEndpoint(input.apiUrl, "apiUrl");
  const consoleUrl = safeEndpoint(input.consoleUrl, "consoleUrl");
  const observerTokenEnv = String(input?.observerTokenEnv ?? "");
  const operatorTokenEnv = String(input?.operatorTokenEnv ?? "");
  if (observerTokenEnv && !ENV_REF.test(observerTokenEnv)) throw new Error("invalid observer token environment reference");
  if (operatorTokenEnv && !ENV_REF.test(operatorTokenEnv)) throw new Error("invalid operator token environment reference");
  if (Object.hasOwn(input ?? {}, "observerToken") || Object.hasOwn(input ?? {}, "operatorToken")) throw new Error("raw tokens cannot be stored in the registry");
  return { id, name, apiUrl, consoleUrl, observerTokenEnv: observerTokenEnv || null, operatorTokenEnv: operatorTokenEnv || null };
}

function safeEndpoint(value, field) {
  let url;
  try { url = new URL(String(value ?? "")); } catch { throw new Error(`invalid ${field}`); }
  const localHttp = url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) throw new Error(`${field} must use HTTPS or loopback HTTP`);
  if (url.username || url.password || url.search || url.hash) throw new Error(`invalid ${field}`);
  return url.href;
}

export function materializeTerminal(terminal, env = process.env) {
  return {
    ...terminal,
    observerToken: terminal.observerTokenEnv ? String(env[terminal.observerTokenEnv] ?? "") : "",
    operatorToken: terminal.operatorTokenEnv ? String(env[terminal.operatorTokenEnv] ?? "") : "",
  };
}

export class TerminalRegistry {
  constructor(file, { seed = [] } = {}) {
    this.file = file;
    this.rows = seed.map(normalizeTerminal);
  }
  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8"));
      this.rows = (Array.isArray(parsed) ? parsed : []).map(normalizeTerminal);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    return this.list();
  }
  list() { return this.rows.map((row) => ({ ...row })); }
  async upsert(input) {
    const row = normalizeTerminal(input);
    const index = this.rows.findIndex((item) => item.id === row.id);
    if (index >= 0) this.rows[index] = row;
    else this.rows.push(row);
    await this.persist();
    return { ...row };
  }
  async remove(id) {
    const next = this.rows.filter((row) => row.id !== id);
    if (next.length === this.rows.length) return false;
    this.rows = next;
    await this.persist();
    return true;
  }
  async persist() {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.rows, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.file);
  }
}
