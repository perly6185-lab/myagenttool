import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, AppWindow, Ban, ChevronDown, ChevronRight, ClipboardCheck, Clock, FileText, Gavel, LifeBuoy, ShieldCheck, Wrench } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { EmptyState } from "@/components/common/empty-state";
import { SectionHeading } from "@/components/common/section-heading";
import { cn } from "@/lib/cn";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { useConsoleState } from "@/data/use-console-state";
import { api } from "@/lib/api-client";
import { useUiStore } from "@/store/ui-store";
import { RunTranscriptSection, isTerminalRunStatus } from "@/features/invocations/run-transcript";
import type { EvidenceLedgerRow, RefusalRow } from "@/lib/console-state";
import type { Tone } from "@/lib/readable-labels";
import {
  groupRefusals,
  readableAppealTo,
  readableRefusalCategory,
  readableRefusalCode,
  summarizeRefusals,
  type RefusalCategoryGroup,
  type RefusalSummary,
} from "@/lib/refusals";
import {
  readableRecoveryActionRequestStatus,
  readableRecoveryActionType,
  recoveryActionRequestTone,
} from "@/features/recovery/application-recovery-ui";

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
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const [lens, setLens] = useState<"evidence" | "refusals">("evidence");
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const ledger = state?.evidenceLedger ?? [];
  const refusals = state?.refusals ?? [];
  const attentionCount = useMemo(() => ledger.filter((r) => r.attention).length, [ledger]);
  const rows = useMemo(() => (filter === "attention" ? ledger.filter((r) => r.attention) : ledger), [ledger, filter]);
  const agentName = (id?: string | null) => state?.agents?.find((a) => a.id === id)?.name ?? id ?? t("evidenceDetails.agent");

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow={t("evidence.trust")}
        title={t("evidence.title")}
        description={t("evidence.description")}
      />

      {/* Two lenses over the same trust surface: the per-run evidence ledger, and
          the device's veto. A refusal is a normal reply, not a failure. */}
      <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-sm">
        <button
          type="button"
          onClick={() => setLens("evidence")}
          className={cn("rounded-md px-3 py-1.5 font-medium transition", lens === "evidence" ? "bg-background shadow-sm" : "text-muted-foreground")}
        >
          {t("evidence.ledger")}
        </button>
        <button
          type="button"
          onClick={() => setLens("refusals")}
          className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition", lens === "refusals" ? "bg-background shadow-sm" : "text-muted-foreground")}
        >
          <Ban className="size-3.5" /> {t("evidence.refusals")}{refusals.length ? ` · ${refusals.length}` : ""}
        </button>
      </div>

      {lens === "refusals" ? (
        <RefusalsLens refusals={refusals} />
      ) : (
      <>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("evidence.show")} className="w-44">
          <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="all">{t("evidence.all")}</option>
            <option value="attention">{t("evidence.attention")}</option>
          </Select>
        </Field>
        <span className="pb-2 text-xs text-muted-foreground">
          {t("evidence.runCount", { count: rows.length })}{attentionCount > 0 ? ` · ${t("evidence.attentionCount", { count: attentionCount })}` : ""}
        </span>
      </div>

      {!rows.length ? (
        <EmptyState
          title={t(ledger.length ? "evidence.noAttention" : "evidence.empty")}
          hint={
            ledger.length
              ? t("evidence.cleanHint")
              : t("evidence.emptyHint")
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
      </>
      )}
    </div>
  );
}

