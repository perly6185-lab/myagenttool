import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/common/empty-state";
import { useConsoleState } from "@/data/use-console-state";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";
import { readableAudit, readableLifecycleAudit } from "@/lib/readable-labels";
import type { EvidenceCenterRecord } from "@/lib/console-state";

export function AuditView() {
  const { data: state } = useConsoleState();
  const selectedEvidenceId = useUiStore((s) => s.selectedEvidenceId);
  const setSelectedEvidenceId = useUiStore((s) => s.setSelectedEvidenceId);
  const audits = state?.auditSummaries ?? [];
  const lifecycle = state?.lifecycleAuditRecords ?? [];
  const policies = state?.policyDecisionRecords ?? [];
  const evidence = state?.evidenceCenterRecords ?? [];
  const selectedEvidence = evidence.find((record) => record.id === selectedEvidenceId) ?? null;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(22rem,0.9fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Invocation audit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {audits.length === 0 ? (
            <EmptyState title="Nothing recorded yet" hint="Run a task to record an audit summary." />
          ) : (
            audits.slice(0, 20).map((audit, index) => (
              <div
                key={`${audit.invocationId ?? "audit"}-${index}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs">{audit.invocationId ?? audit.agentId}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {audit.costSummary ?? "No cost summary"}
                  </p>
                </div>
                <Badge tone={audit.permissionDecision === "denied" ? "danger" : "success"}>
                  {readableAudit(audit)}
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="space-y-5">
        <Card data-audit-panel="evidence-center">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Evidence Center</CardTitle>
              {selectedEvidence ? <Badge tone="success">selected</Badge> : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedEvidence ? <EvidenceDetail record={selectedEvidence} /> : null}
            {evidence.length === 0 ? (
              <EmptyState title="No evidence yet" hint="Application results, smoke evidence, and managed runtime records land here." />
            ) : (
              <div className="space-y-2">
                {evidence.slice(0, 24).map((record) => {
                  const selected = record.id === selectedEvidenceId;
                  return (
                    <button
                      key={record.id}
                      type="button"
                      className={cn(
                        "w-full rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                        selected && "border-primary bg-primary/10",
                      )}
                      onClick={() => setSelectedEvidenceId(record.id)}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-medium">{record.summary}</span>
                        <Badge tone={evidenceTone(record)}>{evidenceLabel(record)}</Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{record.id}</span>
                        <span>{record.source.replaceAll("_", " ")}</span>
                        {record.createdAt ? <span>{shortTime(record.createdAt)}</span> : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Agent lifecycle</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {lifecycle.length === 0 ? (
              <EmptyState title="No lifecycle actions" hint="Health checks and enable/disable land here." />
            ) : (
              lifecycle.slice(0, 12).map((record, index) => (
                <div
                  key={`${record.agentId ?? "agent"}-${record.operation}-${index}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <span className="truncate text-muted-foreground">{record.agentId}</span>
                  <Badge tone={record.status === "failed" ? "danger" : "success"}>
                    {readableLifecycleAudit(record)}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Policy decisions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {policies.length === 0 ? (
              <EmptyState title="No policy decisions" hint="High-risk tasks record a policy decision." />
            ) : (
              policies.slice(0, 12).map((policy) => (
                <div key={policy.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{policy.decision.replaceAll("_", " ")}</span>
                    {policy.riskTags?.length ? (
                      <span className="text-xs text-muted-foreground">{policy.riskTags.join(", ")}</span>
                    ) : null}
                  </div>
                  {policy.reason ? (
                    <p className="text-xs text-muted-foreground">{policy.reason}</p>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function EvidenceDetail({ record }: { record: EvidenceCenterRecord }) {
  return (
    <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={evidenceTone(record)}>{evidenceLabel(record)}</Badge>
        <span className="font-mono text-xs text-muted-foreground">{record.id}</span>
      </div>
      <p className="[overflow-wrap:anywhere] font-medium">{record.summary}</p>
      {record.detail ? <p className="[overflow-wrap:anywhere] text-xs text-muted-foreground">{record.detail}</p> : null}
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        {record.repoPath ? <span>{record.repoPath}</span> : null}
        {record.invocationId ? <span>invocation {record.invocationId}</span> : null}
        {record.createdAt ? <span>{shortTime(record.createdAt)}</span> : null}
      </div>
    </div>
  );
}

function evidenceLabel(record: EvidenceCenterRecord) {
  if (record.source === "application_smoke_evidence") return "Application smoke";
  if (record.source === "application_render_result") return "Render result";
  if (record.source === "application_result_artifact") return "Result artifact";
  if (record.source === "imported_ccusage_report") return "Usage estimate";
  if (record.source === "managed_terminal_runtime") return "Terminal";
  return record.type.replaceAll("_", " ");
}

function evidenceTone(record: EvidenceCenterRecord): "neutral" | "success" | "warning" | "danger" | "running" {
  if (record.source === "application_smoke_evidence") return "success";
  if (record.source.startsWith("application_")) return "success";
  if (record.type.includes("warning")) return "warning";
  if (record.type.includes("approval")) return "warning";
  return record.marker === "imported" ? "neutral" : "success";
}

function shortTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
