import type { NpmWrapperSnapshot } from "@/lib/console-state";

export interface JsonObjectParseResult {
  value: Record<string, unknown> | null;
  error: string | null;
}

export interface WrapperCapabilityImpact {
  added: string[];
  removed: string[];
  unchanged: string[];
}

export function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return "";
  return JSON.stringify(value, null, 2);
}

export function parseOptionalJsonObject(text: string, label: string): JsonObjectParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { value: null, error: null };
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { value: null, error: `${label} must be a JSON object.` };
    }
    return { value: value as Record<string, unknown>, error: null };
  } catch (caught) {
    return { value: null, error: `${label} is not valid JSON${caught instanceof Error ? `: ${caught.message}` : "."}` };
  }
}

export function wrapperCapabilityImpact(
  applicationId: string,
  current: NpmWrapperSnapshot | null | undefined,
  descriptorText: string,
): WrapperCapabilityImpact | null {
  const trimmed = descriptorText.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const next = parsed as { mode?: unknown; commands?: unknown };
  if (String(next.mode ?? "metadata-only") !== "installed-wrapper" || !Array.isArray(next.commands)) return null;
  const prefix = `app.${applicationId}.wrapper.`;
  const currentNames = new Set(
    (current?.commands ?? [])
      .filter((command) => command.status === "approved")
      .map((command) => `${prefix}${command.id}`),
  );
  const nextNames = new Set(
    next.commands
      .filter((command): command is { id?: unknown; status?: unknown } => Boolean(command && typeof command === "object" && !Array.isArray(command)))
      .filter((command) => String(command.status ?? "draft") === "approved" && String(command.id ?? "").trim())
      .map((command) => `${prefix}${String(command.id).trim()}`),
  );
  const added = [...nextNames].filter((name) => !currentNames.has(name)).sort();
  const removed = [...currentNames].filter((name) => !nextNames.has(name)).sort();
  const unchanged = [...nextNames].filter((name) => currentNames.has(name)).sort();
  return { added, removed, unchanged };
}
