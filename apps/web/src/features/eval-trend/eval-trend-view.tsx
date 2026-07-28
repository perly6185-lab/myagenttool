import { useCallback, useEffect, useState } from "react";
import { Gauge, RefreshCw, TriangleAlert, CircleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { api } from "@/data/use-console-actions";
import { useConsoleState } from "@/data/use-console-state";
import type { DispatchAssignment } from "@/lib/console-state";
import { cn } from "@/lib/cn";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import { WebPerformanceCard } from "./web-performance-card";
import { OperationalHealthCard } from "./operational-health-card";

interface MetricPoint {
  startedAt: string | null;
  passRate: number;
  resolved: number | null;
  total: number | null;
  byKind?: Record<string, { total: number; resolved: number }> | null;
}
interface MetricSummary {
  latest: MetricPoint | null;
  previous: MetricPoint | null;
  delta: number | null;
  series: MetricPoint[];
  realRuns: number;
  floor: number | null;
  floorProvisional: boolean;
  regressed: boolean;
  enoughForLines: boolean;
}
interface EvalTrendSummary {
  total: number;
  subcap: MetricSummary;
  heldout: MetricSummary;
  infraFailures: number;
  lastInfraFailure: { startedAt: string | null; detail: string | null } | null;
  lastRunAt: string | null;
  claude: string | null;
  minRunsForLines: number;
}

const pct = (rate: number | null | undefined) => (rate == null ? "—" : `${Math.round(rate * 100)}%`);

function fmtDate(iso: string | null, locale = "en"): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const ageMs = Date.now() - t;
  const days = Math.floor(ageMs / 86_400_000);
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day");
}

