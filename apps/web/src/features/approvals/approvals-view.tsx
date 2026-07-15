import { useState } from "react";
import { AppWindow, Bot, ExternalLink, GitMerge, HelpCircle, Inbox, ListChecks, Loader2, PenLine, RotateCcw, ShieldAlert, Sparkles, Trophy, Wrench, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { cn } from "@/lib/cn";
import { useConsoleState, useRefreshConsoleState } from "@/data/use-console-state";
import { api, useAsyncAction } from "@/data/use-console-actions";
import { useUiStore, type SectionKey } from "@/store/ui-store";
import type { ClaudeApplyAuthorization, InvocationSnapshot, PendingDecision, PendingDecisionKind, WorktreeSnapshot } from "@/lib/console-state";
import { RunTranscriptSection } from "@/features/invocations/run-transcript";

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
  application_recovery: { icon: AppWindow, label: "Recovery" },
  lifecycle_approval: { icon: Wrench, label: "Lifecycle" },
  lifecycle_rollback: { icon: RotateCcw, label: "Rollback" },
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
  const setSelectedApplicationId = useUiStore((s) => s.setSelectedApplicationId);

  const decisions = state?.pendingDecisions ?? [];

  const act = async (fn: () => Promise<unknown>) => {
    if (await execute(fn)) void refresh();
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
        <h1 className="text-lg font-semibold">Approvals</h1>
        <Badge tone={decisions.length ? "warning" : "neutral"}>{decisions.length} pending</Badge>
        <span className="ml-auto text-xs text-muted-foreground">Every human decision, oldest first</span>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {state?.approvalTokenLegacyUses ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
          <span className="font-medium">Approval grants</span>
          {state.approvalTokenLegacyUses.count > 0 ? (
            <Badge tone="warning">
              {state.approvalTokenLegacyUses.count} legacy token use(s)
              {state.approvalTokenLegacyUses.lastAt ? ` · last ${state.approvalTokenLegacyUses.lastAt.slice(0, 10)}` : ""}
            </Badge>
          ) : (
            <Badge tone="success">no legacy token use — safe to require issued grants</Badge>
          )}
          <span className="text-muted-foreground">
            {state.approvalTokenLegacyUses.count > 0
              ? "Some callers still send free-text tokens; migrate them, then flip strict mode in Auto-run settings."
              : "Strict mode (require issued grants) can be enabled in Auto-run settings."}
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
    // Application recovery approvals resolve through the same broker endpoints as
    // codex_broker rows — only the labeling and deep link differ.
    case "application_recovery":
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
    case "lifecycle_rollback":
      return (
        <>
          <Button variant="primary" size="sm" className="h-7 px-2.5 text-xs" disabled={pending} onClick={() => d.ref?.rollbackRequestId && act(() => api.queueLifecycleRollback(d.ref!.rollbackRequestId!))}>
            {spin}
            <RotateCcw className="mr-1 size-3" />Queue rollback
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

// A completed claude.propose.patch invocation, narrowed from the untyped result
// output. The proposal artifact is the patch text + touched files + summary.
interface PatchProposal {
  invocationId: string;
  projectId?: string;
  worktreeId?: string | null;
  summary: string | null;
  patch: string;
  files: { path: string; action?: string }[];
  createdAt?: string;
}

function proposalOf(invocation: InvocationSnapshot): PatchProposal | null {
  const metadata = invocation.options?.metadata as { tool?: string; worktreeId?: string; projectId?: string } | undefined;
  if (metadata?.tool !== "claude.propose.patch" || invocation.status !== "succeeded") return null;
  const output = invocation.result?.output as { patch?: unknown; summary?: unknown; files?: unknown } | undefined;
  if (!output || typeof output.patch !== "string" || !output.patch.trim()) return null;
  const files = Array.isArray(output.files)
    ? (output.files as { path?: unknown; action?: unknown }[])
        .map((f) => ({ path: String(f?.path ?? ""), action: typeof f?.action === "string" ? f.action : undefined }))
        .filter((f) => f.path)
    : [];
  return {
    invocationId: invocation.id,
    projectId: invocation.projectId ?? metadata.projectId,
    worktreeId: invocation.worktreeId ?? metadata.worktreeId ?? null,
    summary: typeof output.summary === "string" ? output.summary : null,
    patch: output.patch,
    files,
    createdAt: invocation.createdAt,
  };
}

// Post-apply verification choices: allowlisted command IDs only (the server and
// the runner each validate independently); "" = no verification.
const VERIFY_CHOICES: { value: string; label: string }[] = [
  { value: "", label: "no verification" },
  { value: "node-test", label: "verify: node --test" },
];

// Patch proposals (Phase 3): compose a new proposal from a worktree + task, browse
// what Claude proposed, then approve → apply in one action — the click mints a
// single-use grant for (apply_patch, proposal) and invokes claude.apply.patch,
// optionally with an allowlisted post-apply verification. A proposal already
// moving through the apply lifecycle shows its status instead; a failed or
// rolled-back apply may be re-applied (a fresh grant each time).
function ProposalsPanel({
  invocations,
  authorizations,
  worktrees,
  pending,
  act,
}: {
  invocations: InvocationSnapshot[];
  authorizations: ClaudeApplyAuthorization[];
  worktrees: WorktreeSnapshot[];
  pending: boolean;
  act: (fn: () => Promise<unknown>) => void;
}) {
  const [composing, setComposing] = useState(false);
  const proposals = invocations.map(proposalOf).filter((p): p is PatchProposal => p !== null);
  const composable = worktrees.filter((w) => !w.isMain);
  if (!proposals.length && !composable.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Patch proposals</h2>
        <Badge tone="neutral">{proposals.length}</Badge>
        <span className="text-xs text-muted-foreground">Claude-proposed changes — nothing is applied without an approval grant</span>
        {composable.length ? (
          <Button variant="secondary" size="sm" className="ml-auto h-7 px-2 text-xs" onClick={() => setComposing((v) => !v)}>
            <PenLine className="mr-1 size-3" />
            New proposal
          </Button>
        ) : null}
      </div>
      {composing ? (
        <ComposeProposal
          worktrees={composable}
          pending={pending}
          onSubmit={(body) => {
            act(() => api.invokeCapability("claude.propose.patch", body));
            setComposing(false);
          }}
        />
      ) : null}
      {proposals.length ? (
        <ul className="flex flex-col gap-2">
          {proposals.map((proposal) => (
            <ProposalRow
              key={proposal.invocationId}
              proposal={proposal}
              // Authorizations are newest-first; the first match is the current lifecycle.
              authorization={authorizations.find((a) => a.proposalInvocationId === proposal.invocationId) ?? null}
              pending={pending}
              act={act}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// Compose a new claude.propose.patch run: pick a worktree, describe the change.
// Proposal generation is read-only (plan mode) so it needs no approval grant;
// the governed propose agent must be registered or the server answers
// agent_not_available, surfaced through the shared action error line.
function ComposeProposal({
  worktrees,
  pending,
  onSubmit,
}: {
  worktrees: WorktreeSnapshot[];
  pending: boolean;
  onSubmit: (body: Record<string, string>) => void;
}) {
  const [worktreeId, setWorktreeId] = useState(worktrees[0]?.id ?? "");
  const [task, setTask] = useState("");
  const worktree = worktrees.find((w) => w.id === worktreeId) ?? null;
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 py-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="text-muted-foreground" htmlFor="proposal-worktree">Worktree</label>
          <select
            id="proposal-worktree"
            className="h-7 rounded-md border border-border bg-background px-2 text-xs"
            value={worktreeId}
            onChange={(event) => setWorktreeId(event.target.value)}
          >
            {worktrees.map((w) => (
              <option key={w.id} value={w.id}>{w.branch}</option>
            ))}
          </select>
        </div>
        <textarea
          className="min-h-16 w-full rounded-md border border-border bg-background p-2 text-xs"
          placeholder="What change should Claude propose? (e.g. Add a null guard to the parser.)"
          value={task}
          maxLength={4000}
          onChange={(event) => setTask(event.target.value)}
        />
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            className="h-7 px-2.5 text-xs"
            disabled={pending || !task.trim() || !worktree}
            onClick={() =>
              worktree && onSubmit({
                projectId: worktree.projectId,
                worktreeId: worktree.id,
                task: task.trim(),
              })
            }
          >
            {pending ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Sparkles className="mr-1 size-3" />}
            Propose
          </Button>
          <span className="text-xs text-muted-foreground">Read-only: Claude proposes a diff, nothing is written.</span>
        </div>
      </CardContent>
    </Card>
  );
}

function ProposalRow({
  proposal,
  authorization,
  pending,
  act,
}: {
  proposal: PatchProposal;
  authorization: ClaudeApplyAuthorization | null;
  pending: boolean;
  act: (fn: () => Promise<unknown>) => void;
}) {
  const [verify, setVerify] = useState("");
  const applicable = !authorization || authorization.status === "failed" || authorization.status === "rolled_back";
  return (
    <li>
      <Card>
        <CardContent className="flex flex-col gap-2 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">proposal</Badge>
            <span className="min-w-0 flex-1 truncate text-sm">
              {proposal.summary ?? `Proposal ${proposal.invocationId}`}
            </span>
            {authorization ? (
              <Badge tone={APPLY_STATUS_TONE[authorization.status] ?? "neutral"}>{authorization.status.replaceAll("_", " ")}</Badge>
            ) : null}
            {applicable && proposal.worktreeId ? (
              <>
                <select
                  aria-label="Post-apply verification"
                  className="h-7 rounded-md border border-border bg-background px-1.5 text-xs"
                  value={verify}
                  onChange={(event) => setVerify(event.target.value)}
                >
                  {VERIFY_CHOICES.map((choice) => (
                    <option key={choice.value} value={choice.value}>{choice.label}</option>
                  ))}
                </select>
                <Button
                  variant="primary"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  disabled={pending}
                  onClick={() =>
                    act(async () => {
                      const grant = await api.issueApprovalGrant("apply_patch", proposal.invocationId);
                      return api.invokeCapability("claude.apply.patch", {
                        ...(proposal.projectId ? { projectId: proposal.projectId } : {}),
                        worktreeId: proposal.worktreeId!,
                        proposalInvocationId: proposal.invocationId,
                        approvalToken: grant.token,
                        ...(verify ? { verify } : {}),
                      });
                    })
                  }
                >
                  {pending ? <Loader2 className="mr-1 size-3 animate-spin" /> : <ShieldAlert className="mr-1 size-3" />}
                  Approve &amp; apply
                </Button>
              </>
            ) : null}
          </div>
          {proposal.files.length ? (
            <div className="text-xs text-muted-foreground">
              <span className="truncate">{proposal.files.map((f) => f.path).join(", ")}</span>
            </div>
          ) : null}
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Proposed patch</summary>
            <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[11px] leading-4">{proposal.patch.slice(0, 20000)}</pre>
          </details>
          {/* #1086: how the agent arrived at this patch — read before approving.
              Proposals only exist for succeeded runs, so the fetch is safe. */}
          <RunTranscriptSection invocationId={proposal.invocationId} defaultOpen={false} />
        </CardContent>
      </Card>
    </li>
  );
}

const APPLY_STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  authorized: "neutral",
  applying: "warning",
  applied: "success",
  failed: "danger",
  rolling_back: "warning",
  rolled_back: "neutral",
};

// Claude patch-apply authorizations (governance Phase 4, #914): each row is a
// grant-consumed apply bound to a proposal. An `applied` row offers the governed
// rollback — the click mints a fresh single-use grant for (rollback_patch, id)
// and the bridge runner re-applies the same server-held patch with --reverse.
function ApplyAuthorizationsPanel({
  rows,
  pending,
  act,
}: {
  rows: ClaudeApplyAuthorization[];
  pending: boolean;
  act: (fn: () => Promise<unknown>) => void;
}) {
  if (!rows.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Patch applies</h2>
        <Badge tone="neutral">{rows.length}</Badge>
        <span className="text-xs text-muted-foreground">Approval-bound Claude patch applies and their rollback state</span>
      </div>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => {
          const files = (row.appliedFiles?.length ? row.appliedFiles : row.files) ?? [];
          return (
            <li key={row.id}>
              <Card>
                <CardContent className="flex flex-col gap-2 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={APPLY_STATUS_TONE[row.status] ?? "neutral"}>{row.status.replaceAll("_", " ")}</Badge>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {row.summary ?? row.resultSummary ?? `Patch for proposal ${row.proposalInvocationId}`}
                    </span>
                    {row.status === "applied" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={pending}
                        onClick={() =>
                          act(async () => {
                            const grant = await api.issueApprovalGrant("rollback_patch", row.id);
                            return api.rollbackClaudeApply(row.id, grant.token);
                          })
                        }
                      >
                        {pending ? <Loader2 className="mr-1 size-3 animate-spin" /> : <RotateCcw className="mr-1 size-3" />}
                        Roll back
                      </Button>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {files.length ? <span className="truncate">{files.map((f) => f.path).join(", ")}</span> : null}
                    {row.verification?.testsPassed !== undefined ? (
                      <Badge tone={row.verification.testsPassed ? "success" : "danger"}>
                        {row.verification.testsPassed ? "tests passed" : "tests failed"}
                        {row.verification.verifyCommand ? ` · ${row.verification.verifyCommand}` : ""}
                      </Badge>
                    ) : null}
                    {row.rolledBackAt ? <span>rolled back {row.rolledBackAt.slice(0, 10)}</span> : null}
                    {row.rollbackError ? <span className="text-destructive">rollback failed: {row.rollbackError}</span> : null}
                  </div>
                  {row.verification?.testsPassed === false && row.verification.testOutputPreview ? (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-destructive">Verification output</summary>
                      <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[11px] leading-4">{row.verification.testOutputPreview}</pre>
                    </details>
                  ) : null}
                  {row.patchPreview ? (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">Patch preview</summary>
                      <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[11px] leading-4">{row.patchPreview}</pre>
                    </details>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
