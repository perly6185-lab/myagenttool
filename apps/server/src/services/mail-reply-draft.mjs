/*
 * Outbound reply flow (Phase 4, #979), in two gated steps:
 *
 *   1. replyOnIssue     — the resolution is posted as a comment on the
 *                         mail-derived issue (a GitHub write, approval-gated),
 *                         where a human can review it in context. Status:
 *                         "pending_review".
 *   2. confirmReplyDraft — only AFTER that review confirms it, the confirmed
 *                         reply becomes the outgoing-mail draft (the draftbox).
 *
 * A send draft therefore cannot be conjured from free text; it can only be the
 * mail form of a reply that was posted on the issue and confirmed. Sending
 * itself is still the exfiltration boundary and is NOT built: it needs a second,
 * separately consented gmail.send credential (ADR 0010) plus approval (ADR 0011).
 * The draft is inert — safe by absence.
 *
 * The property that keeps this out of ADR 0011's hop 3: the reply body is TRUSTED
 * text (the resolution the operator wrote), never the untrusted original mail
 * body. Threading headers and addressee are copied from the original; its body
 * is not. Asserted in the tests.
 */

import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { runIssueComment } from "./issue-status.mjs";

export const MAIL_ISSUE_REPLY_ACTION = "mail.issue.reply";

const MAX_BODY = 20000;
const MAX_SUBJECT = 400;
const MAX_HEADER = 998;
const MAX_REFERENCES = 50;

const cap = (value, max) => (typeof value === "string" ? value.slice(0, max) : null);

// "Re: x", "re:x", "RE: Re: x" -> a single "Re: x". Prevents "Re: Re: Re:".
function replySubject(subject) {
  const base = String(subject ?? "").replace(/^(\s*re\s*:\s*)+/i, "").trim();
  return cap(`Re: ${base || "(no subject)"}`, MAX_SUBJECT);
}

