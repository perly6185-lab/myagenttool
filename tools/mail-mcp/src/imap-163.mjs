import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { readCredential } from "./credential.mjs";

export async function with163Inbox(action) {
  return with163Mailbox("INBOX", { readOnly: true }, action);
}

export async function with163Client(action) {
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
    return await action(client, { username: credential.username });
  } finally {
    if (client.usable) await client.logout().catch(() => client.close());
  }
}

export async function with163Mailbox(path, { readOnly = true } = {}, action) {
  return with163Client(async (client, identity) => {
    const lock = await client.getMailboxLock(path, { readOnly });
    try { return await action(client, identity); } finally { lock.release(); }
  });
}

export async function fetch163ParsedMessage(messageId, folderPath = "INBOX") {
  const normalizedId = String(messageId ?? "").trim();
  if (!normalizedId) throw new Error("messageId is required");
  return with163Mailbox(folderPath, { readOnly: true }, async (client, identity) => {
    const uids = await client.search({ header: { "message-id": normalizedId } }, { uid: true });
    if (!uids.length) throw new Error("mail_message_not_found");
    const candidates = await client.fetchAll(uids, { envelope: true }, { uid: true });
    const match = candidates.find((message) => message.envelope?.messageId === normalizedId);
    if (!match) throw new Error("mail_message_not_found");
    const message = await client.fetchOne(match.uid, { envelope: true, source: true }, { uid: true });
    if (!message) throw new Error("mail_message_not_found");
    // Keep cid: references in the bounded HTML record. Inline image bytes stay
    // behind the existing attachment bridge and are loaded only for a user's
    // safe-HTML preview; embedding them here would bloat persisted state.
    return { message, parsed: await simpleParser(message.source, { keepCidLinks: true }), identity };
  });
}
