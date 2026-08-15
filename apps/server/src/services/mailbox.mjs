/*
 * Ordinary-user mailbox read model + user-authored draft store.
 *
 * Provider credentials and network access stay in the Desktop/MCP process. This
 * service projects already-imported, bounded mail records into a mailbox-shaped
 * API and stores plain-text drafts as server-side artifacts. Sending still goes
 * through mail-send.mjs: callers name a draft and a single-use approval grant;
 * no free-form outbound text crosses the send boundary.
 */

import { createHash } from "node:crypto";
import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { listDevices } from "../runtime/device.mjs";

const MAX_RECIPIENT = 998;
const MAX_SUBJECT = 400;
const MAX_BODY = 20_000;
const MAX_HTML_BODY = 50_000;
const MAX_DRAFTS = 200;
const MAX_MESSAGES = 10_000;
const MAX_MESSAGE_STATES = 10_000;
const MAX_SEARCH = 200;
const MAX_DRAFT_ATTACHMENTS = 10;
const MAX_DRAFT_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_TASK_ATTACHMENTS = 6;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const ACTIVE_SYNC_STATUSES = new Set(["queued", "waiting_for_local_approval", "dispatching", "running", "cancelling"]);

const cap = (value, max) => typeof value === "string" ? value.slice(0, max) : "";

