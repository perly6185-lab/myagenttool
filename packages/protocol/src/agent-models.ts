export const CODEX_MODEL_IDS = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"] as const;
export const CLAUDE_MODEL_IDS = ["sonnet", "opus"] as const;

export interface ModelAwareAgentAdapter {
  type?: string;
  command?: string;
  models?: string[];
  defaultModel?: string | null;
}

const SAFE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,199}$/;

export function normalizeAgentModel(value: unknown): string | null {
  const model = String(value ?? "").trim();
  return SAFE_MODEL_ID.test(model) ? model : null;
}

export function isCodexAgentCommand(command: unknown): boolean {
  return commandMatches(command, ["codex", "codex.exe", "codex.cmd", "codex.ps1"]);
}

export function isClaudeAgentCommand(command: unknown): boolean {
  return commandMatches(command, ["claude", "claude.exe", "claude.cmd", "claude.ps1"]);
}

export function modelIdsForAgentAdapter(adapter?: ModelAwareAgentAdapter | null): string[] {
  if (!adapter) return [];
  const configured = [...new Set((adapter.models ?? []).map(normalizeAgentModel).filter((value): value is string => Boolean(value)))];
  if (configured.length > 0) return configured;
  if (adapter.type === "cli" && isCodexAgentCommand(adapter.command)) return [...CODEX_MODEL_IDS];
  if (adapter.type === "cli" && isClaudeAgentCommand(adapter.command)) return [...CLAUDE_MODEL_IDS];
  return [];
}

export function defaultModelForAgentAdapter(adapter?: ModelAwareAgentAdapter | null): string | null {
  const model = normalizeAgentModel(adapter?.defaultModel);
  return model && modelIdsForAgentAdapter(adapter).includes(model) ? model : null;
}

export function agentAdapterSupportsModel(
  adapter: ModelAwareAgentAdapter | null | undefined,
  value: unknown,
): boolean {
  const model = normalizeAgentModel(value);
  return Boolean(model && modelIdsForAgentAdapter(adapter).includes(model));
}

function commandMatches(command: unknown, names: string[]): boolean {
  const normalized = String(command ?? "").trim().toLowerCase();
  return names.some((name) => normalized === name
    || normalized.endsWith(`/${name}`)
    || normalized.endsWith(`\\${name}`));
}
