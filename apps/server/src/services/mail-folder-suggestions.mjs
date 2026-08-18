import { createHash } from "node:crypto";

import { makeRunTx } from "../runtime/store/run-tx.mjs";

const MAX_PREVIEWS_PER_TEAM = 200;
const MAX_PREVIEW_MESSAGES = 50;
const MAX_AUTOMATIC_MESSAGES = 10;
const PREVIEW_TTL_MS = 30 * 60 * 1000;
const BLOCKED_SPECIAL_USES = new Set(["\\Inbox", "\\Sent", "\\Drafts", "\\Trash", "\\Junk"]);
const ELIGIBLE_DESTINATIONS = new Map([
  ["newsletter", "subscriptions"],
  ["marketing", "subscriptions"],
  ["transaction", "notifications"],
  ["calendar", "notifications"],
  ["system_notification", "notifications"],
]);
const FOLDER_NAME_SIGNALS = {
  subscriptions: ["subscription", "subscriptions", "newsletter", "newsletters", "订阅", "推广", "营销"],
  notifications: ["notification", "notifications", "receipt", "receipts", "通知", "回执", "账单"],
};

export function createMailFolderSuggestionService({
  state,
  now,
  nextId,
  classificationService,
  persistStateSoon = () => {},
  store,
} = {}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  state.mailFolderMovePreviews ??= [];

  function teamIdOf(actor) {
    return actor?.teamId ?? "team_local";
  }

  function catalog({ messages = [], folders = [], actor = null } = {}) {
    const suggestions = deriveSuggestions({ state, messages, folders, actor, classificationService })
      .map(({ matches: _matches, ...suggestion }) => suggestion);
    return { status: 200, body: { suggestions, movesSupported: false } };
  }

  function createPreview({
    suggestionId, destinationFolderId = null, messages = [], folders = [], actor = null,
    purpose = "manual", limit = MAX_PREVIEW_MESSAGES, allowedMessageKeys = null, excludedMessageKeys = null, recoveryOfJobId = null,
  } = {}) {
    if (typeof suggestionId !== "string" || !suggestionId.trim()) {
      return { status: 400, body: { error: "mail_folder_suggestion_invalid" } };
    }
    const suggestion = deriveSuggestions({ state, messages, folders, actor, classificationService })
      .find((item) => item.id === suggestionId);
    if (!suggestion) return { status: 404, body: { error: "mail_folder_suggestion_not_found" } };
    const requestedDestination = destinationFolderId == null || destinationFolderId === ""
      ? null
      : folders.find((folder) => folder.accountId === suggestion.accountId && folder.id === String(destinationFolderId));
    if (destinationFolderId && (!requestedDestination || !folderCanReceiveMail(requestedDestination))) {
      return { status: 400, body: { error: "mail_folder_destination_invalid" } };
    }
    const destination = requestedDestination
      ? publicDestination(requestedDestination, suggestion.destinationCategory)
      : suggestion.proposedDestination;
    const allowedByRecovery = allowedMessageKeys instanceof Set
      ? suggestion.matches.filter((message) => allowedMessageKeys.has(messageKey(message)))
      : suggestion.matches;
    const allowed = excludedMessageKeys instanceof Set
      ? allowedByRecovery.filter((message) => !excludedMessageKeys.has(messageKey(message)))
      : allowedByRecovery;
    const selected = allowed.slice(0, Math.min(MAX_PREVIEW_MESSAGES, Math.max(1, Number(limit) || MAX_PREVIEW_MESSAGES)));
    if (!selected.length) return { status: 409, body: { error: "mail_folder_preview_has_no_recoverable_messages" } };
    const timestamp = now();
    const preview = {
      id: nextId("mailfolderpreview"), ownerTeamId: teamIdOf(actor), accountId: suggestion.accountId,
      suggestionId: suggestion.id, classificationRuleId: suggestion.classificationRuleId,
      classificationRuleRevision: suggestion.classificationRuleRevision,
      destination: {
        kind: destination.kind, folderId: destination.folderId, folderPath: destination.folderPath,
        name: destination.name, category: destination.category,
      },
      messageKeys: selected.map((message) => messageKey(message)),
      messageFingerprint: messageFingerprint(selected),
      totalMatched: allowed.length, selectedCount: selected.length,
      remainingCount: Math.max(0, allowed.length - selected.length),
      purpose: ["manual", "automatic", "recovery"].includes(purpose) ? purpose : "manual",
      recoveryOfJobId: recoveryOfJobId ? String(recoveryOfJobId).slice(0, 160) : null,
      status: "previewed", revision: 1, createdAt: timestamp,
      expiresAt: new Date(new Date(timestamp).getTime() + PREVIEW_TTL_MS).toISOString(),
    };
    runTx(() => {
      state.mailFolderMovePreviews.unshift(preview);
      capTeamRows(state.mailFolderMovePreviews, teamIdOf(actor), MAX_PREVIEWS_PER_TEAM);
    });
    return {
      status: 201,
      body: {
        preview: {
          id: preview.id, accountId: preview.accountId, suggestionId: preview.suggestionId,
          destination: preview.destination, totalMatched: preview.totalMatched,
          selectedCount: preview.selectedCount, remainingCount: preview.remainingCount,
          status: preview.status, revision: preview.revision, expiresAt: preview.expiresAt,
          purpose: preview.purpose, recoveryOfJobId: preview.recoveryOfJobId,
          approvalTarget: previewApprovalTarget(preview),
          samples: selected.map(publicSample),
          movesSupported: false,
        },
      },
    };
  }

  function createAutomaticPreview(input = {}) {
    return createPreview({ ...input, purpose: "automatic", limit: MAX_AUTOMATIC_MESSAGES });
  }

  function inspectAutomaticPreview({ suggestionId, destinationFolderId = null, messages = [], folders = [], actor = null } = {}) {
    const suggestion = deriveSuggestions({ state, messages, folders, actor, classificationService })
      .find((item) => item.id === String(suggestionId ?? ""));
    if (!suggestion) {
      return {
        status: 200,
        body: { dryRun: { selectedCount: 0, matchedCount: 0, excludedCount: 0, exclusionReasons: ["no_matching_messages"] } },
      };
    }
    const requestedDestination = destinationFolderId == null || destinationFolderId === ""
      ? null
      : folders.find((folder) => folder.accountId === suggestion.accountId && folder.id === String(destinationFolderId));
    if (destinationFolderId && (!requestedDestination || !folderCanReceiveMail(requestedDestination))) {
      return { status: 409, body: { error: "mail_folder_destination_invalid" } };
    }
    const destination = requestedDestination
      ? publicDestination(requestedDestination, suggestion.destinationCategory)
      : suggestion.proposedDestination;
    const selected = suggestion.matches.slice(0, MAX_AUTOMATIC_MESSAGES);
    const batchLimited = Math.max(0, suggestion.matches.length - selected.length);
    const exclusionReasons = [];
    if (suggestion.protectedCount) exclusionReasons.push("protected_message");
    if (batchLimited) exclusionReasons.push("batch_limit");
    return {
      status: 200,
      plan: {
        accountId: suggestion.accountId,
        classificationRuleId: suggestion.classificationRuleId,
        classificationRuleRevision: suggestion.classificationRuleRevision,
        destination,
        messageKeys: selected.map(messageKey),
        messageFingerprint: messageFingerprint(selected),
      },
      body: {
        dryRun: {
          accountId: suggestion.accountId,
          destination,
          selectedCount: selected.length,
          matchedCount: suggestion.matches.length,
          excludedCount: suggestion.protectedCount + batchLimited,
          exclusions: { protected: suggestion.protectedCount, batchLimit: batchLimited },
          exclusionReasons,
        },
      },
    };
  }

  function createRecoveryPreview({ job, messages = [], folders = [], actor = null } = {}) {
    const retryable = new Set((job?.items ?? [])
      .filter((item) => item.status === "pending")
      .map((item) => item.messageKey));
    return createPreview({
      suggestionId: job?.suggestionId,
      destinationFolderId: job?.destination?.kind === "existing" ? job.destination.folderId : null,
      messages, folders, actor, purpose: "recovery", allowedMessageKeys: retryable,
      recoveryOfJobId: job?.id,
    });
  }

  function prepareExecution({ previewId, messages = [], folders = [], actor = null, allowedPurposes = ["manual"] } = {}) {
    const preview = state.mailFolderMovePreviews.find((item) => item.id === String(previewId ?? "") && item.ownerTeamId === teamIdOf(actor));
    if (!preview) return { ok: false, status: 404, body: { error: "mail_folder_preview_not_found" } };
    const purpose = preview.purpose ?? "manual";
    if (!allowedPurposes.includes(purpose)) return { ok: false, status: 409, body: { error: "mail_folder_preview_purpose_mismatch" } };
    if (preview.status !== "previewed") return { ok: false, status: 409, body: { error: "mail_folder_preview_not_executable", status: preview.status } };
    const expiry = Date.parse(preview.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= Date.parse(now())) return { ok: false, status: 409, body: { error: "mail_folder_preview_expired" } };
    const suggestion = deriveSuggestions({ state, messages, folders, actor, classificationService }).find((item) => item.id === preview.suggestionId);
    if (!suggestion || suggestion.classificationRuleRevision !== preview.classificationRuleRevision) return { ok: false, status: 409, body: { error: "mail_folder_preview_stale" } };
    const selected = suggestion.matches.slice(0, preview.messageKeys.length);
    const keys = selected.map(messageKey);
    if (messageFingerprint(selected) !== preview.messageFingerprint || keys.length !== preview.messageKeys.length || keys.some((key, index) => key !== preview.messageKeys[index])) {
      return { ok: false, status: 409, body: { error: "mail_folder_preview_stale" } };
    }
    let destination = preview.destination;
    if (destination.kind === "existing") {
      const folder = folders.find((item) => item.accountId === preview.accountId && item.id === destination.folderId && folderCanReceiveMail(item));
      if (!folder || folder.path !== destination.folderPath) return { ok: false, status: 409, body: { error: "mail_folder_preview_stale" } };
      destination = publicDestination(folder, destination.category);
    }
    return {
      ok: true, status: 200, preview,
      execution: {
        accountId: preview.accountId,
        destination,
        destinationName: destination.kind === "new" ? providerFolderName(destination.category) : null,
        messages: selected.map((message) => ({
          messageKey: messageKey(message),
          messageId: String(message.messageId ?? "").slice(0, 998),
          sourceFolderPath: String(message.folderPath ?? "INBOX").slice(0, 998),
        })),
        approvalTarget: previewApprovalTarget(preview),
      },
    };
  }

  return { catalog, createPreview, createAutomaticPreview, inspectAutomaticPreview, createRecoveryPreview, prepareExecution };
}