export function createMailboxService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon = () => {},
  store,
  mailSendEnabled = () => false,
  createCapabilityInvocation = null,
  createWorkItem = null,
  inspectTaskMaterialDraft = null,
}) {
  const runTx = makeRunTx({ store, persistStateSoon });

  function snapshot({ actor = null, page = 1, pageSize = DEFAULT_PAGE_SIZE, folder = "inbox", query = "" } = {}) {
    const teamId = actor?.teamId ?? null;
    const applications = (state.applications ?? []).filter((application) =>
      teamId == null || (application.ownerTeamId ?? "team_local") === teamId,
    );
    const results = (state.applicationResults ?? []).filter((record) =>
      record.source === "mail_headers"
      && (teamId == null || (record.ownerTeamId ?? "team_local") === teamId),
    );
    const drafts = (state.mailDrafts ?? []).filter((draft) =>
      teamId == null || (draft.ownerTeamId ?? "team_local") === teamId,
    );
    const accounts = mailboxAccounts(applications, {
      sendEnabled: Boolean(mailSendEnabled()),
      credentialReadiness: listDevices(state)[0]?.applicationCredentialReadiness ?? [],
    });
    const importedMessages = mailboxMessages(
      results,
      state.mailThreads ?? {},
      (state.mailMessageStates ?? []).filter((row) => teamId == null || (row.ownerTeamId ?? "team_local") === teamId),
      (state.mailTaskLinks ?? []).filter((row) => teamId == null || (row.ownerTeamId ?? "team_local") === teamId),
    ).slice(0, MAX_MESSAGES);
    const providerFolders = mailboxProviderFolders(results, importedMessages);
    const requestedFolder = providerFolders.some((item) => item.id === folder) ? folder : "inbox";
    const normalizedQuery = normalizeSearchQuery(query);
    const allMessages = importedMessages
      .filter((message) => (message.folderId ?? "inbox") === requestedFolder)
      .filter((message) => matchesMailSearch(message, normalizedQuery));
    const pagination = mailboxPagination(allMessages.length, page, pageSize);
    const messages = allMessages.slice(pagination.offset, pagination.offset + pagination.pageSize).map(publicMessage);
    const publicDrafts = drafts.map(publicDraft).sort(compareRecent);

    return {
      accounts: accounts.map(publicMailboxAccount),
      connection: mailboxConnection(accounts),
      sync: mailboxSync(state.invocations ?? [], accounts),
      folders: [
        ...providerFolders,
        { id: "drafts", count: publicDrafts.filter((draft) => draft.status === "draft").length },
        { id: "sent", count: publicDrafts.filter((draft) => draft.status === "sent").length },
        { id: "outbox", count: publicDrafts.filter((draft) => ["sending", "send_unconfirmed"].includes(draft.status)).length },
      ],
      messages,
      query: normalizedQuery,
      selectedFolder: requestedFolder,
      pagination: publicPagination(pagination),
      drafts: publicDrafts,
      updatedAt: latestTimestamp([...results, ...drafts, ...applications]),
    };
  }

  function setMessageRead({ messageId, read = true, actor = null } = {}) {
    const normalizedId = cap(String(messageId ?? "").trim(), MAX_RECIPIENT);
    const teamId = actor?.teamId ?? "team_local";
    if (!normalizedId) return { ok: false, status: 400, body: { error: "mail_message_invalid" } };
    const teamResults = (state.applicationResults ?? []).filter((record) => record.source === "mail_headers" && (record.ownerTeamId ?? "team_local") === teamId);
    const message = mailboxMessages(teamResults, state.mailThreads ?? {}, []).find((item) => item.messageId === normalizedId);
    if (!message) return { ok: false, status: 404, body: { error: "mail_message_not_found" } };
    const application = (state.applications ?? []).find((item) => item.id === message.applicationId && !item.successorApplicationId)
      ?? (state.applications ?? []).find((item) => !item.successorApplicationId && capabilityName(item, "mail_set_read"));
    const capability = application ? capabilityName(application, "mail_set_read") : null;
    if (!capability || typeof createCapabilityInvocation !== "function") {
      persistLocalReadState(normalizedId, read, teamId);
      return { ok: true, status: 200, body: { messageId: normalizedId, unread: read === false } };
    }
    const result = createCapabilityInvocation(capability, { messageId: normalizedId, folderPath: message.folderPath ?? "INBOX", read: read !== false }, actor);
    if (!result || result.status >= 400) return { ok: false, status: 409, body: { error: "mail_read_state_sync_failed" } };
    return { ok: true, status: 202, body: { messageId: normalizedId, unread: read === false, pending: true, invocationId: result.body?.invocationId ?? null } };
  }

  function persistLocalReadState(messageId, read, teamId) {
    runTx(() => {
      state.mailMessageStates = (state.mailMessageStates ?? []).filter((row) => !(row.messageId === messageId && (row.ownerTeamId ?? "team_local") === teamId));
      if (read !== false) {
        const readAt = now();
        state.mailMessageStates.unshift({ id: nextId("mailmsgstate"), messageId, ownerTeamId: teamId, readAt, createdAt: readAt, updatedAt: readAt });
        const ownRows = state.mailMessageStates.filter((row) => (row.ownerTeamId ?? "team_local") === teamId).slice(0, MAX_MESSAGE_STATES);
        const otherRows = state.mailMessageStates.filter((row) => (row.ownerTeamId ?? "team_local") !== teamId);
        state.mailMessageStates = [...ownRows, ...otherRows];
      }
    });
  }

  function startSync({ actor = null } = {}) {
    const teamId = actor?.teamId ?? null;
    const applications = (state.applications ?? []).filter((application) =>
      teamId == null || (application.ownerTeamId ?? "team_local") === teamId,
    );
    const accounts = mailboxAccounts(applications, {
      sendEnabled: Boolean(mailSendEnabled()),
      credentialReadiness: listDevices(state)[0]?.applicationCredentialReadiness ?? [],
    });
    const account = accounts.find((candidate) => candidate.canReceive && candidate.syncCapability) ?? null;
    if (!account) {
      return { ok: false, status: 409, body: { error: "mailbox_not_connected" } };
    }
    const current = mailboxSync(state.invocations ?? [], [account]);
    if (current.status === "syncing") {
      return { ok: true, status: 202, body: { sync: current, reused: true } };
    }
    if (typeof createCapabilityInvocation !== "function") {
      return { ok: false, status: 503, body: { error: "mail_sync_unavailable" } };
    }
    const cursors = latestMailboxCursors((state.applicationResults ?? []).filter((record) =>
      record.source === "mail_headers" && (teamId == null || (record.ownerTeamId ?? "team_local") === teamId),
    ));
    const result = createCapabilityInvocation(account.syncCapability, account.incrementalSync ? { limit: 50, cursors } : { limit: 50 }, actor);
    if (!result || result.status >= 400) {
      return { ok: false, status: 409, body: { error: "mail_sync_unavailable" } };
    }
    return {
      ok: true,
      status: 202,
      body: { sync: mailboxSync(state.invocations ?? [], [account]), reused: false },
    };
  }

  function createDraft({ to, subject, body, attachments = [], inReplyTo = null, references = [], actor = null } = {}) {
    const normalized = validateDraftFields({ to, subject, body, attachments });
    if (!normalized.ok) return normalized;
    const draft = {
      id: nextId("maildraft"),
      status: "draft",
      revision: 1,
      origin: "user",
      provider: preferredMailProvider(state.applications ?? [], actor),
      to: normalized.to,
      subject: normalized.subject,
      body: normalized.body,
      bodyFormat: "plain_text",
      attachments: normalized.attachments,
      inReplyTo: cap(inReplyTo, MAX_RECIPIENT) || null,
      references: Array.isArray(references)
        ? references.map((entry) => cap(entry, MAX_RECIPIENT)).filter(Boolean).slice(0, 50)
        : [],
      ownerTeamId: actor?.teamId ?? "team_local",
      createdBy: actor?.userId ?? null,
      createdAt: now(),
      updatedAt: now(),
      send: { available: false, requires: ["separate send permission", "confirmation before sending"] },
    };
    runTx(() => {
      state.mailDrafts = state.mailDrafts ?? [];
      state.mailDrafts.unshift(draft);
      state.mailDrafts = state.mailDrafts.slice(0, MAX_DRAFTS);
      appendEvent({
        invocationId: null,
        type: "mail_draft_created",
        level: "info",
        message: `Saved mail draft ${draft.id}.`,
        data: { draftId: draft.id, origin: draft.origin },
      });
    });
    return { ok: true, status: 201, body: { draft: publicDraft(draft) } };
  }

  function updateDraft({ draftId, to, subject, body, attachments = [], actor = null } = {}) {
    const draft = findDraft(draftId, actor);
    if (!draft) return { ok: false, status: 404, body: { error: "mail_draft_not_found" } };
    if (draft.status !== "draft") {
      return { ok: false, status: 409, body: { error: "mail_draft_not_editable", status: draft.status } };
    }
    const normalized = validateDraftFields({ to, subject, body, attachments });
    if (!normalized.ok) return normalized;
    runTx(() => {
      draft.to = normalized.to;
      draft.subject = normalized.subject;
      draft.body = normalized.body;
      draft.bodyFormat = "plain_text";
      draft.attachments = normalized.attachments;
      draft.revision = Number(draft.revision ?? 0) + 1;
      draft.updatedAt = now();
      appendEvent({
        invocationId: null,
        type: "mail_draft_updated",
        level: "info",
        message: `Updated mail draft ${draft.id}.`,
        data: { draftId: draft.id, revision: draft.revision },
      });
    });
    return { ok: true, status: 200, body: { draft: publicDraft(draft) } };
  }

  function deleteDraft({ draftId, actor = null } = {}) {
    const draft = findDraft(draftId, actor);
    if (!draft) return { ok: false, status: 404, body: { error: "mail_draft_not_found" } };
    if (draft.status !== "draft") {
      return { ok: false, status: 409, body: { error: "mail_draft_not_deletable", status: draft.status } };
    }
    runTx(() => {
      state.mailDrafts = (state.mailDrafts ?? []).filter((item) => item.id !== draft.id);
      appendEvent({
        invocationId: null,
        type: "mail_draft_deleted",
        level: "info",
        message: `Deleted mail draft ${draft.id}.`,
        data: { draftId: draft.id },
      });
    });
    return { ok: true, status: 200, body: { deleted: true, draftId: draft.id } };
  }

  function findDraft(draftId, actor) {
    const draft = (state.mailDrafts ?? []).find((item) => item.id === String(draftId ?? "")) ?? null;
    if (!draft) return null;
    if (actor?.teamId && (draft.ownerTeamId ?? "team_local") !== actor.teamId) return null;
    return draft;
  }

  function createTaskFromMessage({
    messageId,
    projectId,
    title,
    description = "",
    attachmentIds = [],
    materialDraftId = null,
    materialDraftRevision = null,
    actor = null,
  } = {}) {
    const normalizedId = cap(String(messageId ?? "").trim(), MAX_RECIPIENT);
    const normalizedProjectId = String(projectId ?? "").trim();
    const teamId = actor?.teamId ?? "team_local";
    if (!normalizedId || !normalizedProjectId) {
      return { ok: false, status: 400, body: { error: "mail_task_invalid" } };
    }
    const teamResults = (state.applicationResults ?? []).filter((record) =>
      record.source === "mail_headers" && (record.ownerTeamId ?? "team_local") === teamId,
    );
    const message = mailboxMessages(teamResults, state.mailThreads ?? {}, []).find((item) => item.messageId === normalizedId);
    if (!message) return { ok: false, status: 404, body: { error: "mail_message_not_found" } };

    const existing = (state.mailTaskLinks ?? []).find((row) =>
      row.messageId === normalizedId && (row.ownerTeamId ?? "team_local") === teamId,
    );
    if (existing) return { ok: true, status: 200, body: { task: publicTaskLink(existing), replayed: true } };
    const idempotencyKey = `mail:${createHash("sha256").update(`${teamId}\0${normalizedId}`).digest("hex")}`;
    const recoveredWorkItem = (state.workItems ?? []).find((item) =>
      (item.ownerTeamId ?? "team_local") === teamId && item.createIdempotencyKey === idempotencyKey,
    );
    if (recoveredWorkItem) {
      const recoveredLink = ensureMailTaskLink(normalizedId, recoveredWorkItem, teamId, actor);
      return { ok: true, status: 200, body: { task: publicTaskLink(recoveredLink), replayed: true } };
    }
    if (typeof createWorkItem !== "function") {
      return { ok: false, status: 503, body: { error: "mail_task_service_unavailable" } };
    }

    const selectedIds = Array.isArray(attachmentIds)
      ? [...new Set(attachmentIds.map((value) => String(value ?? "").trim()).filter(Boolean))]
      : [];
    if (selectedIds.length > MAX_TASK_ATTACHMENTS || selectedIds.length !== (attachmentIds?.length ?? 0)) {
      return { ok: false, status: 422, body: { error: "mail_task_attachments_invalid" } };
    }
    const attachmentsById = new Map((message.attachments ?? []).map((attachment) => [String(attachment.id), attachment]));
    const selected = selectedIds.map((id) => attachmentsById.get(id));
    if (selected.some((attachment) => !attachment)) {
      return { ok: false, status: 422, body: { error: "mail_task_attachment_not_found" } };
    }
    if (selected.length > 0) {
      if (!materialDraftId || !Number.isInteger(Number(materialDraftRevision)) || typeof inspectTaskMaterialDraft !== "function") {
        return { ok: false, status: 422, body: { error: "mail_task_material_draft_required" } };
      }
      const inspected = inspectTaskMaterialDraft({ projectId: normalizedProjectId, draftId: String(materialDraftId) }, actor);
      if (inspected.status !== 200) return { ok: false, status: inspected.status, body: inspected.body };
      const assets = inspected.body?.draft?.assets ?? [];
      const matches = assets.length === selected.length && selected.every((attachment, index) => {
        const asset = assets.find((candidate) => candidate.clientFileId === `mail-attachment-${index + 1}`);
        return asset
          && asset.originalName === taskMaterialName(attachment.name)
          && asset.size === Number(attachment.size)
          && (asset.mimeType ?? "application/octet-stream") === String(attachment.contentType ?? "application/octet-stream")
          && /^[a-f0-9]{64}$/.test(String(attachment.sha256 ?? ""))
          && asset.hash === attachment.sha256;
      });
      if (!matches || Number(inspected.body.draft.revision) !== Number(materialDraftRevision)) {
        return { ok: false, status: 409, body: { error: "mail_task_material_draft_mismatch" } };
      }
    } else if (materialDraftId != null) {
      return { ok: false, status: 422, body: { error: "mail_task_attachments_required" } };
    }

    const normalizedTitle = cap(String(title ?? "").trim(), 300) || cap(message.subject, 300) || "来自邮件的任务";
    const normalizedDescription = cap(String(description ?? ""), MAX_BODY);
    const sourceLines = [
      "## 邮件来源（外部内容，请核实后执行）",
      `- 发件人：${singleLine(message.from)}`,
      `- 主题：${singleLine(message.subject)}`,
      `- 收件时间：${singleLine(message.date || "未知")}`,
      `- Message-ID：${singleLine(message.messageId)}`,
      "",
      "## 任务说明",
      normalizedDescription || message.preview || "请查看邮件原文并补充任务说明。",
    ];
    const created = createWorkItem({
      projectId: normalizedProjectId,
      title: normalizedTitle,
      body: cap(sourceLines.join("\n"), MAX_BODY),
      type: "task",
      status: "backlog",
      priority: "p2",
      executionPolicy: "manual",
      labels: ["mail", "untrusted-input"],
      requesterRelation: "unknown",
      idempotencyKey,
      ...(selected.length ? {
        materialDraftId: String(materialDraftId),
        materialDraftRevision: Number(materialDraftRevision),
      } : {}),
    }, actor);
    if (!created?.ok) return created;
    const workItem = created.body.workItem;
    const durableLink = ensureMailTaskLink(normalizedId, workItem, teamId, actor);
    return { ok: true, status: created.status, body: { task: publicTaskLink(durableLink), replayed: created.body.replayed === true } };
  }

  function ensureMailTaskLink(messageId, workItem, teamId, actor) {
    const timestamp = now();
    const link = {
      id: nextId("mailtask"),
      messageId,
      workItemId: workItem.id,
      localRef: workItem.localRef,
      title: workItem.title,
      projectId: workItem.projectId,
      ownerTeamId: teamId,
      createdBy: actor?.userId ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    runTx(() => {
      state.mailTaskLinks ??= [];
      const replay = state.mailTaskLinks.find((row) => row.messageId === messageId && (row.ownerTeamId ?? "team_local") === teamId);
      if (!replay) state.mailTaskLinks.unshift(link);
    });
    return (state.mailTaskLinks ?? []).find((row) => row.messageId === messageId && (row.ownerTeamId ?? "team_local") === teamId) ?? link;
  }

  return { snapshot, startSync, setMessageRead, createDraft, updateDraft, deleteDraft, createTaskFromMessage };
}

export function mailSendApprovalTarget(draft) {
  const revision = Number(draft?.revision ?? 0);
  return revision > 0 ? `${draft.id}@${revision}` : draft?.id ?? "";
}

function mailboxAccounts(applications, { sendEnabled = false, credentialReadiness = [] } = {}) {
  const readApps = applications
    .filter((application) => mailTools(application).some((tool) => ["mail_sync", "mail_list_unread", "mail_fetch"].includes(tool)))
    .filter((application) => !application.successorApplicationId)
    .sort(compareApplicationReadiness);
  const sendApps = applications.filter((application) => mailTools(application).includes("mail_send"));
  const providers = new Map();
  for (const application of readApps) {
    const provider = providerOf(application);
    if (providers.has(provider)) continue;
    const send = sendApps.find((candidate) => providerOf(candidate) === provider) ?? null;
    const active = ["active", "registered"].includes(application.status);
    const receiveCredentialReady = credentialReadyForApplication(application, credentialReadiness);
    const canReceive = active && receiveCredentialReady;
    providers.set(provider, {
      id: application.id,
      provider,
      name: providerLabel(provider, application.name),
      status: canReceive ? "connected" : "needs_attention",
      statusDetail: !active ? String(application.status ?? "not_connected") : receiveCredentialReady ? "ready" : "credential_not_authorized",
      canReceive,
      canSend: Boolean(
        sendEnabled
        && send
        && ["active", "registered"].includes(send.status)
        && credentialReadyForApplication(send, credentialReadiness)
      ),
      readApplicationId: application.id,
      sendApplicationId: send?.id ?? null,
      syncCapability: capabilityName(application, "mail_sync") ?? capabilityName(application, "mail_list_unread"),
      fetchCapability: capabilityName(application, "mail_fetch"),
      incrementalSync: Boolean(capabilityName(application, "mail_sync")),
      providerReadState: Boolean(capabilityName(application, "mail_set_read")),
    });
  }
  return [...providers.values()];
}

function credentialReadyForApplication(application, readiness) {
  const required = application?.source?.credential ?? null;
  if (!required) return true;
  const held = readiness.find((row) => row.applicationId === application.id);
  return Boolean(
    held
    && held.provider === required.provider
    && held.scope === required.scope
    && ["present", "authorized"].includes(held.status),
  );
}

function mailboxConnection(accounts) {
  if (!accounts.length) return { status: "not_connected", message: "Connect an email account to start." };
  if (accounts.some((account) => account.canReceive)) {
    return { status: "connected", message: accounts.length === 1 ? accounts[0].name : `${accounts.length} accounts connected` };
  }
  return { status: "needs_attention", message: "Reconnect your email account to continue." };
}

function publicMailboxAccount(account) {
  const { syncCapability: _internalSyncCapability, ...publicAccount } = account;
  return publicAccount;
}

function mailboxSync(invocations, accounts) {
  const capabilityNames = new Set(accounts.map((account) => account.syncCapability).filter(Boolean));
  const applicationIds = new Set(accounts.map((account) => account.readApplicationId).filter(Boolean));
  const matching = invocations
    .filter((invocation) => {
      const metadata = invocation?.options?.metadata ?? {};
      return capabilityNames.has(metadata.capability) && applicationIds.has(metadata.applicationId);
    })
    .sort((left, right) => timestampOf(right) - timestampOf(left));
  const latest = matching[0] ?? null;
  const lastSuccess = matching.find((invocation) => invocation.status === "succeeded") ?? null;
  const status = !latest
    ? "idle"
    : ACTIVE_SYNC_STATUSES.has(latest.status)
      ? "syncing"
      : latest.status === "succeeded"
        ? "succeeded"
        : "failed";
  return {
    status,
    invocationId: latest?.id ?? null,
    lastCompletedAt: latest && !ACTIVE_SYNC_STATUSES.has(latest.status)
      ? latest.completedAt ?? latest.updatedAt ?? null
      : null,
    lastSucceededAt: lastSuccess?.completedAt ?? lastSuccess?.updatedAt ?? null,
  };
}

function mailboxMessages(results, threads, readStates = [], taskLinks = []) {
  const messages = new Map();
  const ordered = [...results].sort((left, right) => timestampOf(left) - timestampOf(right));
  for (const record of ordered) {
    if (record.data?.kind === "unread_headers") {
      for (const header of record.data.headers ?? []) mergeMessage(messages, header, record, true, threads);
    } else if (record.data?.kind === "message") {
      mergeMessage(messages, record.data, record, true, threads);
    } else if (record.data?.kind === "mailbox_sync") {
      for (const header of record.data.messages ?? []) mergeMessage(messages, header, record, header.unread !== false, threads);
      for (const readState of record.data.readStates ?? []) {
        const entry = [...messages.entries()].find(([, message]) => message.folderId === readState.folderId && message.providerUid === readState.uid);
        if (entry) messages.set(entry[0], { ...entry[1], unread: readState.unread });
      }
    } else if (record.data?.kind === "read_state") {
      const existing = messages.get(record.data.messageId);
      if (existing) messages.set(record.data.messageId, { ...existing, unread: record.data.read !== true });
    }
  }
  const readIds = new Set(readStates.filter((row) => row?.readAt).map((row) => row.messageId));
  const linksByMessageId = new Map(taskLinks.map((row) => [row.messageId, publicTaskLink(row)]));
  return [...messages.values()]
    .map((message) => ({
      ...(readIds.has(message.messageId) ? { ...message, unread: false } : message),
      task: linksByMessageId.get(message.messageId) ?? null,
    }))
    .sort(compareRecent);
}

function recordContainsMessage(record, messageId) {
  if (record.data?.kind === "message") return record.data.messageId === messageId;
  if (record.data?.kind === "unread_headers") return (record.data.headers ?? []).some((header) => header.messageId === messageId);
  if (record.data?.kind === "mailbox_sync") return (record.data.messages ?? []).some((header) => header.messageId === messageId);
  return false;
}

function mailboxPagination(total, requestedPage, requestedPageSize) {
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(requestedPageSize, 10) || DEFAULT_PAGE_SIZE));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(totalPages, Math.max(1, Number.parseInt(requestedPage, 10) || 1));
  return { page, pageSize, total, totalPages, offset: (page - 1) * pageSize };
}

