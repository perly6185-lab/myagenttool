import { ImapFlow } from "imapflow";

/**
 * Verify a NetEase 163 app authorization code without reading or persisting it.
 * The connection is read-only and is closed before the caller stores anything.
 */
export async function verify163Credential({ username, authorizationCode }) {
  const client = new ImapFlow({
    host: "imap.163.com",
    port: 993,
    secure: true,
    auth: { user: username, pass: authorizationCode },
    logger: false,
    disableAutoIdle: true,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  try {
    await client.connect();
    await client.mailboxOpen("INBOX", { readOnly: true });
  } finally {
    if (client.usable) await client.logout().catch(() => undefined);
    else client.close();
  }
}
