const RUNTIMES = [
  runtime("runtime_git", "git", "Git", "tool", ["git"], ["app_git"]),
  runtime("runtime_ccusage", "ccusage", "ccusage CLI", "tool", ["ccusage"], ["app_ccusage"]),
  runtime("runtime_claude", "claude", "Claude Code", "agent_cli", ["claude", "claude code"], ["app_claude"], { authenticationRequired: true }),
  runtime("runtime_codex", "codex", "Codex CLI", "agent_cli", ["codex", "codex cli"], ["app_codex"], { authenticationRequired: true }),
  runtime("runtime_git_bash", "git-bash", "Git Bash", "shell", ["git-bash", "git bash"], []),
  runtime("runtime_wsl", "wsl", "WSL", "shell", ["wsl", "wsl bash", "wsl-bash"], []),
];

function runtime(id, command, displayName, kind, aliases, applicationIds, options = {}) {
  return {
    id,
    command,
    displayName,
    kind,
    aliases,
    applicationIds,
    authenticationRequired: options.authenticationRequired === true,
    userVisible: applicationIds.length > 0,
  };
}

export function listKnownRuntimes() {
  return RUNTIMES.map((entry) => ({
    ...entry,
    aliases: [...entry.aliases],
    applicationIds: [...entry.applicationIds],
  }));
}

export function findKnownRuntime(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return listKnownRuntimes().find((entry) => entry.id === normalized || entry.aliases.includes(normalized)) ?? null;
}

export function runtimeIdForCommand(command) {
  return RUNTIMES.find((entry) => entry.command === String(command ?? "").trim().toLowerCase())?.id ?? null;
}