function publicPagination({ page, pageSize, total, totalPages }) {
  return { page, pageSize, total, totalPages, hasPrevious: page > 1, hasNext: page < totalPages };
}

function mergeMessage(messages, input, record, unread, threads) {
  const messageId = cap(input?.messageId, MAX_RECIPIENT);
  if (!messageId) return;
  const previous = messages.get(messageId) ?? {};
  const body = typeof input?.body === "string" ? cap(input.body, MAX_BODY) : previous.body ?? null;
  const bodyHtml = typeof input?.bodyHtml === "string" ? input.bodyHtml.slice(0, MAX_HTML_BODY) : previous.bodyHtml ?? "";
  const date = cap(input?.date, MAX_RECIPIENT) || previous.date || record.createdAt || null;
  messages.set(messageId, {
    id: messageId,
    messageId,
    from: cap(input?.from, MAX_RECIPIENT) || previous.from || "Unknown sender",
    subject: cap(input?.subject, MAX_SUBJECT) || previous.subject || "(no subject)",
    date,
    body,
    bodyHtml,
    hasHtml: Boolean(bodyHtml),
    bodyTruncated: typeof input?.bodyTruncated === "boolean" ? input.bodyTruncated : previous.bodyTruncated === true,
    bodyContentVersion: input?.bodyContentVersion === 2 ? 2 : previous.bodyContentVersion ?? 1,
    preview: body ? body.replace(/\s+/g, " ").trim().slice(0, 160) : "",
    unread: typeof input?.unread === "boolean" ? input.unread : previous.unread ?? unread,
    folderId: cap(input?.folderId, 100) || previous.folderId || "inbox",
    folderPath: cap(input?.folderPath, MAX_RECIPIENT) || previous.folderPath || "INBOX",
    providerUid: Number.isInteger(input?.uid) ? input.uid : previous.providerUid ?? null,
    fetched: Boolean(body || bodyHtml),
    inReplyTo: cap(input?.inReplyTo, MAX_RECIPIENT) || previous.inReplyTo || null,
    references: Array.isArray(input?.references) ? input.references.slice(0, 50) : previous.references ?? [],
    attachments: Array.isArray(input?.attachments) ? input.attachments.slice(0, 50) : previous.attachments ?? [],
    attachmentMetadataLoaded: input?.attachmentMetadataLoaded === true || previous.attachmentMetadataLoaded === true,
    archive: input?.archive && typeof input.archive === "object" ? input.archive : previous.archive ?? null,
    applicationId: record.applicationId ?? previous.applicationId ?? null,
    issueNumber: threads?.[messageId]?.issueNumber ?? null,
    createdAt: record.createdAt ?? previous.createdAt ?? date,
  });
}

