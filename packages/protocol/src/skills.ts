import type { IsoDateTime } from "./common.js";

// A Skill is an agent-targeted instruction document managed in the system and
// rendered into an invocation's working directory in each agent's native format
// (claude: .claude/skills/<slug>/SKILL.md, codex: an AGENTS.md managed block).
// The same skill is never forced to run on both agents — `targets` declares which
// agent kinds it applies to, and only matching agents get it rendered.
export type SkillTarget = "claude" | "codex";

// Optional binding to an external capability the skill drives. The capability
// logic lives in one place; claude reaches it via an MCP server, codex via the
// CLI. The skill body tells each agent *when* to call it.
export interface SkillToolBinding {
  // Command codex should run, e.g. "node packages/image-tool/cli.mjs".
  cli?: string;
  // MCP server spec rendered into the worktree's .mcp.json for claude.
  mcp?: {
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
  };
}

export interface Skill {
  id: string; // skl_xxxx
  name: string;
  slug: string; // kebab-case, used for .claude/skills/<slug>/
  description: string; // one-line; SKILL.md frontmatter + codex trigger line
  body: string; // markdown instructions (when/how to use)
  targets: SkillTarget[];
  tool?: SkillToolBinding;
  enabled: boolean;
  createdAt: IsoDateTime;
  updatedAt?: IsoDateTime;
}
