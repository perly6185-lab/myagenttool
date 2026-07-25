import { useSyncExternalStore } from "react";
import { SECTIONS, SECTION_GROUPS } from "@/app/sections";
import { LoginControl } from "@/components/layout/login-control";
import { SkinPicker } from "@/components/layout/skin-picker";
import { LanguagePicker } from "@/components/layout/language-picker";
import { useWindowControlsOverlay } from "@/lib/window-controls-overlay";
import { StatusBadge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import {
  isControlPlaneStreamConnected,
  subscribeControlPlaneStream,
} from "@/data/control-plane-stream";

/** The server-persisted current project — survives refresh via /api/state. */
function ProjectSwitcher() {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const { execute, pending } = useAsyncAction();
  const projects = state?.projects ?? [];
  const currentProjectId = state?.currentProjectId ?? "";

  if (!projects.length) return null;

  return (
    <label className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
      <span>{t("shell.project")}</span>
      <Select
        aria-label={t("shell.currentProject")}
        title={projects.find((p) => p.id === currentProjectId)?.name ?? undefined}
        className="h-8 w-44"
        value={currentProjectId}
        disabled={pending}
        onChange={(e) => void execute(() => api.selectProject(e.target.value))}
      >
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </Select>
    </label>
  );
}

function MobileSectionSwitcher() {
  const { t } = useAppTranslation();
  const section = useUiStore((s) => s.section);
  const setSection = useUiStore((s) => s.setSection);
  return (
    <Select
      aria-label={t("shell.section")}
      className="h-8 w-32 md:hidden"
      value={section}
      onChange={(event) => setSection(event.target.value as typeof section)}
    >
      {SECTION_GROUPS.map((group) => (
        <optgroup key={group.key} label={t(group.labelKey)}>
          {SECTIONS.filter((item) => item.group === group.key).map((item) => (
            <option key={item.key} value={item.key}>{t(item.labelKey)}</option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

export function Topbar() {
  const { t } = useAppTranslation();
  const section = useUiStore((s) => s.section);
  const { data: state, isError, isLoading } = useConsoleState();
  const current = SECTIONS.find((item) => item.key === section);
  const wcoVisible = useWindowControlsOverlay();
  const liveUpdates = useSyncExternalStore(
    subscribeControlPlaneStream,
    isControlPlaneStreamConnected,
    () => false,
  );

  const connection = isError
    ? { tone: "danger" as const, label: t("shell.offline") }
    : isLoading
      ? { tone: "running" as const, label: t("shell.connecting") }
      : { tone: "success" as const, label: t("shell.connected") };
  const deviceStatus = state?.device?.status === "online"
    ? t("shell.deviceOnline")
    : state?.device?.status === "offline"
      ? t("shell.deviceOffline")
      : t("shell.deviceUnknown");

  return (
    <header className="app-titlebar flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-background/80 px-3 backdrop-blur sm:gap-4 sm:px-6">
      <div className="hidden min-w-0 sm:block">
        <h1 className="truncate text-sm font-semibold">{current ? t(current.labelKey) : t("sections.dashboard.label")}</h1>
        <p className="truncate text-xs text-muted-foreground">{current ? t(current.blurbKey) : null}</p>
      </div>
      <div className="flex items-center gap-3">
        <MobileSectionSwitcher />
        <ProjectSwitcher />
        {state?.device ? (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {state.device.name} · {deviceStatus}
          </span>
        ) : null}
        <StatusBadge tone={connection.tone}>{connection.label}</StatusBadge>
        {!isLoading && !isError ? (
          <span title={liveUpdates ? "Server events update this view in real time." : "Live events are unavailable; periodic polling remains active."}>
            <StatusBadge tone={liveUpdates ? "success" : "warning"}>
              {liveUpdates ? "Live" : "Polling fallback"}
            </StatusBadge>
          </span>
        ) : null}
        <LanguagePicker />
        <SkinPicker />
        <LoginControl />
        {wcoVisible ? <div className="app-wco-spacer" aria-hidden="true" /> : null}
      </div>
    </header>
  );
}
