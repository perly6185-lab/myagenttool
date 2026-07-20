import { Select } from "@/components/ui/input";
import { SKINS, type SkinId, type SkinMode } from "@/lib/skins";
import { useUiStore } from "@/store/ui-store";

const MODE_OPTIONS: { value: SkinMode; label: string }[] = [
  { value: "light", label: "亮色" },
  { value: "dark", label: "暗色" },
  { value: "system", label: "跟随系统" },
];

/** Topbar controls for the active skin and light/dark mode (#1360). */
export function SkinPicker() {
  const skin = useUiStore((s) => s.skin);
  const setSkin = useUiStore((s) => s.setSkin);
  const mode = useUiStore((s) => s.mode);
  const setMode = useUiStore((s) => s.setMode);

  return (
    <div className="hidden items-center gap-2 lg:flex">
      <Select
        aria-label="皮肤"
        className="h-8 w-28"
        value={skin}
        onChange={(event) => setSkin(event.target.value as SkinId)}
      >
        {SKINS.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </Select>
      <Select
        aria-label="主题模式"
        className="h-8 w-24"
        value={mode}
        onChange={(event) => setMode(event.target.value as SkinMode)}
      >
        {MODE_OPTIONS.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
