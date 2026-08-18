import { type MailClassification, type MailClassificationJob, type MailClassificationQuality, type MailClassificationRule, type MailClassificationRuleSuggestion, type MailFolderAutomation, type MailFolderAutomationDryRun, type MailFolderMoveJob, type MailFolderMovePreview, type MailFolderSuggestion, type MailboxSnapshot, type MailSemanticPreview, type MailSmartView, request } from "@/lib/api-client";

// Keep mailbox-only requests in the lazy mail feature chunk so adding ordinary
// inbox behavior never increases the application's initial JavaScript budget.
export const mailApi = {
  getMailbox: (page = 1, folder = "inbox", query = "", view: MailSmartView = "all") => {
    const params = new URLSearchParams({ page: String(page), pageSize: "25", folder, view });
    if (query.trim()) params.set("q", query.trim());
    return request<MailboxSnapshot>("GET", `/api/mailbox?${params.toString()}`);
  },
  setMessageRead: (messageId: string, read: boolean) => request<{ messageId: string; unread: boolean }>(
    "PATCH",
    `/api/mailbox/messages/${encodeURIComponent(messageId)}/read`,
    { read },
  ),
  classifyMailbox: (scope: "new_mail" | "rebuild" = "new_mail") => request<{
    job: MailClassificationJob;
  }>("POST", "/api/mailbox/classification-jobs", { scope }),
  getSemanticPreview: (limit = 20) => request<{ preview: MailSemanticPreview }>(
    "GET",
    `/api/mailbox/semantic-classification-preview?limit=${encodeURIComponent(String(limit))}`,
  ),
  startDeepOrganize: (limit = 20) => request<{ job: MailClassificationJob }>(
    "POST",
    "/api/mailbox/classification-jobs",
    { mode: "semantic", limit, confirmed: true },
  ),
  getClassificationJob: (jobId: string) => request<{ job: MailClassificationJob }>(
    "GET",
    `/api/mailbox/classification-jobs/${encodeURIComponent(jobId)}`,
  ),
  cancelClassificationJob: (jobId: string) => request<{ job: MailClassificationJob }>(
    "POST",
    `/api/mailbox/classification-jobs/${encodeURIComponent(jobId)}/cancel`,
  ),
  correctClassification: (messageId: string, input: {
    folderId: string;
    expectedRevision: number;
    attention: MailClassification["attention"];
    mailType: MailClassification["mailType"];
    suggestedAction: MailClassification["suggestedAction"];
  }) => request<{ classification: MailClassification }>(
    "PATCH",
    `/api/mailbox/messages/${encodeURIComponent(messageId)}/classification`,
    input,
  ),
  getClassificationRules: () => request<{ rules: MailClassificationRule[]; suggestions: MailClassificationRuleSuggestion[] }>(
    "GET",
    "/api/mailbox/classification-rules",
  ),
  getClassificationQuality: () => request<{ quality: MailClassificationQuality }>(
    "GET",
    "/api/mailbox/classification-quality",
  ),
  createClassificationRule: (suggestionId: string) => request<{ rule: MailClassificationRule }>(
    "POST",
    "/api/mailbox/classification-rules",
    { suggestionId, confirmed: true },
  ),
  updateClassificationRule: (ruleId: string, input: {
    expectedRevision: number;
    action?: "pause" | "resume" | "revoke";
    attention?: MailClassification["attention"];
    mailType?: MailClassification["mailType"];
    suggestedAction?: MailClassification["suggestedAction"];
  }) => request<{ rule: MailClassificationRule }>(
    "PATCH",
    `/api/mailbox/classification-rules/${encodeURIComponent(ruleId)}`,
    input,
  ),
  getFolderSuggestions: () => request<{ suggestions: MailFolderSuggestion[]; movesSupported: boolean; automationSupported?: boolean }>(
    "GET",
    "/api/mailbox/folder-suggestions",
  ),
  createFolderMovePreview: (suggestionId: string, destinationFolderId?: string | null) => request<{ preview: MailFolderMovePreview }>(
    "POST",
    "/api/mailbox/folder-move-previews",
    { suggestionId, ...(destinationFolderId ? { destinationFolderId } : {}) },
  ),
  startFolderMove: (previewId: string, approvalToken: string) => request<{ job: MailFolderMoveJob }>(
    "POST",
    "/api/mailbox/folder-move-jobs",
    { previewId, approvalToken },
  ),
  getFolderMoveJob: (jobId: string) => request<{ job: MailFolderMoveJob }>(
    "GET",
    `/api/mailbox/folder-move-jobs/${encodeURIComponent(jobId)}`,
  ),
  getFolderMoveJobs: () => request<{ jobs: MailFolderMoveJob[] }>(
    "GET",
    "/api/mailbox/folder-move-jobs",
  ),
  reconcileFolderMoveJob: (jobId: string) => request<{ job: MailFolderMoveJob }>(
    "POST",
    `/api/mailbox/folder-move-jobs/${encodeURIComponent(jobId)}/reconcile`,
  ),
  createFolderRecoveryPreview: (jobId: string) => request<{ preview: MailFolderMovePreview }>(
    "POST",
    `/api/mailbox/folder-move-jobs/${encodeURIComponent(jobId)}/recovery-preview`,
  ),
  createFolderAutomationPreview: (suggestionId: string, destinationFolderId?: string | null) => request<{ preview: MailFolderMovePreview }>(
    "POST",
    "/api/mailbox/folder-automation-previews",
    { suggestionId, ...(destinationFolderId ? { destinationFolderId } : {}) },
  ),
  enableFolderAutomation: (previewId: string, approvalToken: string) => request<{ automation: MailFolderAutomation }>(
    "POST",
    "/api/mailbox/folder-automations",
    { previewId, approvalToken, confirmed: true },
  ),
  getFolderAutomations: () => request<{ automations: MailFolderAutomation[] }>(
    "GET",
    "/api/mailbox/folder-automations",
  ),
  updateFolderAutomation: (automationId: string, expectedRevision: number, action: "pause" | "resume" | "revoke") => request<{ automation: MailFolderAutomation }>(
    "PATCH",
    `/api/mailbox/folder-automations/${encodeURIComponent(automationId)}`,
    { expectedRevision, action },
  ),
  dryRunFolderAutomation: (automationId: string) => request<{ dryRun: MailFolderAutomationDryRun }>(
    "POST",
    `/api/mailbox/folder-automations/${encodeURIComponent(automationId)}/dry-run`,
  ),
};
