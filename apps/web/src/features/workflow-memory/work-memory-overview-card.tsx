import { useState, type ComponentType } from "react";
import {
  CircleAlert,
  ArrowDown,
  ArrowRight,
  BookOpen,
  FileCheck2,
  GitCompareArrows,
  HeartPulse,
  Inbox,
  Lightbulb,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Sparkles,
  TableProperties,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

export type WorkMemoryPathItem = {
  title: string;
  detail?: string | null;
  examples?: string[];
};

export type WorkMemoryHealthIssue = {
  id: string;
  message: string;
  action?: string | null;
};

export type WorkMemoryVersion = {
  name: string;
  versionLabel: string;
  changedAt?: string | null;
};

export type WorkMemoryVersionChange = {
  id: string;
  label: string;
  previous: string;
  current: string;
};

export type WorkMemoryResultSuggestion = {
  id: string;
  title: string;
  observedDifference: string;
  suggestedChange: string;
  reason?: string | null;
};

export type WorkMemoryOverview = {
  name: string;
  path: {
    incoming: WorkMemoryPathItem;
    references: WorkMemoryPathItem;
    process: WorkMemoryPathItem;
    result: WorkMemoryPathItem;
    ledger: WorkMemoryPathItem | null;
  };
  health: {
    state: "healthy" | "needs_attention" | "paused";
    score: number | null;
    summary: string;
    issues: WorkMemoryHealthIssue[];
  };
  versions: {
    current: WorkMemoryVersion;
    previous: WorkMemoryVersion | null;
    changes: WorkMemoryVersionChange[];
  };
  resultSuggestions: WorkMemoryResultSuggestion[];
};

const COPY = {
  en: {
    title: "How this work is handled",
    subtitle: "This is what the computer learned from your past work and results.",
    path: "Work path",
    pathLabels: ["New work", "Find references", "Handle it", "Prepare result", "Update ledger"],
    noLedger: "No ledger update is needed for this work",
    health: "Is this work memory ready?",
    score: "Internal reference score",
    healthDetails: "View how this was assessed",
    healthy: "Can be used",
    needs_attention: "Needs review",
    paused: "Pause recommended",
    noIssues: "No problems need your attention.",
    suggestedAction: "What you can do",
    differences: "What changed since last time",
    current: "Current rules",
    previous: "Previous rules",
    noPrevious: "There is no previous version yet.",
    noChanges: "The way this work is handled has not changed.",
    before: "Before",
    now: "Now",
    suggestions: "Changes learned from your finished results",
    suggestionsHint: "These suggestions are waiting for your confirmation. They will not change future work by themselves.",
    observed: "What changed in your result",
    suggested: "Suggested rule",
    why: "Why this is suggested",
    reviewSuggestion: "Review this suggestion",
    restore: "Restore the previous rules",
    restoreQuestion: "Restore the previous way of handling this work?",
    restoreHint: "New work will use the previous rules. Tasks already in progress will keep their current rules.",
    cancel: "Keep the current rules",
    confirmRestore: "Yes, restore the previous rules",
    restoring: "Restoring…",
    loadingTitle: "Preparing this work memory…",
    loadingDetail: "Checking the work path, completion requirements, and recent results.",
    retry: "Try again",
  },
  zh: {
    title: "这项工作会怎样处理",
    subtitle: "这是电脑根据你的历史工作过程和人工结果学会的做法。",
    path: "工作路径",
    pathLabels: ["新工作", "查找参考", "按规矩处理", "生成结果", "更新台账"],
    noLedger: "这项工作不需要更新台账",
    health: "这套工作规矩是否可靠",
    score: "内部参考分数",
    healthDetails: "查看判断依据",
    healthy: "可以使用",
    needs_attention: "需要检查",
    paused: "建议暂停",
    noIssues: "目前没有需要你处理的问题。",
    suggestedAction: "你可以这样处理",
    differences: "和上一次相比有什么变化",
    current: "当前使用",
    previous: "上一次使用",
    noPrevious: "目前还没有可以比较的上一版。",
    noChanges: "工作做法没有发生变化。",
    before: "原来",
    now: "现在",
    suggestions: "从你的人工结果中发现的改进",
    suggestionsHint: "这些建议正在等你确认，不会自行改变以后任务的处理方式。",
    observed: "人工结果中发生了什么变化",
    suggested: "建议以后遵循",
    why: "为什么这样建议",
    reviewSuggestion: "检查这条建议",
    restore: "恢复上一次的规矩",
    restoreQuestion: "确定恢复上一次的工作做法吗？",
    restoreHint: "以后新工作将使用上一次的规矩，已经开始的任务仍按当前规矩完成。",
    cancel: "继续使用当前规矩",
    confirmRestore: "确认恢复上一次",
    restoring: "正在恢复…",
    loadingTitle: "正在整理这项工作的历史做法…",
    loadingDetail: "正在核对工作路径、完成要求和最近结果。",
    retry: "重新加载",
  },
} as const;

const PATH_ICONS: ComponentType<{ className?: string; "aria-hidden"?: boolean }>[] = [
  Inbox,
  BookOpen,
  Sparkles,
  FileCheck2,
  TableProperties,
];

function healthTone(state: WorkMemoryOverview["health"]["state"]) {
  if (state === "healthy") return "success" as const;
  if (state === "needs_attention") return "warning" as const;
  return "neutral" as const;
}

function boundedScore(score: number | null) {
  if (score === null || !Number.isFinite(score)) return null;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function WorkMemoryOverviewNotice({
  state,
  message,
  onRetry,
}: {
  state: "loading" | "error";
  message?: string;
  onRetry?: () => void;
}) {
  const { i18n } = useAppTranslation();
  const copy = COPY[i18n.resolvedLanguage?.startsWith("zh") ? "zh" : "en"];
  const loading = state === "loading";
  const Icon = loading ? LoaderCircle : CircleAlert;
  return (
    <Card role={loading ? "status" : "alert"} aria-live={loading ? "polite" : "assertive"}>
      <CardContent className="flex items-start gap-3 p-4">
        <Icon className={`mt-0.5 size-5 shrink-0 ${loading ? "animate-spin text-primary" : "text-warning"}`}
          aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{loading ? copy.loadingTitle : message}</p>
          {loading ? <p className="mt-1 text-xs text-muted-foreground">{copy.loadingDetail}</p> : null}
          {!loading && onRetry ? (
            <Button className="mt-3" size="sm" variant="secondary" onClick={onRetry}>
              <RefreshCw /> {copy.retry}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function WorkMemoryOverviewCard({
  overview,
  restoring = false,
  onReviewSuggestion,
  onRestorePrevious,
}: {
  overview: WorkMemoryOverview;
  restoring?: boolean;
  onReviewSuggestion?: (suggestionId: string) => void;
  onRestorePrevious: () => void;
}) {
  const { i18n } = useAppTranslation();
  const copy = COPY[i18n.resolvedLanguage?.startsWith("zh") ? "zh" : "en"];
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const score = boundedScore(overview.health.score);
  const path = [
    overview.path.incoming,
    overview.path.references,
    overview.path.process,
    overview.path.result,
    overview.path.ledger ?? { title: copy.noLedger },
  ];

  return (
    <Card>
      <CardHeader className="gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 shrink-0 text-primary" aria-hidden="true" />
            <CardTitle>{copy.title}</CardTitle>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{copy.subtitle}</p>
          <p className="mt-2 break-words text-sm font-semibold">{overview.name}</p>
        </div>
        <Badge tone={healthTone(overview.health.state)}>
          {copy[overview.health.state]}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-5">
        <section aria-labelledby="work-memory-path-title">
          <h4 id="work-memory-path-title" className="text-sm font-semibold">{copy.path}</h4>
          <ol className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]"
            aria-label={copy.path}>
            {path.flatMap((item, index) => {
              const Icon = PATH_ICONS[index];
              const stage = (
                <li key={`stage-${copy.pathLabels[index]}`} className="min-w-0 rounded-lg border bg-muted/25 p-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Icon className="size-4 shrink-0" aria-hidden={true} />
                    <span>{copy.pathLabels[index]}</span>
                  </div>
                  <p className="mt-2 break-words text-sm font-medium">{item.title}</p>
                  {item.detail ? <p className="mt-1 break-words text-xs text-muted-foreground">{item.detail}</p> : null}
                  {item.examples?.length ? (
                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {item.examples.slice(0, 3).map((example) => <li key={example} className="break-words">{example}</li>)}
                    </ul>
                  ) : null}
                </li>
              );
              if (index === path.length - 1) return [stage];
              return [
                stage,
                <li key={`arrow-${index}`} className="flex items-center justify-center text-muted-foreground" aria-hidden="true">
                  <ArrowDown className="size-4 lg:hidden" />
                  <ArrowRight className="hidden size-4 lg:block" />
                </li>,
              ];
            })}
          </ol>
        </section>

        <section className="rounded-lg border p-4" aria-labelledby="work-memory-health-title">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 id="work-memory-health-title" className="flex items-center gap-2 text-sm font-semibold">
                <HeartPulse className="size-4 text-primary" aria-hidden="true" />
                {copy.health}
              </h4>
              <p className="mt-1 text-sm text-muted-foreground">{overview.health.summary}</p>
            </div>
          </div>
          {score !== null ? (
            <details className="mt-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">{copy.healthDetails}</summary>
              <p className="mt-2">{copy.score}：{score}/100</p>
            </details>
          ) : null}
          {overview.health.issues.length ? (
            <ul className="mt-3 space-y-2">
              {overview.health.issues.map((issue) => (
                <li key={issue.id} className="rounded-md bg-warning/5 p-3 text-sm">
                  <p>{issue.message}</p>
                  {issue.action ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{copy.suggestedAction}：</span>{issue.action}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 text-sm text-muted-foreground">{copy.noIssues}</p>}
        </section>

        <section aria-labelledby="work-memory-differences-title">
          <h4 id="work-memory-differences-title" className="flex items-center gap-2 text-sm font-semibold">
            <GitCompareArrows className="size-4 text-primary" aria-hidden="true" />
            {copy.differences}
          </h4>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
              <p className="text-xs text-muted-foreground">{copy.current}</p>
              <p className="mt-1 text-sm font-medium">{overview.versions.current.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{overview.versions.current.versionLabel}</p>
            </div>
            {overview.versions.previous ? (
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">{copy.previous}</p>
                <p className="mt-1 text-sm font-medium">{overview.versions.previous.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{overview.versions.previous.versionLabel}</p>
              </div>
            ) : (
              <p className="rounded-md border p-3 text-sm text-muted-foreground">{copy.noPrevious}</p>
            )}
          </div>
          {overview.versions.changes.length ? (
            <ul className="mt-3 space-y-2">
              {overview.versions.changes.map((change) => (
                <li key={change.id} className="rounded-md border p-3 text-sm">
                  <p className="font-medium">{change.label}</p>
                  <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div><dt className="text-xs text-muted-foreground">{copy.before}</dt><dd className="mt-0.5 break-words">{change.previous}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{copy.now}</dt><dd className="mt-0.5 break-words">{change.current}</dd></div>
                  </dl>
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 text-sm text-muted-foreground">{copy.noChanges}</p>}
        </section>

        {overview.resultSuggestions.length ? (
          <section className="rounded-lg border border-warning/40 bg-warning/5 p-4"
            aria-labelledby="work-memory-suggestions-title">
            <h4 id="work-memory-suggestions-title" className="flex items-center gap-2 text-sm font-semibold">
              <Lightbulb className="size-4 text-warning" aria-hidden="true" />
              {copy.suggestions}
            </h4>
            <p className="mt-1 text-xs text-muted-foreground">{copy.suggestionsHint}</p>
            <ul className="mt-3 space-y-3">
              {overview.resultSuggestions.map((suggestion) => (
                <li key={suggestion.id} className="rounded-md border bg-background p-3">
                  <p className="text-sm font-medium">{suggestion.title}</p>
                  <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                    <div><dt className="font-medium">{copy.observed}</dt><dd className="mt-0.5 break-words text-muted-foreground">{suggestion.observedDifference}</dd></div>
                    <div><dt className="font-medium">{copy.suggested}</dt><dd className="mt-0.5 break-words text-muted-foreground">{suggestion.suggestedChange}</dd></div>
                    {suggestion.reason ? (
                      <div className="sm:col-span-2"><dt className="font-medium">{copy.why}</dt><dd className="mt-0.5 break-words text-muted-foreground">{suggestion.reason}</dd></div>
                    ) : null}
                  </dl>
                  {onReviewSuggestion ? (
                    <Button className="mt-3 w-full sm:w-auto" size="sm" variant="secondary"
                      onClick={() => onReviewSuggestion(suggestion.id)}>
                      {copy.reviewSuggestion}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {overview.versions.previous ? (
          <section className="border-t pt-4">
            {!confirmingRestore ? (
              <Button variant="secondary" size="sm" aria-expanded="false"
                aria-controls="work-memory-restore-confirmation"
                disabled={restoring} onClick={() => setConfirmingRestore(true)}>
                <RotateCcw /> {copy.restore}
              </Button>
            ) : (
              <div id="work-memory-restore-confirmation" className="rounded-lg border border-warning/40 bg-warning/5 p-3"
                role="alert">
                <p className="text-sm font-semibold">{copy.restoreQuestion}</p>
                <p className="mt-1 text-xs text-muted-foreground">{copy.restoreHint}</p>
                <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row">
                  <Button className="w-full sm:w-auto" variant="secondary" size="sm" disabled={restoring}
                    onClick={() => setConfirmingRestore(false)}>
                    {copy.cancel}
                  </Button>
                  <Button className="w-full sm:w-auto" variant="destructive" size="sm" disabled={restoring}
                    onClick={onRestorePrevious}>
                    <RotateCcw /> {restoring ? copy.restoring : copy.confirmRestore}
                  </Button>
                </div>
              </div>
            )}
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
