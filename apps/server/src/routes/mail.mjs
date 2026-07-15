/*
 * Mail write routes (Phase 3, #979). The first governed GitHub write: create or
 * comment an issue from an imported mail message, approval-gated on the
 * Message-ID idempotency key.
 */

export async function handleMailRoutes({ req, res, url, sendJson, readJson, actor, createMailIssueFromImport, createReplyDraft }) {
  if (req.method === "POST" && url.pathname === "/api/mail/issues") {
    const body = await readJson(req);
    // The client names a Message-ID; the issue body is the server's transcription
    // of its own imported record, never client-supplied text.
    const result = await createMailIssueFromImport({
      messageId: body?.messageId,
      approvalToken: body?.approvalToken,
      actor,
    });
    sendJson(res, result.status, result.body);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/mail/drafts") {
    const body = await readJson(req);
    // `body.body` is the TRUSTED reply text (the resolution), not the original.
    // The draft is inert — there is no send route (ADR 0010/0011).
    const result = createReplyDraft({ messageId: body?.messageId, body: body?.body, actor });
    sendJson(res, result.status, result.body);
    return true;
  }
  return false;
}
