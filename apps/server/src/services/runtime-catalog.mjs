const RUNTIMES = [
  runtime("runtime_git", "git", "Git", "tool", ["git"], ["app_git"]),
  runtime("runtime_ccusage", "ccusage", "ccusage CLI", "tool", ["ccusage"], ["app_ccusage"]),
  runtime("runtime_officecli", "officecli", "OfficeCLI", "tool", ["officecli", "office", "office-cli"], ["app_officecli"]),
  runtime("runtime_pdfcpu", "pdfcpu", "pdfcpu", "tool", ["pdfcpu", "pdf cpu"], ["app_pdfcpu"]),
  runtime("runtime_excalidraw_cli", "excalidraw-cli", "Excalidraw CLI", "tool", ["excalidraw-cli", "excalidraw cli"], ["app_excalidraw_cli"]),
  runtime("runtime_claude", "claude", "Claude Code", "agent_cli", ["claude", "claude code"], ["app_claude"], { authenticationRequired: true, loginCommand: "claude auth login" }),
  runtime("runtime_codex", "codex", "Codex CLI", "agent_cli", ["codex", "codex cli"], ["app_codex"], { authenticationRequired: true, loginCommand: "codex login" }),
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
    // Stage 4 (#1342): the AUTHORITATIVE local sign-in command for a runtime that
    // requires authentication (e.g. `codex login`). Owned by the catalog so the web
    // never hardcodes it; it is a fixed command name, never a secret/token.
    loginCommand: options.loginCommand ?? null,
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

export function runtimeRequirementsForApplicationId(applicationId) {
  return RUNTIMES
    .filter((entry) => entry.applicationIds.includes(String(applicationId ?? "")))
    .map((entry) => ({ runtimeId: entry.id, required: true }));
}

/**
 * Stage 4 (#1342): the server-owned local sign-in command for an Application,
 * derived from the first authentication-requiring runtime that backs it. `null`
 * when no backing runtime needs authentication. The web reads this instead of
 * hardcoding per-app login commands.
 */
export function loginCommandForApplicationId(applicationId) {
  const runtime = RUNTIMES.find((entry) =>
    entry.applicationIds.includes(String(applicationId ?? "")) && entry.loginCommand);
  return runtime?.loginCommand ?? null;
}
