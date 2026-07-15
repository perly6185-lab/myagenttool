/*
 * Mail write routes (Phase 3, #979). The first governed GitHub write: create or
 * comment an issue from an imported mail message, approval-gated on the
 * Message-ID idempotency key.
 */

export async function handleMailRoutes({ req, res, url, sendJson, readJson, actor, createMailIssueFromImport }) {
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
  return false;
}
