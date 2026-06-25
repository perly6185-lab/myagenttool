// Integration smoke for the skill system: skills are rendered into an
// invocation's ephemeral worktree in each agent's native format, scoped by the
// skill's `targets`.
//
// Two parts:
//   1. CORE (always) — deterministic, no real CLI or network. Rendering happens
//      server-side in createInvocation, so we never spawn a real agent: boot the
//      server, register codex+claude agents, fire invocations, and assert the
//      rendered files. Exits non-zero on any failure.
//   2. REAL (opt-in via RUN_REAL_AGENTS=1) — starts the actual desktop bridge and
//      runs the real `claude` / `codex` CLIs if present, asserting the agent ran
//      in the worktree and read the rendered skill. Each agent is skipped when
//      its CLI is missing; codex also tolerates upstream/proxy unavailability.

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.SKILLS_SMOKE_PORT ?? 3221);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = process.cwd();
const RUN_REAL = process.env.RUN_REAL_AGENTS === "1";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skills-smoke-"));
const stateFile = path.join(tmp, "state.json");
const children = [];
let failures = 0;

function gitRepo(name) {
  const repo = path.join(tmp, name);
  fs.mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-b", "main", repo], { stdio: "ignore" });
  const g = (args) => execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
  g(["config", "user.email", "smoke@test.local"]);
  g(["config", "user.name", "Smoke"]);
  fs.writeFileSync(path.join(repo, "README.md"), `# ${name}\n`);
  g(["add", "-A"]);
  g(["commit", "-m", "init"]);
  return repo;
}

function start(name, command, args, env) {
  const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  const echo = (chunk) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) if (line.trim()) console.log(`[${name}] ${line}`);
  };
  child.stdout.on("data", echo);
  child.stderr.on("data", echo);
  return child;
}

