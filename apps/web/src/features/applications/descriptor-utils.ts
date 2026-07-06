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

export interface DescriptorFeedbackIssue {
  path: string | null;
  message: string;
}

export interface NpmWrapperCommandDraft {
  id?: string;
  displayName?: string;
  commandType?: string;
  command?: string;
  status?: string;
  riskLevel?: string;
  filePolicy?: string;
  networkPolicy?: string;
  requiresApproval?: boolean;
}

export interface DescriptorTextResult {
  text: string | null;
  error: string | null;
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

export function buildNpmWrapperDescriptorDraft(
  descriptorText: string,
  draft: NpmWrapperCommandDraft,
): DescriptorTextResult {
  const command = String(draft.command ?? "").trim();
  const id = slugSegment(draft.id || draft.displayName || command);
  if (!id) return { text: null, error: "Wrapper command requires an id or command." };
  if (!command) return { text: null, error: "Wrapper command requires a command." };

  const parsed = parseOptionalJsonObject(descriptorText, "npm wrapper descriptor");
  if (parsed.error) return { text: null, error: parsed.error };
  const descriptor: Record<string, unknown> = {
    mode: "installed-wrapper",
    installState: "installed",
    packageManager: "npm",
    ...(parsed.value ?? {}),
  };
  const commands = Array.isArray(descriptor.commands)
    ? descriptor.commands.filter((item: unknown) => item && typeof item === "object" && !Array.isArray(item))
    : [];
  const nextCommand = {
    id,
    ...(String(draft.displayName ?? "").trim() ? { displayName: String(draft.displayName).trim() } : {}),
    commandType: normalizeChoice(draft.commandType, ["npm_script", "bin", "custom"], "npm_script"),
    command,
    status: normalizeChoice(draft.status, ["approved", "draft", "disabled"], "approved"),
    riskLevel: normalizeChoice(draft.riskLevel, ["low", "medium", "high", "critical"], "medium"),
    requiresApproval: draft.requiresApproval !== false,
    filePolicy: normalizeChoice(draft.filePolicy, ["forbidden", "read_only", "workspace_write"], "read_only"),
    networkPolicy: normalizeChoice(draft.networkPolicy, ["forbidden", "restricted", "network"], "forbidden"),
  };
  const withoutExisting = commands.filter((item: unknown) => String((item as { id?: unknown }).id ?? "") !== id);
  return {
    text: prettyJson({
      ...descriptor,
      mode: "installed-wrapper",
      installState: descriptor.installState ?? "installed",
      packageManager: descriptor.packageManager ?? "npm",
      commands: [...withoutExisting, nextCommand],
    }),
    error: null,
  };
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

export function descriptorFeedbackIssues(message: string | null | undefined): DescriptorFeedbackIssue[] {
  const text = String(message ?? "").trim();
  if (!text) return [];
  return text
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^([a-zA-Z][a-zA-Z0-9_.[\]-]*):\s*(.+)$/);
      if (!match) return { path: null, message: part };
      return { path: match[1], message: match[2] };
    });
}

function normalizeChoice(value: unknown, allowed: string[], fallback: string): string {
  const text = String(value ?? "").trim();
  return allowed.includes(text) ? text : fallback;
}

function slugSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replaceAll(".", "_")
    .replaceAll("-", "_");
}
