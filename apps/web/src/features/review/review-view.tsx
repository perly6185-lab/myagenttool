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

function severityTone(severity: string): Tone {
  if (severity === "high") return "danger";
  if (severity === "medium") return "warning";
  return "neutral";
}

/** Unified codex/claude diff-review findings, scoped server-side to the actor. */
export function ReviewView() {
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
        eyebrow="Governed review"
        title="Review findings"
        description="Structured findings imported from governed Codex and Claude diff reviews. Raw review payloads stay server-side."
      />

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Source" className="w-40">
          <Select value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
            <option value="all">All sources</option>
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
          </Select>
        </Field>
        <Field label="Severity" className="w-40">
          <Select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}>
            <option value="all">All severities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Select>
        </Field>
        <span className="pb-2 text-xs text-muted-foreground">
          {findings.length} of {all.length} finding(s)
        </span>
      </div>

      {!findings.length ? (
        <EmptyState
          title={all.length ? "No findings match these filters" : "No review findings yet"}
          hint={
            all.length
              ? "Loosen the source or severity filter."
              : "Run a governed Codex or Claude review from the Tools panel to populate this list."
          }
          action={!all.length ? <Button size="sm" onClick={() => setSection("tools")}>Open Tools</Button> : undefined}
        />
      ) : (
        <div className="space-y-3">
          {findings.map((finding) => (
            <Card key={finding.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={severityTone(finding.severity)}>{finding.severity}</StatusBadge>
                  <Badge>{finding.source}</Badge>
                  <Badge>confidence: {finding.confidence}</Badge>
                  <span className="[overflow-wrap:anywhere] font-mono text-xs text-muted-foreground">
                    {finding.file}
                    {finding.line != null ? `:${finding.line}` : ""}
                  </span>
                </div>
                <p className="text-sm text-foreground">{finding.message}</p>
                {finding.suggestion ? (
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Suggestion: </span>
                    {finding.suggestion}
                  </p>
                ) : null}
                {loadedInvocationIds.has(finding.invocationId) ? (
                  <button
                    type="button"
                    className="text-xs font-medium text-primary hover:underline"
                    onClick={() => openInvocation(finding)}
                  >
                    View invocation →
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Invocation not in the current window
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
