import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  acquireSessionProfile,
  createSessionManager,
  resolveSessionSiteConfig,
} from "../src/services/session-manager.mjs";

// A stand-in for a site plugin CLI, selected via `--mode <name>` in the command
// argv (mirrors zhihu-imports.test.mjs):
//   ok       — print {"ok":true,"loggedIn":true,"detail":"z_c0 present"}
//   expired  — print {"ok":true,"loggedIn":false,"detail":"z_c0 missing"}
//   fail     — exit non-zero with a stderr message
//   badjson  — exit zero but print non-JSON
//   login    — exit 0 with no JSON (the --login contract)
//   overlap  — append "start"/"end" markers to --log <file> around a 120ms nap,
//              so concurrent spawns reveal any interleaving (profile-lock check)
const SHIM = String.raw`
const argv = process.argv.slice(2);
let mode = "ok", log = "";
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--mode") mode = argv[++i];
  else if (a === "--log") log = argv[++i];
}
if (mode === "fail") { process.stderr.write("simulated probe failure\n"); process.exit(2); }
if (mode === "badjson") { process.stdout.write("not json\n"); process.exit(0); }
if (mode === "login") { process.exit(0); }
if (mode === "overlap") {
  const { appendFile } = await import("node:fs/promises");
  await appendFile(log, "start\n");
  await new Promise((r) => setTimeout(r, 120));
  await appendFile(log, "end\n");
  process.stdout.write(JSON.stringify({ ok: true, loggedIn: true, detail: "z_c0 present" }) + "\n");
  process.exit(0);
}
if (mode === "expired") {
  process.stdout.write(JSON.stringify({ ok: true, loggedIn: false, detail: "z_c0 missing" }) + "\n");
  process.exit(0);
}
process.stdout.write(JSON.stringify({ ok: true, loggedIn: true, detail: "z_c0 present" }) + "\n");
`;

async function setup(mode, extraArgs = []) {
  const shimDir = await mkdtemp(join(tmpdir(), "session-shim-"));
  const shimPath = join(shimDir, "shim.mjs");
  await writeFile(shimPath, SHIM, "utf8");
  const command = [process.execPath, shimPath];
  if (mode) command.push("--mode", mode);
  command.push(...extraArgs);
  const commandJson = JSON.stringify(command);
  const env = { ...process.env, MYAGENTTOOL_SESSION_ZHIHU_COMMAND_JSON: commandJson };
  const cleanup = async () => {
    await rm(shimDir, { recursive: true, force: true }).catch(() => {});
  };
  return { shimDir, shimPath, commandJson, env, cleanup };
}

function makeManager() {
  const state = { sessions: [] };
  const events = [];
  const persist = { count: 0 };
  const manager = createSessionManager({
    state,
    now: () => new Date().toISOString(),
    appendEvent: (event) => events.push(event),
    persistStateSoon: () => {
      persist.count++;
    },
  });
  return { state, events, persist, manager };
}

test("resolveSessionSiteConfig prefers the operator override and bounds timeouts", () => {
  const override = JSON.stringify(["/usr/local/bin/node", "/somewhere/cli.mjs"]);
  const cfg = resolveSessionSiteConfig("zhihu", { MYAGENTTOOL_SESSION_ZHIHU_COMMAND_JSON: override });
  assert.deepEqual(cfg.command, ["/usr/local/bin/node", "/somewhere/cli.mjs"]);
  assert.equal(cfg.probeTimeoutMs, 120_000);
  assert.equal(cfg.loginTimeoutMs, 330_000);

  const huge = resolveSessionSiteConfig("zhihu", { MYAGENTTOOL_SESSION_ZHIHU_PROBE_TIMEOUT_MS: "9999999" });
  assert.equal(huge.probeTimeoutMs, 300_000);
  const hugeLogin = resolveSessionSiteConfig("zhihu", { MYAGENTTOOL_SESSION_ZHIHU_LOGIN_TIMEOUT_MS: "9999999" });
  assert.equal(hugeLogin.loginTimeoutMs, 600_000);
  const tiny = resolveSessionSiteConfig("zhihu", { MYAGENTTOOL_SESSION_ZHIHU_PROBE_TIMEOUT_MS: "10" });
  assert.equal(tiny.probeTimeoutMs, 120_000); // below the 1000ms floor → default

  // A malformed override falls back to the bundled CLI, which exists in this worktree.
  const malformed = resolveSessionSiteConfig("zhihu", { MYAGENTTOOL_SESSION_ZHIHU_COMMAND_JSON: "not json" });
  assert.ok(Array.isArray(malformed.command));
  assert.equal(malformed.command[0], process.execPath);
  assert.ok(
    malformed.command[1].replace(/\\/g, "/").endsWith("tools/zhihu-imports/src/cli.mjs"),
    malformed.command[1],
  );
});

test("acquireSessionProfile: registry default → env override → disable", () => {
  // Default: the registry location for this machine.
  const def = acquireSessionProfile("zhihu", {});
  assert.ok(def.replace(/\\/g, "/").endsWith(".myagenttool-zhihu-profile"), def);

  const over = acquireSessionProfile("zhihu", { MYAGENTTOOL_SESSION_ZHIHU_PROFILE_DIR: "D:/profiles/zhihu" });
  assert.equal(over, "D:/profiles/zhihu");

  // Explicitly disabled (empty or "0") → null, letting the CLI fall back.
  assert.equal(acquireSessionProfile("zhihu", { MYAGENTTOOL_SESSION_ZHIHU_PROFILE_DIR: "" }), null);
  assert.equal(acquireSessionProfile("zhihu", { MYAGENTTOOL_SESSION_ZHIHU_PROFILE_DIR: "0" }), null);

  // Unknown site → null (pure resolver, never throws).
  assert.equal(acquireSessionProfile("nonexistent", {}), null);
});