function publicMessage(message) {
  const { providerUid: _providerUid, ...value } = message;
  return value;
}

function publicTaskLink(link) {
  return {
    id: link.workItemId,
    localRef: link.localRef,
    title: link.title,
    projectId: link.projectId,
  };
}

function singleLine(value) {
  return cap(String(value ?? "").replace(/[\r\n\t]+/g, " ").trim(), MAX_RECIPIENT);
}

function taskMaterialName(value) {
  const normalized = String(value ?? "")
    .replace(/[\\/\0\r\n]+/g, " ")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 120);
  return normalized || "reference-file";
}

function mailboxProviderFolders(results, messages) {
  const latestById = new Map();
  for (const record of [...results].sort((left, right) => timestampOf(left) - timestampOf(right))) {
    if (record.data?.kind !== "mailbox_sync") continue;
    for (const folder of record.data.folders ?? []) latestById.set(folder.id, folder);
  }
  if (!latestById.has("inbox")) latestById.set("inbox", { id: "inbox", name: "Inbox", count: 0, unread: null, specialUse: "\\Inbox" });
  return [...latestById.values()]
    .map((folder) => {
      const cached = messages.filter((message) => message.folderId === folder.id);
      return {
        id: folder.id,
        name: folder.name,
        kind: "provider",
        specialUse: folder.specialUse ?? null,
        count: cached.length,
        unread: cached.filter((message) => message.unread).length,
        cursorReset: folder.cursorReset === true,
        syncError: folder.syncError === true,
      };
    })
    .sort((left, right) => folderRank(left) - folderRank(right) || left.name.localeCompare(right.name));
}

