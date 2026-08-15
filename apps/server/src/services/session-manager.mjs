// Local session manager: keeps logged-in site profiles alive and observable.
//
// Sites that need a login (zhihu today) are rendered by their plugin CLI
// (tools/<site>-imports) reusing a persistent browser profile. This service is
// the single owner of "is that profile still logged in?": it probes on demand,
// reseeds via an interactive --login, and (opt-in) sweeps on a slow interval —
// low-frequency on purpose, because a too-regular heartbeat is itself a bot
// signal to the very WAFs the profile exists to pass.
//
// Honest scope: session lifetime is the site's call. This manager does NOT
// promise "always logged in" — it delivers "keep-alive best effort + earliest
// possible expiry detection + one-key reseed". `status` on the card page is a
// finding, not a guarantee.
//
// Trust boundary — identical to feishu-doc-imports.mjs / zhihu-imports.mjs /
// design-render.mjs: the product bundles NO browser. The executable argv is
// product-defaulted (the running node plus the bundled site CLI) and may be
// overridden by an operator env var; it is NEVER agent-proposed. execFile
// spawns with no shell, a bounded timeout, and a bounded buffer. The site key
// is validated against a static registry; site specifics (URLs, auth cookie,
// selectors) live ONLY in the plugin's site.mjs, never here.
//
// Two-argv-allowlists invariant: NOT applicable (server-process spawn, same
// trust regime as the feishu provider — see zhihu-imports.mjs for the longer
// note).
//
// The profile lock: launchPersistentContext takes an exclusive lock on the
// profile dir, so a probe racing a render against the same profile collides.
// Every spawn here goes through withSiteLock — a Map<site, Promise> chain that
// serializes per site. The sweep additionally skips sites with an in-flight
// probe.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_PROBE_TIMEOUT_MS = 120_000;
const MAX_PROBE_TIMEOUT_MS = 300_000;
const DEFAULT_LOGIN_TIMEOUT_MS = 330_000;
const MAX_LOGIN_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;

/** Default profile location for a site: ~/.myagenttool-<site>-profile. */
function resolveProfileDir(site) {
  return join(homedir(), `.myagenttool-${site}-profile`);
}

/**
 * The static site registry — the whole "plugin" seam for login-managed sites.
 * Adding a site = a tools/<site>-imports package (uniform CLI contract, see
 * tools/session-engine/README.md) + one row here + an article-imports render
 * branch. No http-server / state-factory / index.mjs changes per site.
 *
 * heartbeatTier:
 *   - "logged_in": sweep probes this site on its interval (zhihu's z_c0 is a
 *     long-lived cookie that a gentle low-frequency visit keeps warm).
 *   - "manual": probe only on demand; the login flow is too interactive
 *     (QR scan / slider) for automated keep-alive. Reserved for future sites.
 */
const SESSION_SITES = Object.freeze([
  {
    site: "zhihu",
    displayName: "知乎 (Zhihu)",
    authMethod: "persistent_profile",
    heartbeatTier: "logged_in",
    heartbeatIntervalMinutes: 180,
    profileDir: resolveProfileDir("zhihu"),
  },
]);

/** @param {string} site @returns {typeof SESSION_SITES[number] | undefined} */
export function findSessionSite(site) {
  return SESSION_SITES.find((row) => row.site === site);
}

/** Uppercase site key for env-var segments (zhihu → ZHIHU). */
function envSiteKey(site) {
  return site.replace(/[^a-z0-9]/gi, "_").toUpperCase();
}

/**
 * Pure profile resolver — no state, no spawn, no service deps, so consumers
 * (zhihu-imports.mjs renderZhihuArticle) can call it at request time without
 * composition cycles. Precedence: operator env override → registry default.
 * Returns null for an unknown site or an explicitly disabled profile
 * (MYAGENTTOOL_SESSION_<SITE>_PROFILE_DIR=0), letting the CLI fall back to its
 * own env/config.
 *
 * @param {string} site
 * @param {Record<string, string>} [env]
 * @returns {string | null}
 */
