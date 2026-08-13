import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FilePenLine,
  Folder,
  Inbox,
  Mail,
  MailOpen,
  Paperclip,
  PenLine,
  RefreshCw,
  Reply,
  Search,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { SectionHeading } from "@/components/common/section-heading";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { api, ApiError, type MailboxDraft, type MailboxMessage, type MailDraftAttachment } from "@/lib/api-client";
import { mailApi } from "@/features/mail/mail-api";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { cn } from "@/lib/cn";

type FolderId = string;

const COPY = {
  zh: {
    eyebrow: "日常通信",
    title: "我的邮箱",
    description: "收取、阅读和回复邮件；需要时可把邮件继续整理成任务。",
    compose: "写邮件",
    sync: "收取新邮件",
    syncing: "正在收取…",
    syncComplete: "收取完成，收件箱已更新。",
    syncFailed: "暂时无法收取新邮件。已有邮件仍然保留，请重试；若持续失败，请检查连接。",
    lastSynced: "上次收取：{{time}}",
    search: "搜索此文件夹内已收取的邮件",
    searchEmpty: "没有找到匹配的邮件",
    previousPage: "上一页",
    nextPage: "下一页",
    pageStatus: "第 {{page}} / {{total}} 页",
    markUnread: "标为未读",
    markReadFailed: "暂时无法更新已读状态，请重试。",
    attachments: "附件",
    previewAttachment: "预览",
    downloadAttachment: "下载",
    previewTitle: "附件预览",
    previewUnsupported: "此附件不能在应用内安全预览，请下载后使用可信应用打开。",
    previewTooLarge: "附件太大，无法在应用内预览；你仍可选择下载。",
    attachmentUnavailable: "暂时无法读取附件，请稍后重试。",
    downloadSaved: "附件已保存：{{name}}",
    downloadTooLarge: "附件超过当前 25 MB 下载限制。",
    desktopAttachmentOnly: "请在 MyAgentTool 桌面版中预览或下载附件。",
    localReadHint: "已读状态会同步到邮箱服务商；同步失败时会保留原状态并提示重试。",
    cursorReset: "邮箱文件夹发生变化，已安全重新收取最近邮件。",
    folderSyncError: "部分文件夹暂时无法更新，其他邮件已正常保留。请稍后再次收取。",
    connected: "已连接",
    receiveOnly: "当前可收件；发件权限尚未连接",
    folders: { inbox: "收件箱", drafts: "草稿", sent: "已发送", outbox: "发件箱" },
    unread: "未读",
    emptyInbox: "收件箱里还没有邮件",
    emptyInboxHint: "点击“收取新邮件”，新的未读邮件会显示在这里。",
    emptyFolder: "这里还没有邮件",
    choose: "选择一封邮件查看内容",
    loadingBody: "正在安全读取邮件正文…",
    bodyUnavailable: "正文尚未下载。你可以重新收取邮件后再试。",
    reply: "回复",
    issue: "已关联任务来源 #{{number}}",
    untrusted: "邮件内容来自外部。系统只把它当作内容展示，不会将其中的文字当成操作指令。",
    back: "返回邮件列表",
    connectTitle: "连接你的邮箱",
    connectHint: "连接后即可在这里收件。登录信息只保存在这台电脑上。",
    connectAction: "打开邮箱连接设置",
    connectSimple: "不需要在这里填写 IMAP、SMTP 或服务器地址。",
    attention: "邮箱需要重新连接",
    attentionAction: "检查连接",
    manageConnection: "管理邮箱连接",
    receiveReady: "收件已连接",
    sendNotReady: "发件尚未连接",
    connectorTitle: "连接邮箱",
    connectorDescription: "跟着两步完成；系统会自动验证，不需要填写服务器地址。",
    provider163: "163 邮箱",
    provider163Hint: "支持文件夹、增量收取和服务商已读状态同步",
    providerGmail: "Gmail",
    comingSoon: "即将支持",
    desktopOnly: "请在 MyAgentTool 桌面版中连接邮箱。网页不会接触你的登录信息。",
    accountEmail: "163 邮箱地址",
    authorizationCode: "客户端授权码",
    authorizationPlaceholder: "不是邮箱登录密码",
    authHelpTitle: "先在 163 邮箱中取得授权码",
    authHelp: "登录 163 网页邮箱，在设置中开启 IMAP 服务并新建客户端授权码，然后把授权码粘贴到这里。界面名称可能因账号版本略有不同。",
    localSecret: "授权码只保存在这台电脑，并由当前 Windows 用户加密保护。",
    connectAndTest: "连接并测试收件",
    testing: "正在验证…",
    connectSuccess: "收件连接成功",
    connectSuccessHint: "现在可以收取各文件夹的新邮件并同步已读状态；发件可在下一步单独连接。",
    done: "完成",
    reconnect: "重新连接",
    connectSend: "连接发件权限",
    connectSendHint: "发件授权与收件分开保存。连接后，每封邮件仍会在发送前要求你完整确认。",
    sendConnected: "发件权限已连接",
    errors: {
      invalid_email: "请输入完整的 163 邮箱地址。",
      invalid_authorization_code: "请输入 163 客户端授权码。",
      verification_failed: "验证失败。请确认 IMAP 服务已开启，并检查邮箱地址和授权码。",
      save_failed: "连接已验证，但本机保存失败。请稍后重试。",
      platform_not_supported: "当前连接助手仅支持 Windows 桌面版。",
      unavailable: "连接助手暂时不可用，请重新打开桌面版后再试。",
    },
    composeTitle: "写邮件",
    editDraftTitle: "编辑草稿",
    composeHint: "先保存为草稿。真正发送前会再次显示完整内容供你确认。",
    to: "收件人",
    toPlaceholder: "name@example.com",
    subject: "主题",
    subjectPlaceholder: "这封邮件是关于什么的？",
    body: "正文",
    bodyPlaceholder: "写下你想发送的内容…",
    save: "保存草稿",
    saving: "正在保存…",
    reviewSend: "检查并发送",
    deleteDraft: "删除草稿",
    sendUnavailable: "可以继续保存草稿；连接发件权限后才能发送。",
    missingSendFields: "请先填写有效的收件人和正文。",
    invalidRecipient: "请检查收件人邮箱地址。",
    saveFailed: "草稿保存失败，请稍后重试。",
    sendReviewTitle: "发送前请确认",
    sendReviewHint: "发送后收件人将立即收到以下内容。",
    sendNow: "确认发送",
    sending: "正在发送…",
    sendFailed: "邮件暂未发送。草稿仍然保留，你可以检查发件连接后重试。",
    sendDisabled: "发件功能尚未启用。草稿已经保存。",
    sendQueued: "邮件已进入发件箱，正在等待服务商回执。",
    noSubject: "（无主题）",
    close: "关闭",
    saved: "草稿已保存",
    addAttachments: "添加附件",
    pasteAttachments: "也可以直接粘贴复制的文件",
    attachmentLimit: "最多 10 个附件，总计不超过 25 MB",
    removeAttachment: "移除 {{name}}",
    outboundAttachmentFailed: "无法添加附件。请确认文件总计不超过 25 MB 后重试。",
    outboundDesktopOnly: "请在 MyAgentTool 桌面版中添加附件。",
    status: { draft: "草稿", sending: "发送中", sent: "已发送", send_unconfirmed: "请检查是否已发送" },
  },
  en: {
    eyebrow: "Daily communication",
    title: "My email",
    description: "Receive, read, and reply to email, then turn messages into tasks when useful.",
    compose: "New email",
    sync: "Get new mail",
    syncing: "Getting mail…",
    syncComplete: "Mail received. Your inbox is up to date.",
    syncFailed: "New mail could not be retrieved. Existing mail is safe. Try again, then check the connection if it continues.",
    lastSynced: "Last checked: {{time}}",
    search: "Search received mail in this folder",
    searchEmpty: "No matching messages",
    previousPage: "Previous",
    nextPage: "Next",
    pageStatus: "Page {{page}} of {{total}}",
    markUnread: "Mark unread",
    markReadFailed: "The read state could not be updated. Try again.",
    attachments: "Attachments",
    previewAttachment: "Preview",
    downloadAttachment: "Download",
    previewTitle: "Attachment preview",
    previewUnsupported: "This attachment cannot be previewed safely in the app. Download it and open it with a trusted application.",
    previewTooLarge: "This attachment is too large for in-app preview. You can still download it.",
    attachmentUnavailable: "The attachment is temporarily unavailable. Try again.",
    downloadSaved: "Attachment saved: {{name}}",
    downloadTooLarge: "The attachment exceeds the current 25 MB download limit.",
    desktopAttachmentOnly: "Use the MyAgentTool desktop app to preview or download attachments.",
    localReadHint: "Read state syncs with your email provider. If syncing fails, the previous state is kept so you can retry.",
    cursorReset: "This mailbox folder changed, so recent mail was safely retrieved again.",
    folderSyncError: "Some folders could not be updated. Other mail is safe; try Get new mail again later.",
    connected: "Connected",
    receiveOnly: "Receiving is ready; sending is not connected yet",
    folders: { inbox: "Inbox", drafts: "Drafts", sent: "Sent", outbox: "Outbox" },
    unread: "unread",
    emptyInbox: "Your inbox is empty",
    emptyInboxHint: "Choose Get new mail to retrieve unread messages.",
    emptyFolder: "Nothing here yet",
    choose: "Choose an email to read it",
    loadingBody: "Safely loading the message…",
    bodyUnavailable: "The body has not been downloaded yet. Get new mail and try again.",
    reply: "Reply",
    issue: "Linked task source #{{number}}",
    untrusted: "Email comes from outside. It is displayed as content and is never treated as an instruction.",
    back: "Back to message list",
    connectTitle: "Connect your email",
    connectHint: "After connecting, new mail appears here. Sign-in details remain on this computer.",
    connectAction: "Open email connection settings",
    connectSimple: "You do not need to enter IMAP, SMTP, or server addresses here.",
    attention: "Your email needs to be reconnected",
    attentionAction: "Check connection",
    manageConnection: "Manage connection",
    receiveReady: "Receiving connected",
    sendNotReady: "Sending not connected",
    connectorTitle: "Connect email",
    connectorDescription: "Two guided steps; no server addresses are required.",
    provider163: "163 Mail",
    provider163Hint: "Folders, incremental retrieval, and provider read-state sync are supported",
    providerGmail: "Gmail",
    comingSoon: "Coming soon",
    desktopOnly: "Connect email in the MyAgentTool desktop app. The web page never handles your sign-in details.",
    accountEmail: "163 email address",
    authorizationCode: "Client authorization code",
    authorizationPlaceholder: "Not your mailbox password",
    authHelpTitle: "Get an authorization code from 163 Mail first",
    authHelp: "Sign in to 163 webmail, enable IMAP in Settings, and create a client authorization code. Setting names may vary slightly by account version.",
    localSecret: "The code stays on this computer and is encrypted for the current Windows user.",
    connectAndTest: "Connect and test receiving",
    testing: "Verifying…",
    connectSuccess: "Receiving connected",
    connectSuccessHint: "You can now retrieve folder updates and sync read state. Sending can be connected separately next.",
    done: "Done",
    reconnect: "Reconnect",
    connectSend: "Connect sending",
    connectSendHint: "Sending permission is stored separately from receiving. Every message still requires a complete review before sending.",
    sendConnected: "Sending connected",
    errors: {
      invalid_email: "Enter a complete 163 Mail address.",
      invalid_authorization_code: "Enter the 163 client authorization code.",
      verification_failed: "Verification failed. Check that IMAP is enabled, then verify the address and authorization code.",
      save_failed: "The account was verified, but could not be saved on this computer. Try again.",
      platform_not_supported: "The connection assistant currently requires the Windows desktop app.",
      unavailable: "The connection assistant is unavailable. Reopen the desktop app and try again.",
    },
    composeTitle: "New email",
    editDraftTitle: "Edit draft",
    composeHint: "Save a draft first. You will review the complete email again before it is sent.",
    to: "To",
    toPlaceholder: "name@example.com",
    subject: "Subject",
    subjectPlaceholder: "What is this email about?",
    body: "Message",
    bodyPlaceholder: "Write what you want to send…",
    save: "Save draft",
    saving: "Saving…",
    reviewSend: "Review and send",
    deleteDraft: "Delete draft",
    sendUnavailable: "You can save drafts now; connect send permission before sending.",
    missingSendFields: "Add a valid recipient and message first.",
    invalidRecipient: "Check the recipient email address.",
    saveFailed: "The draft could not be saved. Try again.",
    sendReviewTitle: "Review before sending",
    sendReviewHint: "The recipient will receive exactly this content.",
    sendNow: "Confirm and send",
    sending: "Sending…",
    sendFailed: "The email was not sent. Your draft is safe; check the send connection and try again.",
    sendDisabled: "Sending is not enabled yet. Your draft has been saved.",
    sendQueued: "The email is in Outbox while we wait for the provider receipt.",
    noSubject: "(no subject)",
    close: "Close",
    saved: "Draft saved",
    addAttachments: "Add attachments",
    pasteAttachments: "You can also paste copied files here",
    attachmentLimit: "Up to 10 attachments, 25 MB total",
    removeAttachment: "Remove {{name}}",
    outboundAttachmentFailed: "Attachments could not be added. Check that the total is under 25 MB and try again.",
    outboundDesktopOnly: "Add attachments in the MyAgentTool desktop app.",
    status: { draft: "Draft", sending: "Sending", sent: "Sent", send_unconfirmed: "Check whether sent" },
  },
} as const;

