/*
 * Agent-skills: agent-targeted instruction docs, managed via CRUD and rendered
 * into an invocation's worktree in each agent's native format (claude:
 * .claude/skills/<slug>/SKILL.md + .mcp.json, codex: an AGENTS.md managed
 * block). Distinct from loop-routine skills (read-only reference docs) — see
 * packages/protocol/src/agent-skills.ts.
 *
 * Rendering targets main's reused worktrees: writes are idempotent (a fresh run
 * overwrites) and git-excluded so they never pollute the branch or a commit.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { isClaudeCliCommand, isCodexCliCommand } from "./agents.mjs";

export const AGENT_SKILL_TARGETS = ["claude", "codex"];

const SKILL_BLOCK_START = "<!-- myagent:skills:start -->";
const SKILL_BLOCK_END = "<!-- myagent:skills:end -->";

function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function normalizeAgentSkillTargets(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return AGENT_SKILL_TARGETS.filter((t) => value.includes(t));
}

export function normalizeAgentSkillTool(value) {
  if (!value || typeof value !== "object") return undefined;
  const tool = {};
  if (typeof value.cli === "string" && value.cli.trim()) tool.cli = value.cli.trim();
  if (
    value.mcp &&
    typeof value.mcp === "object" &&
    typeof value.mcp.name === "string" &&
    typeof value.mcp.command === "string"
  ) {
    tool.mcp = {
      name: value.mcp.name,
      command: value.mcp.command,
      args: Array.isArray(value.mcp.args) ? value.mcp.args.map(String) : undefined,
      env: value.mcp.env && typeof value.mcp.env === "object" ? value.mcp.env : undefined,
    };
  }
  return Object.keys(tool).length ? tool : undefined;
}

// Which coding-agent CLI an agent wraps, so we can pick its native skill format.
export function agentKind(agent) {
  const command = agent?.adapter?.type === "cli" ? agent.adapter.command : null;
  if (!command) return null;
  if (isCodexCliCommand(command)) return "codex";
  if (isClaudeCliCommand(command)) return "claude";
  return null;
}

// Keep rendered files out of the branch so worktree cleanup never commits them.
function gitExclude(wtPath, entries) {
  try {
    // In a linked worktree, `.git` is a file ("gitdir: <path>"), not a directory.
    const dotGit = join(wtPath, ".git");
    let gitDir = dotGit;
    const stat = existsSync(dotGit) ? statSync(dotGit) : null;
    if (stat?.isFile()) {
      const pointer = readFileSync(dotGit, "utf8").match(/gitdir:\s*(.+)\s*/);
      if (!pointer) return;
      gitDir = resolve(wtPath, pointer[1].trim());
    } else if (!stat?.isDirectory()) {
      return;
    }
    // git reads info/exclude from the COMMON dir; each worktree gitdir carries a
    // `commondir` file pointing at it.
    const commonDirFile = join(gitDir, "commondir");
    const commonDir = existsSync(commonDirFile)
      ? resolve(gitDir, readFileSync(commonDirFile, "utf8").trim())
      : gitDir;
    const excludePath = join(commonDir, "info", "exclude");
    mkdirSync(dirname(excludePath), { recursive: true });
    const existing = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
    const missing = entries.filter((e) => !existing.split(/\r?\n/).includes(e));
    if (missing.length) {
      appendFileSync(excludePath, (existing.endsWith("\n") || !existing ? "" : "\n") + missing.join("\n") + "\n");
    }
  } catch {
    // Non-fatal: exclude is a tidiness optimization, not correctness.
  }
}

/**
 * Render the skills that apply to `agent` into worktree `wtPath`, in the agent's
 * native format. Best-effort: any failure is logged and skipped rather than
 * blocking the invocation. `skills` is the current skill set (state.agentSkills).
 */
