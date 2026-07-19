import { createCcusageApplicationRegistration } from "./ccusage-application.mjs";
import { createClaudeApplicationRegistration } from "./claude-application.mjs";
import { createCodexApplicationRegistration } from "./codex-application.mjs";
import { createGitApplicationRegistration } from "./git-application.mjs";

const KNOWN_APPLICATIONS = [
  {
    name: "git",
    displayName: "Git",
    aliases: ["git"],
    command: "git",
    runtimeRequirements: [{ runtimeId: "runtime_git", required: true }],
    installHint: "Install Git with the operating system package manager, then re-run setup.",
    createRegistration: createGitApplicationRegistration,
  },
  {
    name: "ccusage",
    displayName: "ccusage",
    aliases: ["ccusage"],
    command: "ccusage",
    runtimeRequirements: [{ runtimeId: "runtime_ccusage", required: true }],
    installHint: "Install with npm install -g ccusage, then re-run setup.",
    createRegistration: createCcusageApplicationRegistration,
  },
  {
    name: "claude",
    displayName: "Claude Code",
    aliases: ["claude", "claude code"],
    command: "claude",
    runtimeRequirements: [{ runtimeId: "runtime_claude", required: true }],
    installHint: "Install Claude Code through its approved local installation flow, then re-run setup.",
    createRegistration: createClaudeApplicationRegistration,
  },
  {
    name: "codex",
    displayName: "Codex CLI",
    aliases: ["codex", "codex cli"],
    command: "codex",
    runtimeRequirements: [{ runtimeId: "runtime_codex", required: true }],
    installHint: "Install Codex CLI through its approved local installation flow, then register its governed Application capabilities.",
    createRegistration: createCodexApplicationRegistration,
  },
];

export function listKnownApplications() {
  return KNOWN_APPLICATIONS.map(({ createRegistration, aliases, runtimeRequirements, ...entry }) => ({
    ...entry,
    aliases: [...aliases],
    runtimeRequirements: runtimeRequirements.map((requirement) => ({ ...requirement })),
  }));
}

export function createKnownApplicationRegistration(value, { projectId = null } = {}) {
  const normalized = String(value ?? "").trim().toLowerCase();
  const entry = KNOWN_APPLICATIONS.find((candidate) => candidate.aliases.includes(normalized));
  if (!entry) return null;
  const registration = entry.createRegistration();
  return {
    entry: {
      name: entry.name,
      displayName: entry.displayName,
      command: entry.command,
      installHint: entry.installHint,
      aliases: [...entry.aliases],
      runtimeRequirements: entry.runtimeRequirements.map((requirement) => ({ ...requirement })),
    },
    registration: {
      ...registration,
      ...(projectId ? { projectId } : {}),
    },
  };
}
