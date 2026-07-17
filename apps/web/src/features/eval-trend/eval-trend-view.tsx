import { useCallback, useEffect, useState } from "react";
import { Gauge, RefreshCw, TriangleAlert, CircleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { api } from "@/data/use-console-actions";
import { cn } from "@/lib/cn";

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

function fmtDate(iso: string | null): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "never";
  const ageMs = Date.now() - t;
  const days = Math.floor(ageMs / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function fmtDelta(delta: number | null): string {
  if (delta == null) return "";
  if (delta === 0) return "±0";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${Math.round(delta * 100)}pp vs previous`;
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
  const latest = metric.latest;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span>{title}</span>
          <span className="flex items-center gap-2">
            {metric.regressed ? (
              <Badge tone="danger">
                <TriangleAlert className="mr-1 size-3" /> below floor
              </Badge>
            ) : null}
            <Badge tone={metric.enoughForLines ? "success" : "neutral"}>
              {metric.realRuns}/{minRuns} runs
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
                  {fmtDelta(metric.delta)}
                </span>
              ) : null}
            </div>
            {/* Sparkline-ish: recent pass rates as bars. */}
            <div className="flex items-end gap-1" style={{ height: 40 }}>
              {metric.series.slice(-12).map((p, i) => (
                <div
                  key={`${p.startedAt ?? i}`}
                  title={`${fmtDate(p.startedAt)}: ${pct(p.passRate)}`}
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
              Floor {pct(metric.floor)}
              {metric.floorProvisional ? " (provisional — #250 sets the real line once ≥" : " (≥"}
              {metric.floorProvisional ? `${minRuns} real runs exist)` : ""}
              {!metric.enoughForLines ? ` · ${minRuns - metric.realRuns} more run(s) before a line can be derived` : ""}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No real data points yet — the scheduled agent hasn't produced a scored run for this set.</p>
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
  const green = dora.ciChecks?.greenRate;
  const cf = dora.changeFailures;
  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-base">DORA — Four Keys</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Lead time (median)" value={dora.leadTimeHours?.median != null ? `${dora.leadTimeHours.median}h` : "—"} hint={dora.leadTimeHours?.p90 != null ? `p90 ${dora.leadTimeHours.p90}h` : undefined} />
          <StatTile label="Deploy freq (proxy)" value={dora.mergesPerWeek != null ? `${dora.mergesPerWeek}/wk` : "—"} hint="merges to main" />
          <StatTile label="CI-green rate" value={pct(green ?? null)} hint={`target ${pct(dora.ciChecks?.gateTarget ?? 0.95)}`} tone={green != null && green < (dora.ciChecks?.gateTarget ?? 0.95) ? "danger" : undefined} />
          <StatTile label="Change failure" value={cf?.recorded ? pct(cf.changeFailureRate ?? null) : "not recorded"} hint={cf?.recorded ? (cf.recoveryHours?.median != null ? `recovery ${cf.recoveryHours.median}h` : undefined) : "marker unused"} />
        </div>
        <p className="text-[11px] text-muted-foreground">
          {dora.mergedPrCount ?? 0} merged PR(s) over {dora.windowDays ?? "?"}d · deploy frequency is a merge-to-main proxy (no deploy pipeline) · change-failure/recovery await the `Change-failure: #N` marker convention.
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
function DispatchEvaluationCard({ evaluation }: { evaluation: DispatchEvaluation }) {
  const rate = (r: number | null) => (r == null ? "—" : pct(r));
  const rows: DispatchSlice[] = [...evaluation.workers, ...evaluation.workerAreas];
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 py-3">
        <CardTitle className="text-base">Dispatch routing</CardTitle>
        <Badge tone="neutral">{evaluation.total.assignments} assignment(s)</Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Per-worker and per-(worker × area) outcomes from the dispatcher's own bookkeeping. A slice with fewer than {evaluation.minSamples} settled outcomes shows "insufficient data" rather than an extrapolated rate.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1.5 pr-2 font-medium">Worker</th>
                <th className="py-1.5 pr-2 font-medium">Area</th>
                <th className="py-1.5 pr-2 font-medium text-right">Assigned</th>
                <th className="py-1.5 pr-2 font-medium text-right">Completed</th>
                <th className="py-1.5 pr-2 font-medium text-right">Reassigned</th>
                <th className="py-1.5 pr-2 font-medium text-right">Median settle</th>
                <th className="py-1.5 pr-2 font-medium text-right">Outcome</th>
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
                      {s.verdict === "measured" ? "measured" : `insufficient data (${s.sample})`}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {evaluation.shadow.shadowAssignments > 0 ? (
          <div className="rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs">
            <div className="mb-1 font-medium">Shadow evaluation (recorded counterfactuals, per issue)</div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <StatTile label="Shadow issues" value={String(evaluation.shadow.shadowAssignments)} hint={`${evaluation.shadow.disagreements} diverged`} />
              <StatTile label="Agreement" value={evaluation.shadow.agreementRate != null ? pct(evaluation.shadow.agreementRate) : `insufficient (n=${evaluation.shadow.shadowAssignments})`} hint="baseline = scored" />
              <StatTile label="Settled diverged" value={String(evaluation.shadow.settledDisagreements)} hint={`target ≥ ${evaluation.minSamples}`} />
              {/* #1184: a high reassign rate is evidence TOWARD promoting scored,
                  not a regression — no danger tone; the promotion rule carries
                  the recommendation (and the TTL-churn caveat). */}
              <StatTile
                label="Baseline reassigned on divergence"
                value={evaluation.shadow.verdict === "measured" && evaluation.shadow.baselineReassignRate != null ? pct(evaluation.shadow.baselineReassignRate) : `insufficient (${evaluation.shadow.sample})`}
                hint="baseline's divergent pick, not scored's outcome"
              />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{evaluation.shadow.promotionRule}</p>
          </div>
        ) : null}
        <p className="text-[11px] text-muted-foreground">
          Not shown: time-to-in-progress and time-to-PR — those live in each worker's own server state (the dispatcher only sees assign → settle/reassign). Per-area rows can exceed the worker total when an issue declares multiple areas.
        </p>
      </CardContent>
    </Card>
  );
}

// The computed L0–L6 scorecard: calibration gates applied to measured evidence,
// replacing the hand-typed status. Honest — an unmeasurable gate is "indeterminate".
function MaturityScorecardCard({ scorecard }: { scorecard: MaturityScorecard }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 py-3">
        <CardTitle className="text-base">Maturity scorecard</CardTitle>
        <Badge tone={scorecard.currentLevel >= 0 ? "success" : "neutral"}>
          Current: {scorecard.currentLevel >= 0 ? `L${scorecard.currentLevel}` : "—"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Computed from measured evidence (DORA · held-out eval · backlog · governance) — the current level is the highest reached without a gap. A level still shows its own verdict even when a lower gate blocks contiguity.
        </p>
        {scorecard.nextGap ? (
          <div className="rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs">
            <span className="font-medium">Next: reach L{scorecard.nextGap.level} ({scorecard.nextGap.name})</span>
            <span className="text-muted-foreground"> — {scorecard.nextGap.action}</span>
            {scorecard.nextGap.measured ? <span className="text-muted-foreground"> Currently: {scorecard.nextGap.measured}.</span> : null}
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
                    {l.frontier ? <div className="mt-0.5 text-[10px] text-muted-foreground">frontier</div> : null}
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
    // Poll gently — the trend only changes on the nightly/weekly schedule.
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const anyRegression = summary != null && (summary.subcap.regressed || summary.heldout.regressed);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Gauge className="size-5" /> Capability
          </h1>
          <p className="text-sm text-muted-foreground">
            Scheduled real-agent eval trend (#248) — how the system scores itself over time. The scheduler runs locally; this is a read-only view of its results.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn("mr-1 size-3.5", loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      {maturity ? <MaturityScorecardCard scorecard={maturity} /> : null}

      {dora ? <DoraCard dora={dora} /> : null}

      {dispatch && dispatch.total.assignments > 0 ? <DispatchEvaluationCard evaluation={dispatch} /> : null}

      {summary && summary.total > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Sub-capability" value={pct(summary.subcap.latest?.passRate)} hint={`${summary.subcap.realRuns} real run(s)`} tone={summary.subcap.regressed ? "danger" : undefined} />
            <StatTile label="Held-out" value={pct(summary.heldout.latest?.passRate)} hint={`${summary.heldout.realRuns} real run(s)`} tone={summary.heldout.regressed ? "danger" : undefined} />
            <StatTile label="Last run" value={fmtDate(summary.lastRunAt)} hint={summary.claude ?? undefined} />
            <StatTile label="Infra failures" value={String(summary.infraFailures)} hint={summary.lastInfraFailure ? `last ${fmtDate(summary.lastInfraFailure.startedAt)}` : "none"} tone={summary.infraFailures > 0 ? "danger" : undefined} />
          </div>

          {anyRegression ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />
              <span>A capability metric is below its provisional floor. This is the regression signal #250 will formalize into a hard gate once enough real runs exist.</span>
            </div>
          ) : null}

          {summary.lastInfraFailure ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs text-muted-foreground">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                A scheduled run failed to authenticate ({fmtDate(summary.lastInfraFailure.startedAt)}): {summary.lastInfraFailure.detail ?? "unknown"}. If recent, the scheduler login needs attention — see AUTORUN_PILOT_RUNBOOK.
              </span>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <MetricCard title="Sub-capability eval" metric={summary.subcap} minRuns={summary.minRunsForLines} />
            <MetricCard title="Held-out eval" metric={summary.heldout} minRuns={summary.minRunsForLines} />
          </div>
        </>
      ) : !loading ? (
        <EmptyState
          title="No eval trend yet"
          hint="The scheduled real-agent evals (LaunchAgents: nightly subcap, weekly held-out) haven't written a trend record. Run `pnpm eval:real` or kickstart the agent to seed one."
        />
      ) : null}
    </div>
  );
}
