import { type MailboxSnapshot, request } from "@/lib/api-client";

// Keep mailbox-only requests in the lazy mail feature chunk so adding ordinary
// inbox behavior never increases the application's initial JavaScript budget.
export const mailApi = {
  getMailbox: (page = 1) => request<MailboxSnapshot>("GET", `/api/mailbox?page=${page}&pageSize=25`),
  setMessageRead: (messageId: string, read: boolean) => request<{ messageId: string; unread: boolean }>(
    "PATCH",
    `/api/mailbox/messages/${encodeURIComponent(messageId)}/read`,
    { read },
  ),
};
