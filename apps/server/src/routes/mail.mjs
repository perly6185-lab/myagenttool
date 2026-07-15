/*
 * Mail write routes (Phase 3, #979). The first governed GitHub write: create or
 * comment an issue from an imported mail message, approval-gated on the
 * Message-ID idempotency key.
 */

export async function handleMailRoutes({ req, res, url, sendJson, readJson, actor, createMailIssueFromImport, replyOnIssue, confirmReplyDraft }) {
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

  // Step 1 of the outbound flow: post the resolution on the mail-derived issue
  // for review (a GitHub write, approval-gated). `body.body` is TRUSTED reply
  // text (the resolution), not the untrusted original.
  if (req.method === "POST" && url.pathname === "/api/mail/replies") {
    const body = await readJson(req);
    const result = await replyOnIssue({ messageId: body?.messageId, body: body?.body, approvalToken: body?.approvalToken, actor });
    sendJson(res, result.status, result.body);
    return true;
  }

  // Step 2: after the issue reply is reviewed, confirm it into an inert outgoing
  // draft. No send route exists (ADR 0010/0011).
  const confirmMatch = url.pathname.match(/^\/api\/mail\/replies\/([^/]+)\/confirm$/);
  if (req.method === "POST" && confirmMatch) {
    const result = confirmReplyDraft({ replyId: decodeURIComponent(confirmMatch[1]), actor });
    sendJson(res, result.status, result.body);
    return true;
  }
  return false;
}
