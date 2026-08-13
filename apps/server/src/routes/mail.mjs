/*
 * Mail write routes (Phase 3, #979). The first governed GitHub write: create or
 * comment an issue from an imported mail message, approval-gated on the
 * Message-ID idempotency key.
 */

export async function handleMailRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  actor,
  createMailIssueFromImport,
  replyOnIssue,
  confirmReplyDraft,
  sendConfirmedDraft,
  mailboxSnapshot,
  startMailboxSync,
  createMailboxDraft,
  updateMailboxDraft,
  deleteMailboxDraft,
}) {
  if (req.method === "GET" && url.pathname === "/api/mailbox" && typeof mailboxSnapshot === "function") {
    sendJson(res, 200, mailboxSnapshot({ actor }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/mailbox/sync" && typeof startMailboxSync === "function") {
    const result = startMailboxSync({ actor });
    sendJson(res, result.status, result.body);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/mail/drafts" && typeof createMailboxDraft === "function") {
    const body = await readJson(req);
    const result = createMailboxDraft({ ...body, actor });
    sendJson(res, result.status, result.body);
    return true;
  }

  const draftMatch = url.pathname.match(/^\/api\/mail\/drafts\/([^/]+)$/);
  if (req.method === "PATCH" && draftMatch && typeof updateMailboxDraft === "function") {
    const body = await readJson(req);
    const result = updateMailboxDraft({ ...body, draftId: decodeURIComponent(draftMatch[1]), actor });
    sendJson(res, result.status, result.body);
    return true;
  }
  if (req.method === "DELETE" && draftMatch && typeof deleteMailboxDraft === "function") {
    const result = deleteMailboxDraft({ draftId: decodeURIComponent(draftMatch[1]), actor });
    sendJson(res, result.status, result.body);
    return true;
  }

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
  // draft.
  const confirmMatch = url.pathname.match(/^\/api\/mail\/replies\/([^/]+)\/confirm$/);
  if (req.method === "POST" && confirmMatch) {
    const result = confirmReplyDraft({ replyId: decodeURIComponent(confirmMatch[1]), actor });
    sendJson(res, result.status, result.body);
    return true;
  }

  // Step 3 (#1147, ADR 0014): the exfiltration boundary. Send ONE confirmed
  // draft — the caller supplies a draft id and a single-use grant; every
  // outbound field is resolved server-side from the draftbox row. Gated on the
  // default-OFF flag, the write-credential Application, and credential
  // readiness — see mail-send.mjs for the ordered gates.
  const sendMatch = url.pathname.match(/^\/api\/mail\/drafts\/([^/]+)\/send$/);
  if (req.method === "POST" && sendMatch && typeof sendConfirmedDraft === "function") {
    const body = await readJson(req);
    const result = sendConfirmedDraft({ draftId: decodeURIComponent(sendMatch[1]), approvalToken: body?.approvalToken, actor });
    sendJson(res, result.status, result.body);
    return true;
  }
  return false;
}
