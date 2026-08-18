import { useState } from "react";
import { Loader2, PenLine, RotateCcw, ShieldAlert, Sparkles } from "lucide-react";

import { RunTranscriptSection } from "@/features/invocations/run-transcript";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/data/use-console-actions";
import type { ClaudeApplyAuthorization, InvocationSnapshot, WorktreeSnapshot } from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { proposalFromInvocation, type PatchProposal } from "./approval-patch-model";

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
export function ApprovalProposalsPanel({
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
  const { t } = useAppTranslation();
  const [composing, setComposing] = useState(false);
  const proposals = invocations.map(proposalFromInvocation).filter((proposal): proposal is PatchProposal => proposal !== null);
  const composable = worktrees.filter((w) => !w.isMain);
  if (!proposals.length && !composable.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">{t("approvals.patchProposals")}</h2>
        <Badge tone="neutral">{proposals.length}</Badge>
        <span className="text-xs text-muted-foreground">{t("approvals.patchProposalsHint")}</span>
        {composable.length ? (
          <Button variant="secondary" size="sm" className="ml-auto h-7 px-2 text-xs" onClick={() => setComposing((v) => !v)}>
            <PenLine className="mr-1 size-3" />
            {t("approvals.newProposal")}
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
  const { t } = useAppTranslation();
  const [worktreeId, setWorktreeId] = useState(worktrees[0]?.id ?? "");
  const [task, setTask] = useState("");
  const worktree = worktrees.find((w) => w.id === worktreeId) ?? null;
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 py-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="text-muted-foreground" htmlFor="proposal-worktree">{t("approvals.worktree")}</label>
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
          placeholder={t("approvals.proposalPlaceholder")}
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
            {t("approvals.propose")}
          </Button>
          <span className="text-xs text-muted-foreground">{t("approvals.readOnlyHint")}</span>
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
  const { t } = useAppTranslation();
  const [verify, setVerify] = useState("");
  const applicable = !authorization || authorization.status === "failed" || authorization.status === "rolled_back";
  return (
    <li>
      <Card>
        <CardContent className="flex flex-col gap-2 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{t("approvals.proposal")}</Badge>
            <span className="min-w-0 flex-1 truncate text-sm">
              {proposal.summary ?? `Proposal ${proposal.invocationId}`}
            </span>
            {authorization ? (
              <Badge tone={APPLY_STATUS_TONE[authorization.status] ?? "neutral"}>{authorization.status.replaceAll("_", " ")}</Badge>
            ) : null}
            {applicable && proposal.worktreeId ? (
              <>
                <select
                  aria-label={t("approvals.postApplyVerification")}
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
                  {t("approvals.approveApply")}
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
            <summary className="cursor-pointer text-muted-foreground">{t("approvals.proposedPatch")}</summary>
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
export function ApprovalApplyAuthorizationsPanel({
  rows,
  pending,
  act,
}: {
  rows: ClaudeApplyAuthorization[];
  pending: boolean;
  act: (fn: () => Promise<unknown>) => void;
}) {
  const { t } = useAppTranslation();
  if (!rows.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">{t("approvals.patchApplies")}</h2>
        <Badge tone="neutral">{rows.length}</Badge>
        <span className="text-xs text-muted-foreground">{t("approvals.patchAppliesHint")}</span>
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
                        {t("approvals.rollback")}
                      </Button>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {files.length ? <span className="truncate">{files.map((f) => f.path).join(", ")}</span> : null}
                    {row.verification?.testsPassed !== undefined ? (
                      <Badge tone={row.verification.testsPassed ? "success" : "danger"}>
                        {row.verification.testsPassed ? t("approvals.testsPassed") : t("approvals.testsFailed")}
                        {row.verification.verifyCommand ? ` · ${row.verification.verifyCommand}` : ""}
                      </Badge>
                    ) : null}
                    {row.rolledBackAt ? <span>{t("approvals.rolledBack", { date: row.rolledBackAt.slice(0, 10) })}</span> : null}
                    {row.rollbackError ? <span className="text-destructive">{t("approvals.rollbackFailed")}: {row.rollbackError}</span> : null}
                  </div>
                  {row.verification?.testsPassed === false && row.verification.testOutputPreview ? (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-destructive">{t("approvals.verificationOutput")}</summary>
                      <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[11px] leading-4">{row.verification.testOutputPreview}</pre>
                    </details>
                  ) : null}
                  {row.patchPreview ? (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">{t("approvals.patchPreview")}</summary>
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
