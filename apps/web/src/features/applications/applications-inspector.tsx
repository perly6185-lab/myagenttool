import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clipboard, ExternalLink, Play } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FactList } from "@/components/common/fact-list";
import { ConfirmModal } from "@/components/common/confirm-modal";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
import { sourceSummary } from "@/features/applications/applications-view";
import type { ApplicationOrchestration, ApplicationSnapshot, InvocationSnapshot } from "@/lib/console-state";

// Explicit-intent confirmation token for governed side-effecting actions. It is
// an intent marker (tenancy is the real authz), not a cryptographic approval.
const APPROVAL_TOKEN = "console-operator-confirmed";

function riskTone(risk?: string): "neutral" | "warning" | "danger" {
  if (risk === "high" || risk === "critical") return "danger";
  if (risk === "medium") return "warning";
  return "neutral";
}

interface PendingConfirm {
  title: string;
  description: string;
  confirmLabel: string;
  destructive: boolean;
  run: () => Promise<unknown>;
}

function ApplicationActions({ application }: { application: ApplicationSnapshot }) {
  const { execute, pending, error } = useAsyncAction();
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const status = application.status;

  const lifecycle = (action: "probe" | "online" | "offline" | "archive" | "refresh") =>
    api.applicationLifecycle(application.id, action, { approvalToken: APPROVAL_TOKEN });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lifecycle</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => void execute(() => api.applicationLifecycle(application.id, "probe"))}>
            Probe
          </Button>
          {status !== "active" && status !== "archived" ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => setConfirm({
              title: `Bring "${application.name}" online?`,
              description: "Re-enables the application's execution-like capabilities.",
              confirmLabel: "Bring online",
              destructive: false,
              run: () => lifecycle("online"),
            })}>
              Bring online
            </Button>
          ) : null}
          {status === "active" ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => setConfirm({
              title: `Take "${application.name}" offline?`,
              description: "Disables its execution-like capabilities until brought back online.",
              confirmLabel: "Take offline",
              destructive: true,
              run: () => lifecycle("offline"),
            })}>
              Take offline
            </Button>
          ) : null}
          {status !== "archived" ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => setConfirm({
              title: `Archive "${application.name}"?`,
              description: "Archived applications can no longer be invoked.",
              confirmLabel: "Archive",
              destructive: true,
              run: () => lifecycle("archive"),
            })}>
              Archive
            </Button>
          ) : null}
          {status === "active" ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => setConfirm({
              title: `Refresh "${application.name}"?`,
              description: "Re-records the application source state.",
              confirmLabel: "Refresh",
              destructive: false,
              run: () => lifecycle("refresh"),
            })}>
              Refresh
            </Button>
          ) : null}
          {status !== "archived" && status !== "offline" ? (
            <Button size="sm" disabled={pending} onClick={() => setConfirm({
              title: `Generate orchestration for "${application.name}"?`,
              description: "Writes a governed LoopRoutine draft into the managed application directory.",
              confirmLabel: "Generate",
              destructive: false,
              run: () => api.generateApplicationOrchestration(application.id, { approvalToken: APPROVAL_TOKEN }),
            })}>
              Generate orchestration
            </Button>
          ) : null}
        </div>
        {error && !confirm ? <p className="text-xs text-destructive">{error}</p> : null}
        <ConfirmModal
          open={Boolean(confirm)}
          title={confirm?.title ?? ""}
          description={confirm?.description}
          confirmLabel={confirm?.confirmLabel}
          destructive={confirm?.destructive}
          pending={pending}
          error={error}
          onConfirm={() => {
            if (!confirm) return;
            const run = confirm.run;
            void execute(run).then((ok) => {
              if (ok) setConfirm(null);
            });
          }}
          onClose={() => setConfirm(null)}
        />
      </CardContent>
    </Card>
  );
}

export function latestRoutineInvocation(invocations: InvocationSnapshot[], applicationId: string, routineId: string) {
  return invocations.find((invocation) => {
    const metadata = invocation.options?.metadata;
    return metadata?.source === "application_orchestration"
      && metadata.applicationId === applicationId
      && metadata.routineId === routineId;
  }) ?? null;
}

