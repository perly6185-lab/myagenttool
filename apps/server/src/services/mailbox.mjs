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
import { MAIL_CLASSIFIER_VERSION, mailMessageKey } from "./mail-header-classifier.mjs";
import { backfillMailFacts, mailFactRecords } from "./mail-facts.mjs";

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
const ACTIVE_PREFETCH_STATUSES = new Set(["queued", "waiting_for_local_approval", "dispatching", "running", "cancelling"]);
const MAX_BODY_PREFETCH_JOBS = 5_000;
const MAX_BODY_PREFETCH_ATTEMPTS = 3;
const MAIL_SMART_VIEWS = new Set(["all", "needs_attention", "important", "notifications", "subscriptions", "other"]);

const cap = (value, max) => typeof value === "string" ? value.slice(0, max) : "";

export function isMailClassificationEnabled() {
  return process.env.MYAGENTTOOL_MAIL_CLASSIFICATION_ENABLED !== "0";
}

export function createMailboxService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon = () => {},
  store,
  mailSendEnabled = () => false,
  mailOrganizeEnabled = () => false,
  mailAutoOrganizeEnabled = () => false,
  mailClassificationEnabled = isMailClassificationEnabled,
  createCapabilityInvocation = null,
  createWorkItem = null,
  inspectTaskMaterialDraft = null,
  classificationService = null,
  folderSuggestionService = null,
  folderOrganizationService = null,
  mailQueryIndex = null,
}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  runTx(() => { backfillMailFacts(state); });

  function snapshot({ actor = null, page = 1, pageSize = DEFAULT_PAGE_SIZE, folder = "inbox", query = "", view = "all" } = {}) {
    const teamId = actor?.teamId ?? null;
    const applications = (state.applications ?? []).filter((application) =>
      teamId == null || (application.ownerTeamId ?? "team_local") === teamId,
    );
    const drafts = (state.mailDrafts ?? []).filter((draft) =>
      teamId == null || (draft.ownerTeamId ?? "team_local") === teamId,
    );
    const accounts = mailboxAccounts(applications, {
      sendEnabled: Boolean(mailSendEnabled()),
      organizeEnabled: Boolean(mailOrganizeEnabled()),
      credentialReadiness: listDevices(state)[0]?.applicationCredentialReadiness ?? [],
    });
    const results = filterActiveMailRecords(mailFactRecords(state, teamId), accounts);
    const normalizedQuery = normalizeSearchQuery(query);
    const classificationEnabled = Boolean(mailClassificationEnabled());
    const selectedView = classificationEnabled && MAIL_SMART_VIEWS.has(view) ? view : "all";
    const folderSkeleton = mailboxProviderFolders(results, []);
    const requestedFolder = folderSkeleton.some((item) => item.id === folder) ? folder : "inbox";
    let importedMessages = null;
    const getImportedMessages = () => {
      importedMessages ??= mailboxMessages(
        results,
        state.mailThreads ?? {},
        (state.mailMessageStates ?? []).filter((row) => teamId == null || (row.ownerTeamId ?? "team_local") === teamId),
        (state.mailTaskLinks ?? []).filter((row) => teamId == null || (row.ownerTeamId ?? "team_local") === teamId),
      ).slice(0, MAX_MESSAGES);
      return importedMessages;
    };
    let indexed = null;
    if (mailQueryIndex && teamId != null) {
      try {
        const request = mailboxPageRequest(page, pageSize);
        indexed = mailQueryIndex.query({
          teamId,
          fingerprint: mailQueryFingerprint(state, teamId, results, classificationEnabled),
          buildRows: () => buildMailQueryRows(getImportedMessages(), state, actor, classificationEnabled ? classificationService : null),
          folderId: requestedFolder,
          searchQuery: normalizedQuery,
          view: selectedView,
          page: request.page,
          pageSize: request.pageSize,
          classifierVersion: MAIL_CLASSIFIER_VERSION,
        });
      } catch {
        // The index is derived data. Corruption, an unsupported SQLite runtime,
        // or a failed rebuild must never make the ordinary mailbox unavailable.
        indexed = null;
      }
    }
    const folderMessages = indexed ? null : getImportedMessages()
      .filter((message) => (message.folderId ?? "inbox") === requestedFolder)
      .filter((message) => matchesMailSearch(message, normalizedQuery));
    const allMessages = indexed ? null : folderMessages.filter((message) => classificationService?.matchesView(message, actor, selectedView) ?? true);
    const pagination = indexed?.pagination ?? mailboxPagination(allMessages.length, page, pageSize);
    const messages = (indexed?.messages ?? allMessages.slice(pagination.offset, pagination.offset + pagination.pageSize)).map((message) => ({
      ...publicMessage(message),
      bodyFetch: publicBodyPrefetchStatus(message, state.mailBodyPrefetchJobs ?? [], teamId),
      ...(classificationEnabled && classificationService ? { classification: classificationService.publicFor(message, actor) } : {}),
    }));
    const providerFolders = indexed
      ? mailboxProviderFolders(results, [], indexed.folderCounts)
      : mailboxProviderFolders(results, getImportedMessages());
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
      selectedView,
      classificationSummary: classificationEnabled
        ? indexed?.classificationSummary ?? classificationService?.summary(folderMessages, actor) ?? null
        : null,
      pagination: publicPagination(pagination),
      drafts: publicDrafts,
      updatedAt: latestTimestamp([...results, ...drafts, ...applications]),
    };
  }

  function startClassification({ scope = "new_mail", mode = "header", confirmed = false, limit = 20, actor = null } = {}) {
    if (!mailClassificationEnabled()) return { ok: false, status: 403, body: { error: "mail_classification_disabled" } };
    if (!classificationService) return { ok: false, status: 503, body: { error: "mail_classification_unavailable" } };
    if (!["header", "semantic"].includes(mode)) return { ok: false, status: 400, body: { error: "mail_classification_mode_invalid" } };
    const messages = messagesForActor(state, actor);
    const result = mode === "semantic"
      ? classificationService.startSemanticJob({ messages, limit, confirmed, actor })
      : classificationService.startJob({ messages, scope, actor });
    return { ok: result.status < 400, ...result };
  }

  function previewSemanticClassification({ limit = 20, actor = null } = {}) {
    if (!mailClassificationEnabled()) return { ok: false, status: 403, body: { error: "mail_classification_disabled" } };
    if (!classificationService) return { ok: false, status: 503, body: { error: "mail_classification_unavailable" } };
    const result = classificationService.semanticPreview({ messages: messagesForActor(state, actor), limit, actor });
    return { ok: result.status < 400, ...result };
  }

  function getClassificationJob({ jobId, actor = null } = {}) {
    if (!mailClassificationEnabled()) return { ok: false, status: 403, body: { error: "mail_classification_disabled" } };
    if (!classificationService) return { ok: false, status: 503, body: { error: "mail_classification_unavailable" } };
    const result = classificationService.getJob({ jobId, actor });
    return { ok: result.status < 400, ...result };
  }

  function cancelClassificationJob({ jobId, actor = null } = {}) {
    if (!mailClassificationEnabled()) return { ok: false, status: 403, body: { error: "mail_classification_disabled" } };
    if (!classificationService) return { ok: false, status: 503, body: { error: "mail_classification_unavailable" } };
    const result = classificationService.cancelJob({ jobId, actor });
    return { ok: result.status < 400, ...result };
  }

  function correctClassification({ messageId, folderId = null, expectedRevision, attention, mailType, suggestedAction, actor = null } = {}) {
    if (!mailClassificationEnabled()) return { ok: false, status: 403, body: { error: "mail_classification_disabled" } };
    if (!classificationService) return { ok: false, status: 503, body: { error: "mail_classification_unavailable" } };
    const normalizedId = cap(String(messageId ?? "").trim(), MAX_RECIPIENT);
    const message = messagesForActor(state, actor).find((candidate) =>
      candidate.messageId === normalizedId && (!folderId || candidate.folderId === String(folderId)),
    );
    const result = classificationService.correct({ message, expectedRevision, attention, mailType, suggestedAction, actor });
    return { ok: result.status < 400, ...result };
  }

  function listClassificationRules({ actor = null } = {}) {
    if (!mailClassificationEnabled()) return { ok: false, status: 403, body: { error: "mail_classification_disabled" } };
    if (!classificationService) return { ok: false, status: 503, body: { error: "mail_classification_unavailable" } };
    const result = classificationService.ruleCatalog({ messages: messagesForActor(state, actor), actor });
    return { ok: result.status < 400, ...result };
  }

  function getClassificationQuality({ actor = null } = {}) {
    if (!mailClassificationEnabled()) return { ok: false, status: 403, body: { error: "mail_classification_disabled" } };
    if (!classificationService?.qualitySummary) return { ok: false, status: 503, body: { error: "mail_classification_quality_unavailable" } };
    return { ok: true, status: 200, body: { quality: classificationService.qualitySummary(messagesForActor(state, actor), actor) } };
  }

  function createClassificationRule({ suggestionId, confirmed = false, actor = null } = {}) {
    if (!mailClassificationEnabled()) return { ok: false, status: 403, body: { error: "mail_classification_disabled" } };
    if (!classificationService) return { ok: false, status: 503, body: { error: "mail_classification_unavailable" } };
    const result = classificationService.createRule({ messages: messagesForActor(state, actor), suggestionId, confirmed, actor });
    return { ok: result.status < 400, ...result };
  }

  function updateClassificationRule({ ruleId, expectedRevision, action, attention, mailType, suggestedAction, actor = null } = {}) {
    if (!mailClassificationEnabled()) return { ok: false, status: 403, body: { error: "mail_classification_disabled" } };
    if (!classificationService) return { ok: false, status: 503, body: { error: "mail_classification_unavailable" } };
    const result = classificationService.updateRule({ ruleId, expectedRevision, action, attention, mailType, suggestedAction, actor });
    return { ok: result.status < 400, ...result };
  }

  function listFolderSuggestions({ actor = null } = {}) {
    if (!mailClassificationEnabled()) return { ok: false, status: 403, body: { error: "mail_classification_disabled" } };
    if (!folderSuggestionService) return { ok: false, status: 503, body: { error: "mail_folder_suggestions_unavailable" } };
    const result = folderSuggestionService.catalog({
      messages: messagesForActor(state, actor), folders: folderContextsForActor(state, actor), actor,
    });
    return { ok: result.status < 400, ...result, body: {
      ...result.body,
      movesSupported: canOrganizeForActor(state, actor, mailOrganizeEnabled),
      automationSupported: result.body?.suggestions?.some((suggestion) => mailAutoOrganizeEnabled(suggestion.accountId)) === true,
    } };
  }

  function createFolderMovePreview({ suggestionId, destinationFolderId = null, actor = null } = {}) {
    if (!folderSuggestionService) return { ok: false, status: 503, body: { error: "mail_folder_suggestions_unavailable" } };
    const result = folderSuggestionService.createPreview({
      suggestionId, destinationFolderId,
      messages: messagesForActor(state, actor), folders: folderContextsForActor(state, actor), actor,
    });
    return { ok: result.status < 400, ...result, body: result.body?.preview ? { ...result.body, preview: { ...result.body.preview, movesSupported: canOrganizeForActor(state, actor, mailOrganizeEnabled) } } : result.body };
  }

  function startFolderMove({ previewId, approvalToken, actor = null } = {}) {
    if (!folderOrganizationService) return { ok: false, status: 503, body: { error: "mail_folder_organization_unavailable" } };
    return folderOrganizationService.start({ previewId, approvalToken, messages: messagesForActor(state, actor), folders: folderContextsForActor(state, actor), actor });
  }

  function getFolderMoveJob({ jobId, actor = null } = {}) {
    if (!folderOrganizationService) return { ok: false, status: 503, body: { error: "mail_folder_organization_unavailable" } };
    return folderOrganizationService.get({ jobId, actor });
  }

  function listFolderMoveJobs({ actor = null } = {}) {
    if (!folderOrganizationService) return { ok: false, status: 503, body: { error: "mail_folder_organization_unavailable" } };
    return folderOrganizationService.list({ actor });
  }

  function reconcileFolderMoveJob({ jobId, actor = null } = {}) {
    if (!folderOrganizationService) return { ok: false, status: 503, body: { error: "mail_folder_organization_unavailable" } };
    return folderOrganizationService.reconcile({ jobId, messages: messagesForActor(state, actor), actor });
  }

  function createFolderRecoveryPreview({ jobId, actor = null } = {}) {
    if (!folderOrganizationService) return { ok: false, status: 503, body: { error: "mail_folder_organization_unavailable" } };
    const result = folderOrganizationService.createRecoveryPreview({
      jobId, messages: messagesForActor(state, actor), folders: folderContextsForActor(state, actor), actor,
    });
    return result?.body?.preview
      ? { ...result, body: { ...result.body, preview: { ...result.body.preview, movesSupported: canOrganizeForActor(state, actor, mailOrganizeEnabled) } } }
      : result;
  }

  function createFolderAutomationPreview({ suggestionId, destinationFolderId = null, actor = null } = {}) {
    if (!folderSuggestionService) return { ok: false, status: 503, body: { error: "mail_folder_suggestions_unavailable" } };
    const messages = messagesForActor(state, actor);
    const folders = folderContextsForActor(state, actor);
    const catalog = folderSuggestionService.catalog({ messages, folders, actor });
    const suggestion = catalog.body?.suggestions?.find((item) => item.id === String(suggestionId ?? ""));
    if (!suggestion) return { ok: false, status: 404, body: { error: "mail_folder_suggestion_not_found" } };
    if (!mailAutoOrganizeEnabled(suggestion.accountId)) return { ok: false, status: 403, body: { error: "mail_folder_automation_disabled" } };
    const result = folderSuggestionService.createAutomaticPreview({
      suggestionId, destinationFolderId,
      messages, folders, actor,
    });
    return { ok: result.status < 400, ...result, body: result.body?.preview ? { ...result.body, preview: { ...result.body.preview, movesSupported: true } } : result.body };
  }

  function enableFolderAutomation({ previewId, approvalToken, confirmed = false, actor = null } = {}) {
    if (!folderOrganizationService) return { ok: false, status: 503, body: { error: "mail_folder_organization_unavailable" } };
    return folderOrganizationService.enableAutomation({
      previewId, approvalToken, confirmed,
      messages: messagesForActor(state, actor), folders: folderContextsForActor(state, actor), actor,
    });
  }

  function updateFolderAutomation({ automationId, expectedRevision, action, actor = null } = {}) {
    if (!folderOrganizationService) return { ok: false, status: 503, body: { error: "mail_folder_organization_unavailable" } };
    return folderOrganizationService.updateAutomation({ automationId, expectedRevision, action, messages: messagesForActor(state, actor), actor });
  }

  function listFolderAutomations({ actor = null } = {}) {
    if (!folderOrganizationService) return { ok: false, status: 503, body: { error: "mail_folder_organization_unavailable" } };
    return folderOrganizationService.listAutomations({ actor });
  }

  function dryRunFolderAutomation({ automationId, actor = null } = {}) {
    if (!folderOrganizationService) return { ok: false, status: 503, body: { error: "mail_folder_organization_unavailable" } };
    return folderOrganizationService.dryRunAutomation({
      automationId,
      messages: messagesForActor(state, actor),
      folders: folderContextsForActor(state, actor),
      actor,
    });
  }

  function runFolderAutomations({ teamId, accountId = null, triggerId = null } = {}) {
    if (!teamId || !folderOrganizationService) return { ok: false, status: 400, body: { error: "mail_folder_automation_team_required" } };
    const actor = { teamId, userId: "system_mail_automation" };
    return folderOrganizationService.runAutomations({
      messages: messagesForActor(state, actor), folders: folderContextsForActor(state, actor), actor, accountId, triggerId,
    });
  }

  function setMessageRead({ messageId, read = true, actor = null } = {}) {
    const normalizedId = cap(String(messageId ?? "").trim(), MAX_RECIPIENT);
    const teamId = actor?.teamId ?? "team_local";
    if (!normalizedId) return { ok: false, status: 400, body: { error: "mail_message_invalid" } };
    const teamResults = filterActiveMailRecords(mailFactRecords(state, teamId), mailboxAccounts((state.applications ?? []).filter((item) => (item.ownerTeamId ?? "team_local") === teamId), { credentialReadiness: listDevices(state)[0]?.applicationCredentialReadiness ?? [] }));
    const message = mailboxMessages(teamResults, state.mailThreads ?? {}, []).find((item) => item.messageId === normalizedId);
    if (!message) return { ok: false, status: 404, body: { error: "mail_message_not_found" } };
    const messageApplication = (state.applications ?? []).find((item) => item.id === message.applicationId && !item.successorApplicationId);
    const application = (messageApplication && capabilityName(messageApplication, "mail_set_read") ? messageApplication : null)
      ?? (state.applications ?? []).find((item) => !item.successorApplicationId && providerOf(item) === providerOf(messageApplication) && capabilityName(item, "mail_set_read"))
      ?? (state.applications ?? []).find((item) => !item.successorApplicationId && capabilityName(item, "mail_set_read"));
    const capability = application ? capabilityName(application, "mail_set_read") : null;
    if (!capability || typeof createCapabilityInvocation !== "function") {
      persistLocalReadState(normalizedId, read, teamId, message.accountId ?? null);
      return { ok: true, status: 200, body: { messageId: normalizedId, unread: read === false } };
    }
    const result = createCapabilityInvocation(capability, { messageId: normalizedId, folderPath: message.folderPath ?? "INBOX", read: read !== false }, actor);
    if (!result || result.status >= 400) return { ok: false, status: 409, body: { error: "mail_read_state_sync_failed" } };
    return { ok: true, status: 202, body: { messageId: normalizedId, unread: read === false, pending: true, invocationId: result.body?.invocationId ?? null } };
  }

  function persistLocalReadState(messageId, read, teamId, accountId = null) {
    runTx(() => {
      state.mailMessageStates = (state.mailMessageStates ?? []).filter((row) => !(row.messageId === messageId && (row.ownerTeamId ?? "team_local") === teamId && (row.accountId ?? null) === accountId));
      if (read !== false) {
        const readAt = now();
        state.mailMessageStates.unshift({ id: nextId("mailmsgstate"), messageId, accountId, ownerTeamId: teamId, readAt, createdAt: readAt, updatedAt: readAt });
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
      organizeEnabled: Boolean(mailOrganizeEnabled()),
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
    const cursors = latestMailboxCursors(filterActiveMailRecords(mailFactRecords(state, teamId), [account]));
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

  function enqueueBodyPrefetch({ ownerTeamId = "team_local", applicationId = null, messages = [], commit = true, schedule = true } = {}) {
    if (!applicationId || !Array.isArray(messages) || messages.length === 0) return { queued: 0 };
    const actor = { teamId: ownerTeamId, userId: "system_mail_prefetch" };
    const fetchedIds = new Set(messagesForActor(state, actor).filter(messageBodyPrefetchComplete).map((message) => message.messageId));
    let queued = 0;
    const addJobs = () => {
      state.mailBodyPrefetchJobs ??= [];
      const existingByKey = new Map(state.mailBodyPrefetchJobs.map((job) => [bodyPrefetchKey(job), job]));
      const ordered = [...messages].sort((left, right) => {
        if ((left?.unread !== false) !== (right?.unread !== false)) return left?.unread !== false ? -1 : 1;
        return timestampOf(right) - timestampOf(left);
      });
      for (const message of ordered) {
        const messageId = cap(String(message?.messageId ?? "").trim(), MAX_RECIPIENT);
        if (!messageId || fetchedIds.has(messageId)) continue;
        const candidate = { ownerTeamId, applicationId, accountId: message?.accountId ?? null, messageId };
        const existing = existingByKey.get(bodyPrefetchKey(candidate));
        const folderPath = cap(message?.folderPath, MAX_RECIPIENT) || "INBOX";
        if (existing) {
          if (existing.folderPath !== folderPath) {
            existing.folderPath = folderPath;
            existing.unread = message?.unread !== false;
            existing.messageDate = cap(message?.date, MAX_RECIPIENT) || existing.messageDate;
            if (["unavailable", "failed"].includes(existing.status)) {
              existing.status = "queued";
              existing.attempt = 0;
              existing.invocationId = null;
              existing.completedAt = null;
              existing.lastError = null;
              existing.nextAttemptAt = now();
              queued += 1;
            }
            existing.updatedAt = now();
          }
          continue;
        }
        const at = now();
        state.mailBodyPrefetchJobs.push({
          id: nextId("mailbody"), ownerTeamId, applicationId, accountId: message?.accountId ?? null, messageId,
          folderPath,
          unread: message?.unread !== false,
          messageDate: cap(message?.date, MAX_RECIPIENT) || null,
          status: "queued", priority: "background", attempt: 0,
          invocationId: null, nextAttemptAt: at, lastError: null,
          createdAt: at, updatedAt: at, completedAt: null,
        });
        existingByKey.set(bodyPrefetchKey(candidate), state.mailBodyPrefetchJobs.at(-1));
        queued += 1;
      }
      state.mailBodyPrefetchJobs = boundBodyPrefetchJobs(state.mailBodyPrefetchJobs);
    };
    if (commit) runTx(addJobs);
    else addJobs();
    if (queued > 0 && schedule) queueMicrotask(() => sweepBodyPrefetch());
    return { queued };
  }

  function backfillBodyPrefetch() {
    const teams = new Set((state.applications ?? []).map((application) => application.ownerTeamId ?? "team_local"));
    let queued = 0;
    runTx(() => {
      for (const ownerTeamId of teams) {
        const actor = { teamId: ownerTeamId, userId: "system_mail_prefetch" };
        const messages = messagesForActor(state, actor);
        const byApplication = new Map();
        for (const message of messages) {
          if (messageBodyPrefetchComplete(message) || !message.applicationId) continue;
          const list = byApplication.get(message.applicationId) ?? [];
          list.push(message);
          byApplication.set(message.applicationId, list);
        }
        for (const [applicationId, applicationMessages] of byApplication) {
          queued += enqueueBodyPrefetch({ ownerTeamId, applicationId, messages: applicationMessages, commit: false, schedule: false }).queued;
        }
      }
    });
    if (queued > 0) {
      queueMicrotask(() => sweepBodyPrefetch());
    }
    return { queued };
  }

  function prioritizeBodyPrefetch({ messageId, actor = null } = {}) {
    const ownerTeamId = actor?.teamId ?? "team_local";
    const normalizedId = cap(String(messageId ?? "").trim(), MAX_RECIPIENT);
    if (!normalizedId) return { ok: false, status: 400, body: { error: "mail_message_invalid" } };
    const message = messagesForActor(state, actor).find((candidate) => candidate.messageId === normalizedId);
    if (!message) return { ok: false, status: 404, body: { error: "mail_message_not_found" } };
    if (messageBodyPrefetchComplete(message)) return { ok: true, status: 200, body: { messageId: normalizedId, bodyFetch: { status: "ready", priority: "user" } } };
    enqueueBodyPrefetch({ ownerTeamId, applicationId: message.applicationId, messages: [message] });
    let job = null;
    runTx(() => {
      job = (state.mailBodyPrefetchJobs ?? []).find((candidate) => bodyPrefetchKey(candidate) === bodyPrefetchKey({ ownerTeamId, applicationId: message.applicationId, messageId: normalizedId })) ?? null;
      if (!job) return;
      job.priority = "user";
      if (["failed", "unavailable"].includes(job.status)) {
        job.attempt = 0;
        job.completedAt = null;
        job.invocationId = null;
        job.lastError = null;
        job.status = "queued";
      } else if (job.status === "retry_wait") {
        job.status = "queued";
      }
      job.nextAttemptAt = now();
      job.updatedAt = now();
    });
    sweepBodyPrefetch();
    return { ok: true, status: 202, body: { messageId: normalizedId, bodyFetch: publicBodyPrefetchJob(job) } };
  }

  function sweepBodyPrefetch() {
    if (typeof createCapabilityInvocation !== "function") return { started: 0 };
    const currentTime = now();
    let dispatch = null;
    runTx(() => {
      for (const job of state.mailBodyPrefetchJobs ?? []) {
        if (!["failed", "retry_wait"].includes(job.status) || !job.invocationId) continue;
        const invocation = (state.invocations ?? []).find((candidate) => candidate.id === job.invocationId);
        if (bodyPrefetchInvocationError(invocation) !== "mail_message_not_found") continue;
        job.status = "unavailable";
        job.lastError = "mail_message_not_found";
        job.completedAt = currentTime;
        job.updatedAt = currentTime;
      }
      for (const job of state.mailBodyPrefetchJobs ?? []) {
        if (job.status !== "running") continue;
        const actor = { teamId: job.ownerTeamId, userId: "system_mail_prefetch" };
        const message = messagesForActor(state, actor).find((candidate) => candidate.messageId === job.messageId);
        if (messageBodyPrefetchComplete(message)) {
          job.status = "ready";
          job.completedAt = currentTime;
          job.updatedAt = currentTime;
          continue;
        }
        const invocation = (state.invocations ?? []).find((candidate) => candidate.id === job.invocationId);
        if (!invocation || ACTIVE_PREFETCH_STATUSES.has(invocation.status)) continue;
        job.lastError = bodyPrefetchInvocationError(invocation);
        if (job.lastError === "mail_message_not_found") {
          job.status = "unavailable";
          job.completedAt = currentTime;
          job.updatedAt = currentTime;
          continue;
        }
        if (job.attempt < MAX_BODY_PREFETCH_ATTEMPTS) {
          job.status = "retry_wait";
          job.nextAttemptAt = new Date(Date.parse(currentTime) + 5_000 * (2 ** Math.max(0, job.attempt - 1))).toISOString();
        } else {
          job.status = "failed";
          job.completedAt = currentTime;
        }
        job.updatedAt = currentTime;
      }
      for (const job of state.mailBodyPrefetchJobs ?? []) {
        if (job.status === "retry_wait" && dateTimestamp(job.nextAttemptAt) <= dateTimestamp(currentTime)) {
          job.status = "queued";
          job.updatedAt = currentTime;
        }
      }
      const active = (state.mailBodyPrefetchJobs ?? []).some((job) => job.status === "running");
      if (active) return;
      const job = (state.mailBodyPrefetchJobs ?? [])
        .filter((candidate) => candidate.status === "queued" && dateTimestamp(candidate.nextAttemptAt) <= dateTimestamp(currentTime))
        .sort(compareBodyPrefetchPriority)[0] ?? null;
      if (!job) return;
      const application = (state.applications ?? []).find((candidate) => candidate.id === job.applicationId && !candidate.successorApplicationId)
        ?? (state.applications ?? []).find((candidate) => providerOf(candidate) === providerOf((state.applications ?? []).find((item) => item.id === job.applicationId)) && !candidate.successorApplicationId);
      const capability = application ? capabilityName(application, "mail_prefetch_body") : null;
      const currentAccountId = application
        ? (listDevices(state)[0]?.applicationCredentialReadiness ?? []).find((row) => row.applicationId === application.id)?.accountId ?? null
        : null;
      if (job.accountId && currentAccountId && job.accountId !== currentAccountId) {
        job.status = "unavailable";
        job.lastError = "mail_account_changed";
        job.completedAt = currentTime;
        job.updatedAt = currentTime;
        return;
      }
      if (!capability) {
        // A desktop upgrade may still be registering the lightweight facade.
        // Keep the durable job recoverable; never fall back to mail_fetch here,
        // because that path downloads attachment bytes and archives full EML.
        job.status = "retry_wait";
        job.lastError = "mail_body_prefetch_capability_unavailable";
        job.nextAttemptAt = new Date(Date.parse(currentTime) + 30_000).toISOString();
        job.updatedAt = currentTime;
        return;
      }
      dispatch = {
        jobId: job.id,
        capability,
        input: { messageId: job.messageId, folderPath: job.folderPath },
        actor: { teamId: job.ownerTeamId, userId: "system_mail_prefetch" },
      };
    });
    if (!dispatch) return { started: 0 };

    const result = createCapabilityInvocation(dispatch.capability, dispatch.input, dispatch.actor);
    let started = 0;
    runTx(() => {
      const job = (state.mailBodyPrefetchJobs ?? []).find((candidate) => candidate.id === dispatch.jobId);
      if (!job || job.status !== "queued") return;
      job.attempt += 1;
      job.updatedAt = currentTime;
      if (result && result.status < 400 && result.body?.invocationId) {
        job.status = "running";
        job.invocationId = result.body.invocationId;
        job.lastError = null;
        started = 1;
      } else {
        job.status = job.attempt >= MAX_BODY_PREFETCH_ATTEMPTS ? "failed" : "retry_wait";
        job.nextAttemptAt = new Date(Date.parse(currentTime) + 5_000 * (2 ** Math.max(0, job.attempt - 1))).toISOString();
        job.lastError = cap(result?.body?.error, 500) || "mail_body_prefetch_dispatch_failed";
      }
    });
    return { started };
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
    const teamResults = filterActiveMailRecords(mailFactRecords(state, teamId), mailboxAccounts((state.applications ?? []).filter((item) => (item.ownerTeamId ?? "team_local") === teamId), { credentialReadiness: listDevices(state)[0]?.applicationCredentialReadiness ?? [] }));
    const message = mailboxMessages(teamResults, state.mailThreads ?? {}, []).find((item) => item.messageId === normalizedId);
    if (!message) return { ok: false, status: 404, body: { error: "mail_message_not_found" } };

    const messageAccountId = message.accountId ?? message.applicationId ?? null;
    const existing = (state.mailTaskLinks ?? []).find((row) =>
      row.messageId === normalizedId && (row.ownerTeamId ?? "team_local") === teamId && (row.accountId ?? row.applicationId ?? null) === messageAccountId,
    );
    if (existing) return { ok: true, status: 200, body: { task: publicTaskLink(existing), replayed: true } };
    const idempotencyKey = `mail:${createHash("sha256").update(`${teamId}\0${messageAccountId ?? "legacy"}\0${normalizedId}`).digest("hex")}`;
    const recoveredWorkItem = (state.workItems ?? []).find((item) =>
      (item.ownerTeamId ?? "team_local") === teamId && item.createIdempotencyKey === idempotencyKey,
    );
    if (recoveredWorkItem) {
      const recoveredLink = ensureMailTaskLink(message, recoveredWorkItem, teamId, actor);
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
    const durableLink = ensureMailTaskLink(message, workItem, teamId, actor);
    return { ok: true, status: created.status, body: { task: publicTaskLink(durableLink), replayed: created.body.replayed === true } };
  }

  function ensureMailTaskLink(message, workItem, teamId, actor) {
    const messageId = message.messageId;
    const accountId = message.accountId ?? message.applicationId ?? null;
    const timestamp = now();
    const link = {
      id: nextId("mailtask"),
      messageId,
      accountId,
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
      const replay = state.mailTaskLinks.find((row) => row.messageId === messageId && (row.ownerTeamId ?? "team_local") === teamId && (row.accountId ?? row.applicationId ?? null) === accountId);
      if (!replay) state.mailTaskLinks.unshift(link);
    });
    return (state.mailTaskLinks ?? []).find((row) => row.messageId === messageId && (row.ownerTeamId ?? "team_local") === teamId && (row.accountId ?? row.applicationId ?? null) === accountId) ?? link;
  }

  return {
    snapshot, startSync, setMessageRead, createDraft, updateDraft, deleteDraft, createTaskFromMessage,
    enqueueBodyPrefetch, backfillBodyPrefetch, prioritizeBodyPrefetch, sweepBodyPrefetch,
    startClassification, previewSemanticClassification, getClassificationJob, cancelClassificationJob, correctClassification,
    listClassificationRules, getClassificationQuality, createClassificationRule, updateClassificationRule,
    listFolderSuggestions, createFolderMovePreview, startFolderMove, getFolderMoveJob, listFolderMoveJobs,
    reconcileFolderMoveJob, createFolderRecoveryPreview,
    createFolderAutomationPreview, enableFolderAutomation, updateFolderAutomation, listFolderAutomations, dryRunFolderAutomation, runFolderAutomations,
  };
}

export function mailSendApprovalTarget(draft) {
  const revision = Number(draft?.revision ?? 0);
  return revision > 0 ? `${draft.id}@${revision}` : draft?.id ?? "";
}

function canOrganizeForActor(state, actor, enabled) {
  if (!enabled()) return false;
  const teamId = actor?.teamId ?? null;
  const applications = (state.applications ?? []).filter((application) => teamId == null || (application.ownerTeamId ?? "team_local") === teamId);
  return mailboxAccounts(applications, {
    organizeEnabled: true,
    credentialReadiness: listDevices(state)[0]?.applicationCredentialReadiness ?? [],
  }).some((account) => account.canOrganize);
}

function mailboxAccounts(applications, { sendEnabled = false, organizeEnabled = false, credentialReadiness = [] } = {}) {
  const readApps = applications
    .filter((application) => mailTools(application).some((tool) => ["mail_sync", "mail_list_unread", "mail_fetch"].includes(tool)))
    .filter((application) => !application.successorApplicationId)
    .sort(compareApplicationReadiness);
  const sendApps = applications.filter((application) => mailTools(application).includes("mail_send"));
  const organizeApps = applications.filter((application) => mailTools(application).includes("mail_organize_batch"));
  const providers = new Map();
  for (const application of readApps) {
    const provider = providerOf(application);
    if (providers.has(provider)) continue;
    const send = sendApps.find((candidate) => providerOf(candidate) === provider) ?? null;
    const organize = organizeApps.find((candidate) => providerOf(candidate) === provider) ?? null;
    const active = ["active", "registered"].includes(application.status);
    const receiveCredentialReady = credentialReadyForApplication(application, credentialReadiness);
    const receiveReadiness = credentialReadiness.find((row) => row.applicationId === application.id) ?? null;
    const canReceive = active && receiveCredentialReady;
    providers.set(provider, {
      id: application.id,
      provider,
      accountId: receiveReadiness?.accountId ?? null,
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
      canOrganize: Boolean(organizeEnabled && organize && ["active", "registered"].includes(organize.status) && credentialReadyForApplication(organize, credentialReadiness)),
      organizeApplicationId: organize?.id ?? null,
      syncCapability: capabilityName(application, "mail_sync") ?? capabilityName(application, "mail_list_unread"),
      fetchCapability: capabilityName(application, "mail_fetch"),
      bodyPrefetchCapability: capabilityName(application, "mail_prefetch_body"),
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

function bodyPrefetchKey(job) {
  return `${job?.ownerTeamId ?? "team_local"}\0${job?.applicationId ?? "mail"}\0${job?.accountId ?? "legacy"}\0${job?.messageId ?? ""}`;
}

function compareBodyPrefetchPriority(left, right) {
  if (left.priority !== right.priority) return left.priority === "user" ? -1 : 1;
  if (left.unread !== right.unread) return left.unread !== false ? -1 : 1;
  return dateTimestamp(right.messageDate) - dateTimestamp(left.messageDate)
    || dateTimestamp(left.createdAt) - dateTimestamp(right.createdAt);
}

function publicBodyPrefetchJob(job) {
  if (!job) return { status: "unavailable", priority: "background", attempt: 0, lastError: null };
  return { status: job.status, priority: job.priority, attempt: job.attempt, lastError: job.lastError ?? null };
}

function publicBodyPrefetchStatus(message, jobs, teamId) {
  if (messageBodyPrefetchComplete(message)) return { status: "ready", priority: "background", attempt: 0, lastError: null };
  const job = jobs.find((candidate) =>
    (teamId == null || (candidate.ownerTeamId ?? "team_local") === teamId)
    && candidate.messageId === message?.messageId
    && (!message?.applicationId || candidate.applicationId === message.applicationId)
    && (!message?.accountId || !candidate.accountId || candidate.accountId === message.accountId));
  return publicBodyPrefetchJob(job);
}

function messageBodyPrefetchComplete(message) {
  return Boolean(message?.fetched && message?.bodyContentVersion >= 2 && message?.attachmentMetadataLoaded);
}

function boundBodyPrefetchJobs(jobs) {
  const terminal = new Set(["ready", "failed", "unavailable"]);
  const active = jobs.filter((job) => !terminal.has(job.status));
  const completed = jobs.filter((job) => terminal.has(job.status)).sort((left, right) => dateTimestamp(right.updatedAt) - dateTimestamp(left.updatedAt));
  return [...active, ...completed].slice(0, MAX_BODY_PREFETCH_JOBS);
}

function bodyPrefetchInvocationError(invocation) {
  const output = String(invocation?.result?.output ?? "");
  if (output.includes("mail_message_not_found")) return "mail_message_not_found";
  return cap(invocation?.result?.error ?? invocation?.result?.summary ?? invocation?.summary ?? invocation?.status, 500)
    || "mail_body_prefetch_failed";
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
  const readIds = new Set(readStates.filter((row) => row?.readAt).map((row) => `${row.accountId ?? "legacy"}\0${row.messageId}`));
  const linksByMessageId = new Map(taskLinks.map((row) => [`${row.accountId ?? row.applicationId ?? "legacy"}\0${row.messageId}`, publicTaskLink(row)]));
  return [...messages.values()]
    .map((message) => ({
      ...(readIds.has(`${message.accountId ?? "legacy"}\0${message.messageId}`) ? { ...message, unread: false } : message),
      task: linksByMessageId.get(`${message.accountId ?? message.applicationId ?? "legacy"}\0${message.messageId}`) ?? null,
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
  const { page: normalizedPage, pageSize } = mailboxPageRequest(requestedPage, requestedPageSize);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(totalPages, normalizedPage);
  return { page, pageSize, total, totalPages, offset: (page - 1) * pageSize };
}

function mailboxPageRequest(requestedPage, requestedPageSize) {
  return {
    page: Math.max(1, Number.parseInt(requestedPage, 10) || 1),
    pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(requestedPageSize, 10) || DEFAULT_PAGE_SIZE)),
  };
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
    classificationHeaders: input?.classificationHeaders && typeof input.classificationHeaders === "object"
      ? input.classificationHeaders
      : previous.classificationHeaders ?? null,
    fetched: previous.fetched === true || Object.hasOwn(input ?? {}, "body") || Object.hasOwn(input ?? {}, "bodyHtml"),
    inReplyTo: cap(input?.inReplyTo, MAX_RECIPIENT) || previous.inReplyTo || null,
    references: Array.isArray(input?.references) ? input.references.slice(0, 50) : previous.references ?? [],
    attachments: Array.isArray(input?.attachments) ? input.attachments.slice(0, 50) : previous.attachments ?? [],
    attachmentMetadataLoaded: input?.attachmentMetadataLoaded === true || previous.attachmentMetadataLoaded === true,
    archive: input?.archive && typeof input.archive === "object" ? input.archive : previous.archive ?? null,
    applicationId: record.applicationId ?? previous.applicationId ?? null,
    accountId: input?.accountId ?? record.accountId ?? previous.accountId ?? null,
    issueNumber: threads?.[messageId]?.issueNumber ?? null,
    createdAt: record.createdAt ?? previous.createdAt ?? date,
  });
}

function publicMessage(message) {
  const { providerUid: _providerUid, classificationHeaders: _classificationHeaders, accountId: _accountId, ...value } = message;
  return value;
}

function messagesForActor(state, actor) {
  const teamId = actor?.teamId ?? "team_local";
  const applications = (state.applications ?? []).filter((item) => (item.ownerTeamId ?? "team_local") === teamId);
  const accounts = mailboxAccounts(applications, { credentialReadiness: listDevices(state)[0]?.applicationCredentialReadiness ?? [] });
  const results = filterActiveMailRecords(mailFactRecords(state, teamId), accounts);
  return mailboxMessages(
    results,
    state.mailThreads ?? {},
    (state.mailMessageStates ?? []).filter((row) => (row.ownerTeamId ?? "team_local") === teamId),
    (state.mailTaskLinks ?? []).filter((row) => (row.ownerTeamId ?? "team_local") === teamId),
  ).slice(0, MAX_MESSAGES);
}

function folderContextsForActor(state, actor) {
  const teamId = actor?.teamId ?? "team_local";
  const applications = (state.applications ?? []).filter((item) => (item.ownerTeamId ?? "team_local") === teamId);
  const accounts = mailboxAccounts(applications, { credentialReadiness: listDevices(state)[0]?.applicationCredentialReadiness ?? [] });
  const results = filterActiveMailRecords(mailFactRecords(state, teamId), accounts)
    .sort((left, right) => timestampOf(left) - timestampOf(right));
  const folders = new Map();
  for (const record of results) {
    if (record.data?.kind !== "mailbox_sync") continue;
    const accountId = String(record.applicationId ?? "mail").slice(0, 160);
    for (const folder of record.data.folders ?? []) {
      const id = cap(folder?.id, 100);
      if (!id) continue;
      folders.set(`${accountId}\0${id}`, {
        accountId, id, path: cap(folder.path, MAX_RECIPIENT) || null,
        name: cap(folder.name, 255) || cap(folder.path, MAX_RECIPIENT) || id,
        specialUse: cap(folder.specialUse, 30) || null,
        syncError: folder.syncError === true,
      });
    }
  }
  for (const message of messagesForActor(state, actor)) {
    const accountId = String(message.applicationId ?? "mail").slice(0, 160);
    const id = cap(message.folderId, 100) || "inbox";
    const key = `${accountId}\0${id}`;
    if (!folders.has(key)) folders.set(key, {
      accountId, id, path: cap(message.folderPath, MAX_RECIPIENT) || (id === "inbox" ? "INBOX" : null),
      name: id === "inbox" ? "Inbox" : id, specialUse: id === "inbox" ? "\\Inbox" : null, syncError: false,
    });
  }
  return [...folders.values()].slice(0, 200);
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

function mailboxProviderFolders(results, messages, indexedCounts = null) {
  const latestById = new Map();
  for (const record of [...results].sort((left, right) => timestampOf(left) - timestampOf(right))) {
    if (record.data?.kind !== "mailbox_sync") continue;
    for (const folder of record.data.folders ?? []) latestById.set(folder.id, folder);
  }
  if (!latestById.has("inbox")) latestById.set("inbox", { id: "inbox", name: "Inbox", count: 0, unread: null, specialUse: "\\Inbox" });
  return [...latestById.values()]
    .map((folder) => {
      const cached = indexedCounts?.get(folder.id) ?? null;
      const folderMessages = cached ? [] : messages.filter((message) => message.folderId === folder.id);
      return {
        id: folder.id,
        name: folder.name,
        kind: "provider",
        specialUse: folder.specialUse ?? null,
        count: cached?.count ?? folderMessages.length,
        unread: cached?.unread ?? folderMessages.filter((message) => message.unread).length,
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
  return [...byPath.values()].slice(0, 200).map(({ folderPath, uidValidity, lastUid }) => ({ folderPath, uidValidity, lastUid }));
}

function filterActiveMailRecords(results, accounts) {
  const activeAccountIds = new Set((accounts ?? []).map((account) => account.accountId).filter(Boolean));
  if (!activeAccountIds.size) return results;
  return results.filter((record) => !record.accountId || activeAccountIds.has(record.accountId));
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

function buildMailQueryRows(messages, state, actor, classificationService) {
  const teamId = actor?.teamId ?? "team_local";
  const persistedKeys = new Set((state.mailClassifications ?? [])
    .filter((row) => (row.ownerTeamId ?? "team_local") === teamId)
    .map((row) => row.messageKey));
  return messages.map((message) => {
    const messageKey = mailMessageKey(message);
    const classification = classificationService?.publicFor(message, actor) ?? null;
    return {
      messageKey,
      messageId: String(message.messageId ?? ""),
      accountId: String(message.applicationId ?? "mail"),
      folderId: String(message.folderId ?? "inbox"),
      sortAt: timestampOf(message),
      ordinal: stableMailOrdinal(messageKey),
      unread: message.unread === true,
      smartView: mailSmartView(message, actor, classificationService),
      classified: persistedKeys.has(messageKey),
      searchText: [message.from, message.subject, message.preview, message.body]
        .filter((value) => typeof value === "string")
        .map((value) => value.normalize("NFKC").toLocaleLowerCase())
        .join("\n"),
      payload: {
        ...publicMessage(message),
        ...(classificationService ? { classification } : {}),
      },
    };
  });
}

function stableMailOrdinal(messageKey) {
  const value = Number.parseInt(String(messageKey).slice(0, 12), 16);
  return Number.isSafeInteger(value) ? value : 0;
}

function mailSmartView(message, actor, classificationService) {
  if (!classificationService) return "other";
  for (const view of ["needs_attention", "important", "notifications", "subscriptions"]) {
    if (classificationService.matchesView(message, actor, view)) return view;
  }
  return "other";
}

function mailQueryFingerprint(state, teamId, results, classificationEnabled = true) {
  const hash = createHash("sha256");
  hash.update(`mail-query-v2\0classifier-${MAIL_CLASSIFIER_VERSION}\0classification-${classificationEnabled ? "on" : "off"}\0${teamId}`);
  const addRows = (name, rows, fields) => {
    hash.update(`\0${name}\0${rows.length}`);
    for (const row of [...rows].sort((left, right) => String(left.id ?? left.messageId ?? "").localeCompare(String(right.id ?? right.messageId ?? "")))) {
      hash.update(`\0${fields.map((field) => String(row?.[field] ?? "")).join("\0")}`);
    }
  };
  addRows("results", results, ["id", "applicationId", "createdAt", "updatedAt"]);
  const own = (rows) => (rows ?? []).filter((row) => (row.ownerTeamId ?? "team_local") === teamId);
  addRows("read", own(state.mailMessageStates), ["id", "messageId", "readAt", "updatedAt"]);
  addRows("tasks", own(state.mailTaskLinks), ["id", "messageId", "workItemId", "updatedAt", "title"]);
  addRows("classifications", own(state.mailClassifications), ["id", "messageKey", "revision", "updatedAt"]);
  addRows("rules", own(state.mailClassificationRules), ["id", "revision", "status", "updatedAt"]);
  hash.update(`\0threads\0${JSON.stringify(state.mailThreads ?? {})}`);
  return hash.digest("hex");
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

function dateTimestamp(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestTimestamp(rows) {
  return rows.map((row) => row.updatedAt ?? row.createdAt ?? null).filter(Boolean).sort().at(-1) ?? null;
}
