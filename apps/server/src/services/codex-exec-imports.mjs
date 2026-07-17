import { teamOf } from "../runtime/auth.mjs";
import { isGovernedCodexExecAgent } from "./codex-agent.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

const MAX_CODEX_EXEC_CHANGES = 1000;
const MAX_CHANGES_PER_RUN = 1000;

// Imports the git-derived changeset a governed codex.exec run produced in its
// worktree. Mirrors codex-review-imports: the wrapper reports the AUTHORITATIVE
// changes (from `git status`/`git diff` in the worktree, not the model's self
// report); we store bounded, redacted rows keyed to the invocation.
export function createCodexExecImportService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon = () => {},
  store,
}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  function recordCodexExecChanges({ invocation, result, agent }) {
    if (!isGovernedCodexExecAgent(agent) || !isCodexExecResult(result)) {
      return [];
    }
    const allChanges = normalizeChanges(result.output.changes);
    const droppedChangeCount = Math.max(0, allChanges.length - MAX_CHANGES_PER_RUN);
    const changes = allChanges.slice(0, MAX_CHANGES_PER_RUN);
    if (!changes.length) {
      return [];
    }
    const createdAt = now();
    const records = changes.map((change, index) => ({
      id: nextId("cec_demo"),
      source: "codex",
      execInvocationId: invocation.id,
      invocationId: invocation.id,
      projectId: invocation.projectId ?? invocation.options?.metadata?.projectId ?? null,
      worktreeId: invocation.worktreeId ?? invocation.options?.metadata?.worktreeId ?? null,
      requestedBy: invocation.requestedBy ?? null,
      agentId: invocation.agentId ?? null,
      execAgentName: agent?.name ?? null,
      tool: "codex.exec",
      mode: String(result.output.mode ?? "edit"),
      task: stringOrNull(result.output.task),
      summary: stringOrNull(result.output.summary ?? result.summary),
      changeIndex: index,
      file: change.file,
      action: change.action,
      diffPreview: change.diffPreview,
      changeRisk: change.changeRisk,
      changeSummary: change.summary,
      authoritative: false,
      raw: change.raw,
      createdAt,
    }));
    runTx(() => {
      state.codexExecChanges.unshift(...records);
      state.codexExecChanges = state.codexExecChanges.slice(0, MAX_CODEX_EXEC_CHANGES);
      appendEvent({
        invocationId: invocation.id,
        type: "codex_exec_changes_recorded",
        level: "info",
        message: `Imported ${records.length} Codex exec change(s).`,
        data: {
          codexExecChangeIds: records.map((record) => record.id),
          tool: "codex.exec",
          authoritative: false,
          droppedChangeCount,
        },
      });
    });
    return records;
  }

  // True when the exec change's project belongs to a team the actor doesn't own.
  // A null actor (unscoped/local dev) never treats a row as foreign.
  function isForeignExecChange(change, actor) {
    if (!actor) return false;
    const projectId = change?.projectId
      ?? (state.invocations ?? []).find((item) => item.id === change?.invocationId)?.projectId
      ?? null;
    const project = projectId ? (state.projects ?? []).find((p) => p.id === projectId) : null;
    return Boolean(project) && teamOf(project) !== actor.teamId;
  }

  // Phase 2b: a human reviews a governed exec changeset row. Reject/approve/feedback
  // is recorded and gates a later promote (isExecChangeApproved). Tenancy mirrors
  // createCodexChangeReview: a foreign-team change is rejected with the SAME error as
  // an unknown id, so a cross-team caller can't tell them apart (no existence leak).
  function createCodexExecReview(body, actor = null) {
    const execChangeId = String(body?.execChangeId ?? "").trim();
    const change = state.codexExecChanges.find((item) => item.id === execChangeId);
    if (!change || isForeignExecChange(change, actor)) {
      throw new Error("execChangeId must reference a Codex exec change.");
    }
    const decision = normalizeExecReviewDecision(body?.decision);
    const comment = String(body?.comment ?? "").trim();
    if (decision === "feedback" && !comment) {
      throw new Error("comment is required when sending feedback.");
    }
    const createdAt = now();
    const review = {
      id: nextId("cecr_demo"),
      execChangeId: change.id,
      invocationId: change.invocationId,
      projectId: change.projectId ?? null,
      worktreeId: change.worktreeId ?? null,
      file: change.file,
      action: change.action,
      changeRisk: change.changeRisk ?? "unknown",
      decision,
      comment: comment.length <= 1000 ? comment : `${comment.slice(0, 997)}...`,
      // Feedback/rejected reviews carry a ready-to-run follow-up prompt. Because
      // the worktree model is REUSE (not fresh-per-call), the caller re-invokes
      // codex.exec with the SAME worktreeId and this prompt, and the fix
      // accumulates in place on top of the reviewed change.
      followUpPrompt: decision === "approved" ? null : execChangeFollowUpPrompt(change, comment),
      reviewedBy: actor?.userId ?? "usr_local",
      auditState: "recorded",
      createdAt,
    };
    return runTx(() => {
      state.codexExecChangeReviews.unshift(review);
      appendEvent({
        invocationId: change.invocationId,
        type: decision === "feedback" ? "codex_exec_change_feedback_requested" : "codex_exec_change_reviewed",
        level: decision === "rejected" ? "warn" : "info",
        message: execReviewMessage(review),
        data: { codexExecChangeReviewId: review.id, execChangeId: change.id, decision, followUpPrompt: review.followUpPrompt },
      });
      return review;
    });
  }

  // The change is promotable only when its most recent review approved it. A
  // rejected/feedback (or unreviewed) change is not approved — Phase 3 promote
  // gates on this.
  function isExecChangeApproved(execChangeId) {
    const review = state.codexExecChangeReviews.find((item) => item.execChangeId === execChangeId);
    return review?.decision === "approved";
  }

  // Phase 3 gate: an exec run's changeset is promotable only when it produced at
  // least one change and EVERY change has been approved. Returns the unapproved
  // files so the caller can report exactly what still needs review — a partially
  // reviewed changeset must never reach a PR.
  function execRunPromotionGate(invocationId) {
    const changes = (state.codexExecChanges ?? []).filter((change) => change.invocationId === invocationId);
    if (changes.length === 0) {
      return { ok: false, reason: "no_changes", changes, unapproved: [] };
    }
    const unapproved = changes.filter((change) => !isExecChangeApproved(change.id));
    return {
      ok: unapproved.length === 0,
      reason: unapproved.length === 0 ? null : "changes_not_approved",
      changes,
      unapproved: unapproved.map((change) => ({ execChangeId: change.id, file: change.file, action: change.action })),
    };
  }

  return { recordCodexExecChanges, createCodexExecReview, isExecChangeApproved, execRunPromotionGate };
}

