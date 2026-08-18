import { createHash } from "node:crypto";
import { with163Client } from "./imap-163.mjs";
import { headerOf } from "./message.mjs";

export async function sync163Mailbox(args, withClient = with163Client) {
  const limit = Number.isInteger(args?.limit) ? Math.min(Math.max(args.limit, 1), 100) : 50;
  const cursorMap = new Map((Array.isArray(args?.cursors) ? args.cursors : []).map((cursor) => [boundedFolder(cursor.folderPath), cursor]));
  return withClient(async (client) => {
    const listed = await client.list({ statusQuery: { messages: true, unseen: true, uidNext: true, uidValidity: true } });
    const selectable = listed.filter((folder) => !folder.flags?.has("\\Noselect")).slice(0, 20);
    const folders = [];
    const messages = [];
    const readStates = [];
    const cursors = [];
    for (const folder of selectable) {
      const folderPath = boundedFolder(folder.path);
      const folderId = folderIdOf(folderPath);
      const previous = cursorMap.get(folderPath);
      let lock = null;
      try {
        lock = await client.getMailboxLock(folderPath, { readOnly: true });
        const uidValidity = String(client.mailbox?.uidValidity ?? folder.status?.uidValidity ?? "");
        const cursorValid = previous && previous.uidValidity === uidValidity;
        const lastUid = cursorValid ? Math.max(0, Number(previous.lastUid) || 0) : 0;
        let uids = await client.search(lastUid > 0 ? { uid: `${lastUid + 1}:4294967295` } : { all: true }, { uid: true });
        uids = (Array.isArray(uids) ? uids : []).filter((uid) => Number.isInteger(uid) && uid > lastUid);
        const selected = uids.slice(-limit);
        const fetched = selected.length ? await client.fetchAll(selected, {
          envelope: true,
          flags: true,
          headers: ["List-Id", "List-Unsubscribe", "Auto-Submitted", "Precedence"],
        }, { uid: true }) : [];
        const byUid = new Map(fetched.map((message) => [message.uid, message]));
        for (const uid of selected) {
          const header = headerOf(byUid.get(uid), { folderId, folderPath });
          if (header?.messageId) messages.push(header);
        }
        const recentUids = await client.search({ all: true }, { uid: true });
        const flagUids = (Array.isArray(recentUids) ? recentUids : []).slice(-100);
        const flagRows = flagUids.length ? await client.fetchAll(flagUids, { flags: true }, { uid: true }) : [];
        for (const row of flagRows) readStates.push({ folderId, folderPath, uid: row.uid, unread: !row.flags?.has("\\Seen") });
        const highestUid = Math.max(lastUid, ...uids, 0);
        folders.push({ id: folderId, path: folderPath, name: String(folder.name || folderPath).slice(0, 255), specialUse: String(folder.specialUse ?? (folderPath.toUpperCase() === "INBOX" ? "\\Inbox" : "")).slice(0, 30), count: Math.max(0, Number(folder.status?.messages ?? client.mailbox?.exists ?? 0)), unread: Math.max(0, Number(folder.status?.unseen ?? 0)), cursorReset: Boolean(previous && !cursorValid) });
        cursors.push({ folderId, folderPath, uidValidity, lastUid: highestUid });
      } catch {
        folders.push({ id: folderId, path: folderPath, name: String(folder.name || folderPath).slice(0, 255), specialUse: String(folder.specialUse ?? "").slice(0, 30), count: Math.max(0, Number(folder.status?.messages ?? 0)), unread: Math.max(0, Number(folder.status?.unseen ?? 0)), syncError: true, cursorReset: false });
        if (previous) cursors.push({ folderId, folderPath, uidValidity: String(previous.uidValidity), lastUid: Math.max(0, Number(previous.lastUid) || 0) });
      } finally { lock?.release(); }
    }
    return { folders, messages, readStates, cursors };
  });
}

export function boundedFolder(value) {
  const path = String(value ?? "").trim().slice(0, 998);
  if (!path || /[\u0000-\u001f]/.test(path)) throw new Error("mail_folder_invalid");
  return path;
}

export function folderIdOf(path) {
  if (String(path).toUpperCase() === "INBOX") return "inbox";
  return `provider-${createHash("sha256").update(String(path)).digest("hex").slice(0, 16)}`;
}
