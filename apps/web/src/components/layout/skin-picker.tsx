import { Select } from "@/components/ui/input";
import { SKINS, type SkinId, type SkinMode } from "@/lib/skins";
import { useUiStore } from "@/store/ui-store";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { cn } from "@/lib/cn";

const MODE_OPTIONS: { value: SkinMode; labelKey: "shell.skin.light" | "shell.skin.dark" | "shell.skin.system" }[] = [
  { value: "light", labelKey: "shell.skin.light" },
  { value: "dark", labelKey: "shell.skin.dark" },
  { value: "system", labelKey: "shell.skin.system" },
];

/** Topbar controls for the active skin and light/dark mode (#1360). */
export function SkinPicker({ alwaysVisible = false }: { alwaysVisible?: boolean }) {
  const { t } = useAppTranslation();
  const skin = useUiStore((s) => s.skin);
  const setSkin = useUiStore((s) => s.setSkin);
  const mode = useUiStore((s) => s.mode);
  const setMode = useUiStore((s) => s.setMode);

  return (
    <div className={cn("items-center gap-2", alwaysVisible ? "flex flex-wrap" : "hidden lg:flex")}>
      <Select
        aria-label={t("shell.skin.label")}
        className={alwaysVisible ? "h-11 min-w-36 flex-1" : "h-8 w-28"}
        value={skin}
        onChange={(event) => setSkin(event.target.value as SkinId)}
      >
        {SKINS.map((item) => (
          <option key={item.id} value={item.id}>
            {t(`shell.skin.${item.id}`)}
          </option>
        ))}
      </Select>
      <Select
        aria-label={t("shell.skin.mode")}
        className={alwaysVisible ? "h-11 min-w-28 flex-1" : "h-8 w-24"}
        value={mode}
        onChange={(event) => setMode(event.target.value as SkinMode)}
      >
        {MODE_OPTIONS.map((item) => (
          <option key={item.value} value={item.value}>
            {t(item.labelKey)}
          </option>
        ))}
      </Select>
    </div>
  );
}
