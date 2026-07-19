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
  {
    name: "codex",
    displayName: "Codex CLI",
    aliases: ["codex", "codex cli"],
    command: "codex",
    installHint: "Install Codex CLI through its approved local installation flow, then connect it from the coding-agent setup surface.",
    setupOnly: true,
  },
  {
    name: "git-bash",
    displayName: "Git Bash",
    aliases: ["git-bash", "git bash"],
    command: "git-bash",
    installHint: "Install Git for Windows to provide Git Bash, then re-run setup.",
    setupOnly: true,
  },
  {
    name: "wsl",
    displayName: "WSL",
    aliases: ["wsl", "wsl bash", "wsl-bash"],
    command: "wsl",
    installHint: "Install Windows Subsystem for Linux; a reboot or first distro launch may still be required by Windows.",
    setupOnly: true,
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
  if (!entry || entry.setupOnly) return null;
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
