import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { readCredential, readOrganizeCredential } from "./credential.mjs";

export async function with163Inbox(action) {
  return with163Mailbox("INBOX", { readOnly: true }, action);
}

export async function with163Client(action) {
  return withCredentialClient(readCredential(), action);
}

export async function with163OrganizeClient(action) {
  return withCredentialClient(readOrganizeCredential(), action);
}

async function withCredentialClient(credential, action) {
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

export async function fetch163BodyParts(messageId, folderPath = "INBOX") {
  const normalizedId = String(messageId ?? "").trim();
  if (!normalizedId) throw new Error("messageId is required");
  return with163Mailbox(folderPath, { readOnly: true }, async (client, identity) => {
    const uids = await client.search({ header: { "message-id": normalizedId } }, { uid: true });
    if (!uids.length) throw new Error("mail_message_not_found");
    const candidates = await client.fetchAll(uids, { envelope: true, bodyStructure: true, headers: ["references"] }, { uid: true });
    const message = candidates.find((candidate) => candidate.envelope?.messageId === normalizedId);
    if (!message?.bodyStructure) throw new Error("mail_message_not_found");
    const bodyNodes = selectDisplayBodyNodes(message.bodyStructure);
    const plain = bodyNodes.plain ? await downloadTextPart(client, message.uid, bodyNodes.plain, 25_000) : null;
    const html = bodyNodes.html ? await downloadTextPart(client, message.uid, bodyNodes.html, 55_000) : null;
    return {
      message,
      identity,
      text: plain?.text ?? "",
      html: html?.text ?? "",
      references: referencesFromHeaders(message.headers),
      truncated: Boolean(plain?.truncated || html?.truncated),
    };
  });
}

export function selectDisplayBodyNodes(structure) {
  const nodes = flattenBodyStructure(structure).filter((node) => {
    const disposition = String(node?.disposition ?? "").toLowerCase();
    return disposition !== "attachment" && ["text/plain", "text/html"].includes(String(node?.type ?? "").toLowerCase());
  });
  return {
    plain: nodes.find((node) => String(node.type).toLowerCase() === "text/plain") ?? null,
    html: nodes.find((node) => String(node.type).toLowerCase() === "text/html") ?? null,
  };
}

function flattenBodyStructure(node) {
  if (!node || typeof node !== "object") return [];
  return [node, ...(node.childNodes ?? []).flatMap(flattenBodyStructure)];
}

async function downloadTextPart(client, uid, node, maxBytes) {
  const part = node.part ?? "1";
  const downloaded = await client.download(uid, part, { uid: true, maxBytes });
  if (!downloaded?.content) return { text: "", truncated: false };
  const chunks = [];
  for await (const chunk of downloaded.content) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return { text, truncated: Number(node.size ?? 0) > maxBytes || Buffer.byteLength(text) >= maxBytes };
}

function referencesFromHeaders(headers) {
  const raw = Buffer.isBuffer(headers) ? headers.toString("utf8") : String(headers ?? "");
  const unfolded = raw.replace(/\r?\n[ \t]+/g, " ");
  const value = unfolded.match(/^References:\s*(.+)$/im)?.[1] ?? "";
  return (value.match(/<[^>]{1,996}>/g) ?? []).slice(0, 50);
}
