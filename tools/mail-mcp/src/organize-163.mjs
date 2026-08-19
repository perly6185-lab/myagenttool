import { with163OrganizeClient } from "./imap-163.mjs";
import { boundedFolder } from "./sync-163.mjs";

const MAX_BATCH = 50;
const NEW_FOLDER_NAMES = new Set(["Subscriptions", "Notifications"]);

export async function organize163Batch(args, connect = with163OrganizeClient) {
  const messages = normalizeMessages(args?.messages);
  const requestedPath = args?.destinationFolderPath ? boundedFolder(args.destinationFolderPath) : null;
  const requestedName = args?.destinationName ? boundedNewFolderName(args.destinationName) : null;
  if ((!requestedPath && !requestedName) || (requestedPath && requestedName)) throw new Error("mail_organize_destination_invalid");
  return connect(async (client) => {
    const { path: destinationFolderPath, created } = requestedPath
      ? { path: requestedPath, created: false }
      : await resolveOrCreateFolder(client, requestedName);
    const moved = [];
    const missing = [];
    const conflicts = [];
    for (const [sourceFolderPath, group] of groupBySource(messages)) {
      if (sourceFolderPath.toLowerCase() === destinationFolderPath.toLowerCase()) throw new Error("mail_organize_source_equals_destination");
      const lock = await client.getMailboxLock(sourceFolderPath, { readOnly: false });
      try {
        for (const item of group) {
          const uids = await client.search({ header: { "message-id": item.messageId } }, { uid: true });
          if (!Array.isArray(uids) || !uids.length) { missing.push(item.messageId); continue; }
          if (uids.length !== 1) { conflicts.push({ messageId: item.messageId, reason: "message_id_ambiguous" }); continue; }
          const result = await client.messageMove(uids, destinationFolderPath, { uid: true });
          if (!result) { conflicts.push({ messageId: item.messageId, reason: "move_not_confirmed" }); continue; }
          moved.push(item.messageId);
        }
      } finally {
        lock.release();
      }
    }
    return { organization: { destinationFolderPath, created, requestedCount: messages.length, moved, missing, conflicts } };
  });
}

function normalizeMessages(value) {
  if (!Array.isArray(value) || !value.length || value.length > MAX_BATCH) throw new Error("mail_organize_batch_invalid");
  const seen = new Set();
  return value.map((item) => {
    const messageId = String(item?.messageId ?? "").trim().slice(0, 998);
    const sourceFolderPath = boundedFolder(item?.sourceFolderPath);
    if (!messageId || seen.has(`${sourceFolderPath}\0${messageId}`)) throw new Error("mail_organize_message_invalid");
    seen.add(`${sourceFolderPath}\0${messageId}`);
    return { messageId, sourceFolderPath };
  });
}

function boundedNewFolderName(value) {
  const name = String(value ?? "").normalize("NFKC").trim();
  if (!NEW_FOLDER_NAMES.has(name)) throw new Error("mail_organize_new_folder_invalid");
  return name;
}

async function resolveOrCreateFolder(client, name) {
  const existing = (await client.list()).find((folder) => String(folder.path).toLowerCase() === name.toLowerCase());
  if (existing) return { path: boundedFolder(existing.path), created: false };
  const created = await client.mailboxCreate(name);
  const path = boundedFolder(created?.path ?? name);
  return { path, created: true };
}

function groupBySource(messages) {
  const groups = new Map();
  for (const message of messages) {
    const group = groups.get(message.sourceFolderPath) ?? [];
    group.push(message);
    groups.set(message.sourceFolderPath, group);
  }
  return groups;
}
