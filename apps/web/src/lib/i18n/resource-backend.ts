import type { BackendModule, ReadCallback, ResourceKey } from "i18next";
import { DEFAULT_LOCALE, normalizeLocale, type SupportedLocale } from "@/lib/i18n/locale";

const resourceLoaders = {
  "en-US": () => import("@/lib/i18n/resources-en").then((module) => module.enUSResources),
  "zh-CN": () => import("@/lib/i18n/resources-zh").then((module) => module.zhCNResources),
} as const;

const loadedResources = new Map<SupportedLocale, Promise<ResourceKey>>();

export function loadLocaleResource(locale: SupportedLocale): Promise<ResourceKey> {
  const existing = loadedResources.get(locale);
  if (existing) return existing;
  const pending = resourceLoaders[locale]().then((resource) => resource.common as ResourceKey);
  loadedResources.set(locale, pending);
  return pending;
}

export const localeResourceBackend: BackendModule = {
  type: "backend",
  init() {},
  read(language: string, namespace: string, callback: ReadCallback) {
    if (namespace !== "common") {
      callback(null, {});
      return;
    }
    const locale = normalizeLocale(language) ?? DEFAULT_LOCALE;
    void loadLocaleResource(locale).then(
      (resource) => callback(null, resource),
      (error: unknown) => callback(error instanceof Error ? error : new Error("translation_resource_load_failed"), false),
    );
  },
};
