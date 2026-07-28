import { Select } from "@/components/ui/input";
import type { SupportedLocale } from "@/lib/i18n";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";

export function LanguagePicker({ comfortable = false }: { comfortable?: boolean }) {
  const { t } = useAppTranslation();
  const locale = useUiStore((state) => state.locale);
  const setLocale = useUiStore((state) => state.setLocale);

  return (
    <Select
      aria-label={t("languagePicker.label")}
      className={cn(comfortable ? "h-11 w-full min-w-36" : "h-8 w-28")}
      value={locale}
      onChange={(event) => setLocale(event.target.value as SupportedLocale)}
    >
      <option value="en-US">{t("languagePicker.english")}</option>
      <option value="zh-CN">{t("languagePicker.simplifiedChinese")}</option>
    </Select>
  );
}
