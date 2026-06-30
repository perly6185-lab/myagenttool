import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeviceInspector } from "@/features/devices/device-inspector";
import { GovernanceInspector } from "@/features/integrations/governance-inspector";
import { RunContextInspector } from "@/features/invocations/run-context-inspector";
import { useUiStore } from "@/store/ui-store";

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

/** Right-hand context panel — content follows the active section + selection. */
export function Inspector() {
  const section = useUiStore((s) => s.section);

  return (
    <aside
      aria-label="Context inspector"
      className="hidden h-full w-80 shrink-0 overflow-y-auto border-l border-border bg-background px-4 py-5 xl:block"
    >
      {section === "dashboard" ? (
        <div className="space-y-4">
          <DeviceInspector />
          <RunContextInspector />
        </div>
      ) : null}
      {section === "invocations" ? <RunContextInspector /> : null}
      {section === "agents" ? <DeviceInspector /> : null}
      {section === "devices" ? (
        <HintCard
          title="Local Agent Bridge"
          body="The cloud can request local work, but the bridge owns final execution. Start Desktop Bridge to bring this device online."
        />
      ) : null}
      {section === "discovery" ? (
        <div className="space-y-4">
          <DeviceInspector />
          <HintCard
            title="Conservative by design"
            body="Discovery only checks known or user-provided sources, never auto-enables, and keeps every candidate disabled until you register it."
          />
        </div>
      ) : null}
      {section === "integrations" ? <GovernanceInspector /> : null}
      {section === "economics" ? (
        <div className="space-y-4">
          <HintCard
            title="One economic ledger"
            body="Agent cost, AI usage, chargeback, and settlement roll up through a single ledger. Claude reports real spend; unmetered runs stay visible, never hidden."
          />
          <GovernanceInspector />
        </div>
      ) : null}
      {section === "audit" ? (
        <div className="space-y-4">
          <GovernanceInspector />
          <DeviceInspector />
        </div>
      ) : null}
    </aside>
  );
}
