import type { ReactNode } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import { readableEventType, readableStatus, shortTime, statusTone, type Tone } from "@/lib/readable-labels";
import { cn } from "@/lib/cn";
import type { InvocationEventSnapshot } from "@/lib/console-state";

// Agent Workspace transcript (#162): classify the flat event stream into typed
// blocks and render each distinctly — command output as monospace, warnings
// separated from answer content, review findings linkable, and a final summary.
export type TranscriptBlockKind = "status" | "command" | "approval" | "warning" | "diff";

const KIND_META: Record<TranscriptBlockKind, { label: string; tone: Tone; accent: string }> = {
  status: { label: "Status", tone: "neutral", accent: "border-border" },
  command: { label: "Command", tone: "neutral", accent: "border-primary/40" },
  approval: { label: "Approval", tone: "running", accent: "border-primary/60" },
  warning: { label: "Warning", tone: "warning", accent: "border-warning/50" },
  diff: { label: "Review", tone: "success", accent: "border-success/40" },
};

/**
 * Map one event to a transcript block kind. Order matters: approvals stay
 * actionable even when denied (warn), and unknown types fall back to `status`
 * so a new server event type never breaks rendering.
 */
export function classifyEvent(event: InvocationEventSnapshot): TranscriptBlockKind {
  const type = event.type ?? "";
  if (/approval/i.test(type)) return "approval";
  if (event.level === "warn" || event.level === "error" || /_failed$/i.test(type)) return "warning";
  if (/review_findings_recorded/i.test(type)) return "diff";
  if (["command", "cli", "git", "log", "codex_hook_event"].includes(type)) return "command";
  return "status";
}

export interface TranscriptSummary {
  text?: string | null;
  status?: string;
}

export function Transcript({
  events,
  renderAction,
  summary,
  onOpenReview,
}: {
  events: InvocationEventSnapshot[];
  // Inline slot under a block — anchors an action (e.g. an approval's
  // Approve/Deny) to the exact moment in the stream it was requested.
  renderAction?: (event: InvocationEventSnapshot) => ReactNode;
  // A final answer block, shown once the run reaches a terminal state.
  summary?: TranscriptSummary;
  // When set, review (diff) blocks offer a jump to the Review section.
  onOpenReview?: () => void;
}) {
  if (events.length === 0 && !summary?.text) {
    return <EmptyState title="No runs yet" hint="Run a task to watch local progress here." />;
  }

  const summaryFailed = summary?.status === "failed" || summary?.status === "cancelled";

  return (
    <div className="space-y-3">
      {events.length ? (
        <ol className="space-y-2.5">
          {events.map((event) => {
            const kind = classifyEvent(event);
            const meta = KIND_META[kind];
            const text = event.message ?? "Activity recorded.";
            return (
              <li key={event.id} className="flex gap-3">
                <time
                  dateTime={event.createdAt}
                  className="mt-1 w-16 shrink-0 font-mono text-xs tabular-nums text-muted-foreground"
                >
                  {shortTime(event.createdAt)}
                </time>
                <div className={cn("min-w-0 flex-1 border-l-2 pl-3", meta.accent)}>
                  <div className="flex items-center gap-2">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    <span className="truncate text-sm font-medium">{readableEventType(event.type)}</span>
                  </div>
                  {kind === "command" ? (
                    // Preserve multi-line / ANSI-ish output; never re-flow it into a paragraph.
                    <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono text-xs [overflow-wrap:anywhere]">
                      {text}
                    </pre>
                  ) : (
                    <p
                      className={cn(
                        "mt-0.5 text-sm [overflow-wrap:anywhere]",
                        // Keep warning/stderr content visually distinct from answer content.
                        kind === "warning" ? "text-warning" : "text-muted-foreground",
                      )}
                    >
                      {text}
                    </p>
                  )}
                  {kind === "diff" && onOpenReview ? (
                    <button
                      type="button"
                      onClick={onOpenReview}
                      className="mt-1 text-xs font-medium text-primary hover:underline"
                    >
                      View in Review →
                    </button>
                  ) : null}
                  {renderAction?.(event)}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}

      {summary?.text ? (
        <div className={cn("rounded-lg border-l-2 bg-muted/30 p-3", summaryFailed ? "border-destructive/50" : "border-success/50")}>
          <div className="flex items-center gap-2">
            <Badge tone={statusTone(summary.status)}>Summary</Badge>
            {summary.status ? (
              <span className="text-xs text-muted-foreground">{readableStatus(summary.status)}</span>
            ) : null}
          </div>
          <p className="mt-1 text-sm [overflow-wrap:anywhere]">{summary.text}</p>
        </div>
      ) : null}
    </div>
  );
}
