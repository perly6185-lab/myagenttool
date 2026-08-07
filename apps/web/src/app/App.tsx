import { NavRail } from "@/components/layout/nav-rail";
import { Topbar } from "@/components/layout/topbar";
import { Inspector } from "@/components/layout/inspector";
import { CommandPalette } from "@/components/layout/command-palette";
import { ErrorBoundary } from "@/components/common/error-boundary";
import { lazy, Suspense, useState } from "react";
import { SECTION_VIEWS } from "@/app/routes";
import { pageRegistration } from "@/app/sections";
import { useUrlNavigationSync } from "@/app/url-navigation-sync";
import { useSkinSync } from "@/app/use-skin-sync";
import { useLocaleSync } from "@/app/use-locale-sync";
import { type SectionKey, useUiStore } from "@/store/ui-store";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { useControlPlaneEvents } from "@/app/use-control-plane-events";
import { ContextNavigation } from "@/components/layout/context-navigation";
import { MobileBottomNavigation } from "@/components/layout/mobile-bottom-navigation";

const WorkItemDetailShell = lazy(() => import("@/features/tasks/work-item-detail-shell"));

/**
 * Three-pane control-plane shell: nav rail (domains) · main outlet (active
 * screen) · inspector (selection context). The main column scrolls; the rails
 * stay fixed.
 */
export function App() {
  const { t } = useAppTranslation();
  useUrlNavigationSync();
  useSkinSync();
  useLocaleSync();
  useControlPlaneEvents();
  const section = useUiStore((s) => s.section);
  const [taskViewSection, setTaskViewSection] = useState<SectionKey>("task");
  const View = SECTION_VIEWS[section === "task" ? taskViewSection : section];

  return (
    <div className="flex h-full overflow-hidden">
      <CommandPalette />
      {/* Keep the selected Local Issue open on ordinary entry surfaces. When
          navigating into Trace/Settings, unmount the modal so the contextual
          return control remains clickable; the selection stays in the store
          and is restored when the operator returns to Tasks. */}
      {pageRegistration(section).surface === "entry" && section !== "task" ? (
        <Suspense fallback={null}>
          <WorkItemDetailShell />
        </Suspense>
      ) : null}
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <ContextNavigation taskViewSection={taskViewSection} onTaskViewSectionChange={setTaskViewSection} />
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-y-auto px-3 py-3 sm:px-6 sm:py-6">
            <ErrorBoundary resetKey={View} onRetry={() => location.reload()}>
              <Suspense fallback={<div role="status" className="py-8 text-center text-sm text-muted-foreground">{t("tasks.loading")}</div>}>
                <View />
              </Suspense>
            </ErrorBoundary>
          </main>
          <ErrorBoundary resetKey={section}>
            <Inspector />
          </ErrorBoundary>
        </div>
        <MobileBottomNavigation />
      </div>
    </div>
  );
}