export function acquireSessionProfile(site, env = process.env) {
  const entry = findSessionSite(site);
  if (!entry) return null;
  const raw = env[`MYAGENTTOOL_SESSION_${envSiteKey(site)}_PROFILE_DIR`];
  if (raw !== undefined) {
    const value = String(raw).trim();
    return value === "" || value === "0" ? null : value;
  }
  return entry.profileDir;
}

/**
 * A non-empty array of non-empty strings — the only shape acceptable as a
 * command argv. Mirrors feishu-doc-imports.mjs isArgv.
 * @param {unknown} value
 * @returns {boolean}
 */
function isArgv(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.length > 0);
}

/**
 * Absolute path to a site plugin's bundled CLI, resolved relative to this
 * module (<repo>/apps/server/src/services/session-manager.mjs). Returns null
 * when the CLI is absent (e.g. a packaged build that does not ship tools/).
 * @param {string} site
 * @returns {string | null}
 */
function defaultCliPath(site) {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const repoRoot = resolve(here, "../../../..");
  const cli = resolve(repoRoot, "tools", `${site}-imports`, "src", "cli.mjs");
  return existsSync(cli) ? cli : null;
}

/**
 * Resolve a site plugin's command from the environment.
 *
 * Operator override: `MYAGENTTOOL_SESSION_<SITE>_COMMAND_JSON` — a JSON argv
 * array (e.g. `["node","/path/to/cli.mjs"]`; this is also how tests inject a
 * SHIM). When unset, the product default `[<running node>, <bundled cli>]` is
 * used if the CLI exists.
 *
 * @param {string} site
 * @param {Record<string, string>} [env]
 * @returns {{ command: string[] | null, probeTimeoutMs: number, loginTimeoutMs: number, maxBuffer: number }}
 */
export function resolveSessionSiteConfig(site, env = process.env) {
  const key = envSiteKey(site);
  let command = null;
  const raw = env[`MYAGENTTOOL_SESSION_${key}_COMMAND_JSON`];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (isArgv(parsed)) command = parsed;
    } catch {
      /* fall through to the product default */
    }
  }
  if (!command) {
    const cli = defaultCliPath(site);
    if (cli) command = [process.execPath, cli];
  }
  const probe = Math.round(Number(env[`MYAGENTTOOL_SESSION_${key}_PROBE_TIMEOUT_MS`]));
  const probeTimeoutMs =
    Number.isFinite(probe) && probe >= 1000 ? Math.min(probe, MAX_PROBE_TIMEOUT_MS) : DEFAULT_PROBE_TIMEOUT_MS;
  const login = Math.round(Number(env[`MYAGENTTOOL_SESSION_${key}_LOGIN_TIMEOUT_MS`]));
  const loginTimeoutMs =
    Number.isFinite(login) && login >= 1000 ? Math.min(login, MAX_LOGIN_TIMEOUT_MS) : DEFAULT_LOGIN_TIMEOUT_MS;
  return Object.freeze({ command, probeTimeoutMs, loginTimeoutMs, maxBuffer: DEFAULT_MAX_BUFFER });
}

/**
 * Build a { code }-tagged error routes and the sweep can surface.
 * @param {string} code
 * @param {string} [detail]
 * @returns {Error & { code: string }}
 */
function sessionError(code, detail) {
  const message = detail ? `${code}: ${detail}` : code;
  return Object.assign(new Error(message), { code });
}

/**
 * Reduce a child_process error to a short, safe detail string. Keeps stderr
 * tails (the site CLI writes its failure reason there) but truncates.
 * @param {unknown} error
 * @returns {string}
 */
function summarizeExecError(error) {
  const stderr = String(error?.stderr || "").trim();
  const code = error?.code ? ` code=${error.code}` : "";
  const tail = stderr ? ` | ${stderr.slice(-300)}` : "";
  return `${String(error?.message ?? error).slice(0, 300)}${code}${tail}`;
}