export function MailView() {
  const { i18n } = useAppTranslation();
  const copy = i18n.language.startsWith("zh") ? COPY.zh : COPY.en;
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [folder, setFolder] = useState<FolderId>("inbox");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const systemFolder = ["drafts", "sent", "outbox"].includes(folder);
  const mailbox = useQuery({ queryKey: ["mailbox", page, folder, systemFolder ? "" : deferredQuery], queryFn: () => mailApi.getMailbox(page, systemFolder ? "inbox" : folder, systemFolder ? "" : deferredQuery), refetchInterval: 4_000 });
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [reviewDraft, setReviewDraft] = useState<MailboxDraft | null>(null);
  const [busy, setBusy] = useState<"sync" | "fetch" | "save" | "send" | "delete" | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [connectorOpen, setConnectorOpen] = useState(false);
  const [pendingSyncId, setPendingSyncId] = useState<string | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<AttachmentPreview | null>(null);
  const data = mailbox.data;
  const account = data?.accounts.find((item) => item.canReceive) ?? data?.accounts[0] ?? null;
  const selectedMessage = data?.messages.find((message) => message.id === selectedMessageId) ?? null;
  const syncing = busy === "sync" || data?.sync?.status === "syncing";
  const providerFolders = (data?.folders ?? []).filter((item) => item.kind === "provider");
  const folderName = copy.folders[folder as keyof typeof copy.folders]
    ?? providerFolders.find((item) => item.id === folder)?.name
    ?? folder;
  const lastSyncText = data?.sync?.lastSucceededAt
    ? copy.lastSynced.replace("{{time}}", new Intl.DateTimeFormat(i18n.language, { dateStyle: "short", timeStyle: "short" }).format(new Date(data.sync.lastSucceededAt)))
    : null;

  useEffect(() => {
    if (!pendingSyncId || data?.sync?.invocationId !== pendingSyncId) return;
    if (data.sync.status === "succeeded") {
      setPendingSyncId(null);
      setNotice({ tone: "info", text: copy.syncComplete });
    } else if (data.sync.status === "failed") {
      setPendingSyncId(null);
      setNotice({ tone: "error", text: copy.syncFailed });
    }
  }, [copy.syncComplete, copy.syncFailed, data?.sync?.invocationId, data?.sync?.status, pendingSyncId]);

  useEffect(() => {
    if (data?.pagination && data.pagination.page !== page) setPage(data.pagination.page);
  }, [data?.pagination, page]);

  useEffect(() => {
    setPage(1);
    setSelectedMessageId(null);
  }, [deferredQuery, folder]);

  const visibleMessages = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (value: string) => !needle || value.toLowerCase().includes(needle);
    if (!systemFolder) {
      return data?.messages ?? [];
    }
    return (data?.drafts ?? [])
      .filter((draft) => folder === "drafts" ? draft.status === "draft" : folder === "sent" ? draft.status === "sent" : ["sending", "send_unconfirmed"].includes(draft.status))
      .filter((draft) => matches(`${draft.to} ${draft.subject} ${draft.body}`));
  }, [data?.drafts, data?.messages, folder, query, systemFolder]);

  async function syncMail() {
    if (!account?.canReceive) return;
    setBusy("sync");
    setNotice(null);
    try {
      const result = await api.syncMailbox();
      setPendingSyncId(result.sync.invocationId);
      await queryClient.invalidateQueries({ queryKey: ["mailbox"] });
    } catch {
      setNotice({ tone: "error", text: copy.syncFailed });
    } finally {
      setBusy(null);
    }
  }

  async function openMessage(message: MailboxMessage) {
    setSelectedMessageId(message.id);
    if (message.unread) {
      void mailApi.setMessageRead(message.messageId, true)
        .then(() => queryClient.invalidateQueries({ queryKey: ["mailbox"] }))
        .catch(() => setNotice({ tone: "error", text: copy.markReadFailed }));
    }
    if ((message.fetched && message.attachmentMetadataLoaded) || !account?.fetchCapability || busy === "fetch") return;
    setBusy("fetch");
    try {
      await api.invokeCapability(account.fetchCapability, account.incrementalSync ? { messageId: message.messageId, folderPath: message.folderPath } : { messageId: message.messageId });
      window.setTimeout(() => { void queryClient.invalidateQueries({ queryKey: ["mailbox"] }); }, 800);
    } catch {
      setNotice({ tone: "error", text: copy.bodyUnavailable });
    } finally {
      setBusy(null);
    }
  }

  async function markUnread(message: MailboxMessage) {
    try {
      await mailApi.setMessageRead(message.messageId, false);
      await queryClient.invalidateQueries({ queryKey: ["mailbox"] });
      setSelectedMessageId(null);
    } catch {
      setNotice({ tone: "error", text: copy.markReadFailed });
    }
  }

  async function previewAttachment(message: MailboxMessage, attachment: MailboxMessage["attachments"][number]) {
    const bridge = window.myagenttoolDesktop;
    if (!bridge?.previewMailAttachment) { setNotice({ tone: "error", text: copy.desktopAttachmentOnly }); return; }
    const result = await bridge.previewMailAttachment({ messageId: message.messageId, folderPath: message.folderPath, attachmentId: attachment.id }).catch(() => ({ ok: false as const, error: "attachment_unavailable" as const }));
    if (!result.ok) {
      const text = result.error === "preview_not_supported" ? copy.previewUnsupported : result.error === "preview_too_large" ? copy.previewTooLarge : copy.attachmentUnavailable;
      setNotice({ tone: "error", text });
      return;
    }
    setAttachmentPreview(result.preview);
  }

  async function downloadAttachment(message: MailboxMessage, attachment: MailboxMessage["attachments"][number]) {
    const bridge = window.myagenttoolDesktop;
    if (!bridge?.downloadMailAttachment) { setNotice({ tone: "error", text: copy.desktopAttachmentOnly }); return; }
    const result = await bridge.downloadMailAttachment({ messageId: message.messageId, folderPath: message.folderPath, attachmentId: attachment.id }).catch(() => ({ ok: false as const, error: "attachment_unavailable" as const }));
    if (!result.ok) {
      setNotice({ tone: "error", text: result.error === "download_too_large" ? copy.downloadTooLarge : copy.attachmentUnavailable });
    } else if (result.saved) {
      setNotice({ tone: "info", text: copy.downloadSaved.replace("{{name}}", result.name ?? attachment.name) });
    }
  }

  function startCompose(message?: MailboxMessage) {
    const subject = message ? `Re: ${message.subject.replace(/^(\s*re\s*:\s*)+/i, "")}` : "";
    setCompose({ id: null, to: message?.from ?? "", subject, body: "", attachments: [], inReplyTo: message?.messageId ?? null, references: message ? [...message.references, message.messageId] : [] });
    setNotice(null);
  }

  function editDraft(draft: MailboxDraft) {
    setCompose({ id: draft.id, to: draft.to, subject: draft.subject, body: draft.body, attachments: draft.attachments ?? [], inReplyTo: draft.inReplyTo, references: draft.references });
    setNotice(null);
  }

  function mergeComposeAttachments(attachments: MailDraftAttachment[]) {
    if (!compose) return;
    const merged = [...compose.attachments];
    for (const attachment of attachments) if (!merged.some((item) => item.ref === attachment.ref)) merged.push(attachment);
    if (merged.length > 10 || merged.reduce((sum, item) => sum + item.size, 0) > 25 * 1024 * 1024) {
      setNotice({ tone: "error", text: copy.outboundAttachmentFailed });
      return;
    }
    setCompose({ ...compose, attachments: merged });
  }

  async function pickComposeAttachments() {
    const bridge = window.myagenttoolDesktop;
    if (!bridge?.pickOutboundMailAttachments) { setNotice({ tone: "error", text: copy.outboundDesktopOnly }); return; }
    const result = await bridge.pickOutboundMailAttachments().catch(() => ({ ok: false as const, error: "attachment_stage_failed" as const }));
    if (!result.ok) { setNotice({ tone: "error", text: copy.outboundAttachmentFailed }); return; }
    mergeComposeAttachments(result.attachments);
  }

  async function pasteComposeAttachments(files: File[]) {
    if (!files.length) return;
    const bridge = window.myagenttoolDesktop;
    if (!bridge?.stagePastedMailAttachments) { setNotice({ tone: "error", text: copy.outboundDesktopOnly }); return; }
    let staged: Array<{ name: string; contentType: string; data: ArrayBuffer }>;
    try {
      staged = await Promise.all(files.slice(0, 10).map(async (file) => ({ name: file.name, contentType: file.type || "application/octet-stream", data: await file.arrayBuffer() })));
    } catch {
      setNotice({ tone: "error", text: copy.outboundAttachmentFailed });
      return;
    }
    const result = await bridge.stagePastedMailAttachments({ files: staged }).catch(() => ({ ok: false as const, error: "attachment_stage_failed" as const }));
    if (!result.ok) { setNotice({ tone: "error", text: copy.outboundAttachmentFailed }); return; }
    mergeComposeAttachments(result.attachments);
  }

  async function persistDraft(value: ComposeState) {
    setBusy("save");
    try {
      const result = value.id
        ? await api.updateMailDraft(value.id, { to: value.to, subject: value.subject, body: value.body, attachments: value.attachments })
        : await api.createMailDraft({ to: value.to, subject: value.subject, body: value.body, attachments: value.attachments, inReplyTo: value.inReplyTo, references: value.references });
      await queryClient.invalidateQueries({ queryKey: ["mailbox"] });
      setCompose((current) => current ? { ...current, id: result.draft.id } : current);
      setNotice({ tone: "info", text: copy.saved });
      return result.draft;
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof ApiError && error.code === "mail_recipient_invalid" ? copy.invalidRecipient : copy.saveFailed });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function reviewForSend() {
    if (!compose || !compose.to.trim() || !compose.body.trim()) {
      setNotice({ tone: "error", text: copy.missingSendFields });
      return;
    }
    const draft = await persistDraft(compose);
    if (draft) setReviewDraft(draft);
  }

  async function sendDraft() {
    if (!reviewDraft) return;
    setBusy("send");
    try {
      const grant = await api.issueApprovalGrant("mail.send", reviewDraft.approvalTarget);
      await api.sendMailDraft(reviewDraft.id, grant.token);
      setReviewDraft(null);
      setCompose(null);
      setFolder("outbox");
      setNotice({ tone: "info", text: copy.sendQueued });
      await queryClient.invalidateQueries({ queryKey: ["mailbox"] });
    } catch (error) {
      setReviewDraft(null);
      const disabled = error instanceof ApiError && ["mail_send_disabled", "send_application_not_available", "send_credential_not_ready"].includes(error.code);
      setNotice({ tone: "error", text: disabled ? copy.sendDisabled : copy.sendFailed });
    } finally {
      setBusy(null);
    }
  }

  async function removeDraft() {
    if (!compose?.id) return;
    setBusy("delete");
    try {
      await api.deleteMailDraft(compose.id);
      setCompose(null);
      await queryClient.invalidateQueries({ queryKey: ["mailbox"] });
    } catch {
      setNotice({ tone: "error", text: copy.saveFailed });
    } finally {
      setBusy(null);
    }
  }

  if (mailbox.isLoading) return <div role="status" className="py-12 text-center text-sm text-muted-foreground">{copy.syncing}</div>;

  return (
    <div className="mx-auto max-w-[1500px] space-y-4" data-testid="mail-view">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeading eyebrow={copy.eyebrow} title={copy.title} description={copy.description} />
        <div className="flex flex-wrap gap-2">
          {account?.canReceive ? <Button variant="secondary" onClick={() => void syncMail()} disabled={syncing}><RefreshCw className={cn(syncing && "animate-spin")} />{syncing ? copy.syncing : copy.sync}</Button> : null}
          <Button onClick={() => startCompose()}><PenLine />{copy.compose}</Button>
        </div>
      </div>

      {notice ? <div role={notice.tone === "error" ? "alert" : "status"} className={cn("rounded-lg border px-3 py-2 text-sm", notice.tone === "error" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-primary/30 bg-primary/5 text-foreground")}>{notice.text}</div> : null}
      {data?.folders.some((item) => item.syncError) ? <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">{copy.folderSyncError}</div> : null}
      {data?.folders.some((item) => item.cursorReset) ? <div role="status" className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">{copy.cursorReset}</div> : null}

      {!data?.accounts.length ? (
        <section className="rounded-2xl border bg-card p-6 text-center sm:p-10">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary"><Mail /></span>
          <h2 className="mt-4 text-lg font-semibold">{copy.connectTitle}</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">{copy.connectHint}</p>
          <p className="mx-auto mt-1 max-w-lg text-xs text-muted-foreground">{copy.connectSimple}</p>
          <Button className="mt-5" onClick={() => setConnectorOpen(true)}>{copy.connectAction}</Button>
        </section>
      ) : (
        <>
          <div className={cn("flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm", account?.canReceive ? "bg-card" : "border-warning/40 bg-warning/10")}>
            <div className="flex flex-wrap items-center gap-2"><span className={cn("size-2 rounded-full", account?.canReceive ? "bg-emerald-500" : "bg-amber-500")} /><span className="font-medium">{account?.name}</span><span className="text-muted-foreground">{account?.canReceive ? copy.receiveReady : copy.attention}</span>{lastSyncText ? <span className="text-xs text-muted-foreground">{lastSyncText}</span> : null}</div>
            <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{account?.canSend ? copy.connected : copy.sendNotReady}</span><Button size="sm" variant="secondary" onClick={() => setConnectorOpen(true)}>{account?.canReceive ? copy.manageConnection : copy.attentionAction}</Button></div>
          </div>

          <div className="overflow-hidden rounded-2xl border bg-card lg:grid lg:min-h-[620px] lg:grid-cols-[11rem_minmax(18rem,23rem)_minmax(0,1fr)]">
            <aside className="border-b p-2 lg:border-b-0 lg:border-r" aria-label={copy.title}>
              <div className="flex gap-1 overflow-x-auto lg:block lg:space-y-1">
                {[...providerFolders, ...(["drafts", "sent", "outbox"] as const).map((id) => data.folders.find((item) => item.id === id) ?? { id, count: 0 })].map((item) => {
                  const id = item.id;
                  const Icon = id === "inbox" ? Inbox : id === "drafts" ? FilePenLine : item.kind === "provider" ? Folder : Send;
                  const label = copy.folders[id as keyof typeof copy.folders] ?? item.name ?? id;
                  return <button key={id} type="button" aria-current={folder === id ? "page" : undefined} onClick={() => { setFolder(id); setSelectedMessageId(null); }} className={cn("flex min-w-max items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs sm:text-sm lg:w-full lg:min-w-0 lg:justify-start lg:gap-2 lg:px-3", folder === id ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}><Icon className="size-4 shrink-0" /><span className="truncate">{label}</span><span className="shrink-0 text-[11px] tabular-nums lg:ml-auto">{item.count}</span></button>;
                })}
              </div>
            </aside>

            <section className={cn("min-w-0 border-r", selectedMessage ? "hidden lg:block" : "block")} aria-label={folderName}>
              <div className="border-b p-3">
                <label className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-ring"><Search className="size-4 text-muted-foreground" /><span className="sr-only">{copy.search}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} className="min-w-0 flex-1 bg-transparent outline-none" /></label>
              </div>
              <div className="max-h-[70vh] overflow-y-auto lg:max-h-[560px]">
                {visibleMessages.length ? visibleMessages.map((entry) => !systemFolder
                  ? <MessageRow key={(entry as MailboxMessage).id} message={entry as MailboxMessage} selected={selectedMessageId === (entry as MailboxMessage).id} onOpen={openMessage} />
                  : <DraftRow key={(entry as MailboxDraft).id} draft={entry as MailboxDraft} copy={copy} onOpen={folder === "drafts" ? editDraft : undefined} />)
                  : <div className="p-8 text-center"><p className="font-medium">{!systemFolder ? (query.trim() ? copy.searchEmpty : copy.emptyInbox) : copy.emptyFolder}</p>{!systemFolder && !query.trim() ? <p className="mt-1 text-sm text-muted-foreground">{copy.emptyInboxHint}</p> : null}</div>}
              </div>
              {!systemFolder && data.pagination.totalPages > 1 ? <div className="flex items-center justify-between gap-2 border-t p-2"><Button size="sm" variant="ghost" disabled={!data.pagination.hasPrevious} onClick={() => { setPage((value) => Math.max(1, value - 1)); setSelectedMessageId(null); }}><ChevronLeft />{copy.previousPage}</Button><span className="text-xs text-muted-foreground">{copy.pageStatus.replace("{{page}}", String(data.pagination.page)).replace("{{total}}", String(data.pagination.totalPages))}</span><Button size="sm" variant="ghost" disabled={!data.pagination.hasNext} onClick={() => { setPage((value) => value + 1); setSelectedMessageId(null); }}>{copy.nextPage}<ChevronRight /></Button></div> : null}
            </section>

            <section className={cn("min-w-0", selectedMessage ? "block" : "hidden lg:block")} aria-label={selectedMessage?.subject ?? copy.choose}>
              {selectedMessage ? <MessageDetail message={selectedMessage} copy={copy} loading={busy === "fetch" && !selectedMessage.fetched} onBack={() => setSelectedMessageId(null)} onReply={() => startCompose(selectedMessage)} onMarkUnread={() => void markUnread(selectedMessage)} onPreview={(attachment) => void previewAttachment(selectedMessage, attachment)} onDownload={(attachment) => void downloadAttachment(selectedMessage, attachment)} /> : <div className="grid h-full min-h-80 place-items-center p-8 text-center text-sm text-muted-foreground"><div><Mail className="mx-auto mb-3 size-8 opacity-40" />{copy.choose}</div></div>}
            </section>
          </div>
        </>
      )}

      <ComposeModal copy={copy} value={compose} onChange={setCompose} busy={busy} canSend={Boolean(account?.canSend)} onClose={() => setCompose(null)} onSave={() => compose && void persistDraft(compose)} onReview={() => void reviewForSend()} onDelete={() => void removeDraft()} onPickAttachments={() => void pickComposeAttachments()} onPasteAttachments={(files) => void pasteComposeAttachments(files)} onRemoveAttachment={(ref) => setCompose((current) => current ? { ...current, attachments: current.attachments.filter((item) => item.ref !== ref) } : current)} />
      <SendReviewModal copy={copy} draft={reviewDraft} pending={busy === "send"} onClose={() => setReviewDraft(null)} onSend={() => void sendDraft()} />
      <MailConnectionModal copy={copy} open={connectorOpen} onClose={() => setConnectorOpen(false)} onConnected={() => {
        void queryClient.invalidateQueries({ queryKey: ["mailbox"] });
        window.setTimeout(() => { void queryClient.invalidateQueries({ queryKey: ["mailbox"] }); }, 2_000);
      }} />
      <AttachmentPreviewModal copy={copy} preview={attachmentPreview} onClose={() => setAttachmentPreview(null)} />
    </div>
  );
}

function MailConnectionModal({ copy, open, onClose, onConnected }: { copy: typeof COPY.zh | typeof COPY.en; open: boolean; onClose: () => void; onConnected: () => void }) {
  const bridge = window.myagenttoolDesktop;
  const [email, setEmail] = useState("");
  const [authorizationCode, setAuthorizationCode] = useState("");
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [sendConnected, setSendConnected] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !bridge?.getMailConnectorStatus) return;
    void bridge.getMailConnectorStatus().then((status) => {
      const provider = status.providers.find((item) => item.id === "netease_163");
      if (provider?.account) setEmail(provider.account);
      if (provider?.connected) setConnectedEmail(provider.account);
      setSendConnected(provider?.sendConnected === true);
    }).catch(() => setError(copy.errors.unavailable));
  }, [bridge, copy.errors.unavailable, open]);

  async function connect() {
    if (!bridge?.connect163Mail) { setError(copy.errors.unavailable); return; }
    setPending(true);
    setError(null);
    const result = await bridge.connect163Mail({ email, authorizationCode }).catch(() => ({ ok: false as const, error: "unavailable" as const }));
    setPending(false);
    if (!result.ok) {
      setError(copy.errors[result.error as keyof typeof copy.errors] ?? copy.errors.unavailable);
      return;
    }
    setAuthorizationCode("");
    setConnectedEmail(result.account.email);
    onConnected();
  }

  async function connectSend() {
    if (!bridge?.connect163MailSend) { setError(copy.errors.unavailable); return; }
    setPending(true);
    setError(null);
    const result = await bridge.connect163MailSend({ email, authorizationCode }).catch(() => ({ ok: false as const, error: "unavailable" as const }));
    setPending(false);
    if (!result.ok) { setError(copy.errors[result.error as keyof typeof copy.errors] ?? copy.errors.unavailable); return; }
    setAuthorizationCode("");
    setSendConnected(true);
    onConnected();
  }

  return <Modal open={open} title={copy.connectorTitle} description={copy.connectorDescription} size="lg" onClose={onClose} closeDisabled={pending} footer={connectedEmail && sendConnected ? <div className="flex justify-end"><Button onClick={onClose}>{copy.done}</Button></div> : undefined}>
    {!bridge?.getMailConnectorStatus ? <div className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">{copy.desktopOnly}</div> : connectedEmail ? <div className="space-y-4 text-center"><span className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-500/10 text-emerald-600"><ShieldCheck /></span><div><h3 className="font-semibold">{copy.connectSuccess}</h3><p className="mt-1 text-sm text-muted-foreground">{connectedEmail}</p></div>{sendConnected ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700">{copy.sendConnected}</div> : <div className="space-y-3 rounded-xl border bg-muted/20 p-4 text-left"><p className="text-sm font-medium">{copy.connectSend}</p><p className="text-xs leading-5 text-muted-foreground">{copy.connectSendHint}</p><label className="block text-sm font-medium">{copy.authorizationCode}<input type="password" autoComplete="off" value={authorizationCode} onChange={(event) => setAuthorizationCode(event.target.value)} placeholder={copy.authorizationPlaceholder} className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-normal outline-none focus:ring-2 focus:ring-ring" /></label>{error ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}<Button className="w-full" onClick={() => void connectSend()} disabled={pending}><Send />{pending ? copy.testing : copy.connectSend}</Button></div>}<Button variant="secondary" onClick={() => { setConnectedEmail(null); setSendConnected(false); setError(null); }}>{copy.reconnect}</Button></div> : <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-3"><div className="flex items-center justify-between gap-2"><span className="font-medium">{copy.provider163}</span><span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600">{copy.receiveReady}</span></div><p className="mt-1 text-xs text-muted-foreground">{copy.provider163Hint}</p></div>
        <div className="rounded-xl border bg-muted/30 p-3 opacity-70"><div className="flex items-center justify-between gap-2"><span className="font-medium">{copy.providerGmail}</span><span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{copy.comingSoon}</span></div></div>
      </div>
      <div className="rounded-xl border bg-muted/30 p-3"><p className="text-sm font-medium">1. {copy.authHelpTitle}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{copy.authHelp}</p></div>
      <div className="space-y-3"><p className="text-sm font-medium">2. {copy.connectAndTest}</p><label className="block text-sm font-medium">{copy.accountEmail}<input autoFocus autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@163.com" className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-normal outline-none focus:ring-2 focus:ring-ring" /></label><label className="block text-sm font-medium">{copy.authorizationCode}<input type="password" autoComplete="off" value={authorizationCode} onChange={(event) => setAuthorizationCode(event.target.value)} placeholder={copy.authorizationPlaceholder} className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-normal outline-none focus:ring-2 focus:ring-ring" /></label><p className="flex gap-2 text-xs leading-5 text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />{copy.localSecret}</p></div>
      {error ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
      <Button className="w-full" onClick={() => void connect()} disabled={pending}><RefreshCw className={cn(pending && "animate-spin")} />{pending ? copy.testing : copy.connectAndTest}</Button>
    </div>}
  </Modal>;
}

interface ComposeState {
  id: string | null;
  to: string;
  subject: string;
  body: string;
  attachments: MailDraftAttachment[];
  inReplyTo: string | null;
  references: string[];
}

interface AttachmentPreview {
  id: string;
  name: string;
  contentType: string;
  size: number;
  kind: "image" | "text" | "pdf";
  text?: string;
  dataBase64?: string;
}

function MessageRow({ message, selected, onOpen }: { message: MailboxMessage; selected: boolean; onOpen: (message: MailboxMessage) => void }) {
  return <button type="button" onClick={() => void onOpen(message)} className={cn("block w-full border-b p-3 text-left hover:bg-muted/50", selected && "bg-muted", message.unread && "border-l-2 border-l-primary")}><div className="flex items-baseline justify-between gap-2"><span className={cn("truncate text-sm", message.unread && "font-semibold")}>{message.from}</span><time className="shrink-0 text-[11px] text-muted-foreground">{shortDate(message.date)}</time></div><p className={cn("mt-1 truncate text-sm", message.unread && "font-medium")}>{message.subject}</p><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{message.preview || "…"}</p></button>;
}

function DraftRow({ draft, copy, onOpen }: { draft: MailboxDraft; copy: typeof COPY.zh | typeof COPY.en; onOpen?: (draft: MailboxDraft) => void }) {
  const content = <><div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{draft.to || "—"}</span><span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px]">{copy.status[draft.status as keyof typeof copy.status] ?? draft.status}</span></div><p className="mt-1 truncate text-sm">{draft.subject || copy.noSubject}</p><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{draft.body || "…"}</p></>;
  return onOpen ? <button type="button" onClick={() => onOpen(draft)} className="block w-full border-b p-3 text-left hover:bg-muted/50">{content}</button> : <article className="border-b p-3">{content}</article>;
}

function MessageDetail({ message, copy, loading, onBack, onReply, onMarkUnread, onPreview, onDownload }: { message: MailboxMessage; copy: typeof COPY.zh | typeof COPY.en; loading: boolean; onBack: () => void; onReply: () => void; onMarkUnread: () => void; onPreview: (attachment: MailboxMessage["attachments"][number]) => void; onDownload: (attachment: MailboxMessage["attachments"][number]) => void }) {
  return <div className="flex h-full min-h-0 flex-col"><div className="border-b p-4"><Button className="mb-3 lg:hidden" size="sm" variant="ghost" onClick={onBack}><ArrowLeft />{copy.back}</Button><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-lg font-semibold">{message.subject}</h2><p className="mt-2 break-words text-sm">{message.from}</p><time className="text-xs text-muted-foreground">{longDate(message.date)}</time></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" onClick={onMarkUnread}><MailOpen />{copy.markUnread}</Button><Button size="sm" variant="secondary" onClick={onReply}><Reply />{copy.reply}</Button></div></div>{message.issueNumber ? <p className="mt-3 text-xs text-primary">{copy.issue.replace("{{number}}", String(message.issueNumber))}</p> : null}<p className="mt-2 text-[11px] text-muted-foreground">{copy.localReadHint}</p></div><div className="border-b bg-amber-500/5 px-4 py-2 text-xs text-muted-foreground"><AlertTriangle className="mr-1 inline size-3.5 text-amber-500" />{copy.untrusted}</div><div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">{loading ? <p role="status" className="text-sm text-muted-foreground">{copy.loadingBody}</p> : message.body ? <div className="whitespace-pre-wrap break-words text-sm leading-7">{message.body}</div> : <p className="text-sm text-muted-foreground">{copy.bodyUnavailable}</p>}{message.attachments?.length ? <section className="mt-6 border-t pt-4" aria-label={copy.attachments}><h3 className="flex items-center gap-2 text-sm font-semibold"><Paperclip className="size-4" />{copy.attachments} ({message.attachments.length})</h3><div className="mt-2 space-y-2">{message.attachments.map((attachment) => <article key={attachment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 p-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{attachment.name}</p><p className="text-xs text-muted-foreground">{formatBytes(attachment.size)}</p></div><div className="flex gap-2">{attachment.previewable ? <Button size="sm" variant="ghost" onClick={() => onPreview(attachment)}><Eye />{copy.previewAttachment}</Button> : null}<Button size="sm" variant="secondary" onClick={() => onDownload(attachment)}><Download />{copy.downloadAttachment}</Button></div></article>)}</div></section> : null}</div></div>;
}

function AttachmentPreviewModal({ copy, preview, onClose }: { copy: typeof COPY.zh | typeof COPY.en; preview: AttachmentPreview | null; onClose: () => void }) {
  if (!preview) return null;
  const dataUrl = preview.dataBase64 ? `data:${preview.contentType};base64,${preview.dataBase64}` : null;
  return <Modal open title={copy.previewTitle} description={`${preview.name} · ${formatBytes(preview.size)}`} size="lg" onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>{copy.close}</Button>}><div className="max-h-[65vh] overflow-auto rounded-lg border bg-background p-3">{preview.kind === "text" ? <pre className="whitespace-pre-wrap break-words text-sm">{preview.text}</pre> : preview.kind === "image" && dataUrl ? <img src={dataUrl} alt={preview.name} className="mx-auto max-h-[58vh] max-w-full object-contain" /> : preview.kind === "pdf" && dataUrl ? <iframe title={preview.name} src={dataUrl} className="h-[58vh] w-full border-0" sandbox="" /> : null}</div></Modal>;
}

function ComposeModal({ copy, value, onChange, busy, canSend, onClose, onSave, onReview, onDelete, onPickAttachments, onPasteAttachments, onRemoveAttachment }: { copy: typeof COPY.zh | typeof COPY.en; value: ComposeState | null; onChange: (value: ComposeState | null) => void; busy: string | null; canSend: boolean; onClose: () => void; onSave: () => void; onReview: () => void; onDelete: () => void; onPickAttachments: () => void; onPasteAttachments: (files: File[]) => void; onRemoveAttachment: (ref: string) => void }) {
  if (!value) return null;
  const update = (field: "to" | "subject" | "body", next: string) => onChange({ ...value, [field]: next });
  return <Modal open title={value.id ? copy.editDraftTitle : copy.composeTitle} description={copy.composeHint} size="lg" onClose={onClose} footer={<div className="flex flex-wrap items-center justify-between gap-2"><div>{value.id ? <Button variant="ghost" onClick={onDelete} disabled={busy === "delete"}>{copy.deleteDraft}</Button> : null}</div><div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={onSave} disabled={busy === "save"}>{busy === "save" ? copy.saving : copy.save}</Button><Button onClick={onReview} disabled={busy === "save" || !canSend}><Send />{copy.reviewSend}</Button></div></div>}><div className="space-y-3" onPaste={(event) => { const files = [...event.clipboardData.files]; if (files.length) { event.preventDefault(); onPasteAttachments(files); } }}><label className="block text-sm font-medium">{copy.to}<input autoFocus value={value.to} onChange={(event) => update("to", event.target.value)} placeholder={copy.toPlaceholder} className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-normal outline-none focus:ring-2 focus:ring-ring" /></label><label className="block text-sm font-medium">{copy.subject}<input value={value.subject} onChange={(event) => update("subject", event.target.value)} placeholder={copy.subjectPlaceholder} className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-normal outline-none focus:ring-2 focus:ring-ring" /></label><label className="block text-sm font-medium">{copy.body}<textarea value={value.body} onChange={(event) => update("body", event.target.value)} placeholder={copy.bodyPlaceholder} className="mt-1 min-h-64 w-full resize-y rounded-md border bg-background px-3 py-2 font-normal leading-6 outline-none focus:ring-2 focus:ring-ring" /></label><section className="rounded-lg border bg-muted/20 p-3" aria-label={copy.attachments}><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-medium">{copy.attachments}</p><p className="text-xs text-muted-foreground">{copy.pasteAttachments} · {copy.attachmentLimit}</p></div><Button type="button" size="sm" variant="secondary" onClick={onPickAttachments}><Paperclip />{copy.addAttachments}</Button></div>{value.attachments.length ? <div className="mt-3 space-y-2">{value.attachments.map((attachment) => <div key={attachment.ref} className="flex min-w-0 items-center gap-2 rounded-md bg-background px-3 py-2"><Paperclip className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-sm">{attachment.name}</span><span className="text-xs text-muted-foreground">{formatBytes(attachment.size)}</span><button type="button" className="rounded p-1 hover:bg-muted" aria-label={copy.removeAttachment.replace("{{name}}", attachment.name)} onClick={() => onRemoveAttachment(attachment.ref)}><X className="size-4" /></button></div>)}</div> : null}</section>{!canSend ? <p className="text-xs text-muted-foreground">{copy.sendUnavailable}</p> : null}</div></Modal>;
}