function OrchestrationDrafts({
  application,
  invocations,
  orchestrations,
}: {
  application: ApplicationSnapshot;
  invocations: InvocationSnapshot[];
  orchestrations: ApplicationOrchestration[];
}) {
  const { execute, pending, error } = useAsyncAction();
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const setSection = useUiStore((s) => s.setSection);
  const [createdInvocationByRoutineKey, setCreatedInvocationByRoutineKey] = useState<Record<string, string>>({});
  const [copiedRoutineId, setCopiedRoutineId] = useState<string | null>(null);
  const [pendingRoutineId, setPendingRoutineId] = useState<string | null>(null);

  function viewInvocation(invocationId: string) {
    setSelectedInvocationId(invocationId);
    setSection("invocations");
  }

  function copyRoutine(orchestration: ApplicationOrchestration) {
    const text = orchestration.relativePath
      ? `${orchestration.routineId} (${orchestration.relativePath})`
      : orchestration.routineId;
    void navigator.clipboard?.writeText(text);
    setCopiedRoutineId(orchestration.routineId);
  }

  async function runOrchestration(orchestration: ApplicationOrchestration) {
    setPendingRoutineId(orchestration.routineId);
    const routineKey = `${application.id}:${orchestration.routineId}`;
    const ok = await execute(async () => {
      const created = await api.runApplicationOrchestration(application.id, orchestration.routineId) as {
        invocationId?: string;
        invocation?: { id?: string };
      };
      const invocationId = created.invocationId ?? created.invocation?.id ?? null;
      if (invocationId) {
        setCreatedInvocationByRoutineKey((current) => ({
          ...current,
          [routineKey]: invocationId,
        }));
      }
      return created;
    });
    if (!ok) {
      setCreatedInvocationByRoutineKey((current) => {
        const next = { ...current };
        delete next[routineKey];
        return next;
      });
    }
    setPendingRoutineId(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Orchestration drafts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {orchestrations.map((orchestration) => {
          const lastInvocation = latestRoutineInvocation(invocations, application.id, orchestration.routineId);
          const invocationId = createdInvocationByRoutineKey[`${application.id}:${orchestration.routineId}`]
            ?? lastInvocation?.id
            ?? null;
          const isPendingRoutine = pending && pendingRoutineId === orchestration.routineId;
          return (
            <div key={orchestration.routineId} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <p className="[overflow-wrap:anywhere] font-mono text-xs">{orchestration.routineId}</p>
                  <p className="[overflow-wrap:anywhere] text-xs text-muted-foreground">
                    {orchestration.relativePath ?? orchestration.path ?? "Draft path not recorded"}
                  </p>
                </div>
                <Badge tone={orchestration.validation?.ok === false ? "danger" : "success"}>
                  {orchestration.validation?.ok === false ? "invalid" : orchestration.status ?? "draft"}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="icon"
                  variant="secondary"
                  title="Copy orchestration reference"
                  aria-label="Copy orchestration reference"
                  onClick={() => copyRoutine(orchestration)}
                >
                  <Clipboard />
                </Button>
                <Button
                  size="sm"
                  disabled={pending || orchestration.validation?.ok === false || application.status !== "active"}
                  onClick={() => void runOrchestration(orchestration)}
                >
                  <Play />
                  {isPendingRoutine ? "Starting..." : "Run"}
                </Button>
                {invocationId ? (
                  <Button size="sm" variant="secondary" onClick={() => viewInvocation(invocationId)}>
                    <ExternalLink />
                    View invocation
                  </Button>
                ) : null}
                {copiedRoutineId === orchestration.routineId ? (
                  <span className="text-xs text-success">Copied.</span>
                ) : null}
                {lastInvocation ? (
                  <span className="text-xs text-muted-foreground">
                    Last run: {lastInvocation.status ?? "unknown"}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {application.status !== "active" ? (
          <p className="text-xs text-muted-foreground">Bring the application online before running a draft.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Right-pane detail for the application selected in the Applications view. */
export function ApplicationsInspector() {
  const { data: state } = useConsoleState();
  const selectedApplicationId = useUiStore((s) => s.selectedApplicationId);
  const application = (state?.applications ?? []).find((app) => app.id === selectedApplicationId);

  const { data: capabilityData } = useQuery({
    queryKey: ["application-capabilities", application?.id],
    queryFn: () => api.listApplicationCapabilities(application!.id),
    enabled: Boolean(application?.id),
    refetchInterval: 2000,
  });

  if (!application) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Application details</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Select an application to see its source, capabilities, probe, and orchestration drafts.
          </p>
        </CardContent>
      </Card>
    );
  }

  const capabilities = capabilityData?.capabilities ?? [];
  const probe = application.probe;
  const orchestrations = application.orchestrations ?? [];
  const invocations = state?.invocations ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{application.name}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {application.id} · {application.kind}
          </p>
        </CardHeader>
        <CardContent>
          <FactList
            facts={[
              { term: "Status", value: application.status },
              { term: "Source", value: `${application.source.type} · ${sourceSummary(application.source)}` },
              { term: "Path", value: application.path ?? "—" },
              { term: "Owner", value: application.ownerTeamId ?? "—" },
            ]}
          />
        </CardContent>
      </Card>

      <ApplicationActions application={application} />

      <Card>
        <CardHeader>
          <CardTitle>Capabilities</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!capabilities.length ? (
            <p className="text-sm text-muted-foreground">No capabilities projected.</p>
          ) : (
            capabilities.map((capability) => (
              <div key={capability.name} className="flex items-center justify-between gap-2 text-sm">
                <span className="[overflow-wrap:anywhere]">
                  {capability.displayName ?? capability.name}
                  {capability.requiresApproval ? <span className="text-warning"> ⚠</span> : null}
                </span>
                <div className="flex shrink-0 gap-1.5">
                  <Badge tone={riskTone(capability.riskLevel)}>{capability.riskLevel ?? "—"}</Badge>
                  <Badge tone={capability.status === "disabled" ? "danger" : "success"}>
                    {capability.status ?? "—"}
                  </Badge>
                </div>
              </div>
            ))
          )}
          <p className="text-xs text-muted-foreground">⚠ requires an explicit approval token</p>
        </CardContent>
      </Card>

      {probe ? (
        <Card>
          <CardHeader>
            <CardTitle>Probe</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {probe.summary ? <p className="text-sm text-muted-foreground">{probe.summary}</p> : null}
            {probe.capabilities?.length ? (
              <div className="flex flex-wrap gap-1.5">
                {probe.capabilities.map((capability) => (
                  <Badge key={capability.name} tone={capability.source === "inferred" ? "warning" : "neutral"}>
                    {capability.name.split(".").at(-1)}
                  </Badge>
                ))}
              </div>
            ) : null}
            {probe.warnings?.length ? (
              <ul className="list-inside list-disc text-xs text-warning">
                {probe.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {orchestrations.length ? (
        <OrchestrationDrafts
          application={application}
          invocations={invocations}
          orchestrations={orchestrations}
        />
      ) : null}
    </div>
  );
}
