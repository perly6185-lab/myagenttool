import {
  codexPermissionModeFromLegacySandbox,
  normalizeCodexPermissionMode,
  type CodexPermissionMode,
} from "@myagenttool/protocol/codex-permissions";

export function permissionModeForAgent(
  agent: { adapter?: { command?: string; permissionMode?: string; sandbox?: string } } | undefined | null,
): CodexPermissionMode {
  const command = String(agent?.adapter?.command ?? "").trim().toLowerCase();
  const isCodex = ["codex", "codex.cmd", "codex.ps1", "codex.exe"].some(
    (name) => command === name || command.endsWith(`/${name}`) || command.endsWith(`\\${name}`),
  );
  if (!isCodex) return "ask";
  return normalizeCodexPermissionMode(
    agent?.adapter?.permissionMode
      ?? codexPermissionModeFromLegacySandbox(agent?.adapter?.sandbox),
  );
}
