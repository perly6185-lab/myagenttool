/*
 * Reply-draft artifact (Phase 4, #979). The issue outcome becomes a reviewable
 * draft reply — and STOPS there. Sending is the exfiltration boundary (ADR 0011):
 * it is outbound, irreversible, speaks in the owner's name, and needs a SECOND,
 * separately consented write-scoped credential (gmail.send) that does not exist
 * (ADR 0010). So this slice produces an inert draft; there is no send path here,
 * by design — safe by absence.
 *
 * The one property that keeps this out of ADR 0011's hop 3: the reply body is
 * TRUSTED text (the resolution the operator/triage wrote), never the untrusted
 * original mail body. This service copies the original's threading headers and
 * addressee, but NOT its body — so an injection in the incoming mail cannot shape
 * an outgoing reply. That is asserted in the tests.
 */

import { makeRunTx } from "../runtime/store/run-tx.mjs";

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
}) {
  const runTx = makeRunTx({ store, persistStateSoon });

  function findImportedMessage(messageId) {
    const id = String(messageId ?? "").trim();
    if (!id) return null;
    return (state.applicationResults ?? []).find(
      (record) => record.source === "mail_headers" && record.data?.kind === "message" && record.data.messageId === id,
    ) ?? null;
  }

  /**
   * Build and store an inert reply draft for an imported message. `body` is the
   * TRUSTED reply text (the resolution) — it is the operator's/triage's words,
   * not the untrusted original. Returns { status, draft }.
   */
  function createReplyDraft({ messageId, body, actor = null } = {}) {
    const record = findImportedMessage(messageId);
    if (!record) {
      return { ok: false, status: 404, body: { error: "mail_message_not_imported", messageId: String(messageId ?? "") } };
    }
    if (actor?.teamId && record.ownerTeamId && record.ownerTeamId !== actor.teamId) {
      return { ok: false, status: 404, body: { error: "mail_message_not_imported", messageId: String(messageId ?? "") } };
    }
    const replyBody = cap(body, MAX_BODY);
    if (!replyBody || !replyBody.trim()) {
      return { ok: false, status: 422, body: { error: "reply_body_required", message: "A reply draft needs trusted body text (the resolution), not the original mail body." } };
    }

    const original = record.data;
    // Correct threading or the reply will not attach to the thread in the client:
    // In-Reply-To is the parent's Message-ID; References is the parent's chain
    // plus the parent itself.
    const references = [...(Array.isArray(original.references) ? original.references : []), original.messageId]
      .map((ref) => cap(ref, MAX_HEADER))
      .filter(Boolean)
      .slice(0, MAX_REFERENCES);
    const issueNumber = state.mailThreads?.[original.messageId]?.issueNumber ?? null;

    const draft = {
      id: nextId("maildraft"),
      status: "draft", // inert. There is no send action in this slice.
      to: cap(original.from, MAX_HEADER),
      subject: replySubject(original.subject),
      inReplyTo: cap(original.messageId, MAX_HEADER),
      references,
      body: replyBody,
      ownerTeamId: record.ownerTeamId ?? "team_local",
      provenance: {
        originalMessageId: original.messageId,
        issueNumber,
        transcriptionInvocationId: record.invocationId ?? null,
      },
      createdAt: now(),
      // The gate that would let this leave the machine, recorded but not built:
      // sending requires a separately consented gmail.send credential (ADR 0010)
      // and approval (ADR 0011). Until both exist, a draft cannot be sent.
      send: { available: false, requires: ["gmail.send credential (ADR 0010)", "approval (ADR 0011)"] },
    };

    runTx(() => {
      state.mailDrafts = state.mailDrafts ?? [];
      state.mailDrafts.unshift(draft);
      appendEvent({
        invocationId: null,
        type: "mail_reply_draft_created",
        level: "info",
        message: `Drafted a reply to ${draft.to ?? "(unknown)"} for mail ${original.messageId}${issueNumber ? ` (issue #${issueNumber})` : ""}.`,
        data: { draftId: draft.id, originalMessageId: original.messageId, issueNumber },
      });
    });

    return { ok: true, status: 201, body: { status: "draft", draft } };
  }

  return { createReplyDraft };
}
