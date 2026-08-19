/**
 * Skin (theme) registry — the single source of truth for the built-in skins.
 * Drives the picker UI and the `SkinId` union. Each `id` maps 1:1 to a
 * `[data-skin="<id>"]` block in CSS (`default` is `:root` in main.css; others
 * are files under assets/skins/). See docs/design/SKIN_SYSTEM.md.
 */

export type SkinMode = "light" | "dark" | "system";
export type ResolvedMode = "light" | "dark";

export interface SkinDefinition {
  id: string;
  /** Label shown in the picker. */
  label: string;
  /** Preview chips: [primary, surface, accent]. */
  swatch: readonly [string, string, string];
  /**
   * Native window backing color per resolved mode (approx of `--background`).
   * Sent to the Electron shell so the frame matches and cold start never
   * flashes white. Plain browsers ignore it.
   */
  chrome: { light: string; dark: string };
}

export const SKINS = [
  {
    id: "default",
    label: "靛蓝（默认）",
    swatch: ["oklch(0.54 0.16 262)", "oklch(0.98 0.002 250)", "oklch(0.95 0.006 250)"],
    chrome: { light: "#f8f9fb", dark: "#0f1116" },
  },
  {
    id: "ocean",
    label: "海洋",
    swatch: ["oklch(0.56 0.13 216)", "oklch(0.98 0.006 225)", "oklch(0.95 0.02 220)"],
    chrome: { light: "#f4f8fb", dark: "#0a1522" },
  },
  {
    id: "ink",
    label: "石墨",
    swatch: ["oklch(0.52 0.06 195)", "oklch(0.98 0.001 285)", "oklch(0.95 0.004 285)"],
    chrome: { light: "#f9f9fa", dark: "#131316" },
  },
] as const satisfies readonly SkinDefinition[];

export type SkinId = (typeof SKINS)[number]["id"];

export const SKIN_IDS = SKINS.map((skin) => skin.id) as SkinId[];
export const DEFAULT_SKIN: SkinId = "default";
/** Default mode preserves the console's current forced-dark appearance. */
export const DEFAULT_MODE: SkinMode = "dark";
const SKIN_MODES: SkinMode[] = ["light", "dark", "system"];

export function isSkinId(value: unknown): value is SkinId {
  return typeof value === "string" && (SKIN_IDS as string[]).includes(value);
}

export function isSkinMode(value: unknown): value is SkinMode {
  return typeof value === "string" && (SKIN_MODES as string[]).includes(value);
}

export function skinById(id: SkinId): SkinDefinition {
  return SKINS.find((skin) => skin.id === id) ?? SKINS[0];
}

const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

/** Collapse a mode (which may be `system`) to the concrete light/dark to render. */
export function resolveMode(mode: SkinMode): ResolvedMode {
  if (mode !== "system") return mode;
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia(SYSTEM_DARK_QUERY).matches ? "dark" : "light";
}

/**
 * Apply a skin + mode to the document and forward the native chrome color to
 * the Electron shell. Safe to call repeatedly; a no-op outside the DOM.
 */
export function applySkin(skin: SkinId, mode: SkinMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const resolved = resolveMode(mode);
  root.dataset.skin = skin;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  const bg = skinById(skin).chrome[resolved];
  window.myagenttoolDesktop?.applyChrome?.({ bg, themeSource: mode, resolved });
}

/**
 * Subscribe to OS light/dark changes. Only meaningful while mode is `system`;
 * returns an unsubscribe function (a no-op where matchMedia is unavailable).
 */