export function previewApprovalTarget(preview) {
  return `${preview.id}@${preview.revision}:${preview.messageFingerprint}`;
}

function providerFolderName(category) {
  return category === "notifications" ? "Notifications" : "Subscriptions";
}

function deriveSuggestions({ state, messages, folders, actor, classificationService }) {
  const teamId = actor?.teamId ?? "team_local";
  const inboxIdsByAccount = new Map();
  for (const folder of folders) {
    if (folder.specialUse !== "\\Inbox" && folder.id !== "inbox") continue;
    const ids = inboxIdsByAccount.get(folder.accountId) ?? new Set();
    ids.add(folder.id);
    inboxIdsByAccount.set(folder.accountId, ids);
  }
  const rules = (state.mailClassificationRules ?? [])
    .filter((rule) => rule.ownerTeamId === teamId && rule.status === "active" && ELIGIBLE_DESTINATIONS.has(rule.target?.mailType));
  return rules.flatMap((rule) => {
    const destinationCategory = ELIGIBLE_DESTINATIONS.get(rule.target.mailType);
    const inboxIds = inboxIdsByAccount.get(rule.accountId) ?? new Set(["inbox"]);
    const matches = messages
      .filter((message) => String(message.applicationId ?? "mail") === rule.accountId)
      .filter((message) => inboxIds.has(message.folderId ?? "inbox") || String(message.folderPath ?? "").toUpperCase() === "INBOX")
      .filter((message) => ruleMatchesMessage(rule, message))
      .filter((message) => {
        const classification = classificationService?.publicFor(message, actor);
        return classification?.source !== "manual" && !classificationIsProtected(classification);
      })
      .sort((left, right) => String(right.date ?? "").localeCompare(String(left.date ?? "")));
    if (!matches.length) return [];
    const existingDestination = findExistingDestination(folders, rule.accountId, destinationCategory);
    return [{
      id: suggestionId(rule, destinationCategory), accountId: rule.accountId,
      classificationRuleId: rule.id, classificationRuleRevision: rule.revision,
      matchKind: rule.matchKind, matchValue: rule.matchValue,
      destinationCategory, affectedCount: matches.length,
      protectedCount: messages
        .filter((message) => String(message.applicationId ?? "mail") === rule.accountId)
        .filter((message) => inboxIds.has(message.folderId ?? "inbox") || String(message.folderPath ?? "").toUpperCase() === "INBOX")
        .filter((message) => ruleMatchesMessage(rule, message) && classificationIsProtected(classificationService?.publicFor(message, actor))).length,
      proposedDestination: existingDestination
        ? publicDestination(existingDestination, destinationCategory)
        : { kind: "new", folderId: null, folderPath: null, name: null, category: destinationCategory },
      folderOptions: folders
        .filter((folder) => folder.accountId === rule.accountId && folderCanReceiveMail(folder))
        .map((folder) => publicDestination(folder, destinationCategory)),
      samples: matches.slice(0, 5).map(publicSample),
      matches,
    }];
  });
}

