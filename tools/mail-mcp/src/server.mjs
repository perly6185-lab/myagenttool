import { fetch163ParsedMessage, with163Client, with163Inbox } from "./imap-163.mjs";
import { archiveMailSource, unavailableMailArchive } from "./mail-archive.mjs";
import { headerOf, messageRecordOf } from "./message.mjs";
import { send163Mail } from "./send-163.mjs";
import { boundedFolder, folderIdOf, sync163Mailbox } from "./sync-163.mjs";
import { organize163Batch } from "./organize-163.mjs";

export const TOOL_NAMES = ["mail_sync", "mail_list_unread", "mail_fetch", "mail_set_read", "mail_send", "mail_organize_batch"];

const tools = [
  {
    name: "mail_sync",
    description: "List 163 Mail folders and fetch only headers newer than the supplied per-folder UID cursors.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 100 },
        cursors: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["folderPath", "uidValidity", "lastUid"], properties: { folderPath: { type: "string", maxLength: 998 }, uidValidity: { type: "string", maxLength: 30 }, lastUid: { type: "integer", minimum: 0 } } } },
      },
    },
  },
  {
    name: "mail_list_unread",
    description: "List unread 163 Mail headers without changing Seen state.",
    inputSchema: { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 100 } } },
  },
  {
    name: "mail_fetch",
    description: "Fetch one 163 Mail message by RFC822 Message-ID without changing Seen state and archive its exact RFC 822 source locally when capacity permits.",
    inputSchema: { type: "object", additionalProperties: false, required: ["messageId"], properties: { messageId: { type: "string", maxLength: 998 }, folderPath: { type: "string", maxLength: 998 } } },
  },
  {
    name: "mail_set_read",
    description: "Set the provider Seen state for one 163 Mail message.",
    inputSchema: { type: "object", additionalProperties: false, required: ["messageId", "folderPath", "read"], properties: { messageId: { type: "string", maxLength: 998 }, folderPath: { type: "string", maxLength: 998 }, read: { type: "boolean" } } },
  },
  {
    name: "mail_organize_batch",
    description: "Create one reviewed organization folder if needed and move at most 50 server-selected messages after explicit approval.",
    inputSchema: { type: "object", additionalProperties: false, required: ["messages"], properties: { destinationFolderPath: { type: ["string", "null"], maxLength: 998 }, destinationName: { type: ["string", "null"], enum: ["Subscriptions", "Notifications", null] }, messages: { type: "array", minItems: 1, maxItems: 50, items: { type: "object", additionalProperties: false, required: ["messageId", "sourceFolderPath"], properties: { messageId: { type: "string", maxLength: 998 }, sourceFolderPath: { type: "string", maxLength: 998 } } } } } },
  },
  {
    name: "mail_send",
    description: "Send one server-reviewed mail draft through 163 Mail, resolving opaque local attachment references on this device.",
    inputSchema: { type: "object", additionalProperties: false, required: ["to", "subject", "body"], properties: { to: { type: "string", maxLength: 998 }, subject: { type: "string", maxLength: 400 }, body: { type: "string", maxLength: 20000 }, inReplyTo: { type: ["string", "null"], maxLength: 998 }, references: { type: "array", maxItems: 50, items: { type: "string", maxLength: 998 } }, attachments: { type: "array", maxItems: 10, items: { type: "object", additionalProperties: false, required: ["ref", "name", "contentType", "size"], properties: { ref: { type: "string", pattern: "^mailatt_[a-f0-9-]{36}$" }, name: { type: "string", maxLength: 255 }, contentType: { type: "string", maxLength: 127 }, size: { type: "integer", minimum: 0, maximum: 26214400 } } } } } },
  },
];

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try { void handle(JSON.parse(line)); } catch { /* invalid JSON-RPC is ignored */ }
  }
});

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(message) {
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params?.protocolVersion ?? "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "myagenttool-163-mail", version: "0.0.0" } } });
    return;
  }
  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools } });
    return;
  }
  if (message.method !== "tools/call") return;

  try {
    const name = message.params?.name;
    const args = message.params?.arguments ?? {};
    if (!TOOL_NAMES.includes(name)) throw new Error(`unknown tool ${name}`);
    send({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info", data: `running ${name}` } });
    const result = name === "mail_fetch"
      ? await fetchMessage(args)
      : name === "mail_sync"
        ? await sync163Mailbox(args)
        : name === "mail_send"
          ? await send163Mail(args)
        : name === "mail_set_read"
          ? await setRead(args)
          : name === "mail_organize_batch"
            ? await organize163Batch(args)
            : await listUnread(args);
    send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
  } catch (error) {
    const text = publicError(error);
    send({ jsonrpc: "2.0", id: message.id, result: { isError: true, content: [{ type: "text", text }] } });
  }
}

async function listUnread(args) {
  const limit = Number.isInteger(args.limit) ? Math.min(Math.max(args.limit, 1), 100) : 20;
  return with163Inbox(async (client) => {
    const uids = await client.search({ seen: false }, { uid: true });
    const selected = uids.slice(-limit).reverse();
    if (!selected.length) return { unread: [] };
    const messages = await client.fetchAll(selected, { envelope: true }, { uid: true });
    const byUid = new Map(messages.map((message) => [message.uid, message]));
    return { unread: selected.map((uid) => headerOf(byUid.get(uid))).filter(Boolean) };
  });
}

async function fetchMessage(args) {
  const messageId = String(args.messageId ?? "").trim();
  if (!messageId) throw new Error("messageId is required");
  const folderPath = boundedFolder(args.folderPath ?? "INBOX");
  const { message, parsed, identity } = await fetch163ParsedMessage(messageId, folderPath);
  const record = messageRecordOf(message, parsed);
  let archive;
  try {
    archive = archiveMailSource({
      account: identity?.username,
      messageId,
      folderPath,
      source: message.source,
      attachments: record?.attachments,
    });
  } catch (error) {
    archive = unavailableMailArchive(error);
  }
  return {
    ...record,
    archive,
    attachments: (record?.attachments ?? []).map((attachment) => ({
      ...attachment,
      localAvailable: archive.availability === "available",
    })),
    folderId: folderIdOf(folderPath),
    folderPath,
  };
}

async function setRead(args) {
  const messageId = String(args.messageId ?? "").trim();
  const folderPath = boundedFolder(args.folderPath);
  if (!messageId || !folderPath || typeof args.read !== "boolean") throw new Error("mail_read_state_invalid");
  return with163Client(async (client) => {
    const lock = await client.getMailboxLock(folderPath, { readOnly: false });
    try {
      const uids = await client.search({ header: { "message-id": messageId } }, { uid: true });
      if (!Array.isArray(uids) || !uids.length) throw new Error("mail_message_not_found");
      const ok = args.read
        ? await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true })
        : await client.messageFlagsRemove(uids, ["\\Seen"], { uid: true });
      if (!ok) throw new Error("mail_read_state_not_confirmed");
      return { readState: { messageId, folderId: folderIdOf(folderPath), folderPath, read: args.read } };
    } finally {
      lock.release();
    }
  });
}

function publicError(error) {
  const message = String(error?.message ?? error);
  if (message.startsWith("not_authorized:")) return message;
  if (/auth|authentication|login|credentials/i.test(message)) return "not_authorized: 163 Mail rejected the account or authorization code";
  return `mail_unavailable: ${message.slice(0, 300)}`;
}
