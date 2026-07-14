import { createCcusageApplicationRegistration } from "./ccusage-application.mjs";
import { createClaudeApplicationRegistration } from "./claude-application.mjs";
import { createGitApplicationRegistration } from "./git-application.mjs";

const KNOWN_APPLICATIONS = [
  {
    name: "git",
    displayName: "Git",
    aliases: ["git"],
    command: "git",
    installHint: "Install Git with the operating system package manager, then re-run setup.",
    createRegistration: createGitApplicationRegistration,
  },
  {
    name: "ccusage",
    displayName: "ccusage",
    aliases: ["ccusage"],
    command: "ccusage",
    installHint: "Install with npm install -g ccusage, then re-run setup.",
    createRegistration: createCcusageApplicationRegistration,
  },
  {
    name: "claude",
    displayName: "Claude Code",
    aliases: ["claude", "claude code"],
    command: "claude",
    installHint: "Install Claude Code through its approved local installation flow, then re-run setup.",
    createRegistration: createClaudeApplicationRegistration,
  },
];

export function listKnownApplications() {
  return KNOWN_APPLICATIONS.map(({ createRegistration, aliases, ...entry }) => ({
    ...entry,
    aliases: [...aliases],
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
    },
    registration: {
      ...registration,
      ...(projectId ? { projectId } : {}),
    },
  };
}