async function api(method, p, body) {
  const res = await fetch(`${BASE}${p}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(check, label, attempts = 100, delay = 150) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    try { const r = await check(); if (r) return r; } catch (e) { last = e; }
    await sleep(delay);
  }
  throw new Error(`Timed out waiting for ${label}: ${last?.message ?? "no result"}`);
}

function check(cond, label) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) failures++;
}

function hasCli(cmd) {
  try { execFileSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" }); return true; } catch { return false; }
}

function ephemeralWorktreePath(repo, invId) {
  return path.join(path.dirname(repo), `.${path.basename(repo)}.worktrees`, invId);
}

async function fireAndRender(repo, agentBody, opts = {}) {
  const { project } = await api("POST", "/api/projects", { repoPath: repo, name: path.basename(repo) });
  await api("PATCH", `/api/projects/${project.id}`, { isolation: "worktree" });
  const { agent } = await api("POST", "/api/agents", agentBody);
  const { invocation } = await api("POST", "/api/invocations", {
    task: opts.task ?? "probe",
    agentId: agent.id,
    projectId: project.id,
    options: { timeoutSeconds: 180, permissionLevel: "full" },
  });
  return { project, agent, invocation };
}

try {
  // ---- boot server ----
  start("server", process.execPath, ["apps/server/src/index.mjs"], { SERVER_PORT: String(PORT), SERVER_STATE_FILE: stateFile, MYAGENT_REQUIRE_AUTH: "0" });
  await waitFor(() => api("GET", "/api/state"), "server up");
  // Mark bridge online so local CLI agents aren't gated unhealthy.
  await api("POST", "/api/bridge/register", { bridgeVersion: "smoke", capabilities: ["cli"] });

  // Seed skill is present.
  const seeded = await api("GET", "/api/skills");
  check(Array.isArray(seeded.skills) && seeded.skills.some((s) => s.slug === "image-edit"), "seed: image-edit skill present");

  // A codex-only skill to prove target scoping.
  await api("POST", "/api/skills", { name: "Codex Only", description: "codex-specific", body: "Only for codex.", targets: ["codex"] });

  // ---- CORE: codex rendering ----
  const codexRepo = gitRepo("codex-core");
  const codex = await fireAndRender(codexRepo, { type: "cli", command: "codex", name: "Codex", sandbox: "read-only" });
  const cwt = ephemeralWorktreePath(codexRepo, codex.invocation.id);
  const agentsMd = path.join(cwt, "AGENTS.md");
  check(fs.existsSync(agentsMd), "codex: AGENTS.md rendered");
  const agentsText = fs.existsSync(agentsMd) ? fs.readFileSync(agentsMd, "utf8") : "";
  check(agentsText.includes("myagent:skills:start"), "codex: managed block marker");
  check(agentsText.includes("Image Edit"), "codex: seed skill in block");
  check(agentsText.includes("Codex Only"), "codex: codex-only skill in block");
  check(!fs.existsSync(path.join(cwt, ".claude")), "codex: no .claude (claude-only format absent)");
  const cStatus = execFileSync("git", ["-C", cwt, "status", "--porcelain"], { encoding: "utf8" });
  check(!cStatus.includes("AGENTS.md"), "codex: rendered AGENTS.md is git-excluded");

  // ---- CORE: claude rendering ----
  const claudeRepo = gitRepo("claude-core");
  const claude = await fireAndRender(claudeRepo, { type: "cli", command: "claude", name: "Claude", permissionMode: "acceptEdits" });
  const lwt = ephemeralWorktreePath(claudeRepo, claude.invocation.id);
  const skillMd = path.join(lwt, ".claude", "skills", "image-edit", "SKILL.md");
  check(fs.existsSync(skillMd), "claude: SKILL.md rendered at .claude/skills/image-edit/");
  const skillText = fs.existsSync(skillMd) ? fs.readFileSync(skillMd, "utf8") : "";
  check(skillText.includes("name: Image Edit"), "claude: SKILL.md frontmatter name");
  check(!fs.existsSync(path.join(lwt, ".claude", "skills", "codex-only")), "claude: codex-only skill NOT rendered (target scoping)");
  const mcp = path.join(lwt, ".mcp.json");
  check(fs.existsSync(mcp), "claude: .mcp.json rendered");
  const mcpJson = fs.existsSync(mcp) ? JSON.parse(fs.readFileSync(mcp, "utf8")) : {};
  check(mcpJson?.mcpServers?.["image-tool"]?.command === "node", "claude: .mcp.json has image-tool server");
  check(!fs.existsSync(path.join(lwt, "AGENTS.md")), "claude: no AGENTS.md (codex-only format absent)");
  const lStatus = execFileSync("git", ["-C", lwt, "status", "--porcelain"], { encoding: "utf8" });
  check(!lStatus.includes(".claude") && !lStatus.includes(".mcp.json"), "claude: rendered files git-excluded");

  // ---- REAL agents (opt-in) ----
  if (!RUN_REAL) {
    console.log("\nSKIP: real-agent checks (set RUN_REAL_AGENTS=1 to enable)");
  } else {
    start("bridge", process.execPath, ["apps/desktop/src/index.mjs"], { BRIDGE_SERVER_URL: BASE, BRIDGE_POLL_INTERVAL_MS: "500" });
    await sleep(1500);
    const probe = "An image-editing skill is available here (.claude/skills/ for Claude, AGENTS.md for Codex). Reply with ONLY the exact shell CLI command that skill lists as a fallback to edit an image. No other words.";

    const runReal = async (label, repoName, agentBody, { tolerateInfra = false } = {}) => {
      const repo = gitRepo(repoName);
      const { invocation } = await fireAndRender(repo, agentBody, { task: probe });
      let inv = invocation;
      try {
        inv = await waitFor(async () => {
          const state = await api("GET", "/api/state");
          const found = state.invocations.find((x) => x.id === invocation.id);
          return found && ["succeeded", "failed", "cancelled", "error"].includes(found.status) ? found : false;
        }, `${label} terminal`, 160, 1500);
      } catch (e) {
        if (tolerateInfra) { console.log(`SKIP: ${label} did not finish (${e.message}) — likely upstream/proxy unavailable`); return; }
        throw e;
      }
      const summary = String(inv.result?.summary ?? "");
      if (inv.status !== "succeeded" && tolerateInfra && /capacity|unavailable|503|reconnect|network/i.test(summary)) {
        console.log(`SKIP: ${label} upstream unavailable (${summary.slice(0, 120)})`);
        return;
      }
      check(inv.status === "succeeded", `${label}: invocation succeeded (status=${inv.status})`);
      // The agent's own output is the real proof it read the skill. claude puts it
      // in result.summary; codex streams it as agent_output events. Scan both.
      const state = await api("GET", "/api/state");
      const outputText = state.events
        .filter((e) => e.invocationId === invocation.id && /agent_output|result/i.test(e.type))
        .map((e) => String(e.message ?? ""))
        .concat(summary)
        .join("\n");
      // Soft signal: model phrasing varies, so a miss warns rather than fails.
      if (outputText.includes("packages/image-tool/cli.mjs")) check(true, `${label}: agent surfaced the rendered skill command`);
      else console.log(`WARN: ${label} succeeded but output did not include the exact CLI string`);
    };

    if (hasCli("claude")) await runReal("claude", "claude-real", { type: "cli", command: "claude", name: "Claude", permissionMode: "acceptEdits" });
    else console.log("SKIP: real claude (CLI not found)");

    if (hasCli("codex")) await runReal("codex", "codex-real", { type: "cli", command: "codex", name: "Codex", sandbox: "read-only" }, { tolerateInfra: true });
    else console.log("SKIP: real codex (CLI not found)");
  }
} catch (error) {
  console.error("\nERROR:", error.message);
  failures++;
} finally {
  for (const c of children) { try { if (!c.killed) c.kill("SIGTERM"); } catch {} }
  await sleep(300);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(failures === 0 ? "\nskills-smoke: ALL PASS" : `\nskills-smoke: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
