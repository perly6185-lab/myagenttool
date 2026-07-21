import { createCcusageApplicationRegistration } from "./ccusage-application.mjs";
import { createClaudeApplicationRegistration } from "./claude-application.mjs";
import { createCodexApplicationRegistration } from "./codex-application.mjs";
import { createGitApplicationRegistration } from "./git-application.mjs";
import { createMarkdownApplicationRegistration } from "./markdown-application.mjs";
import { createCanvasApplicationRegistration } from "./canvas-application.mjs";
import { createOfficecliApplicationRegistration } from "./officecli-application.mjs";
import { createExcalidrawCliApplicationRegistration } from "./excalidraw-cli-application.mjs";

const KNOWN_APPLICATIONS = [
  {
    name: "markdown",
    displayName: "Markdown",
    aliases: ["markdown", "md"],
    command: "",
    runtimeRequirements: [],
    installHint: "Built into MyAgentTool and ready without external installation.",
    createRegistration: createMarkdownApplicationRegistration,
  },
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
  {
    // OfficeCLI is a governed binary Application backed by a tool runtime (like git
    // / ccusage). Git Bash and WSL are NOT Applications — they are shell Runtimes
    // (see runtime-catalog.mjs) and no longer appear in the Add Application flow.
    name: "officecli",
    displayName: "OfficeCLI",
    aliases: ["officecli", "office", "office-cli"],
    command: "officecli",
    runtimeRequirements: [{ runtimeId: "runtime_officecli", required: true }],
    installHint: "Install with npm install -g @officecli/officecli, then re-run setup.",
    createRegistration: createOfficecliApplicationRegistration,
  },
  {
    // Canvas is a built-in, in-process Application — no external runtime (like
    // Markdown). The `excalidraw` alias stays with Canvas; the excalidraw-cli
    // runtime-backed Application below keys off `excalidraw-cli` only.
    name: "canvas",
    displayName: "Canvas",
    aliases: ["canvas", "excalidraw"],
    command: "canvas",
    runtimeRequirements: [],
    installHint: "Canvas is built in; no installation is required.",
    createRegistration: createCanvasApplicationRegistration,
  },
  {
    // #1356: the optional excalidraw-cli Application — a governed external binary
    // that renders Canvas scenes to PNG through the Desktop Bridge, backed by a tool
    // runtime. Distinct from the in-process `canvas` Application above.
    name: "excalidraw-cli",
    displayName: "Excalidraw CLI",
    aliases: ["excalidraw-cli", "excalidraw cli"],
    command: "excalidraw-cli",
    runtimeRequirements: [{ runtimeId: "runtime_excalidraw_cli", required: true }],
    installHint: "Install with npm install -g @tommywalkie/excalidraw-cli, then re-run setup.",
    createRegistration: createExcalidrawCliApplicationRegistration,
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
      executionScope: "local",
      runtimeRequirements: entry.runtimeRequirements.map((requirement) => ({ ...requirement })),
      ...(projectId ? { projectId } : {}),
    },
  };
}
