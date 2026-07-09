// Regression smoke for the agent-skills feature (#186 + review fix #191):
// CRUD, target normalization, and worktree rendering (claude/codex, idempotent
// re-render, disabled-skip, non-CLI no-op, and the $-sequence corruption fix).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  agentKind,
  createAgentSkillService,
  normalizeAgentSkillPaths,
  renderAgentSkillsIntoWorktree,
  skillMatchesRole,
} from "../../apps/server/src/services/agent-skills.mjs";

let passed = 0;
const ok = (msg) => {
  passed += 1;
  console.log(`  ok - ${msg}`);
};

// --- CRUD ---
{
  const state = { agentSkills: [] };
  let n = 0;
  const svc = createAgentSkillService({
    state,
    now: () => "2026-01-01T00:00:00Z",
    nextId: (p) => `${p}_${++n}`,
    persistStateSoon: () => {},
  });
  const s = svc.createAgentSkill({ name: "My Skill!", body: "do it", targets: ["codex", "bogus"] });
  assert.equal(s.slug, "my-skill", "slug derived from name");
  assert.deepEqual(s.targets, ["codex"], "unknown target dropped");
  assert.equal(s.enabled, true);
  const u = svc.updateAgentSkill(s.id, { enabled: false, targets: ["claude", "codex"] });
  assert.equal(u.enabled, false);
  assert.deepEqual(u.targets, ["claude", "codex"]);
  assert.equal(u.paths, undefined, "no path restriction by default (renders for every run)");
  const roled = svc.updateAgentSkill(s.id, { paths: ["design", "bogus", "prototype"] });
  assert.deepEqual(roled.paths, ["design", "prototype"], "paths normalized to known roles");
  svc.deleteAgentSkill(s.id);
  assert.equal(state.agentSkills.length, 0);
  assert.throws(() => svc.deleteAgentSkill("nope"), /not found/);
  assert.throws(() => svc.createAgentSkill({}), /name is required/);
  ok("CRUD: create/update/delete/validation");
}

// --- agentKind ---
{
  assert.equal(agentKind({ adapter: { type: "cli", command: "codex" } }), "codex");
  assert.equal(agentKind({ adapter: { type: "cli", command: "/usr/bin/claude" } }), "claude");
  assert.equal(agentKind({ adapter: { type: "http" } }), null);
  ok("agentKind: codex/claude/non-cli");
}

const wt = join(tmpdir(), `agent-skills-smoke-${process.pid}`);
rmSync(wt, { recursive: true, force: true });

const skills = [
  {
    id: "s1", name: "Image Edit", slug: "image-edit", description: "edit images",
    body: "use it", targets: ["claude", "codex"],
    tool: { cli: "node cli.mjs", mcp: { name: "image-tool", command: "node", args: ["mcp.mjs"] } },
    enabled: true,
  },
  { id: "s2", name: "Off", slug: "off", description: "x", body: "y", targets: ["codex"], enabled: false },
];

// --- render codex: block + idempotent + disabled-skip ---
{
  const dir = join(wt, "codex"); mkdirSync(dir, { recursive: true });
  renderAgentSkillsIntoWorktree({ id: "a", adapter: { type: "cli", command: "codex" } }, dir, skills);
  let agents = readFileSync(join(dir, "AGENTS.md"), "utf8");
  assert.ok(agents.includes("## Image Edit") && agents.includes("run `node cli.mjs`"), "codex block written");
  assert.ok(!agents.includes("## Off"), "disabled skill skipped");
  renderAgentSkillsIntoWorktree({ id: "a", adapter: { type: "cli", command: "codex" } }, dir, skills);
  agents = readFileSync(join(dir, "AGENTS.md"), "utf8");
  assert.equal((agents.match(/myagent:skills:start/g) || []).length, 1, "single block after re-render");
  ok("render codex: block + idempotent + disabled-skip");
}

// --- render codex: $-sequences in body must render literally (#191) ---
{
  const dir = join(wt, "dollar"); mkdirSync(dir, { recursive: true });
  const dollar = [{ id: "d", name: "D", slug: "d", description: "d",
    body: "use $& and $1 and $` literally", targets: ["codex"], enabled: true }];
  const a = { id: "a", adapter: { type: "cli", command: "codex" } };
  renderAgentSkillsIntoWorktree(a, dir, dollar);
  renderAgentSkillsIntoWorktree(a, dir, dollar);
  const md = readFileSync(join(dir, "AGENTS.md"), "utf8");
  assert.equal((md.match(/myagent:skills:start/g) || []).length, 1, "one block after re-render with $-sequences");
  assert.ok(md.includes("use $& and $1 and $` literally"), "$-sequences preserved literally");
  ok("render codex: $-sequences preserved (no replacement-pattern corruption)");
}

// --- render claude: SKILL.md + .mcp.json ---
{
  const dir = join(wt, "claude"); mkdirSync(dir, { recursive: true });
  renderAgentSkillsIntoWorktree({ id: "a", adapter: { type: "cli", command: "claude" } }, dir, skills);
  const skillMd = readFileSync(join(dir, ".claude", "skills", "image-edit", "SKILL.md"), "utf8");
  assert.ok(skillMd.startsWith("---\nname: Image Edit\ndescription: edit images\n---"), "claude frontmatter");
  const mcp = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf8"));
  assert.equal(mcp.mcpServers["image-tool"].command, "node");
  assert.ok(!existsSync(join(dir, ".claude", "skills", "off")), "disabled skill not rendered");
  ok("render claude: SKILL.md + .mcp.json");
}

