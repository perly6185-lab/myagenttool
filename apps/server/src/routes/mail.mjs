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
  prioritizeMailboxBodyPrefetch,
  setMailboxMessageRead,
  createMailboxDraft,
  updateMailboxDraft,
  deleteMailboxDraft,
  createMailboxTask,
  startMailClassification,
  previewMailSemanticClassification,
  getMailClassificationJob,
  cancelMailClassificationJob,
  correctMailClassification,
  getMailClassificationQuality,
  listMailClassificationRules,
  createMailClassificationRule,
  updateMailClassificationRule,
  listMailFolderSuggestions,
  createMailFolderMovePreview,
  startMailFolderMove,
  getMailFolderMoveJob,
  listMailFolderMoveJobs,
  reconcileMailFolderMoveJob,
  createMailFolderRecoveryPreview,
  createMailFolderAutomationPreview,
  enableMailFolderAutomation,
  updateMailFolderAutomation,
  listMailFolderAutomations,
  dryRunMailFolderAutomation,
}) {
  if (req.method === "GET" && url.pathname === "/api/mailbox" && typeof mailboxSnapshot === "function") {
    sendJson(res, 200, mailboxSnapshot({ actor, page: url.searchParams.get("page"), pageSize: url.searchParams.get("pageSize"), folder: url.searchParams.get("folder") ?? "inbox", query: url.searchParams.get("q") ?? "", view: url.searchParams.get("view") ?? "all" }));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/mailbox/semantic-classification-preview" && typeof previewMailSemanticClassification === "function") {
    const result = previewMailSemanticClassification({ limit: url.searchParams.get("limit"), actor });
    sendJson(res, result.status, result.body);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/mailbox/classification-jobs" && typeof startMailClassification === "function") {
    const body = await readJson(req);
    const result = startMailClassification({
      scope: body?.scope ?? "new_mail",
      mode: body?.mode ?? "header",
      confirmed: body?.confirmed,
      limit: body?.limit,
      actor,
    });
    sendJson(res, result.status, result.body);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/mailbox/classification-rules" && typeof listMailClassificationRules === "function") {
    const result = listMailClassificationRules({ actor });
    sendJson(res, result.status, result.body);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/mailbox/classification-quality" && typeof getMailClassificationQuality === "function") {
    const result = getMailClassificationQuality({ actor });
    sendJson(res, result.status, result.body);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/mailbox/classification-rules" && typeof createMailClassificationRule === "function") {
    const body = await readJson(req);
    const result = createMailClassificationRule({ suggestionId: body?.suggestionId, confirmed: body?.confirmed, actor });
    sendJson(res, result.status, result.body);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/mailbox/folder-suggestions" && typeof listMailFolderSuggestions === "function") {
    const result = listMailFolderSuggestions({ actor });
    sendJson(res, result.status, result.body);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/mailbox/folder-move-previews" && typeof createMailFolderMovePreview === "function") {
    const body = await readJson(req);
    const result = createMailFolderMovePreview({
      suggestionId: body?.suggestionId, destinationFolderId: body?.destinationFolderId, actor,
    });
    sendJson(res, result.status, result.body);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/mailbox/folder-move-jobs" && typeof startMailFolderMove === "function") {
    const body = await readJson(req);
    const result = startMailFolderMove({ previewId: body?.previewId, approvalToken: body?.approvalToken, actor });
    sendJson(res, result.status, result.body);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/mailbox/folder-move-jobs" && typeof listMailFolderMoveJobs === "function") {
    const result = listMailFolderMoveJobs({ actor });
    sendJson(res, result.status, result.body);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/mailbox/folder-automation-previews" && typeof createMailFolderAutomationPreview === "function") {
    const body = await readJson(req);
    const result = createMailFolderAutomationPreview({ suggestionId: body?.suggestionId, destinationFolderId: body?.destinationFolderId, actor });
    sendJson(res, result.status, result.body);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/mailbox/folder-automations" && typeof listMailFolderAutomations === "function") {
    const result = listMailFolderAutomations({ actor });
    sendJson(res, result.status, result.body);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/mailbox/folder-automations" && typeof enableMailFolderAutomation === "function") {
    const body = await readJson(req);
    const result = enableMailFolderAutomation({ previewId: body?.previewId, approvalToken: body?.approvalToken, confirmed: body?.confirmed, actor });
    sendJson(res, result.status, result.body);
    return true;
  }

  const folderMoveReconcileMatch = url.pathname.match(/^\/api\/mailbox\/folder-move-jobs\/([^/]+)\/reconcile$/);
  if (req.method === "POST" && folderMoveReconcileMatch && typeof reconcileMailFolderMoveJob === "function") {
    const result = reconcileMailFolderMoveJob({ jobId: decodeURIComponent(folderMoveReconcileMatch[1]), actor });
    sendJson(res, result.status, result.body);
    return true;
  }

  const folderMoveRecoveryMatch = url.pathname.match(/^\/api\/mailbox\/folder-move-jobs\/([^/]+)\/recovery-preview$/);
  if (req.method === "POST" && folderMoveRecoveryMatch && typeof createMailFolderRecoveryPreview === "function") {
    const result = createMailFolderRecoveryPreview({ jobId: decodeURIComponent(folderMoveRecoveryMatch[1]), actor });
    sendJson(res, result.status, result.body);
    return true;
  }

  const folderAutomationMatch = url.pathname.match(/^\/api\/mailbox\/folder-automations\/([^/]+)$/);
  if (req.method === "PATCH" && folderAutomationMatch && typeof updateMailFolderAutomation === "function") {
    const body = await readJson(req);
    const result = updateMailFolderAutomation({ automationId: decodeURIComponent(folderAutomationMatch[1]), expectedRevision: body?.expectedRevision, action: body?.action, actor });
    sendJson(res, result.status, result.body);
    return true;
  }

  const folderAutomationDryRunMatch = url.pathname.match(/^\/api\/mailbox\/folder-automations\/([^/]+)\/dry-run$/);
  if (req.method === "POST" && folderAutomationDryRunMatch && typeof dryRunMailFolderAutomation === "function") {
    const result = dryRunMailFolderAutomation({ automationId: decodeURIComponent(folderAutomationDryRunMatch[1]), actor });
    sendJson(res, result.status, result.body);
    return true;
  }

  const folderMoveJobMatch = url.pathname.match(/^\/api\/mailbox\/folder-move-jobs\/([^/]+)$/);
  if (req.method === "GET" && folderMoveJobMatch && typeof getMailFolderMoveJob === "function") {
    const result = getMailFolderMoveJob({ jobId: decodeURIComponent(folderMoveJobMatch[1]), actor });
    sendJson(res, result.status, result.body);
    return true;
  }

  const classificationRuleMatch = url.pathname.match(/^\/api\/mailbox\/classification-rules\/([^/]+)$/);
  if (req.method === "PATCH" && classificationRuleMatch && typeof updateMailClassificationRule === "function") {
    const body = await readJson(req);
    const result = updateMailClassificationRule({
      ruleId: decodeURIComponent(classificationRuleMatch[1]), expectedRevision: body?.expectedRevision,
      action: body?.action, attention: body?.attention, mailType: body?.mailType, suggestedAction: body?.suggestedAction, actor,
    });
    sendJson(res, result.status, result.body);
    return true;
  }

  const classificationJobMatch = url.pathname.match(/^\/api\/mailbox\/classification-jobs\/([^/]+)$/);
  if (req.method === "GET" && classificationJobMatch && typeof getMailClassificationJob === "function") {
    const result = getMailClassificationJob({ jobId: decodeURIComponent(classificationJobMatch[1]), actor });
    sendJson(res, result.status, result.body);
    return true;
  }

  const classificationCancelMatch = url.pathname.match(/^\/api\/mailbox\/classification-jobs\/([^/]+)\/cancel$/);
  if (req.method === "POST" && classificationCancelMatch && typeof cancelMailClassificationJob === "function") {
    const result = cancelMailClassificationJob({ jobId: decodeURIComponent(classificationCancelMatch[1]), actor });
    sendJson(res, result.status, result.body);
    return true;
  }

  const classificationMatch = url.pathname.match(/^\/api\/mailbox\/messages\/([^/]+)\/classification$/);
  if (req.method === "PATCH" && classificationMatch && typeof correctMailClassification === "function") {
    const body = await readJson(req);
    const result = correctMailClassification({
      messageId: decodeURIComponent(classificationMatch[1]),
      folderId: body?.folderId,
      expectedRevision: body?.expectedRevision,
      attention: body?.attention,
      mailType: body?.mailType,
      suggestedAction: body?.suggestedAction,
      actor,
    });
    sendJson(res, result.status, result.body);
    return true;
  }

  const readMatch = url.pathname.match(/^\/api\/mailbox\/messages\/([^/]+)\/read$/);
  if (req.method === "PATCH" && readMatch && typeof setMailboxMessageRead === "function") {
    const body = await readJson(req);
    if (typeof body?.read !== "boolean") {
      sendJson(res, 400, { error: "mail_read_state_invalid" });
      return true;
    }
    const result = setMailboxMessageRead({ messageId: decodeURIComponent(readMatch[1]), read: body.read, actor });
    sendJson(res, result.status, result.body);
    return true;
  }

  const bodyPrefetchMatch = url.pathname.match(/^\/api\/mailbox\/messages\/([^/]+)\/body-prefetch$/);
  if (req.method === "POST" && bodyPrefetchMatch && typeof prioritizeMailboxBodyPrefetch === "function") {
    const result = prioritizeMailboxBodyPrefetch({ messageId: decodeURIComponent(bodyPrefetchMatch[1]), actor });
    sendJson(res, result.status, result.body);
    return true;
  }

  const taskMatch = url.pathname.match(/^\/api\/mailbox\/messages\/([^/]+)\/task$/);
  if (req.method === "POST" && taskMatch && typeof createMailboxTask === "function") {
    const body = await readJson(req);
    const result = createMailboxTask({ ...body, messageId: decodeURIComponent(taskMatch[1]), actor });
    sendJson(res, result.status, result.body);
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