function latestMailboxCursors(results) {
  const byPath = new Map();
  for (const record of [...results].sort((left, right) => timestampOf(left) - timestampOf(right))) {
    if (record.data?.kind !== "mailbox_sync") continue;
    for (const cursor of record.data.cursors ?? []) byPath.set(cursor.folderPath, cursor);
  }
  return [...byPath.values()].slice(0, 20).map(({ folderPath, uidValidity, lastUid }) => ({ folderPath, uidValidity, lastUid }));
}

function normalizeSearchQuery(value) {
  return cap(String(value ?? "").trim(), MAX_SEARCH).normalize("NFKC").toLocaleLowerCase();
}

function matchesMailSearch(message, query) {
  if (!query) return true;
  return [message.from, message.subject, message.preview, message.body]
    .filter((value) => typeof value === "string")
    .some((value) => value.normalize("NFKC").toLocaleLowerCase().includes(query));
}

function folderRank(folder) {
  if (folder.id === "inbox" || folder.specialUse === "\\Inbox") return 0;
  if (folder.specialUse === "\\Sent") return 1;
  if (folder.specialUse === "\\Drafts") return 2;
  if (folder.specialUse === "\\Archive") return 3;
  if (folder.specialUse === "\\Trash") return 8;
  if (folder.specialUse === "\\Junk") return 9;
  return 5;
}