// The refusal lens: what did this device refuse, and why? Grouped by category and
// code. A refusal is a NORMAL reply — rendered calm, never red, never as an
// incident. Every refusal shows a remedy (a refusal with no next action is a dead
// end, and dead ends are what push operators to disable the guardrail).
function RefusalsLens({ refusals }: { refusals: RefusalRow[] }) {
  const { t } = useAppTranslation();
  // Loop promotion refusals live in tools/ai (not server state), so fetch them
  // lazily when this lens opens and merge — one lens over both sources (refusal
  // model #758). Best-effort: a fetch failure just shows the server refusals.
  const [loopRefusals, setLoopRefusals] = useState<RefusalRow[]>([]);
  const [loopTruncated, setLoopTruncated] = useState(false);
  useEffect(() => {
    let alive = true;
    api.getLoopRefusals()
      .then((res) => { if (alive) { setLoopRefusals(res.refusals ?? []); setLoopTruncated(Boolean(res.truncatedRuns)); } })
      .catch(() => { if (alive) setLoopRefusals([]); });
    return () => { alive = false; };
  }, []);

  const merged = useMemo(() => [...refusals, ...loopRefusals], [refusals, loopRefusals]);
  const groups = useMemo(() => groupRefusals(merged), [merged]);
  const summary = useMemo(() => summarizeRefusals(merged), [merged]);
  if (!groups.length) {
    return (
      <EmptyState
        title={t("evidence.nothingRefused")}
        hint={t("evidence.refusalEmptyHint")}
      />
    );
  }
  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        <span>
          {t("evidence.refusalHint")}
        </span>
      </p>
      <RefusalSummaryStrip summary={summary} />
      {loopTruncated ? (
        <p className="text-xs text-muted-foreground/70">{t("evidence.truncated")}</p>
      ) : null}
      {groups.map((group) => (
        <RefusalCategorySection key={group.category} group={group} />
      ))}
    </div>
  );
}

// At-a-glance analytics over the (recent, capped) refusal set: how much this
// device is refusing, the dominant reasons, and a short daily trend. Calm — this
// is audit context, not an incident dashboard.
function RefusalSummaryStrip({ summary }: { summary: RefusalSummary }) {
  const { t } = useAppTranslation();
  if (!summary.total) return null;
  const categories = (["not_granted", "policy", "state", "human"] as const).filter((c) => summary.byCategory[c] > 0);
  const maxDay = Math.max(1, ...summary.daily.map((d) => d.count));
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border border-border bg-card px-4 py-3">
      <div>
        <div className="text-2xl font-semibold tabular-nums">{summary.total}</div>
        <div className="text-xs text-muted-foreground">{t("evidence.recentRefusals")}</div>
      </div>
      {categories.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {categories.map((c) => (
            <Badge key={c} tone="neutral">{readableRefusalCategory(c)} {summary.byCategory[c]}</Badge>
          ))}
        </div>
      ) : null}
      {summary.topCodes.length ? (
        <div className="min-w-0 text-xs text-muted-foreground">
          <span className="text-muted-foreground/70">{t("evidence.topReasons")}: </span>
          {summary.topCodes.map((t, i) => (
            <span key={t.code}>{i ? " · " : ""}{t.label} <span className="tabular-nums">({t.count})</span></span>
          ))}
        </div>
      ) : null}
      <div className="ml-auto flex items-end gap-0.5" title={t("evidence.refusalTrend")} aria-label={t("evidence.refusalTrend")}>
        {summary.daily.map((d) => (
          <span
            key={d.date}
            className="w-2 rounded-sm bg-muted-foreground/30"
            style={{ height: `${4 + Math.round((d.count / maxDay) * 20)}px` }}
            title={`${d.date}: ${d.count}`}
          />
        ))}
      </div>
    </div>
  );
}