test("listSessions merges the registry with durable rows without mutating state", () => {
  const { state, manager } = makeManager();
  const sessions = manager.listSessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].site, "zhihu");
  assert.equal(sessions[0].status, "unknown");
  assert.equal(sessions[0].lastProbeAt, null);
  assert.equal(state.sessions.length, 0); // listing alone records nothing
});

test("probeSite records an active session on loggedIn:true", async (t) => {
  const { env, cleanup } = await setup();
  t.after(cleanup);
  const { state, events, persist, manager } = makeManager();
  const result = await manager.probeSite("zhihu", { env });
  assert.equal(result.ok, true);
  assert.equal(result.loggedIn, true);
  assert.equal(result.detail, "z_c0 present");

  const row = state.sessions.find((r) => r.site === "zhihu");
  assert.ok(row);
  assert.equal(row.id, "session_zhihu");
  assert.equal(row.status, "active");
  assert.equal(row.lastProbeOk, true);
  assert.ok(row.lastProbeAt);
  assert.ok(events.some((e) => e.type === "session_probe_ok"));
  assert.ok(persist.count > 0);

  // The merged view now carries the probe outcome.
  assert.equal(manager.listSessions()[0].status, "active");
});

test("probeSite records needs_login on loggedIn:false — a finding, not an error", async (t) => {
  const { env, cleanup } = await setup("expired");
  t.after(cleanup);
  const { state, events, manager } = makeManager();
  const result = await manager.probeSite("zhihu", { env });
  assert.equal(result.loggedIn, false);
  assert.equal(state.sessions[0].status, "needs_login");
  assert.ok(events.some((e) => e.type === "session_probe_expired"));
});

test("probeSite maps CLI failure / bad JSON to session_cli_failed and keeps the row honest", async (t) => {
  for (const mode of ["fail", "badjson"]) {
    const { env, cleanup } = await setup(mode);
    t.after(cleanup);
    const { state, manager } = makeManager();
    await assert.rejects(() => manager.probeSite("zhihu", { env }), (err) => err.code === "session_cli_failed");
    const row = state.sessions.find((r) => r.site === "zhihu");
    assert.ok(row, mode);
    assert.equal(row.status, "unknown"); // probe did not run — no health claim
    assert.equal(row.lastProbeOk, false);
  }
});

test("probeSite rejects an unknown site with session_site_unknown", async () => {
  const { manager } = makeManager();
  await assert.rejects(() => manager.probeSite("nonexistent", {}), (err) => err.code === "session_site_unknown");
});

test("seedLogin records lastReauthAt when the CLI exits 0", async (t) => {
  const { env, cleanup } = await setup("login");
  t.after(cleanup);
  const { state, events, manager } = makeManager();
  const result = await manager.seedLogin("zhihu", { env });
  assert.equal(result.ok, true);
  const row = state.sessions.find((r) => r.site === "zhihu");
  assert.ok(row.lastReauthAt);
  assert.ok(events.some((e) => e.type === "session_reauth"));
});

test("seedLogin surfaces CLI failure as session_cli_failed", async (t) => {
  const { env, cleanup } = await setup("fail");
  t.after(cleanup);
  const { manager } = makeManager();
  await assert.rejects(() => manager.seedLogin("zhihu", { env }), (err) => err.code === "session_cli_failed");
});

test("concurrent probes against one site serialize (profile lock)", async (t) => {
  const logPath = join(tmpdir(), `session-lock-${process.pid}.log`);
  await rm(logPath, { force: true }).catch(() => {});
  const { env, cleanup } = await setup("overlap", ["--log", logPath]);
  t.after(async () => {
    await cleanup();
    await rm(logPath, { force: true }).catch(() => {});
  });
  const { manager } = makeManager();
  await Promise.all([manager.probeSite("zhihu", { env }), manager.probeSite("zhihu", { env })]);

  // No interleaving: every "start" must be immediately followed by its "end".
  const lines = (await readFile(logPath, "utf8")).trim().split("\n");
  assert.equal(lines.length, 4);
  for (let i = 0; i < lines.length; i++) {
    assert.equal(lines[i], i % 2 === 0 ? "start" : "end", `line ${i}: ${lines[i]}`);
  }
});

test("sessionHealthSweep skips fresh probes and probes stale ones", async (t) => {
  const { env, cleanup } = await setup();
  t.after(cleanup);
  const { state, manager } = makeManager();

  // Never probed → the sweep probes (env forwarded, so the SHIM runs — NOT the
  // real CLI; a missing env here would silently probe the live site).
  await manager.sessionHealthSweep({ env });
  assert.equal(state.sessions[0].status, "active");

  // Fresh probe → the sweep skips (only one probe total).
  const firstAt = state.sessions[0].lastProbeAt;
  await manager.sessionHealthSweep({ env });
  assert.equal(state.sessions[0].lastProbeAt, firstAt);

  // Age the row past the registry interval (180 min) → the sweep probes again.
  state.sessions[0].lastProbeAt = new Date(Date.now() - 200 * 60_000).toISOString();
  await manager.sessionHealthSweep({ env });
  assert.notEqual(state.sessions[0].lastProbeAt, firstAt);
});