// --- non-CLI agent renders nothing ---
{
  const dir = join(wt, "http"); mkdirSync(dir, { recursive: true });
  renderAgentSkillsIntoWorktree({ id: "a", adapter: { type: "http" } }, dir, skills);
  assert.ok(!existsSync(join(dir, "AGENTS.md")) && !existsSync(join(dir, ".claude")), "no render for non-CLI");
  ok("render: non-CLI agent writes nothing");
}

// --- render codex: a git-TRACKED AGENTS.md must be left untouched (#191 review) ---
{
  const repo = join(wt, "tracked-repo"); mkdirSync(repo, { recursive: true });
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "t@t.co");
  git("config", "user.name", "t");
  const userContent = "# My Agents\n\nHand-written project instructions.\n";
  writeFileSync(join(repo, "AGENTS.md"), userContent);
  git("add", "-A");
  git("commit", "-qm", "init");
  renderAgentSkillsIntoWorktree({ id: "a", adapter: { type: "cli", command: "codex" } }, repo, skills);
  assert.equal(readFileSync(join(repo, "AGENTS.md"), "utf8"), userContent,
    "tracked AGENTS.md left byte-for-byte unchanged (no skill injection)");
  ok("render codex: git-tracked AGENTS.md is not mutated");
}

// --- role-keyed selection: normalize + match + per-run render ---
{
  assert.equal(normalizeAgentSkillPaths(undefined), undefined, "undefined stays undefined (every run)");
  assert.deepEqual(normalizeAgentSkillPaths(["design", "nope"]), ["design"], "unknown role dropped");
  assert.deepEqual(normalizeAgentSkillPaths("design"), undefined, "non-array → undefined");

  const unrestricted = { paths: undefined };
  const designOnly = { paths: ["design"] };
  assert.equal(skillMatchesRole(unrestricted, "develop"), true, "no restriction → any role");
  assert.equal(skillMatchesRole(unrestricted, undefined), true, "no restriction → manual run too");
  assert.equal(skillMatchesRole(designOnly, "design"), true, "restricted → matching role renders");
  assert.equal(skillMatchesRole(designOnly, "develop"), false, "restricted → other role skipped");
  assert.equal(skillMatchesRole(designOnly, undefined), false, "restricted → manual run skipped");
  assert.equal(skillMatchesRole({ paths: [] }, undefined), true, "empty array = every run");
  ok("role selection: normalize + skillMatchesRole semantics");
}

// --- render respects role: a design-only skill renders only for a design run ---
{
  const roleSkills = [
    { id: "g", name: "General", slug: "general", description: "always", body: "g", targets: ["codex"], enabled: true },
    { id: "d", name: "Design Kit", slug: "design-kit", description: "design", body: "d", targets: ["codex"], enabled: true, paths: ["design"] },
  ];
  const agent = { id: "a", adapter: { type: "cli", command: "codex" } };

  const dDesign = join(wt, "role-design"); mkdirSync(dDesign, { recursive: true });
  renderAgentSkillsIntoWorktree(agent, dDesign, roleSkills, { role: "design" });
  let md = readFileSync(join(dDesign, "AGENTS.md"), "utf8");
  assert.ok(md.includes("## General") && md.includes("## Design Kit"), "design run: both general + design-only render");

  const dDev = join(wt, "role-develop"); mkdirSync(dDev, { recursive: true });
  renderAgentSkillsIntoWorktree(agent, dDev, roleSkills, { role: "develop" });
  md = readFileSync(join(dDev, "AGENTS.md"), "utf8");
  assert.ok(md.includes("## General") && !md.includes("## Design Kit"), "develop run: design-only skill excluded");

  const dManual = join(wt, "role-manual"); mkdirSync(dManual, { recursive: true });
  renderAgentSkillsIntoWorktree(agent, dManual, roleSkills); // no role
  md = readFileSync(join(dManual, "AGENTS.md"), "utf8");
  assert.ok(md.includes("## General") && !md.includes("## Design Kit"), "manual run: only unrestricted skills render");
  ok("render: role-restricted skill renders only for its role");
}

// --- seeded design-role skills (fresh state): brief + UI wireframes (D2) ---
{
  const { createServerState } = await import("../../apps/server/src/runtime/state-factory.mjs");
  const { state } = createServerState({ defaultProjectPath: tmpdir(), now: () => new Date("2026-01-01T00:00:00Z").toISOString() });
  const byId = Object.fromEntries((state.agentSkills ?? []).map((s) => [s.id, s]));
  assert.ok(byId.skl_design_brief, "design-brief skill seeded");
  const ui = byId.skl_ui_design;
  assert.ok(ui, "UI-design wireframes skill seeded (D2)");
  assert.deepEqual(ui.paths, ["design"], "UI-design skill is design-role scoped");
  assert.equal(ui.enabled, true, "UI-design skill enabled by default");
  assert.match(ui.body, /ASCII wireframes/, "brief must demand ASCII wireframes");
  assert.match(ui.body, /component hierarchy/i, "brief must demand a component hierarchy");
  assert.match(ui.body, /Do NOT edit product code/, "design rule preserved");
  ok("seed: skl_ui_design present, design-scoped, wireframe requirements in body");
}

rmSync(wt, { recursive: true, force: true });
console.log(`\nagent-skills-smoke: ${passed} checks passed`);