function classificationIsProtected(classification) {
  return !classification
    || ["action_required", "reply_expected", "important"].includes(classification.attention)
    || classification.mailType === "account_security";
}

function ruleMatchesMessage(rule, message) {
  const identity = senderIdentity(message.from);
  return rule.matchKind === "sender"
    ? identity.email === rule.matchValue
    : rule.matchKind === "domain" && identity.domain === rule.matchValue;
}

function senderIdentity(value) {
  const input = String(value ?? "").trim().toLowerCase();
  const angle = input.match(/<([^<>\s]+@[^<>\s]+)>/);
  const plain = input.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  const email = String(angle?.[1] ?? plain?.[0] ?? "").replace(/[>,;]+$/g, "").slice(0, 320);
  const separator = email.lastIndexOf("@");
  return { email, domain: separator > 0 ? email.slice(separator + 1) : "" };
}

function findExistingDestination(folders, accountId, category) {
  const signals = FOLDER_NAME_SIGNALS[category] ?? [];
  return folders.find((folder) => {
    if (folder.accountId !== accountId || !folderCanReceiveMail(folder)) return false;
    const value = `${folder.name ?? ""} ${folder.path ?? ""}`.normalize("NFKC").toLowerCase();
    return signals.some((signal) => value.includes(signal));
  }) ?? null;
}

