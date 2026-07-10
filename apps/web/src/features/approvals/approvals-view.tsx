import { Bot, ExternalLink, GitMerge, HelpCircle, Inbox, ListChecks, Loader2, ShieldAlert, Sparkles, Trophy, Wrench, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { cn } from "@/lib/cn";
import { useConsoleState, useRefreshConsoleState } from "@/data/use-console-state";
import { api, useAsyncAction } from "@/data/use-console-actions";
import { useUiStore, type SectionKey } from "@/store/ui-store";
import type { PendingDecision, PendingDecisionKind } from "@/lib/console-state";

// The Approvals section: ONE queue of every pending human decision, aggregated
// server-side (read-model `pendingDecisions`) from surfaces that used to be
// scattered across Invocations, Auto-runs, and Compare. Binary gates act inline;
// the richer ones (plan / design / clarify review) deep-link to their native UI.

const KIND_META: Record<PendingDecisionKind, { icon: LucideIcon; label: string }> = {
  invocation_approval: { icon: ShieldAlert, label: "Approval" },
  decomposition: { icon: ListChecks, label: "Decompose" },
  design: { icon: Sparkles, label: "Design" },
  clarify: { icon: HelpCircle, label: "Clarify" },
  merge: { icon: GitMerge, label: "Merge" },
  compare_promote: { icon: Trophy, label: "Promote" },
  codex_broker: { icon: Bot, label: "Codex" },
  lifecycle_approval: { icon: Wrench, label: "Lifecycle" },
};

function since(iso?: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const secs = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

export function ApprovalsView() {
  const { data: state } = useConsoleState();
  const refresh = useRefreshConsoleState();
  const { execute, pending, error } = useAsyncAction();
  const setSection = useUiStore((s) => s.setSection);
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);

  const decisions = state?.pendingDecisions ?? [];

  const act = async (fn: () => Promise<unknown>) => {
    if (await execute(fn)) void refresh();
  };

  // Deep-link to the native surface for full context; select the invocation when
  // the target is invocation-scoped so the user lands on the right row.
  const open = (d: PendingDecision) => {
    if (d.ref?.invocationId && d.section === "invocations") setSelectedInvocationId(d.ref.invocationId);
    setSection(d.section as SectionKey);
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <Inbox className="size-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Approvals</h1>
        <Badge tone={decisions.length ? "warning" : "neutral"}>{decisions.length} pending</Badge>
        <span className="ml-auto text-xs text-muted-foreground">Every human decision, oldest first</span>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {decisions.length === 0 ? (
        <EmptyState title="Nothing waiting on you" hint="Approvals, decomposition plans, design sign-offs, clarify answers, PR merges, and compare promotions all land here." />
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {decisions.map((d) => {
            const meta = KIND_META[d.kind];
            const Icon = meta?.icon ?? Inbox;
            const age = since(d.createdAt);
            return (
              <li key={d.id}>
                <Card>
                  <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{d.title}</span>
                        <Badge tone="neutral" className="shrink-0">{meta?.label ?? d.kind}</Badge>
                        {age ? <span className="shrink-0 text-xs text-muted-foreground">{age}</span> : null}
                      </div>
                      {d.subtitle ? <p className="truncate text-xs text-muted-foreground">{d.subtitle}</p> : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <DecisionActions d={d} pending={pending} act={act} open={open} />
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DecisionActions({
  d,
  pending,
  act,
  open,
}: {
  d: PendingDecision;
  pending: boolean;
  act: (fn: () => Promise<unknown>) => void;
  open: (d: PendingDecision) => void;
}) {
  const spin = pending ? <Loader2 className="mr-1 size-3 animate-spin" /> : null;
  const openBtn = (
    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => open(d)}>
      Open
    </Button>
  );

  switch (d.kind) {
    case "invocation_approval":
      return (
        <>
          <Button variant="primary" size="sm" className="h-7 px-2.5 text-xs" disabled={pending} onClick={() => d.ref?.approvalId && act(() => api.approveApproval(d.ref!.approvalId!))}>
            {spin}Approve
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={pending} onClick={() => d.ref?.approvalId && act(() => api.denyApproval(d.ref!.approvalId!))}>
            Deny
          </Button>
          {openBtn}
        </>
      );
    case "codex_broker":
      return (
        <>
          <Button variant="primary" size="sm" className="h-7 px-2.5 text-xs" disabled={pending} onClick={() => d.ref?.requestId && act(() => api.approveCodexApproval(d.ref!.requestId!))}>
            {spin}Approve
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={pending} onClick={() => d.ref?.requestId && act(() => api.denyCodexApproval(d.ref!.requestId!))}>
            Deny
          </Button>
          {openBtn}
        </>
      );
    case "lifecycle_approval":
      return (
        <>
          <Button variant="primary" size="sm" className="h-7 px-2.5 text-xs" disabled={pending} onClick={() => d.ref?.approvalId && act(() => api.approveLifecycleApproval(d.ref!.approvalId!))}>
            {spin}Approve
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={pending} onClick={() => d.ref?.approvalId && act(() => api.denyLifecycleApproval(d.ref!.approvalId!))}>
            Deny
          </Button>
          {openBtn}
        </>
      );
    case "compare_promote":
      return (
        <>
          <Button variant="primary" size="sm" className="h-7 px-2.5 text-xs" disabled={pending} onClick={() => d.ref?.compareRunId && act(() => api.promoteCompareRun(d.ref!.compareRunId!))}>
            {spin}
            <Trophy className="mr-1 size-3" />Promote
          </Button>
          {openBtn}
        </>
      );
    case "merge":
      return (
        <>
          <Button variant="primary" size="sm" className="h-7 px-2.5 text-xs" disabled={pending} onClick={() => d.ref?.autoRunId && act(() => api.mergeAutoRunPr(d.ref!.autoRunId!))}>
            {spin}
            <GitMerge className="mr-1 size-3" />Merge
          </Button>
          {d.ref?.prUrl ? (
            <a href={d.ref.prUrl} target="_blank" rel="noreferrer" className={cn("inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground")}>
              PR <ExternalLink className="size-3" />
            </a>
          ) : null}
          {openBtn}
        </>
      );
    // decomposition / design / clarify need their rich native UI to act on.
    default:
      return (
        <Button variant="secondary" size="sm" className="h-7 px-2.5 text-xs" onClick={() => open(d)}>
          Review in Auto-runs
        </Button>
      );
  }
}
