import { NavRail } from "@/components/layout/nav-rail";
import { Topbar } from "@/components/layout/topbar";
import { Inspector } from "@/components/layout/inspector";
import { CommandPalette } from "@/components/layout/command-palette";
import { ErrorBoundary } from "@/components/common/error-boundary";
import { SECTION_VIEWS } from "@/app/routes";
import { useUrlNavigationSync } from "@/app/url-navigation-sync";
import { useSkinSync } from "@/app/use-skin-sync";
import { useUiStore } from "@/store/ui-store";

/**
 * Three-pane control-plane shell: nav rail (domains) · main outlet (active
 * screen) · inspector (selection context). The main column scrolls; the rails
 * stay fixed.
 */
export function App() {
  useUrlNavigationSync();
  useSkinSync();
  const section = useUiStore((s) => s.section);
  const View = SECTION_VIEWS[section];

  return (
    <div className="flex h-full overflow-hidden">
      <CommandPalette />
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-y-auto px-3 py-3 sm:px-6 sm:py-6">
            <ErrorBoundary resetKey={section}>
              <View />
            </ErrorBoundary>
          </main>
          <ErrorBoundary resetKey={section}>
            <Inspector />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}
