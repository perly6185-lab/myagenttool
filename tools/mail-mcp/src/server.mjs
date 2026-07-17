import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { readCredential } from "./credential.mjs";
import { headerOf, messageRecordOf } from "./message.mjs";

export const TOOL_NAMES = ["mail_list_unread", "mail_fetch"];

const tools = [
  {
    name: "mail_list_unread",
    description: "List unread 163 Mail headers without changing Seen state.",
    inputSchema: { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 100 } } },
  },
  {
    name: "mail_fetch",
    description: "Fetch one 163 Mail message by RFC822 Message-ID without changing Seen state.",
    inputSchema: { type: "object", additionalProperties: false, required: ["messageId"], properties: { messageId: { type: "string", maxLength: 998 } } },
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
    send({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info", data: name === "mail_fetch" ? "fetching 163 Mail message" : "listing unread 163 Mail" } });
    const result = name === "mail_fetch" ? await fetchMessage(args) : await listUnread(args);
    send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
  } catch (error) {
    const text = publicError(error);
    send({ jsonrpc: "2.0", id: message.id, result: { isError: true, content: [{ type: "text", text }] } });
  }
}

async function withInbox(action) {
  const credential = readCredential();
  const client = new ImapFlow({
    host: "imap.163.com",
    port: 993,
    secure: true,
    auth: { user: credential.username, pass: credential.authorizationCode },
    logger: false,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try { return await action(client); } finally { lock.release(); }
  } finally {
    if (client.usable) await client.logout().catch(() => client.close());
  }
}

async function listUnread(args) {
  const limit = Number.isInteger(args.limit) ? Math.min(Math.max(args.limit, 1), 100) : 20;
  return withInbox(async (client) => {
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
  return withInbox(async (client) => {
    // IMAP HEADER search is a SUBSTRING match (RFC 3501), so `<a1@host>` also
    // matches `<xa1@host>`; taking uids.at(-1) then returned the newest of any
    // partial hit — a DIFFERENT message, whose body/threading mapped a reply
    // onto the wrong issue (#1199). Confirm an EXACT Message-ID before fetching.
    const uids = await client.search({ header: { "message-id": messageId } }, { uid: true });
    if (!uids.length) throw new Error(`no message with Message-ID ${messageId}`);
    const candidates = await client.fetchAll(uids, { envelope: true }, { uid: true });
    const match = candidates.find((m) => m.envelope?.messageId === messageId);
    if (!match) throw new Error(`no message with Message-ID ${messageId}`);
    // Re-fetch with the source; guard the expunge race (fetchOne → false).
    const message = await client.fetchOne(match.uid, { envelope: true, source: true }, { uid: true });
    if (!message) throw new Error(`no message with Message-ID ${messageId}`);
    const parsed = await simpleParser(message.source);
    return messageRecordOf(message, parsed);
  });
}

function publicError(error) {
  const message = String(error?.message ?? error);
  if (message.startsWith("not_authorized:")) return message;
  if (/auth|authentication|login|credentials/i.test(message)) return "not_authorized: 163 Mail rejected the account or authorization code";
  return `mail_unavailable: ${message.slice(0, 300)}`;
}