export function watchSystemMode(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(SYSTEM_DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

declare global {
  interface Window {
    /** Bridge exposed by the Electron preload; absent in a plain browser. */
    myagenttoolDesktop?: {
      applyChrome?: (chrome: { bg: string; themeSource: SkinMode; resolved: ResolvedMode }) => void;
      pickLocalOfficeDocument?: () => Promise<{ selectionId: string; absolutePath: string; name: string; type: "docx" | "xlsx" | "pptx"; size: number } | null>;
      pickWorkflowSourceFolder?: () => Promise<{ absolutePath: string; name: string } | null>;
      pickWorkflowCaseFiles?: () => Promise<{
        selectionId: string;
        files: Array<{
          name: string;
          extension: string;
          size: number;
          readiness: "ready" | "inspect" | "needs_ocr";
        }>;
      } | null>;
      stageWorkflowCase?: (input: {
        requestId: string;
        sourceId: string;
        selectionId?: string;
        pastedText?: string;
        primaryKey: string;
        caseName?: string;
        authorizationMode: "authorized" | "deidentified";
        supportingRoles?: Record<string, "reference" | "historical_output">;
        confirmed: true;
      }) => Promise<{
        requestId: string;
        caseDirectory: string;
        primaryRelativePath: string;
        supportingRelativePaths: string[];
        supportingFileRoles: Record<string, "reference" | "historical_output">;
        files: Array<{
          key: string;
          name: string;
          relativePath: string;
          extension: string;
          size: number;
          readiness: "ready" | "inspect" | "needs_ocr";
        }>;
        authorizationMode: "authorized" | "deidentified";
        recordedAt: string;
      }>;
      copySelectedOfficeDocument?: (input: { selectionId: string; worktreeId: string; destination: string; onConflict?: "rename" }) => Promise<{ path: string; bytes: number; type: "docx" | "xlsx" | "pptx" }>;
      openContainedOfficeDocument?: (input: { projectId: string; worktreeId?: string; relativePath: string }) => Promise<{ opened: true }>;
      openContainedAsset?: (input: { projectId: string; worktreeId?: string; relativePath: string }) => Promise<{ opened: true }>;
      revealContainedAsset?: (input: { projectId: string; worktreeId?: string; relativePath: string }) => Promise<{ revealed: true }>;
      getMailConnectorStatus?: () => Promise<{
        desktop: true;
        providers: Array<{ id: "netease_163" | "gmail"; name: string; available: boolean; connected: boolean; credentialStored?: boolean; upgradeNeeded?: boolean; sendConnected?: boolean; organizeConnected?: boolean; readStateConnected?: boolean; account: string | null }>;
      }>;
      connect163Mail?: (input: { email: string; authorizationCode: string }) => Promise<
        | { ok: true; account: { provider: string; email: string; canReceive: true; canSend: true; canOrganize: true } }
        | { ok: false; error: "platform_not_supported" | "invalid_email" | "invalid_authorization_code" | "verification_failed" | "save_failed" }
      >;
      previewMailAttachment?: (input: { messageId: string; folderPath?: string; attachmentId: string; archiveRef?: string }) => Promise<
        | { ok: true; preview: { id: string; name: string; contentType: string; size: number; kind: "image" | "text" | "pdf"; text?: string; dataBase64?: string } }
        | { ok: false; error: "attachment_not_found" | "preview_not_supported" | "preview_too_large" | "attachment_unavailable" }
      >;
      downloadMailAttachment?: (input: { messageId: string; folderPath?: string; attachmentId: string; archiveRef?: string }) => Promise<
        | { ok: true; saved: boolean; name?: string }
        | { ok: false; error: "attachment_not_found" | "download_too_large" | "attachment_unavailable" }
      >;
      readMailAttachmentForTask?: (input: { messageId: string; folderPath?: string; attachmentId: string; archiveRef?: string }) => Promise<
        | { ok: true; attachment: { id: string; name: string; contentType: string; size: number; sha256: string; data: ArrayBuffer } }
        | { ok: false; error: "attachment_not_found" | "download_too_large" | "attachment_unavailable" }
      >;
      connect163MailSend?: () => Promise<
        | { ok: true; account: { provider: string; email: string; canReceive: true; canSend: true; canOrganize: true } }
        | { ok: false; error: "platform_not_supported" | "not_authorized" | "save_failed" }
      >;
      connect163MailOrganize?: () => Promise<
        | { ok: true; account: { provider: string; email: string; canReceive: true; canSend: true; canOrganize: true } }
        | { ok: false; error: "platform_not_supported" | "not_authorized" | "save_failed" }
      >;
      disconnect163Mail?: () => Promise<
        | { ok: true; disconnected: true }
        | { ok: false; error: "platform_not_supported" | "save_failed" }
      >;
      pickOutboundMailAttachments?: () => Promise<
        | { ok: true; attachments: Array<{ ref: string; name: string; contentType: string; size: number }> }
        | { ok: false; error: "attachment_invalid" | "attachment_too_large" | "attachment_stage_failed" }
      >;
      stagePastedMailAttachments?: (input: { files: Array<{ name: string; contentType: string; data: ArrayBuffer }> }) => Promise<
        | { ok: true; attachments: Array<{ ref: string; name: string; contentType: string; size: number }> }
        | { ok: false; error: "attachment_invalid" | "attachment_too_large" | "attachment_stage_failed" }
      >;
    };
  }
}