export function createMailReplyDraftService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon = () => {},
  store,
  validateApprovalToken,
  repoCwd,
  issueComment = runIssueComment,
}) {
  const runTx = makeRunTx({ store, persistStateSoon });

  function findImportedMessage(messageId) {
    const id = String(messageId ?? "").trim();
    if (!id) return null;
    return (state.applicationResults ?? []).find(
      (record) => record.source === "mail_headers" && record.data?.kind === "message" && record.data.messageId === id,
    ) ?? null;
  }

  function findReply(replyId) {
    return (state.mailReplies ?? []).find((reply) => reply.id === replyId) ?? null;
  }

  /**
   * Step 1: post the resolution on the mail-derived issue for review. `body` is
   * TRUSTED text (the resolution), not the untrusted original. A GitHub write,
   * so it is approval-gated. Requires the message to already have an issue
   * (Phase 3) — the reply goes ON the issue, so the issue must exist.
   */
  async function replyOnIssue({ messageId, body, approvalToken, actor = null } = {}) {
    const record = findImportedMessage(messageId);
    if (!record) {
      return { ok: false, status: 404, body: { error: "mail_message_not_imported", messageId: String(messageId ?? "") } };
    }
    if (actor?.teamId && record.ownerTeamId && record.ownerTeamId !== actor.teamId) {
      return { ok: false, status: 404, body: { error: "mail_message_not_imported", messageId: String(messageId ?? "") } };
    }
    // A positive integer — not just "finite": Number(null) is 0, which would let
    // a reply post against a non-existent issue #0.
    const issueNumber = state.mailThreads?.[record.data.messageId]?.issueNumber;
    if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
      return { ok: false, status: 409, body: { error: "issue_not_created", message: "Transcribe the mail to an issue before replying on it.", messageId: record.data.messageId } };
    }
    const replyBody = cap(body, MAX_BODY);
    if (!replyBody || !replyBody.trim()) {
      return { ok: false, status: 422, body: { error: "reply_body_required", message: "A reply needs trusted body text (the resolution), not the original mail body." } };
    }
    // Approval-gated GitHub write, like issue create, bound to this message.
    const targetId = record.data.messageId;
    const approval = typeof validateApprovalToken === "function"
      ? validateApprovalToken(approvalToken, { action: MAIL_ISSUE_REPLY_ACTION, targetId, actor })
      : { approved: false, reason: "approval_validator_unavailable" };
    if (!approval.approved) {
      return {
        ok: false,
        status: 409,
        body: {
          error: "approval_required",
          reason: approval.reason === "missing_token"
            ? "Replying on the issue requires an explicit approvalToken."
            : `approvalToken rejected: ${approval.reason}.`,
          action: MAIL_ISSUE_REPLY_ACTION,
          targetId,
        },
      };
    }

    // The comment marks itself as a proposed reply awaiting review — it is not a
    // sent email, and the issue is the place it gets reviewed.
    const comment = `**Proposed reply to ${cap(record.data.from, MAX_HEADER) ?? "the sender"}** (draft — not sent; review before it can become an outgoing draft):\n\n${replyBody}`;
    await issueComment({ cwd: repoCwd, issueNumber: Number(issueNumber), body: comment });

    const reply = {
      id: nextId("mailreply"),
      messageId: record.data.messageId,
      issueNumber: Number(issueNumber),
      body: replyBody,
      status: "pending_review",
      ownerTeamId: record.ownerTeamId ?? "team_local",
      createdAt: now(),
      confirmedAt: null,
      draftId: null,
    };
    runTx(() => {
      state.mailReplies = state.mailReplies ?? [];
      state.mailReplies.unshift(reply);
      appendEvent({
        invocationId: null,
        type: "mail_issue_reply_posted",
        level: "info",
        message: `Posted a proposed reply on issue #${reply.issueNumber} for mail ${reply.messageId} (awaiting review).`,
        data: { replyId: reply.id, issueNumber: reply.issueNumber, messageId: reply.messageId },
      });
    });
    return { ok: true, status: 201, body: { status: "pending_review", reply } };
  }

  /**
   * Step 2: after the issue reply is reviewed and confirmed, turn it into the
   * inert outgoing-mail draft. The draft is the mail form of a reply that lived
   * on the issue and passed review — never free text. Still no send.
   */
  function confirmReplyDraft({ replyId, actor = null } = {}) {
    const reply = findReply(replyId);
    if (!reply) {
      return { ok: false, status: 404, body: { error: "mail_reply_not_found", replyId: String(replyId ?? "") } };
    }
    if (actor?.teamId && reply.ownerTeamId && reply.ownerTeamId !== actor.teamId) {
      return { ok: false, status: 404, body: { error: "mail_reply_not_found", replyId: String(replyId ?? "") } };
    }
    if (reply.status !== "pending_review") {
      return { ok: false, status: 409, body: { error: "reply_not_pending_review", status: reply.status, replyId: reply.id } };
    }
    const record = findImportedMessage(reply.messageId);
    if (!record) {
      return { ok: false, status: 404, body: { error: "mail_message_not_imported", messageId: reply.messageId } };
    }
    const original = record.data;
    // Correct threading or the reply will not attach to the thread in the client:
    // In-Reply-To is the parent's Message-ID; References is the parent's chain
    // plus the parent itself.
    const references = [...(Array.isArray(original.references) ? original.references : []), original.messageId]
      .map((ref) => cap(ref, MAX_HEADER))
      .filter(Boolean)
      .slice(0, MAX_REFERENCES);

    const draft = {
      id: nextId("maildraft"),
      status: "draft", // inert. There is no send action.
      to: cap(original.from, MAX_HEADER),
      subject: replySubject(original.subject),
      inReplyTo: cap(original.messageId, MAX_HEADER),
      references,
      body: reply.body, // the CONFIRMED issue reply, verbatim — trusted text.
      ownerTeamId: reply.ownerTeamId,
      provenance: {
        originalMessageId: original.messageId,
        issueNumber: reply.issueNumber,
        replyId: reply.id,
        transcriptionInvocationId: record.invocationId ?? null,
      },
      createdAt: now(),
      send: { available: false, requires: ["gmail.send credential (ADR 0010)", "approval (ADR 0011)"] },
    };

    runTx(() => {
      state.mailDrafts = state.mailDrafts ?? [];
      state.mailDrafts.unshift(draft);
      reply.status = "confirmed";
      reply.confirmedAt = now();
      reply.draftId = draft.id;
      appendEvent({
        invocationId: null,
        type: "mail_reply_draft_created",
        level: "info",
        message: `Confirmed reply on issue #${reply.issueNumber} → outgoing draft to ${draft.to ?? "(unknown)"} for mail ${original.messageId}.`,
        data: { draftId: draft.id, replyId: reply.id, originalMessageId: original.messageId, issueNumber: reply.issueNumber },
      });
    });
    return { ok: true, status: 201, body: { status: "draft", draft } };
  }

  return { replyOnIssue, confirmReplyDraft };
}
