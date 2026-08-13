/*
 * Ordinary-user mailbox read model + user-authored draft store.
 *
 * Provider credentials and network access stay in the Desktop/MCP process. This
 * service projects already-imported, bounded mail records into a mailbox-shaped
 * API and stores plain-text drafts as server-side artifacts. Sending still goes
 * through mail-send.mjs: callers name a draft and a single-use approval grant;
 * no free-form outbound text crosses the send boundary.
 */

import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { listDevices } from "../runtime/device.mjs";

const MAX_RECIPIENT = 998;
const MAX_SUBJECT = 400;
const MAX_BODY = 20_000;
const MAX_DRAFTS = 200;
const MAX_MESSAGES = 500;

const cap = (value, max) => typeof value === "string" ? value.slice(0, max) : "";

export function createMailboxService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon = () => {},
  store,
  mailSendEnabled = () => false,
}) {
  const runTx = makeRunTx({ store, persistStateSoon });

  function snapshot({ actor = null } = {}) {
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
    const messages = mailboxMessages(results, state.mailThreads ?? {}).slice(0, MAX_MESSAGES);
    const publicDrafts = drafts.map(publicDraft).sort(compareRecent);

    return {
      accounts,
      connection: mailboxConnection(accounts),
      folders: [
        { id: "inbox", count: messages.length, unread: messages.filter((message) => message.unread).length },
        { id: "drafts", count: publicDrafts.filter((draft) => draft.status === "draft").length },
        { id: "sent", count: publicDrafts.filter((draft) => draft.status === "sent").length },
        { id: "outbox", count: publicDrafts.filter((draft) => ["sending", "send_unconfirmed"].includes(draft.status)).length },
      ],
      messages,
      drafts: publicDrafts,
      updatedAt: latestTimestamp([...results, ...drafts, ...applications]),
    };
  }

  function createDraft({ to, subject, body, inReplyTo = null, references = [], actor = null } = {}) {
    const normalized = validateDraftFields({ to, subject, body });
    if (!normalized.ok) return normalized;
    const draft = {
      id: nextId("maildraft"),
      status: "draft",
      revision: 1,
      origin: "user",
      to: normalized.to,
      subject: normalized.subject,
      body: normalized.body,
      bodyFormat: "plain_text",
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

  function updateDraft({ draftId, to, subject, body, actor = null } = {}) {
    const draft = findDraft(draftId, actor);
    if (!draft) return { ok: false, status: 404, body: { error: "mail_draft_not_found" } };
    if (draft.status !== "draft") {
      return { ok: false, status: 409, body: { error: "mail_draft_not_editable", status: draft.status } };
    }
    const normalized = validateDraftFields({ to, subject, body });
    if (!normalized.ok) return normalized;
    runTx(() => {
      draft.to = normalized.to;
      draft.subject = normalized.subject;
      draft.body = normalized.body;
      draft.bodyFormat = "plain_text";
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

  return { snapshot, createDraft, updateDraft, deleteDraft };
}

export function mailSendApprovalTarget(draft) {
  const revision = Number(draft?.revision ?? 0);
  return revision > 0 ? `${draft.id}@${revision}` : draft?.id ?? "";
}

function mailboxAccounts(applications, { sendEnabled = false, credentialReadiness = [] } = {}) {
  const readApps = applications
    .filter((application) => mailTools(application).some((tool) => ["mail_list_unread", "mail_fetch"].includes(tool)))
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
      syncCapability: capabilityName(application, "mail_list_unread"),
      fetchCapability: capabilityName(application, "mail_fetch"),
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

function mailboxMessages(results, threads) {
  const messages = new Map();
  const ordered = [...results].sort((left, right) => timestampOf(left) - timestampOf(right));
  for (const record of ordered) {
    if (record.data?.kind === "unread_headers") {
      for (const header of record.data.headers ?? []) mergeMessage(messages, header, record, true, threads);
    } else if (record.data?.kind === "message") {
      mergeMessage(messages, record.data, record, true, threads);
    }
  }
  return [...messages.values()].sort(compareRecent);
}

function mergeMessage(messages, input, record, unread, threads) {
  const messageId = cap(input?.messageId, MAX_RECIPIENT);
  if (!messageId) return;
  const previous = messages.get(messageId) ?? {};
  const body = typeof input?.body === "string" ? cap(input.body, MAX_BODY) : previous.body ?? null;
  const date = cap(input?.date, MAX_RECIPIENT) || previous.date || record.createdAt || null;
  messages.set(messageId, {
    id: messageId,
    messageId,
    from: cap(input?.from, MAX_RECIPIENT) || previous.from || "Unknown sender",
    subject: cap(input?.subject, MAX_SUBJECT) || previous.subject || "(no subject)",
    date,
    body,
    preview: body ? body.replace(/\s+/g, " ").trim().slice(0, 160) : "",
    unread: previous.unread ?? unread,
    fetched: Boolean(body),
    inReplyTo: cap(input?.inReplyTo, MAX_RECIPIENT) || previous.inReplyTo || null,
    references: Array.isArray(input?.references) ? input.references.slice(0, 50) : previous.references ?? [],
    applicationId: record.applicationId ?? previous.applicationId ?? null,
    issueNumber: threads?.[messageId]?.issueNumber ?? null,
    createdAt: record.createdAt ?? previous.createdAt ?? date,
  });
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
    createdAt: draft.createdAt ?? null,
    updatedAt: draft.updatedAt ?? draft.createdAt ?? null,
    sentAt: draft.sentAt ?? null,
    sendError: draft.sendError ?? null,
    approvalTarget: mailSendApprovalTarget(draft),
  };
}

function validateDraftFields({ to, subject, body }) {
  const normalizedTo = cap(String(to ?? "").trim(), MAX_RECIPIENT);
  const normalizedSubject = cap(String(subject ?? "").trim(), MAX_SUBJECT);
  const normalizedBody = cap(String(body ?? ""), MAX_BODY);
  // Drafts may be incomplete while the user is writing. The send gate remains
  // fail-closed on recipient/body, and the client highlights missing fields
  // before asking for an approval grant.
  if (normalizedTo && !validRecipientList(normalizedTo)) return { ok: false, status: 422, body: { error: "mail_recipient_invalid" } };
  return { ok: true, to: normalizedTo, subject: normalizedSubject, body: normalizedBody };
}

function validRecipientList(value) {
  const entries = value.split(/[;,]/).map((entry) => entry.trim()).filter(Boolean);
  if (!entries.length || entries.length > 20) return false;
  return entries.every((entry) => {
    const bracketed = entry.match(/<([^<>]+)>$/)?.[1] ?? entry;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bracketed.trim());
  });
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