function normalizeExecReviewDecision(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["approved", "rejected", "feedback"].includes(normalized) ? normalized : "feedback";
}

function execReviewMessage(review) {
  if (review.decision === "approved") return `Codex exec change approved: ${review.action} ${review.file}.`;
  if (review.decision === "rejected") return `Codex exec change rejected: ${review.action} ${review.file}.`;
  return `Codex exec change feedback recorded for ${review.action} ${review.file}.`;
}

// A ready-to-run task for the follow-up codex.exec (same worktree, reuse model).
// Mirrors the managed-session codexChangeFollowUpPrompt shape.
function execChangeFollowUpPrompt(change, comment) {
  const trimmed = String(comment ?? "").replace(/\s+/g, " ").trim();
  const boundedComment = trimmed.length <= 500 ? trimmed : `${trimmed.slice(0, 497)}...`;
  return [
    "Follow up on a reviewed Codex exec change in this worktree.",
    `Change: ${change.action} ${change.file}`,
    boundedComment ? `Reviewer comment: ${boundedComment}` : "Address the reviewer's concerns.",
  ].join("\n");
}

function isCodexExecResult(result) {
  return result?.output?.source === "codex"
    && result.output.tool === "codex.exec"
    && !result.output.error;
}

function normalizeChanges(value) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      file: stringOrNull(item.file),
      action: enumValue(item.action, "modified", ["created", "modified", "deleted"]),
      diffPreview: stringOrNull(item.diffPreview),
      changeRisk: enumValue(item.changeRisk, "unknown", ["low", "medium", "high", "unknown"]),
      summary: stringOrNull(item.summary),
      raw: item,
    }))
    .filter((item) => item.file);
}

function enumValue(value, fallback, allowed) {
  const text = String(value ?? fallback).trim();
  return allowed.includes(text) ? text : fallback;
}

function stringOrNull(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}
