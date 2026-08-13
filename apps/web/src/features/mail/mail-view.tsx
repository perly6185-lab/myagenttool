import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  FilePenLine,
  Inbox,
  Mail,
  PenLine,
  RefreshCw,
  Reply,
  Search,
  Send,
  ShieldCheck,
} from "lucide-react";
import { SectionHeading } from "@/components/common/section-heading";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { api, ApiError, type MailboxDraft, type MailboxMessage } from "@/lib/api-client";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { cn } from "@/lib/cn";

type FolderId = "inbox" | "drafts" | "sent" | "outbox";

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
    search: "搜索发件人、主题或正文",
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
    provider163Hint: "当前支持收取和阅读邮件",
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
    connectSuccessHint: "现在可以回到收件箱收取新邮件。发件权限仍保持关闭。",
    done: "完成",
    reconnect: "重新连接",
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
    search: "Search sender, subject, or body",
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
    provider163Hint: "Receiving and reading are currently supported",
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
    connectSuccessHint: "You can now retrieve new messages. Sending permission remains off.",
    done: "Done",
    reconnect: "Reconnect",
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
    status: { draft: "Draft", sending: "Sending", sent: "Sent", send_unconfirmed: "Check whether sent" },
  },
} as const;

export function MailView() {
  const { i18n } = useAppTranslation();
  const copy = i18n.language.startsWith("zh") ? COPY.zh : COPY.en;
  const queryClient = useQueryClient();
  const mailbox = useQuery({ queryKey: ["mailbox"], queryFn: api.getMailbox, refetchInterval: 4_000 });
  const [folder, setFolder] = useState<FolderId>("inbox");
  const [query, setQuery] = useState("");
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [reviewDraft, setReviewDraft] = useState<MailboxDraft | null>(null);
  const [busy, setBusy] = useState<"sync" | "fetch" | "save" | "send" | "delete" | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [connectorOpen, setConnectorOpen] = useState(false);
  const [pendingSyncId, setPendingSyncId] = useState<string | null>(null);
  const data = mailbox.data;
  const account = data?.accounts.find((item) => item.canReceive) ?? data?.accounts[0] ?? null;
  const selectedMessage = data?.messages.find((message) => message.id === selectedMessageId) ?? null;
  const syncing = busy === "sync" || data?.sync?.status === "syncing";
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

  const visibleMessages = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (value: string) => !needle || value.toLowerCase().includes(needle);
    if (folder === "inbox") {
      return (data?.messages ?? []).filter((message) => matches(`${message.from} ${message.subject} ${message.preview}`));
    }
    return (data?.drafts ?? [])
      .filter((draft) => folder === "drafts" ? draft.status === "draft" : folder === "sent" ? draft.status === "sent" : ["sending", "send_unconfirmed"].includes(draft.status))
      .filter((draft) => matches(`${draft.to} ${draft.subject} ${draft.body}`));
  }, [data?.drafts, data?.messages, folder, query]);

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
    if (message.fetched || !account?.fetchCapability || busy === "fetch") return;
    setBusy("fetch");
    try {
      await api.invokeCapability(account.fetchCapability, { messageId: message.messageId });
      window.setTimeout(() => { void queryClient.invalidateQueries({ queryKey: ["mailbox"] }); }, 800);
    } catch {
      setNotice({ tone: "error", text: copy.bodyUnavailable });
    } finally {
      setBusy(null);
    }
  }

  function startCompose(message?: MailboxMessage) {
    const subject = message ? `Re: ${message.subject.replace(/^(\s*re\s*:\s*)+/i, "")}` : "";
    setCompose({ id: null, to: message?.from ?? "", subject, body: "", inReplyTo: message?.messageId ?? null, references: message ? [...message.references, message.messageId] : [] });
    setNotice(null);
  }

  function editDraft(draft: MailboxDraft) {
    setCompose({ id: draft.id, to: draft.to, subject: draft.subject, body: draft.body, inReplyTo: draft.inReplyTo, references: draft.references });
    setNotice(null);
  }

  async function persistDraft(value: ComposeState) {
    setBusy("save");
    try {
      const result = value.id
        ? await api.updateMailDraft(value.id, { to: value.to, subject: value.subject, body: value.body })
        : await api.createMailDraft({ to: value.to, subject: value.subject, body: value.body, inReplyTo: value.inReplyTo, references: value.references });
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
              <div className="grid grid-cols-4 gap-1 lg:block lg:space-y-1">
                {(["inbox", "drafts", "sent", "outbox"] as FolderId[]).map((id) => {
                  const count = data.folders.find((item) => item.id === id)?.count ?? 0;
                  const Icon = id === "inbox" ? Inbox : id === "drafts" ? FilePenLine : Send;
                  return <button key={id} type="button" aria-current={folder === id ? "page" : undefined} onClick={() => { setFolder(id); setSelectedMessageId(null); }} className={cn("flex min-w-0 items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs sm:text-sm lg:w-full lg:justify-start lg:gap-2 lg:px-3", folder === id ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}><Icon className="size-4 shrink-0" /><span className="truncate">{copy.folders[id]}</span><span className="shrink-0 text-[11px] tabular-nums lg:ml-auto">{count}</span></button>;
                })}
              </div>
            </aside>

            <section className={cn("min-w-0 border-r", selectedMessage ? "hidden lg:block" : "block")} aria-label={copy.folders[folder]}>
              <div className="border-b p-3">
                <label className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-ring"><Search className="size-4 text-muted-foreground" /><span className="sr-only">{copy.search}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} className="min-w-0 flex-1 bg-transparent outline-none" /></label>
              </div>
              <div className="max-h-[70vh] overflow-y-auto lg:max-h-[560px]">
                {visibleMessages.length ? visibleMessages.map((entry) => folder === "inbox"
                  ? <MessageRow key={(entry as MailboxMessage).id} message={entry as MailboxMessage} selected={selectedMessageId === (entry as MailboxMessage).id} onOpen={openMessage} />
                  : <DraftRow key={(entry as MailboxDraft).id} draft={entry as MailboxDraft} copy={copy} onOpen={folder === "drafts" ? editDraft : undefined} />)
                  : <div className="p-8 text-center"><p className="font-medium">{folder === "inbox" ? copy.emptyInbox : copy.emptyFolder}</p>{folder === "inbox" ? <p className="mt-1 text-sm text-muted-foreground">{copy.emptyInboxHint}</p> : null}</div>}
              </div>
            </section>

            <section className={cn("min-w-0", selectedMessage ? "block" : "hidden lg:block")} aria-label={selectedMessage?.subject ?? copy.choose}>
              {selectedMessage ? <MessageDetail message={selectedMessage} copy={copy} loading={busy === "fetch" && !selectedMessage.fetched} onBack={() => setSelectedMessageId(null)} onReply={() => startCompose(selectedMessage)} /> : <div className="grid h-full min-h-80 place-items-center p-8 text-center text-sm text-muted-foreground"><div><Mail className="mx-auto mb-3 size-8 opacity-40" />{copy.choose}</div></div>}
            </section>
          </div>
        </>
      )}

      <ComposeModal copy={copy} value={compose} onChange={setCompose} busy={busy} canSend={Boolean(account?.canSend)} onClose={() => setCompose(null)} onSave={() => compose && void persistDraft(compose)} onReview={() => void reviewForSend()} onDelete={() => void removeDraft()} />
      <SendReviewModal copy={copy} draft={reviewDraft} pending={busy === "send"} onClose={() => setReviewDraft(null)} onSend={() => void sendDraft()} />
      <MailConnectionModal copy={copy} open={connectorOpen} onClose={() => setConnectorOpen(false)} onConnected={() => {
        void queryClient.invalidateQueries({ queryKey: ["mailbox"] });
        window.setTimeout(() => { void queryClient.invalidateQueries({ queryKey: ["mailbox"] }); }, 2_000);
      }} />
    </div>
  );
}

