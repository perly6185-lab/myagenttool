/*
 * The first governed GitHub WRITE (Phase 3, #979): create/comment an issue from
 * an imported mail message. Approval-gated, idempotent, and driven from the
 * SERVER's own imported record — never from client-supplied text.
 *
 * Reuses the existing governed write primitives (runChildIssueCreate /
 * runIssueComment) rather than minting a new one. The authorization is an
 * approvalToken bound to (action, idempotencyKey), the same grant flow every
 * other side-effecting action uses.
 *
 * Two properties this holds, both load-bearing:
 *   1. The issue is transcribed from the imported record (the read loop's
 *      audited output), so a caller cannot inject arbitrary issue content
 *      through the write path. The client names a Message-ID; it does not supply
 *      a body.
 *   2. Idempotent by Message-ID. A re-request for an already-created issue is a
 *      no-op (no write, no approval consumed); a reply threads onto its existing
 *      issue as a comment. A re-poll never duplicates (ADR 0011 + #1047).
 */

import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { runChildIssueCreate } from "./auto-run-spawn.mjs";
import { runIssueComment } from "./issue-status.mjs";
import { resolveMailThread, transcribeMailToIssue } from "./mail-issue-transcription.mjs";

export const MAIL_ISSUE_CREATE_ACTION = "mail.issue.create";

export function createMailIssueWriteService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon = () => {},
  store,
  validateApprovalToken,
  repoCwd,
  // Injected in tests; the real primitives shell out to `gh`.
  issueCreate = runChildIssueCreate,
  issueComment = runIssueComment,
}) {
  // Durable writes commit through the Store unit of work (#1001), never a bare
  // persistStateSoon — the thread map is the idempotency ledger, and it must be
  // persisted atomically with the event that records the write.
  const runTx = makeRunTx({ store, persistStateSoon });
  function threadNumberMap() {
    const threads = state.mailThreads ?? {};
    const map = {};
    for (const [messageId, entry] of Object.entries(threads)) {
      const number = Number(entry?.issueNumber ?? entry);
      if (Number.isFinite(number)) map[messageId] = number;
    }
    return map;
  }

  function findImportedMessage(messageId) {
    const id = String(messageId ?? "").trim();
    if (!id) return null;
    return (state.applicationResults ?? []).find(
      (record) => record.source === "mail_headers" && record.data?.kind === "message" && record.data.messageId === id,
    ) ?? null;
  }

  function recordThread(messageId, issueNumber, { idempotencyKey, ownerTeamId }) {
    state.mailThreads = state.mailThreads ?? {};
    state.mailThreads[messageId] = { issueNumber, idempotencyKey, ownerTeamId: ownerTeamId ?? null, createdAt: now() };
  }

  /**
   * Create (or comment on) the issue for an imported mail message. `messageId`
   * names an imported `mail_fetch` record; the body is the server's, not the
   * caller's. Returns { status, issueNumber, url?, action }.
   */
  async function createMailIssueFromImport({ messageId, approvalToken, actor = null } = {}) {
    const record = findImportedMessage(messageId);
    if (!record) {
      return { ok: false, status: 404, body: { error: "mail_message_not_imported", messageId: String(messageId ?? "") } };
    }
    // Tenancy: the imported record is owned by the mail application's team.
    if (actor?.teamId && record.ownerTeamId && record.ownerTeamId !== actor.teamId) {
      return { ok: false, status: 404, body: { error: "mail_message_not_imported", messageId: String(messageId ?? "") } };
    }

    const message = record.data;
    const plan = transcribeMailToIssue(message, { invocationId: record.invocationId });
    if (!plan) {
      return { ok: false, status: 422, body: { error: "mail_message_not_transcribable", messageId: String(messageId ?? "") } };
    }

    const resolution = resolveMailThread(message, threadNumberMap());
    // Already created for this exact Message-ID: idempotent no-op. No write, no
    // approval consumed — a re-poll is not a new side effect.
    if (resolution.action === "noop") {
      return { ok: true, status: 200, body: { status: "noop", action: "noop", issueNumber: resolution.issueNumber, messageId: message.messageId } };
    }

    // Every real write is approval-gated on the idempotency key, so a grant
    // authorizes exactly this message's issue and no other.
    const approval = typeof validateApprovalToken === "function"
      ? validateApprovalToken(approvalToken, { action: MAIL_ISSUE_CREATE_ACTION, targetId: plan.idempotencyKey, actor })
      : { approved: false, reason: "approval_validator_unavailable" };
    if (!approval.approved) {
      return {
        ok: false,
        status: 409,
        body: {
          error: "approval_required",
          reason: approval.reason === "missing_token"
            ? "Creating an issue from mail requires an explicit approvalToken."
            : `approvalToken rejected: ${approval.reason}.`,
          action: MAIL_ISSUE_CREATE_ACTION,
          targetId: plan.idempotencyKey,
        },
      };
    }

    // The GitHub write happens OUTSIDE the tx (it is a network side effect, not a
    // state mutation); the tx then commits the thread-map entry + audit event
    // atomically. If the write throws, no thread entry is recorded and the next
    // attempt retries cleanly.
    if (resolution.action === "comment") {
      await issueComment({ cwd: repoCwd, issueNumber: resolution.issueNumber, body: plan.body });
      runTx(() => {
        // Map this reply's own Message-ID onto the thread too, so a
        // reply-to-the-reply also threads instead of opening a duplicate.
        recordThread(message.messageId, resolution.issueNumber, { idempotencyKey: plan.idempotencyKey, ownerTeamId: record.ownerTeamId });
        appendEvent({
          invocationId: null,
          type: "mail_issue_commented",
          level: plan.injection.suspicious ? "warn" : "info",
          message: `Commented on issue #${resolution.issueNumber} from mail ${message.messageId}.`,
          data: { issueNumber: resolution.issueNumber, messageId: message.messageId, injectionMarkers: plan.injection.markers },
        });
      });
      return { ok: true, status: 201, body: { status: "commented", action: "comment", issueNumber: resolution.issueNumber, messageId: message.messageId } };
    }

    // action === "create"
    const created = await issueCreate({ cwd: repoCwd, title: plan.title, body: plan.body, labels: plan.labels });
    runTx(() => {
      recordThread(message.messageId, created.number, { idempotencyKey: plan.idempotencyKey, ownerTeamId: record.ownerTeamId });
      appendEvent({
        invocationId: null,
        type: "mail_issue_created",
        level: plan.injection.suspicious ? "warn" : "info",
        message: `Created issue #${created.number} from mail ${message.messageId}${plan.injection.suspicious ? " (prompt injection flagged)" : ""}.`,
        data: { issueNumber: created.number, url: created.url, messageId: message.messageId, injectionMarkers: plan.injection.markers },
      });
    });
    return { ok: true, status: 201, body: { status: "created", action: "create", issueNumber: created.number, url: created.url, messageId: message.messageId } };
  }

  return { createMailIssueFromImport };
}