function publicDraft(draft) {
  return {
    id: draft.id,
    status: draft.status,
    revision: Number(draft.revision ?? 0),
    origin: draft.origin ?? (draft.provenance ? "reply" : "legacy"),
    to: draft.to ?? "",
    subject: draft.subject ?? "",
    body: draft.body ?? "",
    inReplyTo: draft.inReplyTo ?? null,
    references: Array.isArray(draft.references) ? draft.references : [],
    attachments: Array.isArray(draft.attachments) ? draft.attachments : [],
    createdAt: draft.createdAt ?? null,
    updatedAt: draft.updatedAt ?? draft.createdAt ?? null,
    sentAt: draft.sentAt ?? null,
    sendError: draft.sendError ?? null,
    approvalTarget: mailSendApprovalTarget(draft),
  };
}

function validateDraftFields({ to, subject, body, attachments = [] }) {
  const normalizedTo = cap(String(to ?? "").trim(), MAX_RECIPIENT);
  const normalizedSubject = cap(String(subject ?? "").trim(), MAX_SUBJECT);
  const normalizedBody = cap(String(body ?? ""), MAX_BODY);
  // Drafts may be incomplete while the user is writing. The send gate remains
  // fail-closed on recipient/body, and the client highlights missing fields
  // before asking for an approval grant.
  if (normalizedTo && !validRecipientList(normalizedTo)) return { ok: false, status: 422, body: { error: "mail_recipient_invalid" } };
  const normalizedAttachments = normalizeDraftAttachments(attachments);
  if (!normalizedAttachments.ok) return normalizedAttachments;
  return { ok: true, to: normalizedTo, subject: normalizedSubject, body: normalizedBody, attachments: normalizedAttachments.attachments };
}