function RefusalCategorySection({ group }: { group: RefusalCategoryGroup }) {
  const { t } = useAppTranslation();
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold">{group.label}</h3>
        <span className="text-xs text-muted-foreground">{group.count}</span>
      </div>
      <p className="text-xs text-muted-foreground">{group.hint}</p>
      <div className="space-y-2">
        {group.codes.map((codeGroup) => (
          <Card key={codeGroup.code}>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center gap-2">
                <Badge tone="neutral">
                  <Ban className="size-3" /> {codeGroup.label}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {t("evidenceDetails.refusalCount", { count: codeGroup.refusals.length })}
                </span>
              </div>
              <div className="space-y-2">
                {codeGroup.refusals.map((refusal) => (
                  <RefusalItem key={refusal.id} refusal={refusal} />
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function RefusalItem({ refusal }: { refusal: RefusalRow }) {
  const { t } = useAppTranslation();
  const [showEvidence, setShowEvidence] = useState(false);
  const appeal = readableAppealTo(refusal.appealTo);
  const age = since(refusal.at);
  const hasEvidence = refusal.evidence && Object.keys(refusal.evidence).length > 0;
  return (
    <div className="rounded-md border border-border/70 bg-background/60 px-3 py-2.5 text-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 font-medium">{refusal.summary || readableRefusalCode(refusal.code)}</p>
        <div className="flex shrink-0 items-center gap-2">
          {refusal.source === "loop" ? <Badge tone="neutral">{t("evidenceDetails.agentLoop")}</Badge> : null}
          {age ? <span className="text-xs text-muted-foreground">{age}</span> : null}
        </div>
      </div>
      {refusal.remedy ? (
        <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Wrench className="mt-0.5 size-3 shrink-0" />
          <span>{refusal.remedy}</span>
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {refusal.decidedBy?.kind ? (
          <span className="inline-flex items-center gap-1">
            <Gavel className="size-3" /> {refusal.decidedBy.kind.replace(/_/g, " ")}
          </span>
        ) : null}
        {refusal.retryAfter ? (
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" /> {t("evidenceDetails.retryAfter", { time: refusal.retryAfter })}
          </span>
        ) : (
          <span className="text-muted-foreground/70">{t("evidenceDetails.retryNoHelp")}</span>
        )}
        {appeal ? <span>{t("evidenceDetails.appealTo", { target: appeal })}</span> : <span className="text-muted-foreground/70">{t("evidenceDetails.noAppeal")}</span>}
      </div>
      {hasEvidence ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowEvidence((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {showEvidence ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />} {t("evidenceDetails.evidence")}
          </button>
          {showEvidence ? (
            <pre className="mt-1 max-h-56 overflow-auto rounded bg-muted/50 p-2 text-[11px] leading-relaxed">
              {JSON.stringify(refusal.evidence, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
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
  const { t } = useAppTranslation();
  return (
    <>
      {row.review.total > 0 ? (
        <span className="inline-flex items-center gap-1 text-xs">
          {row.review.high > 0 ? <StatusBadge tone="danger">{t("evidenceDetails.highCount", { count: row.review.high })}</StatusBadge> : null}
          {row.review.medium > 0 ? <StatusBadge tone="warning">{t("evidenceDetails.mediumCount", { count: row.review.medium })}</StatusBadge> : null}
          {row.review.low > 0 ? <StatusBadge tone="neutral">{t("evidenceDetails.lowCount", { count: row.review.low })}</StatusBadge> : null}
        </span>
      ) : null}
      {row.audit?.permissionDecision ? (
        <StatusBadge tone={row.audit.permissionDecision === "denied" ? "danger" : "neutral"}>
          {row.audit.permissionDecision}
        </StatusBadge>
      ) : null}
      {row.troubleshooting.present ? <Badge tone="warning">{t("evidenceDetails.troubleshooting")}</Badge> : null}
      {row.runtimeEvidence > 0 ? <Badge tone="neutral">{t("evidenceDetails.evidenceCount", { count: row.runtimeEvidence })}</Badge> : null}
      {row.application?.name || row.application?.id ? (
        <Badge tone="neutral" className="inline-flex items-center gap-1">
          <AppWindow className="size-3" />
          {row.application.name ?? row.application.id}
        </Badge>
      ) : null}
      {row.recovery?.latestStatus ? (
        <StatusBadge tone={recoveryActionRequestTone(row.recovery.latestStatus)}>
          {t("evidenceDetails.recoveryStatus", { status: readableRecoveryActionRequestStatus(row.recovery.latestStatus).toLowerCase() })}
        </StatusBadge>
      ) : null}
      {row.recoveryResultOf ? <Badge tone="success">{t("evidenceDetails.recoveryResult")}</Badge> : null}
    </>
  );
}

// The expanded dossier composes the full evidence from data already in the
// snapshot, joined on this run's invocation id.
function Dossier({ invocationId }: { invocationId: string }) {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const setSection = useUiStore((s) => s.setSection);

  const findings = (state?.reviewFindings ?? []).filter((f) => f.invocationId === invocationId);
  const audit = (state?.auditSummaries ?? []).find((a) => a.invocationId === invocationId) ?? null;
  const troubleshooting = (state?.troubleshootingReports ?? []).find((t) => t.invocationId === invocationId) ?? null;
  const runtime = (state?.evidenceCenterRecords ?? []).filter((e) => e.invocationId === invocationId);
  const recoveryRequests = (state?.applicationRecoveryActions ?? []).filter((r) => r.invocationId === invocationId);
  const recoveryProvenance = (state?.applicationRecoveryActions ?? []).find((r) => r.resultInvocationId === invocationId) ?? null;
  const canOpen = (state?.invocations ?? []).some((i) => i.id === invocationId);

  return (
    <div className="space-y-3 border-t border-border px-4 py-3">
      <DossierBlock icon={ShieldCheck} title={t("evidence.reviewFindings", { count: findings.length })} empty={!findings.length}>
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
            {f.suggestion ? <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{t("evidence.suggestion")}: </span>{f.suggestion}</p> : null}
          </div>
        ))}
      </DossierBlock>

      <DossierBlock icon={ClipboardCheck} title={t("evidence.audit")} empty={!audit}>
        {audit ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {audit.permissionDecision ? <StatusBadge tone={audit.permissionDecision === "denied" ? "danger" : "neutral"}>{audit.permissionDecision}</StatusBadge> : null}
            {audit.costSummary ? <span className="text-muted-foreground">{audit.costSummary}</span> : null}
            {audit.errorSummary ? <span className="text-destructive">{audit.errorSummary}</span> : null}
            {audit.traceId ? <span className="font-mono text-muted-foreground">trace {audit.traceId}</span> : null}
          </div>
        ) : null}
      </DossierBlock>

      {/* #1086: the trust question is "what did the agent actually do" — answer
          it in place instead of only via "Open run →". */}
      <RunTranscriptSection
        invocationId={invocationId}
        terminal={(() => {
          const inv = (state?.invocations ?? []).find((i) => i.id === invocationId);
          return inv ? isTerminalRunStatus(inv.status) : true;
        })()}
        defaultOpen={false}
      />

      <DossierBlock icon={Wrench} title={t("evidence.troubleshooting")} empty={!troubleshooting}>
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

      <DossierBlock icon={LifeBuoy} title={t("evidence.recovery", { count: recoveryRequests.length })} empty={!recoveryRequests.length && !recoveryProvenance}>
        <div className="space-y-1">
          {recoveryProvenance ? (
            <p className="text-xs text-muted-foreground">
              {t("evidence.producedBy")} <span className="font-medium text-foreground">{readableRecoveryActionType(recoveryProvenance.actionType)}</span> {t("evidence.recoveryFor")}{" "}
              <span className="font-mono">{recoveryProvenance.invocationId}</span>
            </p>
          ) : null}
          {recoveryRequests.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 text-xs">
              <StatusBadge tone={recoveryActionRequestTone(r.status)}>{readableRecoveryActionRequestStatus(r.status)}</StatusBadge>
              <span className="font-medium">{readableRecoveryActionType(r.actionType)}</span>
              {r.reason ? <span className="text-muted-foreground">{r.reason}</span> : null}
              {r.resultInvocationId ? <span className="font-mono text-muted-foreground">→ {r.resultInvocationId}</span> : null}
            </div>
          ))}
        </div>
      </DossierBlock>

      <DossierBlock icon={FileText} title={t("evidence.runtime", { count: runtime.length })} empty={!runtime.length}>
        <ul className="space-y-1">
          {runtime.slice(0, 30).map((e) => (
            <li key={e.id} className="text-xs">
              <span className="font-mono text-muted-foreground">{e.type}</span> · {e.summary}
            </li>
          ))}
          {runtime.length > 30 ? <li className="text-xs text-muted-foreground">{t("evidence.more", { count: runtime.length - 30 })}</li> : null}
        </ul>
      </DossierBlock>

      {canOpen ? (
        <button
          type="button"
          className="text-xs font-medium text-primary hover:underline"
          onClick={() => { setSelectedInvocationId(invocationId); setSection("invocations"); }}
        >
          {t("evidence.openRun")} →
        </button>
      ) : (
        <span className="text-xs text-muted-foreground">{t("evidence.notCurrent")}</span>
      )}
    </div>
  );
}

function DossierBlock({ icon: Icon, title, empty, children }: { icon: typeof ShieldCheck; title: string; empty: boolean; children: ReactNode }) {
  const { t } = useAppTranslation();
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Icon className="size-3.5" />
        {title}
      </div>
      {empty ? <p className="pl-5 text-xs text-muted-foreground">{t("evidence.none")}</p> : <div className="space-y-1.5">{children}</div>}
    </div>
  );
}
