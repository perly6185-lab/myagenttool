import { type MailboxSnapshot, request } from "@/lib/api-client";

// Keep mailbox-only requests in the lazy mail feature chunk so adding ordinary
// inbox behavior never increases the application's initial JavaScript budget.
export const mailApi = {
  getMailbox: (page = 1, folder = "inbox", query = "") => {
    const params = new URLSearchParams({ page: String(page), pageSize: "25", folder });
    if (query.trim()) params.set("q", query.trim());
    return request<MailboxSnapshot>("GET", `/api/mailbox?${params.toString()}`);
  },
  setMessageRead: (messageId: string, read: boolean) => request<{ messageId: string; unread: boolean }>(
    "PATCH",
    `/api/mailbox/messages/${encodeURIComponent(messageId)}/read`,
    { read },
  ),
};