function normalizeDraftAttachments(input) {
  if (!Array.isArray(input) || input.length > MAX_DRAFT_ATTACHMENTS) return { ok: false, status: 422, body: { error: "mail_attachments_invalid" } };
  const attachments = [];
  const refs = new Set();
  let total = 0;
  for (const item of input) {
    const ref = cap(item?.ref, 80);
    const name = cap(item?.name, 255);
    const contentType = cap(item?.contentType, 127) || "application/octet-stream";
    const size = Number(item?.size);
    if (!/^mailatt_[a-f0-9-]{36}$/.test(ref) || !name || !Number.isInteger(size) || size < 0 || size > MAX_DRAFT_ATTACHMENT_BYTES || refs.has(ref)) {
      return { ok: false, status: 422, body: { error: "mail_attachments_invalid" } };
    }
    refs.add(ref);
    total += size;
    if (total > MAX_DRAFT_ATTACHMENT_BYTES) return { ok: false, status: 422, body: { error: "mail_attachments_too_large" } };
    attachments.push({ ref, name, contentType, size });
  }
  return { ok: true, attachments };
}

function validRecipientList(value) {
  const entries = splitRecipientList(value);
  if (!entries.length || entries.length > 20) return false;
  return entries.every((entry) => {
    const bracketed = entry.match(/<([^<>]+)>$/)?.[1] ?? entry;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bracketed.trim());
  });
}