function folderCanReceiveMail(folder) {
  const specialUse = typeof folder?.specialUse === "string"
    ? [...BLOCKED_SPECIAL_USES].find((value) => value.toLowerCase() === folder.specialUse.toLowerCase())
    : null;
  return folder?.id && !specialUse && folder.syncError !== true;
}

function publicDestination(folder, category) {
  return {
    kind: "existing", folderId: folder.id, folderPath: folder.path ?? null,
    name: String(folder.name ?? folder.path ?? folder.id).slice(0, 255), category,
  };
}

function publicSample(message) {
  return {
    messageId: String(message.messageId ?? "").slice(0, 998),
    from: String(message.from ?? "").slice(0, 998),
    subject: String(message.subject ?? "").slice(0, 400),
    date: message.date ?? null,
    folderId: String(message.folderId ?? "inbox").slice(0, 100),
  };
}

function suggestionId(rule, category) {
  return `mailfoldersug_${createHash("sha256")
    .update(`${rule.ownerTeamId}\0${rule.accountId}\0${rule.id}\0${rule.revision}\0${category}`)
    .digest("hex").slice(0, 24)}`;
}

function messageKey(message) {
  return createHash("sha256")
    .update(String(message.applicationId ?? "mail"))
    .update("\0").update(String(message.folderId ?? "inbox"))
    .update("\0").update(String(message.messageId ?? ""))
    .digest("hex");
}

function messageFingerprint(messages) {
  return createHash("sha256").update(messages.map(messageKey).sort().join("\0")).digest("hex");
}

function capTeamRows(rows, teamId, max) {
  const own = rows.filter((row) => row.ownerTeamId === teamId).slice(0, max);
  const other = rows.filter((row) => row.ownerTeamId !== teamId);
  rows.splice(0, rows.length, ...own, ...other);
}
