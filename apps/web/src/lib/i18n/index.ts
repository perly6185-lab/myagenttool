import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { applyDocumentLocale, DEFAULT_LOCALE } from "@/lib/i18n/locale";
import { defaultNamespace, resources } from "@/lib/i18n/resources";
import { useUiStore } from "@/store/ui-store";

export const i18n = i18next.createInstance();

const initialLocale = useUiStore.getState().locale;

void i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: initialLocale,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: Object.keys(resources),
    defaultNS: defaultNamespace,
    interpolation: { escapeValue: false },
    initAsync: false,
    returnNull: false,
  });

applyDocumentLocale(initialLocale);

export { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "@/lib/i18n/locale";
export type { SupportedLocale } from "@/lib/i18n/locale";