function splitRecipientList(value) {
  const entries = [];
  let current = "";
  let quote = null;
  let angleDepth = 0;
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (quote && character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (character === '"' || character === "'") {
      if (!quote) quote = character;
      else if (quote === character) quote = null;
      current += character;
      continue;
    }
    if (!quote && character === "<") angleDepth += 1;
    if (!quote && character === ">") angleDepth = Math.max(0, angleDepth - 1);
    const commaSeparates = character === "," && angleDepth === 0 && (current.includes("@") || current.includes(">"));
    if (!quote && angleDepth === 0 && (character === ";" || commaSeparates)) {
      if (current.trim()) entries.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim()) entries.push(current.trim());
  return entries;
}

function mailTools(application) {
  return (application.capabilityFacades ?? []).map((facade) => facade.agentToolName ?? facade.toolName).filter(Boolean);
}

function capabilityName(application, toolName) {
  const facade = (application.capabilityFacades ?? []).find((item) => (item.agentToolName ?? item.toolName) === toolName);
  return facade ? `app.${application.id}.${facade.id}` : null;
}

function providerOf(application) {
  return String(application.source?.credential?.provider ?? application.source?.manifest?.provider ?? "mail").toLowerCase();
}

function preferredMailProvider(applications, actor) {
  const application = applications.find((item) =>
    !item.successorApplicationId
    && (!actor?.teamId || (item.ownerTeamId ?? "team_local") === actor.teamId)
    && mailTools(item).some((tool) => ["mail_sync", "mail_list_unread", "mail_fetch"].includes(tool)),
  );
  return application ? providerOf(application) : null;
}

function providerLabel(provider, fallback) {
  if (provider === "netease" || provider === "163") return "163 Mail";
  if (provider === "google" || provider === "gmail") return "Gmail";
  return fallback || "Email";
}

function compareApplicationReadiness(left, right) {
  const rank = (application) => application.status === "active" ? 2 : application.status === "registered" ? 1 : 0;
  return rank(right) - rank(left) || timestampOf(right) - timestampOf(left);
}

function compareRecent(left, right) {
  return Date.parse(right.updatedAt ?? right.createdAt ?? right.date ?? "") - Date.parse(left.updatedAt ?? left.createdAt ?? left.date ?? "");
}

function timestampOf(value) {
  const parsed = Date.parse(value?.updatedAt ?? value?.createdAt ?? value?.date ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestTimestamp(rows) {
  return rows.map((row) => row.updatedAt ?? row.createdAt ?? null).filter(Boolean).sort().at(-1) ?? null;
}
