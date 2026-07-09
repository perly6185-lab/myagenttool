import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, ClipboardCheck, FileText, ShieldCheck, Wrench } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { EmptyState } from "@/components/common/empty-state";
import { SectionHeading } from "@/components/common/section-heading";
import { cn } from "@/lib/cn";
import { useConsoleState } from "@/data/use-console-state";
import { useUiStore } from "@/store/ui-store";
import type { EvidenceLedgerRow } from "@/lib/console-state";
import type { Tone } from "@/lib/readable-labels";

// The Evidence Center: a per-run TRUST LEDGER. Each row rolls up the evidence for
// one agent run — code-review findings, the audit/permission record, a
// troubleshooting report, and Codex/terminal runtime evidence — from the server
// `evidenceLedger` read-model. Expanding a row composes the full dossier from data
// already in the snapshot (findings/audit/troubleshooting/evidence, joined on the
// invocation id). Answers "can I trust what this run produced?".

function severityTone(severity: string): Tone {
  if (severity === "high") return "danger";
  if (severity === "medium") return "warning";
  return "neutral";
}

function since(iso?: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const secs = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h`;
  return `${Math.round(secs / 86400)}d`;
}

export function EvidenceView() {
  const { data: state } = useConsoleState();
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const ledger = state?.evidenceLedger ?? [];
  const attentionCount = useMemo(() => ledger.filter((r) => r.attention).length, [ledger]);
  const rows = useMemo(() => (filter === "attention" ? ledger.filter((r) => r.attention) : ledger), [ledger, filter]);
  const agentName = (id?: string | null) => state?.agents?.find((a) => a.id === id)?.name ?? id ?? "agent";

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="Trust"
        title="Evidence"
        description="Per-run rollup of the evidence that a change is sound — review findings, the audit record, troubleshooting, and Codex/terminal runtime evidence — joined on the run that produced it."
      />

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Show" className="w-44">
          <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="all">All runs with evidence</option>
            <option value="attention">Needs attention</option>
          </Select>
        </Field>
        <span className="pb-2 text-xs text-muted-foreground">
          {rows.length} run(s){attentionCount > 0 ? ` · ${attentionCount} need attention` : ""}
        </span>
      </div>

      {!rows.length ? (
        <EmptyState
          title={ledger.length ? "No runs need attention" : "No evidence yet"}
          hint={
            ledger.length
              ? "Every run with evidence is clean. Switch to “All runs with evidence” to browse them."
              : "Evidence appears here once runs accumulate review findings, audit records, troubleshooting, or Codex/terminal runtime evidence."
          }
        />
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <LedgerRow
              key={row.invocationId}
              row={row}
              expanded={expandedId === row.invocationId}
              onToggle={() => setExpandedId((id) => (id === row.invocationId ? null : row.invocationId))}
              agentName={agentName}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LedgerRow({
  row,
  expanded,
  onToggle,
  agentName,
}: {
  row: EvidenceLedgerRow;
  expanded: boolean;
  onToggle: () => void;
  agentName: (id?: string | null) => string;
}) {
  const age = since(row.createdAt);
  return (
    <Card className={cn(row.attention && "border-warning/50")}>
      <CardContent className="p-0">
        <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left">
          {expanded ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {row.attention ? <AlertTriangle className="size-3.5 shrink-0 text-warning" /> : null}
              <span className="truncate text-sm font-medium">{row.task || row.invocationId}</span>
              {row.status ? <Badge tone="neutral" className="shrink-0">{row.status}</Badge> : null}
              {age ? <span className="shrink-0 text-xs text-muted-foreground">{age}</span> : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{agentName(row.agentId)}</span>
              <VerdictChips row={row} />
            </div>
            {row.attention && row.attentionReasons.length ? (
              <p className="mt-1 truncate text-xs text-warning">{row.attentionReasons.join(" · ")}</p>
            ) : null}
          </div>
        </button>
        {expanded ? <Dossier invocationId={row.invocationId} /> : null}
      </CardContent>
    </Card>
  );
}

function VerdictChips({ row }: { row: EvidenceLedgerRow }) {
  return (
    <>
      {row.review.total > 0 ? (
        <span className="inline-flex items-center gap-1 text-xs">
          {row.review.high > 0 ? <StatusBadge tone="danger">{row.review.high} high</StatusBadge> : null}
          {row.review.medium > 0 ? <StatusBadge tone="warning">{row.review.medium} med</StatusBadge> : null}
          {row.review.low > 0 ? <StatusBadge tone="neutral">{row.review.low} low</StatusBadge> : null}
        </span>
      ) : null}
      {row.audit?.permissionDecision ? (
        <StatusBadge tone={row.audit.permissionDecision === "denied" ? "danger" : "neutral"}>
          {row.audit.permissionDecision}
        </StatusBadge>
      ) : null}
      {row.troubleshooting.present ? <Badge tone="warning">troubleshooting</Badge> : null}
      {row.runtimeEvidence > 0 ? <Badge tone="neutral">{row.runtimeEvidence} evidence</Badge> : null}
    </>
  );
}

// The expanded dossier composes the full evidence from data already in the
// snapshot, joined on this run's invocation id.
function Dossier({ invocationId }: { invocationId: string }) {
  const { data: state } = useConsoleState();
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const setSection = useUiStore((s) => s.setSection);

  const findings = (state?.reviewFindings ?? []).filter((f) => f.invocationId === invocationId);
  const audit = (state?.auditSummaries ?? []).find((a) => a.invocationId === invocationId) ?? null;
  const troubleshooting = (state?.troubleshootingReports ?? []).find((t) => t.invocationId === invocationId) ?? null;
  const runtime = (state?.evidenceCenterRecords ?? []).filter((e) => e.invocationId === invocationId);
  const canOpen = (state?.invocations ?? []).some((i) => i.id === invocationId);

  return (
    <div className="space-y-3 border-t border-border px-4 py-3">
      <DossierBlock icon={ShieldCheck} title={`Review findings (${findings.length})`} empty={!findings.length}>
        {findings.map((f) => (
          <div key={f.id} className="space-y-1 rounded-md border border-border p-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={severityTone(f.severity)}>{f.severity}</StatusBadge>
              <Badge>{f.source}</Badge>
              <span className="[overflow-wrap:anywhere] font-mono text-xs text-muted-foreground">
                {f.file}{f.line != null ? `:${f.line}` : ""}
              </span>
            </div>
            <p className="text-sm">{f.message}</p>
            {f.suggestion ? <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Suggestion: </span>{f.suggestion}</p> : null}
          </div>
        ))}
      </DossierBlock>

      <DossierBlock icon={ClipboardCheck} title="Audit" empty={!audit}>
        {audit ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {audit.permissionDecision ? <StatusBadge tone={audit.permissionDecision === "denied" ? "danger" : "neutral"}>{audit.permissionDecision}</StatusBadge> : null}
            {audit.costSummary ? <span className="text-muted-foreground">{audit.costSummary}</span> : null}
            {audit.errorSummary ? <span className="text-destructive">{audit.errorSummary}</span> : null}
            {audit.traceId ? <span className="font-mono text-muted-foreground">trace {audit.traceId}</span> : null}
          </div>
        ) : null}
      </DossierBlock>

      <DossierBlock icon={Wrench} title="Troubleshooting" empty={!troubleshooting}>
        {troubleshooting ? (
          <div className="space-y-1">
            <p className="text-sm">{troubleshooting.summary}</p>
            {troubleshooting.suggestedFixes?.length ? (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {troubleshooting.suggestedFixes.map((fix, i) => <li key={i}>{fix}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}
      </DossierBlock>

      <DossierBlock icon={FileText} title={`Runtime evidence (${runtime.length})`} empty={!runtime.length}>
        <ul className="space-y-1">
          {runtime.slice(0, 30).map((e) => (
            <li key={e.id} className="text-xs">
              <span className="font-mono text-muted-foreground">{e.type}</span> · {e.summary}
            </li>
          ))}
          {runtime.length > 30 ? <li className="text-xs text-muted-foreground">… {runtime.length - 30} more</li> : null}
        </ul>
      </DossierBlock>

      {canOpen ? (
        <button
          type="button"
          className="text-xs font-medium text-primary hover:underline"
          onClick={() => { setSelectedInvocationId(invocationId); setSection("invocations"); }}
        >
          Open run →
        </button>
      ) : (
        <span className="text-xs text-muted-foreground">Run not in the current window</span>
      )}
    </div>
  );
}

function DossierBlock({ icon: Icon, title, empty, children }: { icon: typeof ShieldCheck; title: string; empty: boolean; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Icon className="size-3.5" />
        {title}
      </div>
      {empty ? <p className="pl-5 text-xs text-muted-foreground">None.</p> : <div className="space-y-1.5">{children}</div>}
    </div>
  );
}
