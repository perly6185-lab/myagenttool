import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { applyDocumentLocale, detectInitialLocale, SUPPORTED_LOCALES } from "@/lib/i18n/locale";
import { defaultNamespace } from "@/lib/i18n/config";
import { localeResourceBackend } from "@/lib/i18n/resource-backend";

export const i18n = i18next.createInstance();

const initialLocale = detectInitialLocale();

export const i18nReady = i18n
  .use(initReactI18next)
  .use(localeResourceBackend)
  .init({
    lng: initialLocale,
    fallbackLng: false,
    supportedLngs: SUPPORTED_LOCALES,
    load: "currentOnly",
    ns: [defaultNamespace],
    defaultNS: defaultNamespace,
    interpolation: { escapeValue: false },
    returnNull: false,
  })
  .then(() => {
    applyDocumentLocale(initialLocale);
    return i18n;
  });

export { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "@/lib/i18n/locale";
export type { SupportedLocale } from "@/lib/i18n/locale";