export function renderAgentSkillsIntoWorktree(agent, wtPath, skills = []) {
  const kind = agentKind(agent);
  if (!kind || !wtPath) return;
  const applicable = skills.filter(
    (s) => s.enabled && Array.isArray(s.targets) && s.targets.includes(kind),
  );
  if (!applicable.length) return;
  const root = resolve(wtPath);
  const inside = (p) => {
    const resolved = resolve(root, p);
    return resolved === root || resolved.startsWith(root + sep);
  };
  try {
    if (kind === "claude") {
      const mcpServers = {};
      for (const skill of applicable) {
        const dir = join(root, ".claude", "skills", skill.slug);
        if (!inside(dir)) continue;
        mkdirSync(dir, { recursive: true });
        const frontmatter = `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n`;
        writeFileSync(join(dir, "SKILL.md"), frontmatter + skill.body + "\n");
        if (skill.tool?.mcp) {
          mcpServers[skill.tool.mcp.name] = {
            command: skill.tool.mcp.command,
            ...(skill.tool.mcp.args ? { args: skill.tool.mcp.args } : {}),
            ...(skill.tool.mcp.env ? { env: skill.tool.mcp.env } : {}),
          };
        }
      }
      if (Object.keys(mcpServers).length) {
        writeFileSync(join(root, ".mcp.json"), JSON.stringify({ mcpServers }, null, 2) + "\n");
      }
      gitExclude(root, [".claude/", ".mcp.json"]);
    } else if (kind === "codex") {
      const sections = applicable.map((skill) => {
        const lines = [`## ${skill.name}`, "", skill.description, "", skill.body];
        if (skill.tool?.cli) lines.push("", `Tool: run \`${skill.tool.cli}\` to invoke this capability.`);
        return lines.join("\n");
      });
      const block = `${SKILL_BLOCK_START}\n# Skills\n\n${sections.join("\n\n---\n\n")}\n${SKILL_BLOCK_END}`;
      const agentsPath = join(root, "AGENTS.md");
      const preexisting = existsSync(agentsPath);
      const existing = preexisting ? readFileSync(agentsPath, "utf8") : "";
      let next;
      if (existing.includes(SKILL_BLOCK_START) && existing.includes(SKILL_BLOCK_END)) {
        // Replacer FUNCTION, not a string: a skill body containing $&, $1, $` etc.
        // would otherwise be interpreted as replacement patterns and corrupt the block.
        next = existing.replace(new RegExp(`${SKILL_BLOCK_START}[\\s\\S]*?${SKILL_BLOCK_END}`), () => block);
      } else {
        next = existing ? `${existing.replace(/\s*$/, "")}\n\n${block}\n` : `${block}\n`;
      }
      writeFileSync(agentsPath, next);
      // Only exclude AGENTS.md when we created it (don't hide a tracked file's diff).
      if (!preexisting) gitExclude(root, ["AGENTS.md"]);
    }
  } catch (error) {
    console.warn(
      `[server] agent-skill render failed for ${agent?.id}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function createAgentSkillService({ state, now, nextId, persistStateSoon }) {
  function findAgentSkill(skillId) {
    return (state.agentSkills ?? []).find((s) => s.id === skillId) ?? null;
  }

  function createAgentSkill(body = {}) {
    const name = String(body.name ?? "").trim();
    if (!name) throw new Error("Skill name is required.");
    state.agentSkills = state.agentSkills ?? [];
    const slug = slugify(body.slug || name) || `skill-${state.agentSkills.length + 1}`;
    const createdAt = now();
    const skill = {
      id: nextId("skl"),
      name,
      slug,
      description: String(body.description ?? "").trim(),
      body: String(body.body ?? ""),
      targets: normalizeAgentSkillTargets(body.targets, ["claude"]),
      tool: normalizeAgentSkillTool(body.tool),
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
      createdAt,
      updatedAt: createdAt,
    };
    state.agentSkills.push(skill);
    persistStateSoon();
    return skill;
  }

  function updateAgentSkill(skillId, patch = {}) {
    const skill = findAgentSkill(skillId);
    if (!skill) throw new Error("Skill not found.");
    if (patch.name !== undefined) skill.name = String(patch.name).trim() || skill.name;
    if (patch.slug !== undefined) skill.slug = slugify(patch.slug) || skill.slug;
    if (patch.description !== undefined) skill.description = String(patch.description).trim();
    if (patch.body !== undefined) skill.body = String(patch.body);
    if (patch.targets !== undefined) skill.targets = normalizeAgentSkillTargets(patch.targets, skill.targets);
    if (patch.tool !== undefined) skill.tool = normalizeAgentSkillTool(patch.tool);
    if (patch.enabled !== undefined) skill.enabled = Boolean(patch.enabled);
    skill.updatedAt = now();
    persistStateSoon();
    return skill;
  }

  function deleteAgentSkill(skillId) {
    const before = (state.agentSkills ?? []).length;
    state.agentSkills = (state.agentSkills ?? []).filter((s) => s.id !== skillId);
    if (state.agentSkills.length === before) throw new Error("Skill not found.");
    persistStateSoon();
  }

  return { findAgentSkill, createAgentSkill, updateAgentSkill, deleteAgentSkill };
}
