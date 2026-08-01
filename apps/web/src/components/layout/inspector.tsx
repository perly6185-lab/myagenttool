import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeviceInspector } from "@/features/devices/device-inspector";
import { GovernanceInspector } from "@/features/integrations/governance-inspector";
import { RunContextInspector } from "@/features/invocations/run-context-inspector";
import { SessionHistory } from "@/features/invocations/session-history";
import { ToolsInspector } from "@/features/tools/tools-inspector";
import { ApplicationsInspector } from "@/features/applications/applications-inspector";
import { useUiStore, type SectionKey } from "@/store/ui-store";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

function HintCard({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}

// The context each section shows in the right rail, or null when it has none.
// Sections that return null get no rail at all, so the main column fills the
// freed width instead of leaving an empty bordered gap.
export function inspectorContent(section: SectionKey, t: ReturnType<typeof useAppTranslation>["t"]): ReactNode {
  switch (section) {
    case "dashboard":
      return null;
    case "invocations":
      return (
        <div className="space-y-4">
          <SessionHistory />
          <RunContextInspector />
        </div>
      );
    case "agents":
      return <DeviceInspector />;
    case "devices":
      return (
        <HintCard
          title={t("inspector.bridgeTitle")}
          body={t("inspector.bridgeBody")}
        />
      );
    case "discovery":
      return (
        <div className="space-y-4">
          <DeviceInspector />
          <HintCard
            title={t("inspector.discoveryTitle")}
            body={t("inspector.discoveryBody")}
          />
        </div>
      );
    case "integrations":
      return <GovernanceInspector />;
    case "tools":
      return <ToolsInspector />;
    case "applications":
      return <ApplicationsInspector />;
    case "review":
      return (
        <div className="space-y-4">
          <HintCard
            title={t("inspector.reviewTitle")}
            body={t("inspector.reviewBody")}
          />
          <RunContextInspector />
        </div>
      );
    case "economics":
      return (
        <div className="space-y-4">
          <HintCard
            title={t("inspector.economicsTitle")}
            body={t("inspector.economicsBody")}
          />
          <GovernanceInspector />
        </div>
      );
    case "audit":
      return (
        <div className="space-y-4">
          <GovernanceInspector />
          <DeviceInspector />
        </div>
      );
    default:
      return null;
  }
}

/** Right-hand context panel — content follows the active section + selection. */
export function Inspector() {
  const { t } = useAppTranslation();
  const section = useUiStore((s) => s.section);
  const content = inspectorContent(section, t);
  // No context for this section (e.g. Projects, Tasks) → render no rail so the
  // main column expands to fill the width instead of leaving an empty gap.
  if (!content) return null;

  return (
    <aside
      aria-label={t("inspector.label")}
      className="hidden h-full w-80 shrink-0 overflow-y-auto border-l border-border bg-background px-4 py-5 xl:block"
    >
      {content}
    </aside>
  );
}
