import { NavRail } from "@/components/layout/nav-rail";
import { Topbar } from "@/components/layout/topbar";
import { Inspector } from "@/components/layout/inspector";
import { CommandPalette } from "@/components/layout/command-palette";
import { ErrorBoundary } from "@/components/common/error-boundary";
import { lazy, Suspense } from "react";
import { SECTION_VIEWS } from "@/app/routes";
import { pageRegistration } from "@/app/sections";
import { useUrlNavigationSync } from "@/app/url-navigation-sync";
import { useSkinSync } from "@/app/use-skin-sync";
import { useLocaleSync } from "@/app/use-locale-sync";
import { useUiStore, type TaskArea } from "@/store/ui-store";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { useControlPlaneEvents } from "@/app/use-control-plane-events";
import { ContextNavigation } from "@/components/layout/context-navigation";
import { MobileBottomNavigation } from "@/components/layout/mobile-bottom-navigation";
import { canDiscoverProfessionalPage } from "@/app/page-access";
import { useSessionUser } from "@/hooks/use-session-user";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { Button } from "@/components/ui/button";

const WorkItemDetailShell = lazy(() => import("@/features/tasks/work-item-detail-shell"));
const MySettingsDialog = lazy(() => import("@/features/settings/my-settings-dialog").then((module) => ({
  default: module.MySettingsDialog,
})));

const TASK_AREA_VIEWS: Record<TaskArea, keyof typeof SECTION_VIEWS> = {
  overview: "task",
  process: "workBoard",
  assets: "documents",
  verification: "review",
  trace: "invocations",
};

/**
 * Three-pane control-plane shell: nav rail (domains) · main outlet (active
 * screen) · inspector (selection context). The main column scrolls; the rails
 * stay fixed.
 */
export function App() {
  const { t, i18n } = useAppTranslation();
  useUrlNavigationSync();
  useSkinSync();
  useLocaleSync();
  useControlPlaneEvents();
  const section = useUiStore((s) => s.section);
  const returnSection = useUiStore((s) => s.surfaceReturnSection);
  const taskArea = useUiStore((state) => state.taskArea);
  const setTaskArea = useUiStore((state) => state.setTaskArea);
  const sessionUser = useSessionUser();
  const navigate = usePageNavigation();
  const settingsDialogOpen = useUiStore((state) => state.settingsDialogOpen)
    || section === "me"
    || section === "settings"
    || pageRegistration(section).surface !== "entry";
  const backgroundSection = settingsDialogOpen
    ? returnSection && returnSection !== "me" && pageRegistration(returnSection).surface === "entry"
      ? returnSection
      : "dashboard"
    : section;
  const pageAllowed = backgroundSection === "settings" || canDiscoverProfessionalPage(backgroundSection, sessionUser?.role);
  const View = SECTION_VIEWS[backgroundSection === "task" ? TASK_AREA_VIEWS[taskArea] : backgroundSection];

  return (
    <div className="flex h-full overflow-hidden">
      <CommandPalette />
      {settingsDialogOpen ? (
        <Suspense fallback={null}>
          <MySettingsDialog />
        </Suspense>
      ) : null}
      {/* Outside the task center, keep the selected task open on ordinary Entry
          surfaces. During a contextual setup/Trace visit, unmount the modal so
          the destination and return control remain usable; the selection stays
          in the store and is restored when the operator returns to Tasks. */}
      {!settingsDialogOpen && pageRegistration(backgroundSection).surface === "entry" && backgroundSection !== "task" && !returnSection ? (
        <Suspense fallback={null}>
          <WorkItemDetailShell />
        </Suspense>
      ) : null}
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <ContextNavigation taskArea={taskArea} onTaskAreaChange={setTaskArea} />
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-y-auto px-3 py-3 sm:px-6 sm:py-6">
            <ErrorBoundary resetKey={View} onRetry={() => location.reload()}>
              <Suspense fallback={<div role="status" className="py-8 text-center text-sm text-muted-foreground">{t("tasks.loading")}</div>}>
                {pageAllowed ? <View /> : (
                  <div className="mx-auto max-w-xl rounded-xl border bg-card p-6 text-center">
                    <h2 className="text-base font-semibold">{i18n.language.startsWith("zh") ? "当前角色无法打开此能力" : "This capability is unavailable for your role"}</h2>
                    <p className="mt-2 text-sm text-muted-foreground">{i18n.language.startsWith("zh") ? "可用能力由服务端角色决定。返回我的设置查看当前账号可以使用的项目。" : "Available capabilities follow the server-verified role. Return to My settings to see what this account can use."}</p>
                    <Button className="mt-4" variant="secondary" onClick={() => navigate("settings")}>{t("me.settings")}</Button>
                  </div>
                )}
              </Suspense>
            </ErrorBoundary>
          </main>
          <ErrorBoundary resetKey={backgroundSection}>
            <Inspector />
          </ErrorBoundary>
        </div>
        <MobileBottomNavigation />
      </div>
    </div>
  );
}