function SendReviewModal({ copy, draft, pending, onClose, onSend }: { copy: typeof COPY.zh | typeof COPY.en; draft: MailboxDraft | null; pending: boolean; onClose: () => void; onSend: () => void }) {
  if (!draft) return null;
  return <Modal open title={copy.sendReviewTitle} description={copy.sendReviewHint} size="lg" onClose={onClose} closeDisabled={pending} footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={pending}>{copy.close}</Button><Button onClick={onSend} disabled={pending}><Send />{pending ? copy.sending : copy.sendNow}</Button></div>}><dl className="space-y-3 text-sm"><div><dt className="text-xs text-muted-foreground">{copy.to}</dt><dd className="mt-1 break-words font-medium">{draft.to}</dd></div><div><dt className="text-xs text-muted-foreground">{copy.subject}</dt><dd className="mt-1 break-words font-medium">{draft.subject || copy.noSubject}</dd></div><div><dt className="text-xs text-muted-foreground">{copy.body}</dt><dd className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border bg-background p-3 leading-6">{draft.body}</dd></div>{draft.attachments?.length ? <div><dt className="text-xs text-muted-foreground">{copy.attachments}</dt><dd className="mt-1 space-y-1">{draft.attachments.map((attachment) => <div key={attachment.ref} className="flex items-center gap-2 rounded-md border px-3 py-2"><Paperclip className="size-4" /><span className="min-w-0 flex-1 truncate">{attachment.name}</span><span className="text-xs text-muted-foreground">{formatBytes(attachment.size)}</span></div>)}</dd></div> : null}</dl></Modal>;
}

function shortDate(value: string | null) { const date = value ? new Date(value) : null; return date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date) : ""; }
function longDate(value: string | null) { const date = value ? new Date(value) : null; return date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date) : ""; }
function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; return `${(value / (1024 * 1024)).toFixed(1)} MB`; }