function StatTile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "danger" }) {
  return (
    <div className={cn("rounded-lg border bg-card px-4 py-3", tone === "danger" ? "border-red-500/40" : "border-border")}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-2xl font-semibold tabular-nums", tone === "danger" && "text-red-600 dark:text-red-400")}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function MetricCard({ title, metric, minRuns }: { title: string; metric: MetricSummary; minRuns: number }) {
  const { t, i18n } = useAppTranslation();
  const latest = metric.latest;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span>{title}</span>
          <span className="flex items-center gap-2">
            {metric.regressed ? (
              <Badge tone="danger">
                <TriangleAlert className="mr-1 size-3" /> {t("evalPage.belowFloor")}
              </Badge>
            ) : null}
            <Badge tone={metric.enoughForLines ? "success" : "neutral"}>
              {t("evalPage.runProgress", { count: metric.realRuns, total: minRuns })}
            </Badge>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {latest ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className={cn("text-3xl font-semibold tabular-nums", metric.regressed && "text-red-600 dark:text-red-400")}>{pct(latest.passRate)}</span>
              {latest.resolved != null && latest.total != null ? (
                <span className="text-sm text-muted-foreground tabular-nums">
                  {latest.resolved}/{latest.total}
                </span>
              ) : null}
              {metric.delta != null ? (
                <span className={cn("text-xs", metric.delta < 0 ? "text-red-600 dark:text-red-400" : metric.delta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                  {t("evalFormat.delta", { value: `${metric.delta > 0 ? "+" : metric.delta === 0 ? "±" : ""}${Math.round(metric.delta * 100)}pp` })}
                </span>
              ) : null}
            </div>
            {/* Sparkline-ish: recent pass rates as bars. */}
            <div className="flex items-end gap-1" style={{ height: 40 }}>
              {metric.series.slice(-12).map((p, i) => (
                <div
                  key={`${p.startedAt ?? i}`}
                  title={`${fmtDate(p.startedAt, i18n.language)}: ${pct(p.passRate)}`}
                  className={cn("w-3 rounded-sm", metric.floor != null && p.passRate < metric.floor ? "bg-red-500/60" : "bg-primary/60")}
                  style={{ height: `${Math.max(4, Math.round(p.passRate * 40))}px` }}
                />
              ))}
            </div>
            {latest.byKind ? (
              <div className="flex flex-col gap-0.5 border-t border-border pt-1.5">
                {Object.entries(latest.byKind).map(([kind, k]) => {
                  const kindRate = k.total > 0 ? k.resolved / k.total : 0;
                  const kindMiss = k.total > 0 && k.resolved < k.total;
                  return (
                    <div key={kind} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">{kind}</span>
                      <span className={cn("tabular-nums", kindMiss ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
                        {k.resolved}/{k.total} · {pct(kindRate)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {t("evalPage.floor")} {pct(metric.floor)}
              {metric.floorProvisional ? ` (${t("evalPage.provisional")} — #250 ${t("evalPage.realLineOnce")} ≥` : " (≥"}
              {metric.floorProvisional ? `${minRuns} real runs exist)` : ""}
              {!metric.enoughForLines ? ` · ${t("evalPage.moreBeforeLine", { count: minRuns - metric.realRuns })}` : ""}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("evalPage.noDataPoints")}</p>
        )}
      </CardContent>
    </Card>
  );
}

interface MaturityLevel {
  level: number;
  name: string;
  gate: string;
  anchor?: string | null;
  frontier?: string;
  measured?: string | null;
  verdict: "met" | "unmet" | "indeterminate";
  detail?: string;
}
interface MaturityScorecard {
  levels: MaturityLevel[];
  currentLevel: number;
  nextGap?: { level: number; name: string; verdict: string; gate: string; measured?: string | null; detail?: string; action: string } | null;
  disclaimer: string;
  inputs?: {
    orchestration?: {
      total: number;
      failed: number;
      recoveryHours: { median: number | null; count: number };
      trend?: { at: string; hours: number }[];
      alerting?: boolean;
      thresholdHours?: number;
    } | null;
  };
}

function RecoveryTrendCard({ recovery }: { recovery: NonNullable<MaturityScorecard["inputs"]>["orchestration"] }) {
  if (!recovery || (!recovery.total && !recovery.trend?.length)) return null;
  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="flex items-center justify-between gap-2">
          <span>Recovery time trend</span>
          {recovery.alerting ? <Badge tone="danger">Above {recovery.thresholdHours}h</Badge> : <Badge tone="success">Within target</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Median recovery" value={recovery.recoveryHours.median == null ? "—" : `${recovery.recoveryHours.median}h`} hint={`n=${recovery.recoveryHours.count}`} tone={recovery.alerting ? "danger" : undefined} />
          <StatTile label="Failed runs" value={String(recovery.failed)} hint={`${recovery.total} measured runs`} />
          <StatTile label="Latest recovery" value={recovery.trend?.at(-1) ? `${recovery.trend.at(-1)?.hours}h` : "—"} hint={recovery.trend?.at(-1)?.at ? fmtDate(recovery.trend.at(-1)?.at ?? null) : undefined} />
        </div>
        {recovery.trend?.length ? (
          <div className="mt-3 flex h-16 items-end gap-1" aria-label="Recovery duration trend">
            {recovery.trend.map((point) => (
              <div key={point.at} className={cn("min-w-2 flex-1 rounded-t", point.hours > (recovery.thresholdHours ?? 24) ? "bg-destructive" : "bg-primary/70")}
                style={{ height: `${Math.max(8, Math.min(100, (point.hours / Math.max(...recovery.trend!.map((item) => item.hours), 1)) * 100))}%` }}
                title={`${fmtDate(point.at)} · ${point.hours}h`} />
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

interface DoraReport {
  windowDays?: number;
  mergedPrCount?: number;
  leadTimeHours?: { median?: number; p90?: number; max?: number } | null;
  mergesPerWeek?: number;
  ciChecks?: { greenRate?: number; gateTarget?: number; ciActive?: boolean } | null;
  changeFailures?: { recorded?: boolean; changeFailureRate?: number; recoveryHours?: { median?: number } } | null;
}

// #1174 (R2 of #1170): per-worker / per-(worker×area) dispatch outcomes. Rates
// are null below the sample threshold (verdict "indeterminate"); time-to-PR is
// deliberately absent (cross-server data the dispatcher doesn't hold).
interface DispatchSlice {
  worker: string;
  area?: string;
  assignments: number;
  open: number;
  completed: number;
  reassigned: number;
  settled: number;
  completionRate: number | null;
  reassignmentRate: number | null;
  medianMinutesToSettle: number | null;
  verdict: "measured" | "indeterminate";
  sample: string;
}
interface DispatchShadow {
  shadowAssignments: number;
  disagreements: number;
  agreementRate: number | null;
  settledDisagreements: number;
  baselineReassignRate: number | null;
  verdict: "measured" | "indeterminate";
  sample: string;
  promotionRule: string;
}
interface DispatchEvaluation {
  minSamples: number;
  total: DispatchSlice;
  workers: DispatchSlice[];
  workerAreas: DispatchSlice[];
  shadow: DispatchShadow;
  unmeasured: string[];
}

// DORA Four Keys from the latest github:dora artifact. Deploy frequency is an
// honest merge-to-main proxy (no deploy pipeline); change-fail reads "not recorded"
// until the marker convention is used — surfaced as-is, never faked.
function DoraCard({ dora }: { dora: DoraReport }) {
  const { t } = useAppTranslation();
  const green = dora.ciChecks?.greenRate;
  const cf = dora.changeFailures;
  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-base">{t("evalPage.dora")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label={t("evalPage.leadTime")} value={dora.leadTimeHours?.median != null ? `${dora.leadTimeHours.median}h` : "—"} hint={dora.leadTimeHours?.p90 != null ? `p90 ${dora.leadTimeHours.p90}h` : undefined} />
          <StatTile label={t("evalPage.deployFreq")} value={dora.mergesPerWeek != null ? `${dora.mergesPerWeek}/wk` : "—"} hint={t("evalPage.mergesMain")} />
          <StatTile label={t("evalPage.ciGreen")} value={pct(green ?? null)} hint={`${t("evalPage.target")} ${pct(dora.ciChecks?.gateTarget ?? 0.95)}`} tone={green != null && green < (dora.ciChecks?.gateTarget ?? 0.95) ? "danger" : undefined} />
          <StatTile label={t("evalPage.changeFailure")} value={cf?.recorded ? pct(cf.changeFailureRate ?? null) : t("evalPage.notRecorded")} hint={cf?.recorded ? (cf.recoveryHours?.median != null ? `${t("evalPage.recovery")} ${cf.recoveryHours.median}h` : undefined) : t("evalPage.markerUnused")} />
        </div>
        <p className="text-[11px] text-muted-foreground">
          {t("evalPage.doraHint", { count: dora.mergedPrCount ?? 0, days: dora.windowDays ?? "?" })}
        </p>
      </CardContent>
    </Card>
  );
}

function verdictTone(v: string): "success" | "danger" | "neutral" {
  if (v === "met") return "success";
  if (v === "unmet") return "danger";
  return "neutral";
}

// #1174: dispatch routing outcomes. Rates render only past the sample threshold
// (else "insufficient data"); the panel is explicit that time-to-PR is a
// cross-server signal the dispatcher can't see — honest gap, not a blank.
function DispatchEvaluationCard({ evaluation, assignments = [] }: { evaluation: DispatchEvaluation; assignments?: DispatchAssignment[] }) {
  const { t } = useAppTranslation();
  const rate = (r: number | null) => (r == null ? "—" : pct(r));
  const rows: DispatchSlice[] = [...evaluation.workers, ...evaluation.workerAreas];
  // Most-recent routing decisions with their "why" (the per-decision reasoning
  // the aggregate rates above can't show). Newest first, capped.
  const recent = [...assignments]
    .filter((a) => a.routing)
    .sort((a, b) => String(b.assignedAt ?? "").localeCompare(String(a.assignedAt ?? "")))
    .slice(0, 8);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 py-3">
        <CardTitle className="text-base">{t("evalPage.dispatchRouting")}</CardTitle>
        <Badge tone="neutral">{t("evalPage.assignmentCount", { count: evaluation.total.assignments })}</Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {t("evalPage.dispatchHint", { count: evaluation.minSamples })}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1.5 pr-2 font-medium">{t("evalPage.worker")}</th>
                <th className="py-1.5 pr-2 font-medium">{t("evalPage.area")}</th>
                <th className="py-1.5 pr-2 font-medium text-right">{t("evalPage.assigned")}</th>
                <th className="py-1.5 pr-2 font-medium text-right">{t("evalPage.completed")}</th>
                <th className="py-1.5 pr-2 font-medium text-right">{t("evalPage.reassigned")}</th>
                <th className="py-1.5 pr-2 font-medium text-right">{t("evalPage.medianSettle")}</th>
                <th className="py-1.5 pr-2 font-medium text-right">{t("evalPage.outcome")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => (
                <tr key={`${s.worker}:${s.area ?? "_"}:${i}`} className="border-b border-border/60">
                  <td className="py-1.5 pr-2 font-mono">{s.worker}</td>
                  <td className="py-1.5 pr-2 text-muted-foreground">{s.area ?? "—"}</td>
                  <td className="py-1.5 pr-2 text-right">{s.assignments}</td>
                  <td className="py-1.5 pr-2 text-right">{s.verdict === "measured" ? `${s.completed} (${rate(s.completionRate)})` : s.completed}</td>
                  <td className="py-1.5 pr-2 text-right">{s.verdict === "measured" ? `${s.reassigned} (${rate(s.reassignmentRate)})` : s.reassigned}</td>
                  <td className="py-1.5 pr-2 text-right">{s.medianMinutesToSettle != null ? `${s.medianMinutesToSettle}m` : "—"}</td>
                  <td className="whitespace-nowrap py-1.5 text-right">
                    <Badge tone={s.verdict === "measured" ? "success" : "neutral"}>
                      {s.verdict === "measured" ? t("evalPage.measured") : t("evalPage.insufficientSample", { sample: s.sample })}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {evaluation.shadow.shadowAssignments > 0 ? (
          <div className="rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs">
            <div className="mb-1 font-medium">{t("evalPage.shadowEvaluation")}</div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <StatTile label={t("evalPage.shadowIssues")} value={String(evaluation.shadow.shadowAssignments)} hint={t("evalPage.diverged", { count: evaluation.shadow.disagreements })} />
              <StatTile label={t("evalPage.agreement")} value={evaluation.shadow.agreementRate != null ? pct(evaluation.shadow.agreementRate) : t("evalPage.insufficientN", { count: evaluation.shadow.shadowAssignments })} hint={t("evalPage.baselineScored")} />
              <StatTile label={t("evalPage.settledDiverged")} value={String(evaluation.shadow.settledDisagreements)} hint={`${t("evalPage.target")} ≥ ${evaluation.minSamples}`} />
              {/* #1184: a high reassign rate is evidence TOWARD promoting scored,
                  not a regression — no danger tone; the promotion rule carries
                  the recommendation (and the TTL-churn caveat). */}
              <StatTile
                label={t("evalPage.baselineReassigned")}
                value={evaluation.shadow.verdict === "measured" && evaluation.shadow.baselineReassignRate != null ? pct(evaluation.shadow.baselineReassignRate) : `insufficient (${evaluation.shadow.sample})`}
                hint={t("evalPage.baselineHint")}
              />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{evaluation.shadow.promotionRule}</p>
          </div>
        ) : null}
        {recent.length > 0 ? (
          <div className="rounded-md border border-border bg-muted/20 px-2.5 py-2 text-xs">
            <div className="mb-1.5 font-medium">{t("evalPage.recentDecisions")}</div>
            <ul className="space-y-1.5">
              {recent.map((a) => (
                <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-mono text-muted-foreground">#{a.issueNumber}</span>
                  <span>→ <span className="font-mono font-medium">{a.routing?.chosen ?? "—"}</span></span>
                  {a.routing?.why ? <Badge tone="neutral">{a.routing.why.replace(/_/g, " ")}{a.routing.margin ? ` · ${a.routing.margin}` : ""}</Badge> : null}
                  {(a.routing?.candidates?.length ?? 0) > 1 ? (
                    <span className="text-muted-foreground">
                      {t("evalPage.over")} {a.routing!.candidates!.filter((c) => c.id !== a.routing?.chosen).map((c) => `${c.id} (${t("evalPage.aff")} ${c.affinity}, ${t("evalPage.load")} ${c.load})`).join(", ")}
                    </span>
                  ) : null}
                  {(a.routing?.ineligible?.length ?? 0) > 0 ? (
                    <span className="text-muted-foreground" title={a.routing!.ineligible!.map((i) => `${i.id}: ${i.reason}`).join("; ")}>
                      · {t("evalPage.ineligible", { count: a.routing!.ineligible!.length })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="text-[11px] text-muted-foreground">
          {t("evalPage.notShown")}
        </p>
      </CardContent>
    </Card>
  );
}

// The computed L0–L6 scorecard: calibration gates applied to measured evidence,
// replacing the hand-typed status. Honest — an unmeasurable gate is "indeterminate".
function MaturityScorecardCard({ scorecard }: { scorecard: MaturityScorecard }) {
  const { t } = useAppTranslation();
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 py-3">
        <CardTitle className="text-base">{t("evalPage.maturity")}</CardTitle>
        <Badge tone={scorecard.currentLevel >= 0 ? "success" : "neutral"}>
          {t("evalPage.current")}: {scorecard.currentLevel >= 0 ? `L${scorecard.currentLevel}` : "—"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {t("evalPage.maturityHint")}
        </p>
        {scorecard.nextGap ? (
          <div className="rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs">
            <span className="font-medium">{t("evalPage.nextReach", { level: scorecard.nextGap.level, name: scorecard.nextGap.name })}</span>
            <span className="text-muted-foreground"> — {scorecard.nextGap.action}</span>
            {scorecard.nextGap.measured ? <span className="text-muted-foreground"> {t("evalPage.currently")}: {scorecard.nextGap.measured}.</span> : null}
            {scorecard.nextGap.detail ? <div className="mt-0.5 text-[11px] text-warning">{scorecard.nextGap.detail}</div> : null}
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <tbody>
              {scorecard.levels.map((l) => (
                <tr key={l.level} className="border-b border-border/60 align-top">
                  <td className="py-1.5 pr-2 font-mono font-semibold">L{l.level}</td>
                  <td className="py-1.5 pr-2">
                    <div className="font-medium">{l.name}</div>
                    <div className="text-muted-foreground">{l.gate}</div>
                    {l.detail ? <div className="text-[11px] text-warning">{l.detail}</div> : null}
                  </td>
                  <td className="py-1.5 pr-2 text-muted-foreground">{l.measured ?? "—"}</td>
                  <td className="whitespace-nowrap py-1.5 text-right">
                    <Badge tone={verdictTone(l.verdict)}>{l.verdict}</Badge>
                    {l.frontier ? <div className="mt-0.5 text-[10px] text-muted-foreground">{t("evalPage.frontier")}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] italic text-muted-foreground">{scorecard.disclaimer}</p>
      </CardContent>
    </Card>
  );
}

export function EvalTrendView() {
  const { t, i18n } = useAppTranslation();
  const { data: consoleState } = useConsoleState();
  const assignments = consoleState?.dispatchAssignments ?? [];
  const [summary, setSummary] = useState<EvalTrendSummary | null>(null);
  const [maturity, setMaturity] = useState<MaturityScorecard | null>(null);
  const [dora, setDora] = useState<DoraReport | null>(null);
  const [dispatch, setDispatch] = useState<DispatchEvaluation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [trend, mat, doraResp, disp] = await Promise.all([
        api.listEvalTrend() as Promise<{ summary?: EvalTrendSummary }>,
        api.maturity() as Promise<MaturityScorecard>,
        api.dora() as Promise<{ dora?: DoraReport | null }>,
        api.dispatchEvaluation() as Promise<DispatchEvaluation>,
      ]);
      setSummary(trend.summary ?? null);
      setMaturity(mat ?? null);
      setDora(doraResp.dora ?? null);
      setDispatch(disp ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  // Poll gently — the trend only changes on the nightly/weekly schedule.
  useVisibleInterval(() => void load(), 60_000);

  const anyRegression = summary != null && (summary.subcap.regressed || summary.heldout.regressed);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Gauge className="size-5" /> {t("evalPage.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("evalPage.description")}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn("mr-1 size-3.5", loading && "animate-spin")} /> {t("evalPage.refresh")}
        </Button>
      </div>

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      {maturity ? <MaturityScorecardCard scorecard={maturity} /> : null}
      {maturity?.inputs?.orchestration ? <RecoveryTrendCard recovery={maturity.inputs.orchestration} /> : null}

      {dora ? <DoraCard dora={dora} /> : null}

      {dispatch && dispatch.total.assignments > 0 ? <DispatchEvaluationCard evaluation={dispatch} assignments={assignments} /> : null}
      <WebPerformanceCard />
      <OperationalHealthCard />

      {summary && summary.total > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label={t("evalPage.subcap")} value={pct(summary.subcap.latest?.passRate)} hint={t("evalPage.realRuns", { count: summary.subcap.realRuns })} tone={summary.subcap.regressed ? "danger" : undefined} />
            <StatTile label={t("evalPage.heldout")} value={pct(summary.heldout.latest?.passRate)} hint={t("evalPage.realRuns", { count: summary.heldout.realRuns })} tone={summary.heldout.regressed ? "danger" : undefined} />
            <StatTile label={t("evalPage.lastRun")} value={fmtDate(summary.lastRunAt, i18n.language)} hint={summary.claude ?? undefined} />
            <StatTile label={t("evalPage.infraFailures")} value={String(summary.infraFailures)} hint={summary.lastInfraFailure ? `${t("evalPage.last")} ${fmtDate(summary.lastInfraFailure.startedAt, i18n.language)}` : t("evalPage.none")} tone={summary.infraFailures > 0 ? "danger" : undefined} />
          </div>

          {anyRegression ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />
              <span>{t("evalPage.regressionWarning")}</span>
            </div>
          ) : null}

          {summary.lastInfraFailure ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs text-muted-foreground">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                {t("evalPage.authFailure", { time: fmtDate(summary.lastInfraFailure.startedAt, i18n.language), detail: summary.lastInfraFailure.detail ?? t("evalPage.unknown") })}
              </span>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <MetricCard title={t("evalPage.subcapEval")} metric={summary.subcap} minRuns={summary.minRunsForLines} />
            <MetricCard title={t("evalPage.heldoutEval")} metric={summary.heldout} minRuns={summary.minRunsForLines} />
          </div>
        </>
      ) : !loading ? (
        <EmptyState
          title={t("evalPage.empty")}
          hint={t("evalPage.emptyHint")}
        />
      ) : null}
    </div>
  );
}
