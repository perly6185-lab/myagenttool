import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeviceInspector } from "@/features/devices/device-inspector";
import { GovernanceInspector } from "@/features/integrations/governance-inspector";
import { RunContextInspector } from "@/features/invocations/run-context-inspector";
import { SessionHistory } from "@/features/invocations/session-history";
import { ToolsInspector } from "@/features/tools/tools-inspector";
import { ApplicationsInspector } from "@/features/applications/applications-inspector";
import { useUiStore, type SectionKey } from "@/store/ui-store";

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
function inspectorContent(section: SectionKey): ReactNode {
  switch (section) {
    case "dashboard":
      return (
        <div className="space-y-4">
          <SessionHistory />
          <DeviceInspector />
          <RunContextInspector />
        </div>
      );
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
          title="Local Agent Bridge"
          body="The cloud can request local work, but the bridge owns final execution. Start Desktop Bridge to bring this device online."
        />
      );
    case "discovery":
      return (
        <div className="space-y-4">
          <DeviceInspector />
          <HintCard
            title="Conservative by design"
            body="Discovery only checks known or user-provided sources, never auto-enables, and keeps every candidate disabled until you register it."
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
            title="Findings, not raw output"
            body="Review findings are the structured, non-authoritative output of governed Codex and Claude diff reviews. Raw model transcripts and CLI output are kept server-side and never shown here."
          />
          <RunContextInspector />
        </div>
      );
    case "economics":
      return (
        <div className="space-y-4">
          <HintCard
            title="One economic ledger"
            body="Agent cost, AI usage, chargeback, and settlement roll up through a single ledger. Claude reports real spend; unmetered runs stay visible, never hidden."
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
  const section = useUiStore((s) => s.section);
  const content = inspectorContent(section);
  // No context for this section (e.g. Projects, Tasks) → render no rail so the
  // main column expands to fill the width instead of leaving an empty gap.
  if (!content) return null;

  return (
    <aside
      aria-label="Context inspector"
      className="hidden h-full w-80 shrink-0 overflow-y-auto border-l border-border bg-background px-4 py-5 xl:block"
    >
      {content}
    </aside>
  );
}
