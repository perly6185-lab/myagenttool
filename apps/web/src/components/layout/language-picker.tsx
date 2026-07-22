import { useTranslation } from "react-i18next";
import { Select } from "@/components/ui/input";
import type { SupportedLocale } from "@/lib/i18n";
import { useUiStore } from "@/store/ui-store";

export function LanguagePicker() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const setLocale = useUiStore((state) => state.setLocale);

  return (
    <Select
      aria-label={t("languagePicker.label")}
      className="h-8 w-28"
      value={locale}
      onChange={(event) => setLocale(event.target.value as SupportedLocale)}
    >
      <option value="en-US">{t("languagePicker.english")}</option>
      <option value="zh-CN">{t("languagePicker.simplifiedChinese")}</option>
    </Select>
  );
}
