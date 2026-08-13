import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { EmptyState } from "@/components/common/empty-state";
import { SectionHeading } from "@/components/common/section-heading";
import { useConsoleState } from "@/data/use-console-state";
import { useUiStore } from "@/store/ui-store";
import type { ReviewFinding } from "@/lib/console-state";
import type { Tone } from "@/lib/readable-labels";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

function severityTone(severity: string): Tone {
  if (severity === "high") return "danger";
  if (severity === "medium") return "warning";
  return "neutral";
}

/** Unified codex/claude diff-review findings, scoped server-side to the actor. */
export function ReviewView() {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const setSection = useUiStore((s) => s.setSection);

  const [source, setSource] = useState<"all" | "codex" | "claude">("all");
  const [severity, setSeverity] = useState<"all" | "low" | "medium" | "high">("all");

  const all = state?.reviewFindings ?? [];
  const findings = useMemo(
    () =>
      all.filter(
        (finding) =>
          (source === "all" || finding.source === source) &&
          (severity === "all" || finding.severity === severity),
      ),
    [all, source, severity],
  );

  // A finding's invocation may fall outside the bounded invocations snapshot;
  // only offer the jump when it's actually loaded, else it would land on an
  // unrelated invocation (resolveInvocation falls back to invocations[0]).
  const loadedInvocationIds = useMemo(
    () => new Set((state?.invocations ?? []).map((invocation) => invocation.id)),
    [state?.invocations],
  );

  function openInvocation(finding: ReviewFinding) {
    if (!loadedInvocationIds.has(finding.invocationId)) return;
    setSelectedInvocationId(finding.invocationId);
    setSection("invocations");
  }

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow={t("reviewPage.eyebrow")}
        title={t("reviewPage.title")}
        description={t("reviewPage.description")}
      />

      <div className="flex flex-col gap-3 rounded-lg border border-primary/25 bg-primary/[0.045] p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-3xl text-muted-foreground">{t("reviewPage.resultReviewHint")}</p>
        <Button className="shrink-0" size="sm" variant="secondary" onClick={() => setSection("task")}>
          {t("reviewPage.openTasks")}
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("reviewPage.source")} className="w-40">
          <Select value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
            <option value="all">{t("reviewPage.allSources")}</option>
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
          </Select>
        </Field>
        <Field label={t("reviewPage.severity")} className="w-40">
          <Select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}>
            <option value="all">{t("reviewPage.allSeverities")}</option>
            <option value="high">{t("reviewPage.high")}</option>
            <option value="medium">{t("reviewPage.medium")}</option>
            <option value="low">{t("reviewPage.low")}</option>
          </Select>
        </Field>
        <span className="pb-2 text-xs text-muted-foreground">
          {t("reviewPage.count", { visible: findings.length, total: all.length })}
        </span>
      </div>

      {!findings.length ? (
        <EmptyState
          title={all.length ? t("reviewPage.noMatches") : t("reviewPage.empty")}
          hint={
            all.length
              ? t("reviewPage.noMatchesHint")
              : t("reviewPage.emptyHint")
          }
          action={!all.length ? <Button size="sm" onClick={() => setSection("tools")}>{t("reviewPage.openTools")}</Button> : undefined}
        />
      ) : (
        <div className="space-y-3">
          {findings.map((finding) => (
            <Card key={finding.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={severityTone(finding.severity)}>{t(`reviewPage.${finding.severity}` as never)}</StatusBadge>
                  <Badge>{finding.source}</Badge>
                  <Badge>{t("reviewPage.confidence")}: {finding.confidence}</Badge>
                  <span className="[overflow-wrap:anywhere] font-mono text-xs text-muted-foreground">
                    {finding.file}
                    {finding.line != null ? `:${finding.line}` : ""}
                  </span>
                </div>
                <p className="text-sm text-foreground">{finding.message}</p>
                {finding.suggestion ? (
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{t("reviewPage.suggestion")}: </span>
                    {finding.suggestion}
                  </p>
                ) : null}
                {loadedInvocationIds.has(finding.invocationId) ? (
                  <button
                    type="button"
                    className="text-xs font-medium text-primary hover:underline"
                    onClick={() => openInvocation(finding)}
                  >
                    {t("reviewPage.viewInvocation")} →
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {t("reviewPage.notCurrent")}
                  </span>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
