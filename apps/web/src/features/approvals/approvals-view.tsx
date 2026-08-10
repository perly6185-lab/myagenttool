import { useEffect, useRef, useState } from "react";
import { AppWindow, Bot, ExternalLink, GitMerge, Hand, HelpCircle, Inbox, ListChecks, Loader2, MessagesSquare, RotateCcw, Route, ShieldAlert, Sparkles, Trophy, Wrench, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { cn } from "@/lib/cn";
import { useConsoleState, useRefreshConsoleState } from "@/data/use-console-state";
import { api, useAsyncAction } from "@/data/use-console-actions";
import { useUiStore, type SectionKey } from "@/store/ui-store";
import type { PendingDecision, PendingDecisionKind } from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { focusQueryTarget } from "@/lib/focus-query";
import { approvalBrokerApi } from "./approval-broker-api";
import {
  ApprovalApplyAuthorizationsPanel as ApplyAuthorizationsPanel,
  ApprovalProposalsPanel as ProposalsPanel,
} from "./approval-patch-panels";

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
  agent_broker: { icon: Bot, label: "Agent" },
  application_recovery: { icon: AppWindow, label: "Recovery" },
  lifecycle_approval: { icon: Wrench, label: "Lifecycle" },
  lifecycle_rollback: { icon: RotateCcw, label: "Rollback" },
  channel_task: { icon: MessagesSquare, label: "Channel task" },
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
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const refresh = useRefreshConsoleState();
  const { execute, pending, error } = useAsyncAction();
  const setSection = useUiStore((s) => s.setSection);
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const setSelectedApplicationId = useUiStore((s) => s.setSelectedApplicationId);
  const [focusedApprovalId, setFocusedApprovalId] = useState<string | null>(null);
  const focusedDecisionRef = useRef<HTMLLIElement>(null);
  const didFocusApprovalRef = useRef(false);

  const decisions = state?.pendingDecisions ?? [];

  useEffect(() => {
    const focus = focusQueryTarget(window.location.href, "approval");
    if (!focus) return;
    setFocusedApprovalId(focus.id);
    window.history.replaceState(window.history.state, "", focus.nextLocation);
  }, []);

  useEffect(() => {
    if (!focusedApprovalId || didFocusApprovalRef.current) return;
    const target = focusedDecisionRef.current;
    if (!target) return;
    didFocusApprovalRef.current = true;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.focus({ preventScroll: true });
  }, [decisions, focusedApprovalId]);

  // #1151: a decision that raced another operator answers 200 + alreadyDecided
  // instead of an indistinguishable success — tell the loser who won and when.
  const [decidedNote, setDecidedNote] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => {
    // execute() reports only success/failure; capture the response body here so
    // a raced decision's alreadyDecided payload can be surfaced.
    let result: unknown;
    const ok = await execute(async () => {
      result = await fn();
      return result;
    });
    if (ok) {
      const ad = (result as { alreadyDecided?: { decidedBy?: string | null; decidedAt?: string | null; status?: string | null } } | undefined)?.alreadyDecided;
      setDecidedNote(
        ad
          ? t("approvals.alreadyDecided", { status: ad.status ? ` (${ad.status})` : "", actor: ad.decidedBy ?? t("approvals.someoneElse"), time: ad.decidedAt ? ` ${t("approvals.at")} ${ad.decidedAt.replace("T", " ").slice(0, 16)}` : "" })
          : null,
      );
      void refresh();
    }
  };

  // Deep-link to the native surface for full context; select the invocation when
  // the target is invocation-scoped so the user lands on the right row.
  const open = (d: PendingDecision) => {
    if (d.ref?.invocationId && d.section === "invocations") setSelectedInvocationId(d.ref.invocationId);
    if (d.section === "applications" && d.targetId) setSelectedApplicationId(d.targetId);
    setSection(d.section as SectionKey);
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <Inbox className="size-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">{t("approvals.title")}</h1>
        <Badge tone={decisions.length ? "warning" : "neutral"}>{t("approvals.pending", { count: decisions.length })}</Badge>
        <span className="ml-auto text-xs text-muted-foreground">{t("approvals.oldestFirst")}</span>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {decidedNote ? <p className="text-sm text-muted-foreground">{decidedNote}</p> : null}

      {state?.approvalTokenLegacyUses ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
          <span className="font-medium">{t("approvals.grants")}</span>
          {state.approvalTokenLegacyUses.count > 0 ? (
            <Badge tone="warning">
              {t("approvals.legacyUses", { count: state.approvalTokenLegacyUses.count })}
              {state.approvalTokenLegacyUses.lastAt ? ` · ${t("approvals.last", { date: state.approvalTokenLegacyUses.lastAt.slice(0, 10) })}` : ""}
            </Badge>
          ) : (
            <Badge tone="success">{t("approvals.noLegacy")}</Badge>
          )}
          <span className="text-muted-foreground">
            {state.approvalTokenLegacyUses.count > 0
              ? t("approvals.legacyHint")
              : t("approvals.strictHint")}
          </span>
        </div>
      ) : null}

      <ProposalsPanel
        invocations={state?.invocations ?? []}
        authorizations={state?.claudeApplyAuthorizations ?? []}
        worktrees={state?.worktrees ?? []}
        pending={pending}
        act={act}
      />

      <ApplyAuthorizationsPanel
        rows={state?.claudeApplyAuthorizations ?? []}
        pending={pending}
        act={act}
      />

      {decisions.length === 0 ? (
        <EmptyState title={t("approvals.empty")} hint={t("approvals.emptyHint")} />
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {decisions.map((d) => {
            const meta = KIND_META[d.kind];
            const Icon = meta?.icon ?? Inbox;
            const age = since(d.createdAt);
            const focused = focusedApprovalId != null
              && (d.id === focusedApprovalId || d.ref?.approvalId === focusedApprovalId);
            return (
              <li
                key={d.id}
                ref={focused ? focusedDecisionRef : undefined}
                tabIndex={focused ? -1 : undefined}
                aria-current={focused ? "true" : undefined}
                className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Card className={cn(focused && "border-primary ring-2 ring-primary/20")}>
                  <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{d.title}</span>
                        <Badge tone="neutral" className="shrink-0">{t(`approvals.kind.${d.kind}` as never)}</Badge>
                        {d.softClaim?.claimedBy ? (
                          <Badge tone="warning" className="shrink-0">
                            <Hand className="mr-1 size-3" />
                            {t("approvals.handling")} · {d.softClaim.claimedBy}
                          </Badge>
                        ) : null}
                        {age ? <span className="shrink-0 text-xs text-muted-foreground">{age}</span> : null}
                      </div>
                      {d.subtitle ? <p className="truncate text-xs text-muted-foreground">{d.subtitle}</p> : null}
                      {d.kind === "invocation_approval" && d.context ? (
                        <div className="mt-2 grid gap-1 rounded-md border border-border bg-muted/30 p-2 text-xs md:grid-cols-2">
                          <div>
                            <span className="text-muted-foreground">{t("integrationsPage.command")}</span>
                            <code className="block break-all">{[d.context.command, ...(d.context.arguments ?? [])].filter(Boolean).join(" ") || "—"}</code>
                          </div>
                          <div>
                            <span className="text-muted-foreground">{t("integrationsPage.workingDirectory")}</span>
                            <code className="block break-all">{d.context.workingDirectory ?? "—"}</code>
                          </div>
                          <div>
                            <span className="text-muted-foreground">{t("capabilityRun.files")}</span>
                            <span className="block">{d.context.pathPolicy ?? "—"}{d.context.worktreeId ? ` · ${d.context.worktreeId}` : ""}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">{t("applicationInspectorDeep.result")}</span>
                            <span className="block break-words">{d.context.impactScope?.join(", ") || "—"}</span>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {/* #1151 soft-claim: advisory — marks the row, never gates the buttons. */}
                      {d.softClaim ? (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={pending} title={t("approvals.releaseHint", { actor: d.softClaim.claimedBy ?? t("approvals.someone") })} onClick={() => act(() => api.releaseDecisionClaim(d.id))}>
                          <Hand className="mr-1 size-3" />{t("approvals.release")}
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={pending} title={t("approvals.handleHint")} onClick={() => act(() => api.claimDecision(d.id))}>
                          <Hand className="mr-1 size-3" />{t("approvals.handle")}
                        </Button>
                      )}
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
  const { t } = useAppTranslation();
  const spin = pending ? <Loader2 className="mr-1 size-3 animate-spin" /> : null;
  const openBtn = (
    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => open(d)}>
      {t("approvals.open")}
    </Button>
  );

  switch (d.kind) {
    case "invocation_approval":
      return (
        <>
          <Button variant="primary" size="sm" className="h-7 px-2.5 text-xs" disabled={pending} onClick={() => d.ref?.approvalId && act(() => api.approveApproval(d.ref!.approvalId!))}>
            {spin}{t("approvals.approve")}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={pending} onClick={() => d.ref?.approvalId && act(() => api.denyApproval(d.ref!.approvalId!))}>
            {t("approvals.deny")}
          </Button>
          {openBtn}
        </>
      );
    // Application recovery approvals resolve through the same broker endpoints as
    // codex_broker rows — only the labeling and deep link differ.
    case "application_recovery":
    case "codex_broker":
    case "agent_broker":
      if (d.kind === "codex_broker" && d.ref?.timedOut) {
        const recoveryInProgress = ["requested", "waiting_for_terminal", "starting"].includes(d.ref.recoveryStatus ?? "");
        return (
          <>
            {recoveryInProgress ? (
              <Badge tone="warning">{t("approvals.resuming")}</Badge>
            ) : (
              <Button variant="primary" size="sm" className="h-7 px-2.5 text-xs" disabled={pending} onClick={() => d.ref?.requestId && act(() => approvalBrokerApi.approve(d.ref!.requestId!))}>
                {spin}{t("approvals.approveAndResume")}
              </Button>
            )}
            {openBtn}
          </>
        );
      }
      return (
        <>
          <Button variant="primary" size="sm" className="h-7 px-2.5 text-xs" disabled={pending} onClick={() => d.ref?.requestId && act(() => approvalBrokerApi.approve(d.ref!.requestId!))}>
            {spin}{t("approvals.approve")}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={pending} onClick={() => d.ref?.requestId && act(() => approvalBrokerApi.deny(d.ref!.requestId!))}>
            {t("approvals.deny")}
          </Button>
          {openBtn}
        </>
      );
    case "lifecycle_approval":
      return (
        <>
          <Button variant="primary" size="sm" className="h-7 px-2.5 text-xs" disabled={pending} onClick={() => d.ref?.approvalId && act(() => api.approveLifecycleApproval(d.ref!.approvalId!))}>
            {spin}{t("approvals.approve")}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={pending} onClick={() => d.ref?.approvalId && act(() => api.denyLifecycleApproval(d.ref!.approvalId!))}>
            {t("approvals.deny")}
          </Button>
          {openBtn}
        </>
      );
    case "lifecycle_rollback":
      return (
        <>
          <Button variant="primary" size="sm" className="h-7 px-2.5 text-xs" disabled={pending} onClick={() => d.ref?.rollbackRequestId && act(() => api.queueLifecycleRollback(d.ref!.rollbackRequestId!))}>
            {spin}
            <RotateCcw className="mr-1 size-3" />{t("approvals.queueRollback")}
          </Button>
          {openBtn}
        </>
      );
    case "compare_promote":
      return (
        <>
          <Button variant="primary" size="sm" className="h-7 px-2.5 text-xs" disabled={pending} onClick={() => d.ref?.compareRunId && act(() => api.promoteCompareRun(d.ref!.compareRunId!))}>
            {spin}
            <Trophy className="mr-1 size-3" />{t("approvals.promote")}
          </Button>
          {openBtn}
        </>
      );
    case "merge":
      return (
        <>
          <Button variant="primary" size="sm" className="h-7 px-2.5 text-xs" disabled={pending} onClick={() => d.ref?.autoRunId && act(() => api.mergeAutoRunPr(d.ref!.autoRunId!))}>
            {spin}
            <GitMerge className="mr-1 size-3" />{t("approvals.merge")}
          </Button>
          {d.ref?.prUrl ? (
            <a href={d.ref.prUrl} target="_blank" rel="noreferrer" className={cn("inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground")}>
              PR <ExternalLink className="size-3" />
            </a>
          ) : null}
          {openBtn}
        </>
      );
    // Channel /task: a captured inbound request — Route starts a tracked auto-run,
    // Dismiss closes the issue.
    case "channel_task":
      return (
        <>
          <Button variant="primary" size="sm" className="h-7 px-2.5 text-xs" disabled={pending} onClick={() => d.ref?.channelTaskRequestId && act(() => api.routeChannelTask(d.ref!.channelTaskRequestId!))}>
            {spin}
            <Route className="mr-1 size-3" />{t("approvals.route")}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={pending} onClick={() => d.ref?.channelTaskRequestId && act(() => api.dismissChannelTask(d.ref!.channelTaskRequestId!))}>
            {t("approvals.dismiss")}
          </Button>
          {d.ref?.issueUrl ? (
            <a href={d.ref.issueUrl} target="_blank" rel="noreferrer" className={cn("inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground")}>
              Issue <ExternalLink className="size-3" />
            </a>
          ) : null}
        </>
      );
    // decomposition / design / clarify need their rich native UI to act on.
    default:
      return (
        <Button variant="secondary" size="sm" className="h-7 px-2.5 text-xs" onClick={() => open(d)}>
          {t("approvals.reviewAutoRuns")}
        </Button>
      );
  }
}
