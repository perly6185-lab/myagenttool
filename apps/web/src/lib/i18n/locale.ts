export const SUPPORTED_LOCALES = ["en-US", "zh-CN"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = "en-US";
export const LOCALE_STORAGE_KEY = "myagenttool-ui";

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === "string" && SUPPORTED_LOCALES.includes(value as SupportedLocale);
}

/**
 * Normalize a browser/Electron language tag to a locale supported by the UI.
 * Traditional/other Chinese variants intentionally remain unsupported until
 * their translations have been reviewed; they therefore use the safe fallback.
 */
export function normalizeLocale(value: unknown): SupportedLocale | null {
  if (typeof value !== "string") return null;
  const tag = value.trim().replaceAll("_", "-").toLowerCase();
  if (tag === "en" || tag.startsWith("en-")) return "en-US";
  if (
    tag === "zh"
    || ["zh-cn", "zh-hans", "zh-sg"].some((supported) => tag === supported || tag.startsWith(`${supported}-`))
  ) return "zh-CN";
  return null;
}

export function detectLocale(languages?: readonly string[]): SupportedLocale {
  const candidates = languages ?? (
    typeof navigator === "undefined"
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : navigator.language
          ? [navigator.language]
          : []
  );
  for (const candidate of candidates) {
    const locale = normalizeLocale(candidate);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

export function detectInitialLocale(storage?: Pick<Storage, "getItem">): SupportedLocale {
  const target = storage ?? (typeof localStorage === "undefined" ? null : localStorage);
  if (target) {
    try {
      const saved = JSON.parse(target.getItem(LOCALE_STORAGE_KEY) ?? "null") as { state?: { locale?: unknown } } | null;
      if (isSupportedLocale(saved?.state?.locale)) return saved.state.locale;
    } catch {
      // A corrupt UI preference must never block application startup.
    }
  }
  return detectLocale();
}

export function localeDirection(_locale: SupportedLocale): "ltr" | "rtl" {
  return "ltr";
}

export function applyDocumentLocale(locale: SupportedLocale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  document.documentElement.dir = localeDirection(locale);
}