/**
 * Create the session-manager service.
 *
 * @param {{
 *   state: object,
 *   now: () => string,
 *   appendEvent: (event: object) => void,
 *   persistStateSoon: () => void,
 * }} deps
 */
export function createSessionManager({ state, now, appendEvent, persistStateSoon }) {
  if (!Array.isArray(state.sessions)) state.sessions = [];

  /** per-site exclusive lock — the profile dir cannot host two browsers. */
  const inflight = new Map();

  /**
   * Serialize fn per site. Later callers await earlier ones; a rejection never
   * poisons the chain.
   * @template T
   * @param {string} site
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  function withSiteLock(site, fn) {
    const prior = inflight.get(site) ?? Promise.resolve();
    const run = prior.then(fn, fn);
    inflight.set(
      site,
      run.then(
        () => {},
        () => {},
      ),
    );
    return run;
  }

  /** The durable row for a site (state.sessions), or null when absent. */
  function sessionRow(site) {
    return state.sessions.find((row) => row.site === site) ?? null;
  }

  /** Merge the static registry with the durable row into the card-page view. */
  function listSessions() {
    return SESSION_SITES.map((entry) => {
      const row = sessionRow(entry.site);
      return {
        site: entry.site,
        displayName: entry.displayName,
        authMethod: entry.authMethod,
        heartbeatTier: entry.heartbeatTier,
        heartbeatIntervalMinutes: entry.heartbeatIntervalMinutes,
        profileDir: entry.profileDir,
        status: row?.status ?? "unknown",
        lastProbeAt: row?.lastProbeAt ?? null,
        lastProbeOk: row?.lastProbeOk ?? null,
        lastReauthAt: row?.lastReauthAt ?? null,
        detail: row?.detail ?? "Never probed.",
      };
    });
  }

  /**
   * Run the site CLI with the given mode args, under the site lock.
   * @param {{ parse?: boolean }} [opts] - --login emits no JSON (success is
   *   exit 0); pass parse:false for that mode.
   * @returns {Promise<object | null>} parsed stdout JSON, or null when parse:false
   */
  async function runSiteCli(site, modeArgs, timeoutMs, { signal, env = process.env, parse = true } = {}) {
    const entry = findSessionSite(site);
    if (!entry) throw sessionError("session_site_unknown", `Unknown session site '${site}'.`);
    const { command, maxBuffer } = resolveSessionSiteConfig(site, env);
    if (!command) {
      throw sessionError(
        "session_cli_unavailable",
        `No CLI command is configured for '${site}' (MYAGENTTOOL_SESSION_${envSiteKey(site)}_COMMAND_JSON) and the bundled CLI was not found.`,
      );
    }
    if (signal?.aborted) throw sessionError("session_canceled", "Aborted before launch.");

    const profileDir = acquireSessionProfile(site, env) ?? entry.profileDir;
    const argv = [...modeArgs, "--profile", profileDir];

    return withSiteLock(site, async () => {
      const [file, ...baseArgs] = command;
      let stdout;
      try {
        const out = await execFileAsync(file, [...baseArgs, ...argv], {
          env,
          timeout: timeoutMs,
          maxBuffer,
          windowsHide: true,
          ...(signal ? { signal } : {}),
        });
        stdout = out.stdout;
      } catch (error) {
        if (signal?.aborted) throw sessionError("session_canceled", "Aborted during site CLI run.");
        throw sessionError("session_cli_failed", summarizeExecError(error));
      }
      if (!parse) return null;
      try {
        return JSON.parse(stdout);
      } catch {
        throw sessionError("session_cli_failed", "Site CLI exited but did not return parseable JSON output.");
      }
    });
  }

  /**
   * Probe a site's profile health. Updates the durable row + emits an event.
   * `loggedIn:false` is a FINDING (exit 0 from the CLI), not an error.
   */
  async function probeSite(site, { signal, env = process.env } = {}) {
    const entry = findSessionSite(site);
    if (!entry) throw sessionError("session_site_unknown", `Unknown session site '${site}'.`);
    const { probeTimeoutMs } = resolveSessionSiteConfig(site, env);

    let result;
    try {
      result = await runSiteCli(site, ["--probe"], probeTimeoutMs, { signal, env });
    } catch (error) {
      recordProbe(site, "unknown", false, String(error?.message ?? error));
      appendEvent({
        invocationId: null,
        type: "session_probe_failed",
        level: "warn",
        message: `Session probe for ${site} failed: ${String(error?.message ?? error).slice(0, 200)}`,
        data: { site },
      });
      throw error;
    }

    const loggedIn = result?.ok === true && result?.loggedIn === true;
    recordProbe(site, loggedIn ? "active" : "needs_login", true, String(result?.detail ?? ""));
    appendEvent({
      invocationId: null,
      type: loggedIn ? "session_probe_ok" : "session_probe_expired",
      level: loggedIn ? "info" : "warn",
      message: `Session probe for ${site}: ${loggedIn ? "logged in" : "not logged in"} (${String(result?.detail ?? "")}).`,
      data: { site, loggedIn },
    });
    return { ok: true, loggedIn, detail: String(result?.detail ?? ""), session: sessionRow(site) };
  }

  /**
   * Reseed a site's profile interactively: opens a HEADED browser on the
   * server's machine for the operator to log in. Long timeout on purpose —
   * the operator types/scan codes at their leisure.
   */
  async function seedLogin(site, { signal, env = process.env } = {}) {
    const entry = findSessionSite(site);
    if (!entry) throw sessionError("session_site_unknown", `Unknown session site '${site}'.`);
    const { loginTimeoutMs } = resolveSessionSiteConfig(site, env);

    // --login emits no JSON — success is exit 0.
    await runSiteCli(site, ["--login"], loginTimeoutMs, { signal, env, parse: false });

    const row = recordReauth(site);
    appendEvent({
      invocationId: null,
      type: "session_reauth",
      level: "info",
      message: `Session for ${site} reseeded via interactive login.`,
      data: { site },
    });
    return { ok: true, session: row };
  }

  /** Record a probe outcome into the durable row (creating it if needed). */
  function recordProbe(site, status, probeRan, detail) {
    const at = now();
    let row = sessionRow(site);
    if (!row) {
      row = { id: `session_${site}`, site, createdAt: at };
      state.sessions = [...state.sessions, row];
    }
    row.status = status;
    row.lastProbeAt = at;
    row.lastProbeOk = probeRan;
    row.detail = detail.slice(0, 500);
    row.updatedAt = at;
    persistStateSoon();
    return row;
  }

  /** Record a successful interactive reseed. */
  function recordReauth(site) {
    const at = now();
    let row = sessionRow(site);
    if (!row) {
      row = { id: `session_${site}`, site, createdAt: at };
      state.sessions = [...state.sessions, row];
    }
    row.lastReauthAt = at;
    row.updatedAt = at;
    persistStateSoon();
    return row;
  }

  /**
   * Slow keep-alive sweep — opt-in via MYAGENTTOOL_SESSION_MANAGER_ENABLED=1
   * (index.mjs owns the gate). For every "logged_in"-tier site whose probe is
   * older than its interval, run a best-effort probe; skip sites with an
   * in-flight lock holder. Never throws.
   */
  async function sessionHealthSweep({ env = process.env } = {}) {
    for (const entry of SESSION_SITES) {
      if (entry.heartbeatTier !== "logged_in") continue;
      if (inflight.get(entry.site)) continue;
      const row = sessionRow(entry.site);
      const intervalMs = entry.heartbeatIntervalMinutes * 60_000;
      const last = row?.lastProbeAt ? Date.parse(row.lastProbeAt) : NaN;
      if (Number.isFinite(last) && Date.now() - last < intervalMs) continue;
      try {
        await probeSite(entry.site, { env });
      } catch {
        /* best-effort sweep — the probe already recorded its failure */
      }
    }
  }

  return {
    listSessions,
    probeSite,
    seedLogin,
    sessionHealthSweep,
    acquireProfile: (site, env = process.env) => acquireSessionProfile(site, env),
  };
}
