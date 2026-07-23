import { useEffect } from "react";
import { i18n } from "@/lib/i18n";
import { applyDocumentLocale } from "@/lib/i18n/locale";
import { useUiStore } from "@/store/ui-store";

/** Keep i18next and the host document aligned with the persisted UI locale. */
export function useLocaleSync(): void {
  const locale = useUiStore((state) => state.locale);

  useEffect(() => {
    applyDocumentLocale(locale);
    if (i18n.resolvedLanguage !== locale) void i18n.changeLanguage(locale);
  }, [locale]);
}