function MailConnectionModal({ copy, open, onClose, onConnected }: { copy: typeof COPY.zh | typeof COPY.en; open: boolean; onClose: () => void; onConnected: () => void }) {
  const bridge = window.myagenttoolDesktop;
  const [email, setEmail] = useState("");
  const [authorizationCode, setAuthorizationCode] = useState("");
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !bridge?.getMailConnectorStatus) return;
    void bridge.getMailConnectorStatus().then((status) => {
      const provider = status.providers.find((item) => item.id === "netease_163");
      if (provider?.account) setEmail(provider.account);
      if (provider?.connected) setConnectedEmail(provider.account);
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

  return <Modal open={open} title={copy.connectorTitle} description={copy.connectorDescription} size="lg" onClose={onClose} closeDisabled={pending} footer={connectedEmail ? <div className="flex justify-end"><Button onClick={onClose}>{copy.done}</Button></div> : undefined}>
    {!bridge?.getMailConnectorStatus ? <div className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">{copy.desktopOnly}</div> : connectedEmail ? <div className="space-y-4 text-center"><span className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-500/10 text-emerald-600"><ShieldCheck /></span><div><h3 className="font-semibold">{copy.connectSuccess}</h3><p className="mt-1 text-sm text-muted-foreground">{connectedEmail}</p><p className="mt-2 text-sm text-muted-foreground">{copy.connectSuccessHint}</p></div><Button variant="secondary" onClick={() => { setConnectedEmail(null); setError(null); }}>{copy.reconnect}</Button></div> : <div className="space-y-4">
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
  inReplyTo: string | null;
  references: string[];
}

function MessageRow({ message, selected, onOpen }: { message: MailboxMessage; selected: boolean; onOpen: (message: MailboxMessage) => void }) {
  return <button type="button" onClick={() => void onOpen(message)} className={cn("block w-full border-b p-3 text-left hover:bg-muted/50", selected && "bg-muted", message.unread && "border-l-2 border-l-primary")}><div className="flex items-baseline justify-between gap-2"><span className={cn("truncate text-sm", message.unread && "font-semibold")}>{message.from}</span><time className="shrink-0 text-[11px] text-muted-foreground">{shortDate(message.date)}</time></div><p className={cn("mt-1 truncate text-sm", message.unread && "font-medium")}>{message.subject}</p><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{message.preview || "…"}</p></button>;
}

function DraftRow({ draft, copy, onOpen }: { draft: MailboxDraft; copy: typeof COPY.zh | typeof COPY.en; onOpen?: (draft: MailboxDraft) => void }) {
  const content = <><div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{draft.to || "—"}</span><span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px]">{copy.status[draft.status as keyof typeof copy.status] ?? draft.status}</span></div><p className="mt-1 truncate text-sm">{draft.subject || copy.noSubject}</p><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{draft.body || "…"}</p></>;
  return onOpen ? <button type="button" onClick={() => onOpen(draft)} className="block w-full border-b p-3 text-left hover:bg-muted/50">{content}</button> : <article className="border-b p-3">{content}</article>;
}

function MessageDetail({ message, copy, loading, onBack, onReply }: { message: MailboxMessage; copy: typeof COPY.zh | typeof COPY.en; loading: boolean; onBack: () => void; onReply: () => void }) {
  return <div className="flex h-full min-h-0 flex-col"><div className="border-b p-4"><Button className="mb-3 lg:hidden" size="sm" variant="ghost" onClick={onBack}><ArrowLeft />{copy.back}</Button><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-lg font-semibold">{message.subject}</h2><p className="mt-2 break-words text-sm">{message.from}</p><time className="text-xs text-muted-foreground">{longDate(message.date)}</time></div><Button size="sm" variant="secondary" onClick={onReply}><Reply />{copy.reply}</Button></div>{message.issueNumber ? <p className="mt-3 text-xs text-primary">{copy.issue.replace("{{number}}", String(message.issueNumber))}</p> : null}</div><div className="border-b bg-amber-500/5 px-4 py-2 text-xs text-muted-foreground"><AlertTriangle className="mr-1 inline size-3.5 text-amber-500" />{copy.untrusted}</div><div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">{loading ? <p role="status" className="text-sm text-muted-foreground">{copy.loadingBody}</p> : message.body ? <div className="whitespace-pre-wrap break-words text-sm leading-7">{message.body}</div> : <p className="text-sm text-muted-foreground">{copy.bodyUnavailable}</p>}</div></div>;
}

function ComposeModal({ copy, value, onChange, busy, canSend, onClose, onSave, onReview, onDelete }: { copy: typeof COPY.zh | typeof COPY.en; value: ComposeState | null; onChange: (value: ComposeState | null) => void; busy: string | null; canSend: boolean; onClose: () => void; onSave: () => void; onReview: () => void; onDelete: () => void }) {
  if (!value) return null;
  const update = (field: "to" | "subject" | "body", next: string) => onChange({ ...value, [field]: next });
  return <Modal open title={value.id ? copy.editDraftTitle : copy.composeTitle} description={copy.composeHint} size="lg" onClose={onClose} footer={<div className="flex flex-wrap items-center justify-between gap-2"><div>{value.id ? <Button variant="ghost" onClick={onDelete} disabled={busy === "delete"}>{copy.deleteDraft}</Button> : null}</div><div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={onSave} disabled={busy === "save"}>{busy === "save" ? copy.saving : copy.save}</Button><Button onClick={onReview} disabled={busy === "save" || !canSend}><Send />{copy.reviewSend}</Button></div></div>}><div className="space-y-3"><label className="block text-sm font-medium">{copy.to}<input autoFocus value={value.to} onChange={(event) => update("to", event.target.value)} placeholder={copy.toPlaceholder} className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-normal outline-none focus:ring-2 focus:ring-ring" /></label><label className="block text-sm font-medium">{copy.subject}<input value={value.subject} onChange={(event) => update("subject", event.target.value)} placeholder={copy.subjectPlaceholder} className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-normal outline-none focus:ring-2 focus:ring-ring" /></label><label className="block text-sm font-medium">{copy.body}<textarea value={value.body} onChange={(event) => update("body", event.target.value)} placeholder={copy.bodyPlaceholder} className="mt-1 min-h-64 w-full resize-y rounded-md border bg-background px-3 py-2 font-normal leading-6 outline-none focus:ring-2 focus:ring-ring" /></label>{!canSend ? <p className="text-xs text-muted-foreground">{copy.sendUnavailable}</p> : null}</div></Modal>;
}

function SendReviewModal({ copy, draft, pending, onClose, onSend }: { copy: typeof COPY.zh | typeof COPY.en; draft: MailboxDraft | null; pending: boolean; onClose: () => void; onSend: () => void }) {
  if (!draft) return null;
  return <Modal open title={copy.sendReviewTitle} description={copy.sendReviewHint} size="lg" onClose={onClose} closeDisabled={pending} footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={pending}>{copy.close}</Button><Button onClick={onSend} disabled={pending}><Send />{pending ? copy.sending : copy.sendNow}</Button></div>}><dl className="space-y-3 text-sm"><div><dt className="text-xs text-muted-foreground">{copy.to}</dt><dd className="mt-1 break-words font-medium">{draft.to}</dd></div><div><dt className="text-xs text-muted-foreground">{copy.subject}</dt><dd className="mt-1 break-words font-medium">{draft.subject || copy.noSubject}</dd></div><div><dt className="text-xs text-muted-foreground">{copy.body}</dt><dd className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border bg-background p-3 leading-6">{draft.body}</dd></div></dl></Modal>;
}

function shortDate(value: string | null) { const date = value ? new Date(value) : null; return date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date) : ""; }
function longDate(value: string | null) { const date = value ? new Date(value) : null; return date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date) : ""; }
