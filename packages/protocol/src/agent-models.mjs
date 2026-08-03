const SAFE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,199}$/;

export const CODEX_MODEL_IDS = Object.freeze([
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
]);

export const CLAUDE_MODEL_IDS = Object.freeze(["sonnet", "opus"]);

export function normalizeAgentModel(value) {
  const model = String(value ?? "").trim();
  return SAFE_MODEL_ID.test(model) ? model : null;
}

export function isCodexAgentCommand(command) {
  return commandMatches(command, ["codex", "codex.exe", "codex.cmd", "codex.ps1"]);
}

export function isClaudeAgentCommand(command) {
  return commandMatches(command, ["claude", "claude.exe", "claude.cmd", "claude.ps1"]);
}

export function modelIdsForAgentAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") return [];
  const configured = uniqueModels(adapter.models);
  if (configured.length > 0) return configured;
  if (adapter.type === "cli" && isCodexAgentCommand(adapter.command)) return [...CODEX_MODEL_IDS];
  if (adapter.type === "cli" && isClaudeAgentCommand(adapter.command)) return [...CLAUDE_MODEL_IDS];
  return [];
}

export function defaultModelForAgentAdapter(adapter) {
  const model = normalizeAgentModel(adapter?.defaultModel);
  return model && modelIdsForAgentAdapter(adapter).includes(model) ? model : null;
}

export function agentAdapterSupportsModel(adapter, value) {
  const model = normalizeAgentModel(value);
  return Boolean(model && modelIdsForAgentAdapter(adapter).includes(model));
}

function uniqueModels(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map(normalizeAgentModel)
      .filter(Boolean),
  )];
}

function commandMatches(command, names) {
  const normalized = String(command ?? "").trim().toLowerCase();
  return names.some((name) => normalized === name
    || normalized.endsWith(`/${name}`)
    || normalized.endsWith(`\\${name}`));
}
