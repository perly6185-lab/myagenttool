import type { ApplicationSnapshot, NpmWrapperSnapshot } from "@/lib/console-state";

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

export interface DescriptorRiskPreviewItem {
  id: string;
  label: string;
  surface: "mcp" | "npm_wrapper" | "manual_manifest";
  status: string;
  riskLevel: string;
  requiresApproval: boolean;
  needsPolicyConsent: boolean;
  projectedCapability: boolean;
  filePolicy?: string | null;
  networkPolicy?: string | null;
}

export interface DescriptorRiskPreview {
  items: DescriptorRiskPreviewItem[];
  projectedCount: number;
  draftCount: number;
  approvalCount: number;
  policyConsentCount: number;
  highRiskCount: number;
}

export function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return "";
  return JSON.stringify(value, null, 2);
}

export function parseOptionalJsonObject(text: string, label: string): JsonObjectParseResult {
  return parseOptionalJsonObjectCore(text, label, false);
}

export function parseOptionalJsonObjectAllowNull(text: string, label: string): JsonObjectParseResult {
  return parseOptionalJsonObjectCore(text, label, true);
}

function parseOptionalJsonObjectCore(text: string, label: string, allowNull: boolean): JsonObjectParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { value: null, error: null };
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (value === null && allowNull) {
      return { value: null, error: null };
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { value: null, error: `${label} must be a JSON object${allowNull ? " or null" : ""}.` };
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

export function descriptorRiskPreview(
  application: ApplicationSnapshot,
  descriptors: {
    mcpDescriptor?: string;
    wrapperDescriptor?: string;
    manualManifest?: string;
  },
): DescriptorRiskPreview {
  const items = [
    ...mcpPreviewItems(descriptors.mcpDescriptor),
    ...(application.source.type === "npm" ? npmWrapperPreviewItems(descriptors.wrapperDescriptor) : []),
    ...(application.source.type === "manual" ? manualManifestPreviewItems(descriptors.manualManifest) : []),
  ];
  return {
    items,
    projectedCount: items.filter((item) => item.projectedCapability).length,
    draftCount: items.filter((item) => item.status === "draft" || item.status === "candidate").length,
    approvalCount: items.filter((item) => item.requiresApproval || item.needsPolicyConsent).length,
    policyConsentCount: items.filter((item) => item.needsPolicyConsent).length,
    highRiskCount: items.filter((item) => item.riskLevel === "high" || item.riskLevel === "critical").length,
  };
}

function mcpPreviewItems(descriptorText?: string): DescriptorRiskPreviewItem[] {
  const descriptor = parseDescriptorObject(descriptorText);
  if (!descriptor) return [];
  const allowedTools = Array.isArray(descriptor.allowedTools) ? descriptor.allowedTools : [];
  const filePolicy = textOrNull(descriptor.filePolicy) ?? "read_only";
  const networkPolicy = textOrNull(descriptor.networkPolicy) ?? (descriptor.transport === "http" ? "restricted" : "forbidden");
  const riskLevel = normalizeRisk(textOrNull(descriptor.riskLevel), networkPolicy !== "forbidden" ? "high" : "medium");
  return allowedTools.length
    ? allowedTools.map((tool, index) => ({
        id: `mcp:${String(tool ?? index)}`,
        label: String(tool ?? `tool_${index + 1}`),
        surface: "mcp",
        status: "shared_tool",
        riskLevel,
        requiresApproval: true,
        needsPolicyConsent: false,
        projectedCapability: true,
        filePolicy,
        networkPolicy,
      }))
    : [{
        id: "mcp:descriptor",
        label: textOrNull(descriptor.name) ?? "MCP descriptor",
        surface: "mcp",
        status: "descriptor",
        riskLevel,
        requiresApproval: true,
        needsPolicyConsent: false,
        projectedCapability: false,
        filePolicy,
        networkPolicy,
      }];
}

function npmWrapperPreviewItems(descriptorText?: string): DescriptorRiskPreviewItem[] {
  const descriptor = parseDescriptorObject(descriptorText);
  if (!descriptor || String(descriptor.mode ?? "metadata-only") !== "installed-wrapper" || !Array.isArray(descriptor.commands)) return [];
  return descriptor.commands
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .map((command, index) => {
      const status = textOrNull(command.status) ?? "draft";
      const filePolicy = textOrNull(command.filePolicy) ?? "read_only";
      const networkPolicy = textOrNull(command.networkPolicy) ?? "forbidden";
      const needsPolicyConsent = filePolicy !== "read_only" || networkPolicy !== "forbidden";
      return {
        id: `wrapper:${textOrNull(command.id) ?? index}`,
        label: textOrNull(command.displayName ?? command.id ?? command.command) ?? `Wrapper command ${index + 1}`,
        surface: "npm_wrapper",
        status,
        riskLevel: normalizeRisk(textOrNull(command.riskLevel), needsPolicyConsent ? "high" : "medium"),
        requiresApproval: command.requiresApproval !== false,
        needsPolicyConsent,
        projectedCapability: status === "approved",
        filePolicy,
        networkPolicy,
      };
    });
}

function manualManifestPreviewItems(descriptorText?: string): DescriptorRiskPreviewItem[] {
  const manifest = parseDescriptorObject(descriptorText);
  const capabilities = Array.isArray(manifest?.capabilities) ? manifest.capabilities : [];
  return capabilities
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .map((capability, index) => ({
      id: `manual:${textOrNull(capability.id) ?? index}`,
      label: textOrNull(capability.displayName ?? capability.name ?? capability.id) ?? `Declared capability ${index + 1}`,
      surface: "manual_manifest",
      status: "candidate",
      riskLevel: normalizeRisk(textOrNull(capability.riskLevel), "medium"),
      requiresApproval: capability.requiresApproval === true,
      needsPolicyConsent: false,
      projectedCapability: false,
      filePolicy: null,
      networkPolicy: null,
    }));
}

function parseDescriptorObject(text?: string): Record<string, unknown> | null {
  const trimmed = String(text ?? "").trim();
  if (!trimmed || trimmed === "null") return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function normalizeRisk(value: string | null, fallback: "low" | "medium" | "high"): string {
  return value && ["low", "medium", "high", "critical"].includes(value) ? value : fallback;
}

function textOrNull(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
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
