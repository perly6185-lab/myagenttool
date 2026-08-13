import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { readCredential } from "./credential.mjs";

export async function with163Inbox(action) {
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

export async function fetch163ParsedMessage(messageId) {
  const normalizedId = String(messageId ?? "").trim();
  if (!normalizedId) throw new Error("messageId is required");
  return with163Inbox(async (client) => {
    const uids = await client.search({ header: { "message-id": normalizedId } }, { uid: true });
    if (!uids.length) throw new Error("mail_message_not_found");
    const candidates = await client.fetchAll(uids, { envelope: true }, { uid: true });
    const match = candidates.find((message) => message.envelope?.messageId === normalizedId);
    if (!match) throw new Error("mail_message_not_found");
    const message = await client.fetchOne(match.uid, { envelope: true, source: true }, { uid: true });
    if (!message) throw new Error("mail_message_not_found");
    return { message, parsed: await simpleParser(message.source) };
  });
}
