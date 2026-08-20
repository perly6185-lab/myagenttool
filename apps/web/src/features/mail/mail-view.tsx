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
  ListTodo,
  Mail,
  MailOpen,
  MonitorUp,
  Paperclip,
  PenLine,
  RefreshCw,
  Reply,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { SectionHeading } from "@/components/common/section-heading";
import { ConfirmModal } from "@/components/common/confirm-modal";
import { DesktopHandoffLink } from "@/components/common/desktop-handoff";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { api, ApiError, type MailboxAccount, type MailboxDraft, type MailboxMessage, type MailClassification, type MailClassificationJob, type MailClassificationQuality, type MailClassificationRule, type MailClassificationRuleSuggestion, type MailFolderAutomation, type MailFolderMoveJob, type MailFolderMovePreview, type MailFolderSuggestion, type MailDraftAttachment, type MailResponsePackage, type MailSemanticPreview, type MailSmartView, type MailTaskOperations, type MailTaskPolicy } from "@/lib/api-client";
import { mailApi } from "@/features/mail/mail-api";
import { normalizeCid, PlainMailBody, SafeHtmlMailBody } from "@/features/mail/safe-mail-content";
import { useConsoleState } from "@/data/use-console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { cn } from "@/lib/cn";
import { useUiStore } from "@/store/ui-store";
import { canManageProfessionalSettings } from "@/app/page-access";
import { useSessionUser } from "@/hooks/use-session-user";

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
    organize: "智能分类",
    organizing: "正在智能分类…",
    organizeComplete: "智能分类已完成。你可以通过智能分类视图快速查看。",
    organizeFailed: "暂时无法完成智能分类，现有邮件不受影响，请稍后重试。",
    deepOrganize: "深度整理",
    deepTitle: "深度整理最近邮件",
    deepHint: "使用你在本机配置的模型，进一步判断已打开邮件的正文。",
    deepLoading: "正在检查可整理的邮件…",
    deepUnavailable: "本机语义模型尚未配置。基础整理仍可正常使用。",
    deepCircuit: "本机模型连续失败，已暂时暂停。稍后可重试，基础分类不受影响。",
    deepEligible: "将处理 {{count}} 封已打开且正文已缓存的邮件。",
    deepRange: "范围：{{from}} 至 {{to}}",
    deepLocal: "正文只发送到本机模型，不会发往外部服务。",
    deepCachedOnly: "只分析后台已下载的正文，不会为深度整理读取附件。",
    deepNoActions: "只更新分类建议，不会移动、删除、回复或创建任务。",
    deepStart: "确认并开始",
    deepStarting: "正在开始…",
    deepNoPending: "已打开的邮件都已完成深度整理。",
    deepProgress: "已处理 {{processed}} / {{total}}",
    deepCompleted: "深度整理完成，新的分类建议已更新。",
    deepDegraded: "基础整理可用，但部分邮件未能完成深度判断。",
    deepCancelled: "已取消深度整理，已完成的结果会保留。",
    cancelDeep: "取消整理",
    cancellingDeep: "正在取消…",
    smartViews: { all: "全部", needs_attention: "待处理", important: "重要", notifications: "通知与回执", subscriptions: "订阅与推广", other: "其他" },
    classificationWhy: "分类建议：{{reason}}",
    uncertainClassification: "可能不准确",
    classificationWrong: "分类不对",
    correctionTitle: "调整邮件分类",
    correctionHint: "选择更合适的位置。只改变智能视图，不会移动、删除或回复邮件。",
    correctionLabel: "放到",
    correctionSave: "保存调整",
    correctionSaving: "正在保存…",
    correctionFailed: "暂时无法保存分类调整，请重试。",
    rules: "智能分类设置",
    organizeMenu: "智能分类",
    organizeMenuTitle: "智能分类",
    organizeMenuHint: "智能分类只更新视图；邮箱目录和自动整理会在单独确认后处理低风险邮件。",
    organizeBasicHint: "使用邮件头快速分类新邮件",
    organizeDeepHint: "使用本机模型分析已打开的邮件",
    organizeRulesHint: "查看和管理你的分类习惯",
    rulesTitle: "智能分类与邮箱目录",
    rulesHint: "系统只会根据多次一致的手动调整提出建议。智能分类规则只更新视图；自动整理需稳定达标并单独确认。",
    rulesLoading: "正在读取规则…",
    rulesFailed: "暂时无法读取或更新智能分类设置，请重试。",
    rulesSuggestions: "建议启用",
    rulesExisting: "已创建的规则",
    rulesSuggestionEmpty: "暂无新建议。继续调整分类，出现稳定习惯后会显示在这里。",
    rulesExistingEmpty: "尚未启用任何个人智能分类规则。",
    rulesSuggestionNotice: "发现 {{count}} 条可复用的分类习惯",
    rulesSuggestionNoticeHint: "查看影响范围后，可选择是否用于以后的邮件。",
    mobileSuggestionNotice: "有 {{count}} 条整理建议",
    mobileSuggestionNoticeHint: "按需查看，不影响正常收取和阅读邮件。",
    rulesReview: "查看建议",
    rulesMatchSender: "发件人 {{value}}",
    rulesMatchDomain: "域名 {{value}}",
    rulesEvidence: "基于 {{count}} 次一致调整",
    rulesAffected: "当前将影响 {{count}} 封邮件",
    rulesFutureOnly: "当前没有未手动调整的匹配邮件；规则仍可用于以后收到的邮件。",
    rulesSamples: "影响样例",
    rulesEnable: "启用规则",
    rulesEnabling: "正在启用…",
    rulesUpdating: "正在更新…",
    rulesActive: "已启用",
    rulesPaused: "已暂停",
    rulesRevoked: "已撤销",
    rulesPause: "暂停",
    rulesResume: "恢复",
    rulesRevoke: "撤销",
    rulesEdit: "修改分类",
    rulesSave: "保存规则",
    rulesNoActions: "规则只改变智能视图，单封邮件的手动调整始终优先。",
    rulesAccount: "邮箱：{{value}}",
    rulesEditing: "正在修改：{{match}}",
    rulesEnabledSuccess: "规则已启用，以后的匹配邮件将进入所选智能视图。",
    rulesUpdatedSuccess: "规则已更新。",
    rulesSavedSuccess: "规则分类已保存。",
    qualityTitle: "整理质量",
    qualityCollecting: "正在积累本地样本",
    qualityHealthy: "当前整理表现稳定",
    qualityNeedsAttention: "建议先检查分类结果",
    qualityCollectingHint: "至少积累 {{count}} 封已智能分类邮件后再判断稳定性；样本不足不会开启更多自动操作。",
    qualityHealthyHint: "当前本地信号均在建议范围内，这只是使用质量信号，不代表绝对准确率。",
    qualityNeedsAttentionHint: "“其他”、手动调整或任务失败偏多。建议先检查规则并继续纠正，不会自动扩大整理范围。",
    qualityCoverage: "已整理",
    qualityUnknown: "归入其他",
    qualityCorrections: "手动调整",
    qualityJobFailures: "处理失败",
    qualityMoveResults: "目录批次待核对 {{unconfirmed}} / {{total}}",
    qualityMoveCollecting: "邮箱目录批次不足，暂不判断稳定性。",
    qualityPrivacy: "只在本机汇总数量，不包含邮件主题、发件人或正文。",
    qualityLoading: "正在计算本地质量…",
    qualityFailed: "暂时无法读取整理质量，请重试。",
    folderSuggestions: "邮箱目录建议",
    folderSuggestionNotice: "发现 {{count}} 条邮箱目录建议",
    folderSuggestionNoticeHint: "可以先查看哪些邮件可能适合放入同一目录；当前不会移动邮件。",
    folderSuggestionEmpty: "暂无邮箱目录建议。启用稳定的订阅或通知智能分类规则后，建议会显示在这里。",
    folderSuggestionLoading: "正在检查目录建议…",
    folderSuggestionFailed: "暂时无法读取或预览目录建议，请重试。",
    folderSuggestedExisting: "建议放入已有目录：{{value}}",
    folderSuggestedNew: "建议新目录：{{value}}",
    folderDestination: "预览目标目录",
    folderAccount: "邮箱",
    folderAffected: "{{count}} 封邮件符合条件",
    folderProtected: "另有 {{count}} 封重要或待处理邮件已自动排除",
    folderPreview: "预览邮件",
    folderPreviewing: "正在生成预览…",
    folderPreviewTitle: "邮箱目录预览",
    folderPreviewHint: "这是只读预览，不会创建目录或移动邮件。",
    folderPreviewCount: "本次预览 {{selected}} 封，共匹配 {{total}} 封",
    folderPreviewRemaining: "其余 {{count}} 封将在后续批次中处理。",
    folderPreviewNoMove: "当前不会移动任何邮件。需要执行移动时，系统会另行展示完整清单并再次要求确认。",
    folderMoveConfirm: "确认并移动 {{count}} 封",
    folderMoveStarting: "正在提交…",
    folderMoveProgress: "正在整理 {{count}} 封邮件…",
    folderMoveSuccess: "已将 {{count}} 封邮件移入目标目录。",
    folderMoveUnconfirmed: "服务商没有返回完整结果。请先重新收取邮件，确认实际位置后再创建新预览；系统不会自动重试。",
    folderMoveFailed: "暂时无法更新邮箱目录，请重新生成预览后再试。",
    folderMovePermission: "检查邮箱连接",
    folderMovePermissionHint: "目录创建和移动复用当前邮箱连接；每次实际移动仍会先让你确认。",
    organizeConnected: "目录整理已连接",
    folderMoveRecoveryNotice: "有一批邮箱目录结果需要核对",
    folderMoveRecoveryHint: "系统不会自动重试。重新收取邮件后，请检查邮件的实际位置。",
    folderMoveReviewStatus: "查看状态",
    folderMoveReconcile: "核对同步结果",
    folderMoveReconciling: "正在核对…",
    folderMoveReconciled: "已根据同步结果确认这批邮件的位置。",
    folderMoveReconcileFailed: "暂时无法核对，请先完成收取邮件后重试。",
    folderMoveRecoverable: "已确认还有 {{count}} 封留在原目录，可生成新的确认预览。",
    folderMoveConflict: "部分邮件位置仍不明确，已停止自动处理，请手动检查。",
    folderAutomationTitle: "自动整理",
    folderAutomationEmpty: "尚未启用自动整理。只有智能分类和邮箱目录批次都稳定后才可开启。",
    folderAutomationEnable: "启用自动整理",
    folderAutomationConfirmTitle: "确认自动整理",
    folderAutomationConfirmHint: "这是持续生效的邮箱写入授权，请确认范围和目标目录。",
    folderAutomationConfirm: "确认并启用",
    folderAutomationScope: "以后每次收取邮件后，最多自动整理 {{count}} 封符合此规则的新邮件。",
    folderAutomationStandingConsent: "启用后，匹配邮件不再逐批询问；你可以随时暂停或撤销。",
    folderAutomationSafety: "待处理、重要、账号安全和手动调整邮件始终排除；任一批结果不确定时规则会立即暂停。",
    folderAutomationQualityRequired: "需至少 50 封稳定智能分类和 10 个稳定邮箱目录批次后才能开启自动整理。",
    folderAutomationEnabled: "自动整理已启用；每批最多 10 封，异常时会自动暂停。",
    folderAutomationFailed: "暂时无法启用或更新自动整理，请检查质量状态和邮箱目录权限。",
    folderAutomationActive: "自动整理已启用",
    folderAutomationPaused: "自动整理已暂停",
    folderAutomationNeedsReview: "上次执行或质量信号异常，需要重新授权后才能恢复。",
    folderAutomationDryRun: "试运行",
    folderAutomationDryRunning: "正在试运行…",
    folderAutomationDryRunResult: "试运行：本批将整理 {{selected}} 封，排除 {{excluded}} 封；未调用邮箱服务商。",
    folderAutomationLastSuccess: "最近成功：{{time}}",
    folderAutomationSuccessStreak: "连续成功 {{count}} 批",
    folderAutomationLastChecked: "最近核对：{{time}}",
    folderAutomationPauseUser: "你已暂停；准备好后可以恢复。",
    folderAutomationPauseSync: "结果需要核对；请先收取新邮件并查看实际位置。",
    folderAutomationPauseQuality: "智能分类质量暂未达标；请先检查并纠正分类。",
    folderAutomationPauseRollout: "当前发布阶段未开放自动整理；历史授权和记录仍然保留。",
    folderAutomationPauseAuthorize: "规则或邮箱目录发生变化；请重新确认自动整理。",
    folderHistoryTitle: "邮箱目录操作历史",
    folderHistoryEmpty: "尚无目录移动记录。",
    folderHistoryManual: "手动确认",
    folderHistoryAutomatic: "自动规则",
    folderHistoryRecovery: "失败恢复",
    folderHistorySucceeded: "已移动 {{count}} 封",
    folderHistoryMoving: "进行中",
    folderHistoryRecoverable: "{{count}} 封可重试",
    folderHistoryNeedsReview: "待核对",
    loadFailed: "邮箱暂时无法加载。已有邮件和草稿没有丢失，请重试。",
    retry: "重新加载",
    lastSynced: "上次收取：{{time}}",
    search: "搜索此邮箱目录内已收取的邮件",
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
    archiveAvailable: "原始邮件和附件已安全保存在本机，可离线读取。",
    archiveUnavailable: "邮件正文已收取，但原始邮件尚未保存在本机；附件仍需连接邮箱读取。",
    attachmentLocal: "本机可用",
    cursorReset: "邮箱目录发生变化，已安全重新收取最近邮件。",
    folderSyncError: "部分邮箱目录暂时无法更新，其他邮件已正常保留。请稍后再次收取。",
    connected: "已连接",
    receiveOnly: "当前可收件；发件权限尚未连接",
    folders: { inbox: "收件箱", drafts: "草稿", sent: "已发送", outbox: "发件箱" },
    unread: "未读",
    emptyInbox: "收件箱里还没有邮件",
    emptyInboxHint: "点击“收取新邮件”，新的未读邮件会显示在这里。",
    emptyFolder: "这里还没有邮件",
    choose: "选择一封邮件查看内容",
    loadingBody: "正文正在后台下载，完成后会自动显示，无需重复操作。",
    bodyUnavailable: "正文已加入后台下载队列，完成后会自动显示。",
    bodyDownloadFailed: "正文自动下载暂未完成。再次点击这封邮件即可优先重试。",
    bodyNoLongerAvailable: "邮箱服务商已找不到这封邮件，列表信息仍会保留。邮件可能已在其他设备上被移动或删除。",
    htmlTextNotice: "这封邮件包含 HTML。默认显示经过转换的安全文本，不会加载远程图片。",
    htmlTextNoticeCompact: "含 HTML，当前显示安全文本。",
    viewSafeHtml: "查看安全排版",
    viewPlainText: "返回纯文本",
    safeHtmlTitle: "安全邮件内容",
    safeHtmlNotice: "HTML 已移除脚本、表单、样式和非安全地址，并在隔离区域中显示。",
    remoteImagesBlocked: "远程图片默认已拦截，以避免向发件人暴露阅读状态和网络地址。",
    remoteImagesLoaded: "已按你的选择加载远程图片；发件方可能获知你的网络地址和阅读行为。",
    loadRemoteImages: "加载远程图片",
    blockRemoteImages: "重新拦截远程图片",
    inlineImagesLoading: "正在安全加载邮件内嵌图片…",
    bodyTruncated: "这封邮件超过本地安全读取上限，当前正文并不完整。请到邮箱服务商查看原文。",
    reply: "回复",
    replyDraft: "写回复草稿",
    issue: "已关联任务来源 #{{number}}",
    createTask: "交给 AI 处理",
    linkedTask: "已关联 {{ref}}",
    taskReviewTitle: "确认任务内容",
    taskReviewHint: "先确认项目和任务说明，再选择保存为待办，或让 AI 在受限环境中分析并准备结果。",
    taskProject: "所属项目",
    taskTitle: "任务标题",
    taskDescription: "任务说明",
    taskDescriptionPlaceholder: "补充需要完成的事项、交付结果或时间要求",
    taskSourceHint: "邮件是外部内容。AI 只会把它作为待分析资料，不会把邮件文字当成系统指令，也不会自动发送回复。",
    taskAttachmentsHint: "选择要一并带入任务的附件（可选，最多 6 个）",
    createTaskNow: "只创建任务",
    createAndHandle: "创建并让 AI 处理",
    creatingTask: "正在创建…",
    taskCreated: "任务 {{ref}} 已创建。",
    taskCreatedWithSkipped: "任务 {{ref}} 已创建，{{count}} 个附件未能添加，可稍后在任务中补充。",
    viewTask: "查看任务",
    aiConsole: "AI 处理台",
    aiConsoleTitle: "邮件 AI 处理台",
    aiConsoleHint: "面向专业用户的任务关联、审核、影子规则和运行时间线。自动化总开关关闭时只记录影子判断。",
    responseReady: "AI 回复建议",
    responseAnalysis: "分析摘要",
    responseReply: "建议回复",
    responseApprove: "批准建议",
    responseRevise: "让 AI 修改",
    responseDraft: "转为邮件草稿",
    responseDrafted: "已生成草稿，可在草稿箱继续编辑和确认发送。",
    responseLoad: "读取 AI 结果",
    responsePending: "AI 结果尚未完成，请稍后再试。",
    taskFailed: "暂时无法创建任务，请检查项目后重试。",
    taskProjectRequired: "请先选择一个项目。",
    taskTitleRequired: "请填写任务标题。",
    taskAttachmentDesktopOnly: "邮件附件只能在桌面版中转入任务；你可以取消附件选择后继续。",
    untrusted: "邮件内容来自外部。系统只把它当作内容展示，不会将其中的文字当成操作指令。",
    securityStored: "安全显示 · 已保存在本机",
    securityOnline: "安全显示 · 附件读取需要邮箱连接",
    securityDetails: "安全与保存详情",
    back: "返回邮件列表",
    connectTitle: "连接你的邮箱",
    connectHint: "连接后即可收件、整理目录和发邮件。登录信息只保存在这台电脑上。",
    connectAction: "打开邮箱连接设置",
    connectSimple: "不需要在这里填写 IMAP、SMTP 或服务器地址。",
    attention: "邮箱需要重新连接",
    attentionAction: "检查连接",
    manageConnection: "管理邮箱连接",
    receiveReady: "收件已连接",
    readyToConnect: "可连接",
    connectorTitle: "连接邮箱",
    connectorDescription: "连接一次即可收件、整理目录和发邮件，不需要填写服务器地址。",
    provider163: "163 邮箱",
    provider163Hint: "支持邮箱目录、增量收取和服务商已读状态同步",
    upgradeBadge: "需要升级",
    upgradeTitle: "升级现有邮箱连接",
    upgradeHint: "系统正在用现有授权自动补全收件、目录和发件能力，不需要再次输入授权码。",
    upgradeAction: "检查并修复连接",
    providerGmail: "Gmail",
    comingSoon: "即将支持",
    desktopOnly: "为了保护邮箱授权码，这一步需要在 MyAgentTool 桌面版完成（当前支持 Windows）。桌面版会直接打开当前授权步骤，不需要重新寻找入口。",
    platformUnsupported: "163 邮箱授权目前仅支持 Windows 桌面版。当前系统暂时不能完成此操作。",
    continueOnDesktop: "在桌面版继续",
    desktopLaunchHint: "如果桌面版没有自动打开，请先安装或启动 MyAgentTool 桌面版后重试。",
    accountEmail: "163 邮箱地址",
    authorizationCode: "客户端授权码",
    authorizationPlaceholder: "不是邮箱登录密码",
    authHelpTitle: "先在 163 邮箱中取得授权码",
    authHelp: "登录 163 网页邮箱，在设置中开启 IMAP 服务并新建客户端授权码，然后把授权码粘贴到这里。界面名称可能因账号版本略有不同。",
    localSecret: "授权码只保存在这台电脑，并由当前 Windows 用户加密保护。",
    connectAndTest: "连接并测试邮箱",
    testing: "正在验证…",
    connectSuccess: "邮箱连接成功",
    connectSuccessHint: "收件、目录整理和发件已共用这份本机加密授权；移动和发送前仍会让你确认。",
    done: "完成",
    reconnect: "重新连接",
    disconnect: "断开邮箱",
    disconnectConfirm: "确定断开此邮箱吗？本机保存的邮箱授权会被删除，已同步的资料和草稿会保留。",
    disconnecting: "正在断开…",
    capabilityPending: "尚未就绪",
    sendConnected: "发件已连接",
    errors: {
      invalid_email: "请输入完整的 163 邮箱地址。",
      invalid_authorization_code: "请输入 163 客户端授权码。",
      verification_failed: "验证失败。请确认 IMAP/SMTP 服务已开启，并检查邮箱地址和授权码。",
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
    sendUnavailable: "可以继续保存草稿；请检查邮箱连接后再发送。",
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
    deliveryDetails: "邮件详情",
    deliveryStatus: "发送状态",
    updatedAt: "更新时间",
    sendProblem: "上次发送未完成",
    sendUnconfirmedHint: "请先到服务商邮箱核对是否已经发送，再决定是否重新发送，避免收件人收到重复邮件。",
    discardComposeTitle: "放弃未保存的邮件？",
    discardComposeDescription: "关闭后，本次尚未保存的收件人、主题、正文和附件将不会保留。",
    discardComposeConfirm: "放弃并关闭",
    noSubject: "（无主题）",
    close: "关闭",
    saved: "草稿已保存",
    addAttachments: "添加附件",
    pasteAttachments: "也可以直接粘贴复制的文件",
    attachmentLimit: "最多 10 个附件，总计不超过 25 MB",
    removeAttachment: "移除 {{name}}",
    outboundAttachmentFailed: "无法添加附件。请确认文件总计不超过 25 MB 后重试。",
    outboundDesktopOnly: "附件需要桌面版；当前网页中尚未保存的内容不会自动带过去，请先保存草稿。",
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
    organize: "Smart classification",
    organizing: "Classifying…",
    organizeComplete: "Smart classification is complete. Use smart classification views to focus on what matters.",
    organizeFailed: "Smart classification is unavailable. Existing messages are unchanged; try again.",
    deepOrganize: "Deep organize",
    deepTitle: "Deep organize recent mail",
    deepHint: "Use your locally configured model to refine already-opened messages from their cached text.",
    deepLoading: "Checking eligible messages…",
    deepUnavailable: "A local semantic model is not configured. Basic organization remains available.",
    deepCircuit: "The local model failed repeatedly and is temporarily paused. Basic classification is unaffected.",
    deepEligible: "This will process {{count}} opened messages with cached text.",
    deepRange: "Range: {{from}} to {{to}}",
    deepLocal: "Message text goes only to the local model, never an external service.",
    deepCachedOnly: "Only bodies already downloaded in the background are analyzed; attachments are not read for deep organization.",
    deepNoActions: "Only suggestions change; mail is never moved, deleted, replied to, or turned into tasks.",
    deepStart: "Confirm and start",
    deepStarting: "Starting…",
    deepNoPending: "All eligible opened messages are already deeply organized.",
    deepProgress: "Processed {{processed}} of {{total}}",
    deepCompleted: "Deep organization is complete and suggestions are updated.",
    deepDegraded: "Basic organization is available, but some messages could not be deeply classified.",
    deepCancelled: "Deep organization was cancelled. Completed results are kept.",
    cancelDeep: "Cancel organization",
    cancellingDeep: "Cancelling…",
    smartViews: { all: "All", needs_attention: "Needs attention", important: "Important", notifications: "Notifications & receipts", subscriptions: "Subscriptions & promotions", other: "Other" },
    classificationWhy: "Classification suggestion: {{reason}}",
    uncertainClassification: "May be inaccurate",
    classificationWrong: "Wrong category",
    correctionTitle: "Adjust email category",
    correctionHint: "Choose a better smart view. This will not move, delete, or reply to the email.",
    correctionLabel: "Move to",
    correctionSave: "Save adjustment",
    correctionSaving: "Saving…",
    correctionFailed: "The category adjustment could not be saved. Try again.",
    rules: "Smart classification settings",
    organizeMenu: "Smart classification",
    organizeMenuTitle: "Smart classification",
    organizeMenuHint: "Smart classification only updates views. Mailbox folders and automatic organization handle low-risk mail after separate confirmation.",
    organizeBasicHint: "Quickly classify new mail from message headers",
    organizeDeepHint: "Use the local model on already-opened mail",
    organizeRulesHint: "Review and manage your category habits",
    rulesTitle: "Smart classification & mailbox folders",
    rulesHint: "Suggestions appear only after repeated, consistent manual adjustments. Smart classification rules update views; automatic organization requires a separate confirmation after quality gates pass.",
    rulesLoading: "Loading rules…",
    rulesFailed: "Smart classification settings could not be loaded or updated. Try again.",
    rulesSuggestions: "Suggested rules",
    rulesExisting: "Created rules",
    rulesSuggestionEmpty: "No new suggestions. Keep adjusting categories and stable patterns will appear here.",
    rulesExistingEmpty: "No personal smart classification rules have been enabled yet.",
    rulesSuggestionNotice: "Found {{count}} reusable category habits",
    rulesSuggestionNoticeHint: "Review the impact, then choose whether to use them for future mail.",
    mobileSuggestionNotice: "{{count}} organization suggestions",
    mobileSuggestionNoticeHint: "Review them when convenient. Receiving and reading mail are unaffected.",
    rulesReview: "Review suggestions",
    rulesMatchSender: "Sender {{value}}",
    rulesMatchDomain: "Domain {{value}}",
    rulesEvidence: "Based on {{count}} consistent adjustments",
    rulesAffected: "Currently affects {{count}} messages",
    rulesFutureOnly: "No matching unadjusted messages now; the rule can still apply to future mail.",
    rulesSamples: "Affected examples",
    rulesEnable: "Enable rule",
    rulesEnabling: "Enabling…",
    rulesUpdating: "Updating…",
    rulesActive: "Active",
    rulesPaused: "Paused",
    rulesRevoked: "Revoked",
    rulesPause: "Pause",
    rulesResume: "Resume",
    rulesRevoke: "Revoke",
    rulesEdit: "Change category",
    rulesSave: "Save rule",
    rulesNoActions: "Rules only change smart views. A manual adjustment on one message always wins.",
    rulesAccount: "Mailbox: {{value}}",
    rulesEditing: "Editing: {{match}}",
    rulesEnabledSuccess: "Rule enabled. Future matching mail will use the selected smart view.",
    rulesUpdatedSuccess: "Rule updated.",
    rulesSavedSuccess: "Rule category saved.",
    qualityTitle: "Organization quality",
    qualityCollecting: "Collecting local samples",
    qualityHealthy: "Organization is currently stable",
    qualityNeedsAttention: "Review category results first",
    qualityCollectingHint: "At least {{count}} smart-classified messages are needed before stability is assessed. A small sample never enables more automation.",
    qualityHealthyHint: "Current local signals are within the suggested ranges. These are usage-quality signals, not a claim of absolute accuracy.",
    qualityNeedsAttentionHint: "Other results, manual adjustments, or processing failures are elevated. Review rules and keep correcting; the scope will not expand automatically.",
    qualityCoverage: "Smart classified",
    qualityUnknown: "Other",
    qualityCorrections: "Adjusted",
    qualityJobFailures: "Processing failures",
    qualityMoveResults: "Folder batches to verify: {{unconfirmed}} / {{total}}",
    qualityMoveCollecting: "There are not enough folder batches to assess stability yet.",
    qualityPrivacy: "Counts are summarized locally and never include subjects, senders, or message bodies.",
    qualityLoading: "Calculating local quality…",
    qualityFailed: "Organization quality is temporarily unavailable. Try again.",
    folderSuggestions: "Mailbox folder suggestions",
    folderSuggestionNotice: "Found {{count}} folder organization suggestions",
    folderSuggestionNoticeHint: "Preview which messages may belong together. No mail will be moved yet.",
    folderSuggestionEmpty: "No folder suggestions yet. Enable a stable subscription or notification rule to generate one.",
    folderSuggestionLoading: "Checking folder suggestions…",
    folderSuggestionFailed: "Folder suggestions or previews are temporarily unavailable. Try again.",
    folderSuggestedExisting: "Suggested existing folder: {{value}}",
    folderSuggestedNew: "Suggested new folder: {{value}}",
    folderDestination: "Preview destination",
    folderAccount: "Mailbox",
    folderAffected: "{{count}} messages match",
    folderProtected: "{{count}} important or actionable messages were automatically excluded",
    folderPreview: "Preview messages",
    folderPreviewing: "Building preview…",
    folderPreviewTitle: "Mailbox folder preview",
    folderPreviewHint: "This is a read-only preview. No folder will be created and no mail will be moved.",
    folderPreviewCount: "Previewing {{selected}} of {{total}} matching messages",
    folderPreviewRemaining: "The remaining {{count}} messages can be handled in a later batch.",
    folderPreviewNoMove: "No messages will be moved now. Before any move, you will see the complete list and be asked to confirm again.",
    folderMoveConfirm: "Confirm and move {{count}} messages",
    folderMoveStarting: "Submitting…",
    folderMoveProgress: "Organizing {{count}} messages…",
    folderMoveSuccess: "Moved {{count}} messages to the destination folder.",
    folderMoveUnconfirmed: "The provider did not return a complete result. Sync first and check the actual location before creating a new preview; the system will not retry automatically.",
    folderMoveFailed: "Folder organization could not start. Build a fresh preview and try again.",
    folderMovePermission: "Check email connection",
    folderMovePermissionHint: "Folder creation and moves reuse the current email connection; every move is still reviewed first.",
    organizeConnected: "Folder organization connected",
    folderMoveRecoveryNotice: "A folder organization batch needs review",
    folderMoveRecoveryHint: "The system will not retry automatically. Sync mail and check the messages' actual location.",
    folderMoveReviewStatus: "View status",
    folderMoveReconcile: "Check synced result",
    folderMoveReconciling: "Checking…",
    folderMoveReconciled: "The batch location was confirmed from the latest sync.",
    folderMoveReconcileFailed: "Unable to check yet. Finish syncing mail and try again.",
    folderMoveRecoverable: "{{count}} messages are confirmed in the source and can receive a new review preview.",
    folderMoveConflict: "Some message locations remain unclear. Automatic processing has stopped for manual review.",
    folderAutomationTitle: "Automatic organization",
    folderAutomationEmpty: "Automatic organization is off. Smart classification and mailbox folder batches must both be stable first.",
    folderAutomationEnable: "Enable automatic organization",
    folderAutomationConfirmTitle: "Confirm automatic organization",
    folderAutomationConfirmHint: "This is ongoing mailbox write authorization. Review its scope and destination.",
    folderAutomationConfirm: "Confirm and enable",
    folderAutomationScope: "After each sync, at most {{count}} newly matching messages will be organized automatically.",
    folderAutomationStandingConsent: "Matching mail will no longer ask batch by batch. You can pause or revoke this rule at any time.",
    folderAutomationSafety: "Action-needed, important, account-security, and manually corrected mail always stay excluded. Any uncertain batch pauses the rule immediately.",
    folderAutomationQualityRequired: "Automatic organization requires at least 50 stable smart classifications and 10 stable mailbox folder batches.",
    folderAutomationEnabled: "Automatic organization is enabled, bounded to 10 messages per batch, and pauses on uncertainty.",
    folderAutomationFailed: "Unable to enable or update automatic organization. Check quality status and mailbox folder permission.",
    folderAutomationActive: "Automatic organization active",
    folderAutomationPaused: "Automatic organization paused",
    folderAutomationNeedsReview: "The last run or quality signal needs review; reauthorization is required to resume.",
    folderAutomationDryRun: "Try without changes",
    folderAutomationDryRunning: "Checking…",
    folderAutomationDryRunResult: "Trial: {{selected}} messages would be organized and {{excluded}} excluded; the mail provider was not called.",
    folderAutomationLastSuccess: "Last success: {{time}}",
    folderAutomationSuccessStreak: "{{count}} successful batches in a row",
    folderAutomationLastChecked: "Last checked: {{time}}",
    folderAutomationPauseUser: "You paused this. Resume when ready.",
    folderAutomationPauseSync: "The result needs review. Sync mail and check the actual location first.",
    folderAutomationPauseQuality: "Smart classification quality is below the gate. Review and correct classifications first.",
    folderAutomationPauseRollout: "Automatic organization is not open in the current rollout stage; authorization and history are preserved.",
    folderAutomationPauseAuthorize: "The rule or mailbox folder changed. Confirm automatic organization again.",
    folderHistoryTitle: "Mailbox folder history",
    folderHistoryEmpty: "No folder move history yet.",
    folderHistoryManual: "Manual confirmation",
    folderHistoryAutomatic: "Automatic organization",
    folderHistoryRecovery: "Failure recovery",
    folderHistorySucceeded: "Moved {{count}}",
    folderHistoryMoving: "In progress",
    folderHistoryRecoverable: "{{count}} ready to retry",
    folderHistoryNeedsReview: "Needs review",
    loadFailed: "The mailbox could not be loaded. Your existing mail and drafts are still safe; try again.",
    retry: "Retry",
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
    archiveAvailable: "The original message and attachments are safely stored on this device for offline access.",
    archiveUnavailable: "The message body is available, but its original is not stored locally; attachments still require the mail provider.",
    attachmentLocal: "Available offline",
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
    loadingBody: "The body is downloading in the background and will appear automatically.",
    bodyUnavailable: "The body is queued for background download and will appear automatically.",
    bodyDownloadFailed: "Automatic body download did not finish. Select this message again to retry it with priority.",
    bodyNoLongerAvailable: "The provider can no longer find this message. Its list entry is kept; it may have been moved or deleted on another device.",
    htmlTextNotice: "This email contains HTML. Safe converted text is shown by default, without loading remote images.",
    htmlTextNoticeCompact: "HTML email · showing safe text",
    viewSafeHtml: "View safe layout",
    viewPlainText: "Back to plain text",
    safeHtmlTitle: "Safe email content",
    safeHtmlNotice: "Scripts, forms, styles, and unsafe addresses were removed, and the HTML is isolated from the app.",
    remoteImagesBlocked: "Remote images are blocked by default so the sender cannot learn your reading status or network address.",
    remoteImagesLoaded: "Remote images were loaded at your request; the sender may learn your network address and reading activity.",
    loadRemoteImages: "Load remote images",
    blockRemoteImages: "Block remote images again",
    inlineImagesLoading: "Safely loading inline email images…",
    bodyTruncated: "This email exceeds the local safe-reading limit, so the displayed body is incomplete. Open it at your email provider to see the original.",
    reply: "Reply",
    replyDraft: "Draft reply",
    issue: "Linked task source #{{number}}",
    createTask: "Let AI handle it",
    linkedTask: "Linked to {{ref}}",
    taskReviewTitle: "Review task details",
    taskReviewHint: "Confirm the project and task notes, then save it for later or let AI analyze it in a restricted environment.",
    taskProject: "Project",
    taskTitle: "Task title",
    taskDescription: "Task notes",
    taskDescriptionPlaceholder: "Add the work to do, expected result, or timing",
    taskSourceHint: "Email is external content. AI treats it only as material to analyze, never as system instructions, and never sends a reply automatically.",
    taskAttachmentsHint: "Choose attachments to copy into the task (optional, up to 6)",
    createTaskNow: "Create task only",
    createAndHandle: "Create and let AI handle it",
    creatingTask: "Creating…",
    taskCreated: "Task {{ref}} was created.",
    taskCreatedWithSkipped: "Task {{ref}} was created; {{count}} attachment(s) could not be added and can be attached later.",
    viewTask: "View task",
    aiConsole: "AI operations",
    aiConsoleTitle: "Mail AI operations",
    aiConsoleHint: "Professional task links, review packages, shadow rules, and execution timeline. With the automation kill switch open, rules only record shadow decisions.",
    responseReady: "AI reply suggestion",
    responseAnalysis: "Analysis",
    responseReply: "Proposed reply",
    responseApprove: "Approve suggestion",
    responseRevise: "Ask AI to revise",
    responseDraft: "Create email draft",
    responseDrafted: "Draft created. Continue editing and explicitly confirm sending from Drafts.",
    responseLoad: "Load AI result",
    responsePending: "The AI result is not complete yet. Try again shortly.",
    taskFailed: "The task could not be created. Check the project and try again.",
    taskProjectRequired: "Choose a project first.",
    taskTitleRequired: "Add a task title.",
    taskAttachmentDesktopOnly: "Email attachments can only be copied in the desktop app. Deselect them to continue.",
    untrusted: "Email comes from outside. It is displayed as content and is never treated as an instruction.",
    securityStored: "Safe display · saved on this device",
    securityOnline: "Safe display · attachments need the email connection",
    securityDetails: "Security and storage details",
    back: "Back to message list",
    connectTitle: "Connect your email",
    connectHint: "Connect once to receive, organize, and send email. Sign-in details remain on this computer.",
    connectAction: "Open email connection settings",
    connectSimple: "You do not need to enter IMAP, SMTP, or server addresses here.",
    attention: "Your email needs to be reconnected",
    attentionAction: "Check connection",
    manageConnection: "Manage connection",
    receiveReady: "Receiving connected",
    readyToConnect: "Available to connect",
    connectorTitle: "Connect email",
    connectorDescription: "Connect once to receive, organize, and send email. No server addresses are required.",
    provider163: "163 Mail",
    provider163Hint: "Folders, incremental retrieval, and provider read-state sync are supported",
    upgradeBadge: "Upgrade needed",
    upgradeTitle: "Upgrade your existing connection",
    upgradeHint: "The app is completing receive, folder, and send setup with your existing authorization. No code needs to be entered again.",
    upgradeAction: "Check and repair connection",
    providerGmail: "Gmail",
    comingSoon: "Coming soon",
    desktopOnly: "To protect your email authorization code, finish this step in the Windows desktop app. It opens directly at the step you selected.",
    platformUnsupported: "163 Mail authorization currently requires the Windows desktop app and is unavailable on this system.",
    continueOnDesktop: "Continue in desktop app",
    desktopLaunchHint: "If the desktop app does not open automatically, install or start MyAgentTool and try again.",
    accountEmail: "163 email address",
    authorizationCode: "Client authorization code",
    authorizationPlaceholder: "Not your mailbox password",
    authHelpTitle: "Get an authorization code from 163 Mail first",
    authHelp: "Sign in to 163 webmail, enable IMAP in Settings, and create a client authorization code. Setting names may vary slightly by account version.",
    localSecret: "The code stays on this computer and is encrypted for the current Windows user.",
    connectAndTest: "Connect and test email",
    testing: "Verifying…",
    connectSuccess: "Email connected",
    connectSuccessHint: "Receiving, folder organization, and sending share this locally encrypted authorization. Moves and sends still require review.",
    done: "Done",
    reconnect: "Reconnect",
    disconnect: "Disconnect email",
    disconnectConfirm: "Disconnect this mailbox? The locally stored authorization will be deleted. Synced content and drafts will be kept.",
    disconnecting: "Disconnecting…",
    capabilityPending: "Not ready",
    sendConnected: "Sending connected",
    errors: {
      invalid_email: "Enter a complete 163 Mail address.",
      invalid_authorization_code: "Enter the 163 client authorization code.",
      verification_failed: "Verification failed. Check that IMAP/SMTP is enabled, then verify the address and authorization code.",
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
    sendUnavailable: "You can save drafts now; check the email connection before sending.",
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
    deliveryDetails: "Email details",
    deliveryStatus: "Delivery status",
    updatedAt: "Updated",
    sendProblem: "The last send did not complete",
    sendUnconfirmedHint: "Check your provider mailbox before sending again so the recipient does not receive a duplicate.",
    discardComposeTitle: "Discard this unsaved email?",
    discardComposeDescription: "Closing will discard the unsaved recipient, subject, message, and attachments.",
    discardComposeConfirm: "Discard and close",
    noSubject: "(no subject)",
    close: "Close",
    saved: "Draft saved",
    addAttachments: "Add attachments",
    pasteAttachments: "You can also paste copied files here",
    attachmentLimit: "Up to 10 attachments, 25 MB total",
    removeAttachment: "Remove {{name}}",
    outboundAttachmentFailed: "Attachments could not be added. Check that the total is under 25 MB and try again.",
    outboundDesktopOnly: "Attachments require the desktop app. Save this draft first; unsaved browser text will not transfer automatically.",
    status: { draft: "Draft", sending: "Sending", sent: "Sent", send_unconfirmed: "Check whether sent" },
  },
} as const;

type MailConnectorIntent = "manage" | "send" | "organize";

export function MailView() {
  const { i18n } = useAppTranslation();
  const copy = i18n.language.startsWith("zh") ? COPY.zh : COPY.en;
  const queryClient = useQueryClient();
  const consoleState = useConsoleState();
  const sessionUser = useSessionUser();
  const canOperateMailAi = !sessionUser?.role || sessionUser.role !== "viewer";
  const canManageMailAi = canManageProfessionalSettings(sessionUser?.role);
  const selectedProjectId = useUiStore((state) => state.selectedProjectId);
  const openWorkItem = useUiStore((state) => state.openWorkItem);
  const setSection = useUiStore((state) => state.setSection);
  const [page, setPage] = useState(1);
  const [folder, setFolder] = useState<FolderId>("inbox");
  const [smartView, setSmartView] = useState<MailSmartView>("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const systemFolder = ["drafts", "sent", "outbox"].includes(folder);
  const mailbox = useQuery({ queryKey: ["mailbox", page, folder, systemFolder ? "" : deferredQuery, systemFolder ? "all" : smartView], queryFn: () => mailApi.getMailbox(page, systemFolder ? "inbox" : folder, systemFolder ? "" : deferredQuery, systemFolder ? "all" : smartView), refetchInterval: 4_000 });
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [composeBaseline, setComposeBaseline] = useState("");
  const [confirmComposeClose, setConfirmComposeClose] = useState(false);
  const [reviewDraft, setReviewDraft] = useState<MailboxDraft | null>(null);
  const [viewedDraft, setViewedDraft] = useState<MailboxDraft | null>(null);
  const [busy, setBusy] = useState<"sync" | "save" | "send" | "delete" | "task" | "response" | "classify" | "deep" | "correct" | "rules" | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string; task?: NonNullable<MailboxMessage["task"]> } | null>(null);
  const [connectorOpen, setConnectorOpen] = useState(false);
  const [connectorIntent, setConnectorIntent] = useState<MailConnectorIntent>("manage");
  const [pendingSyncId, setPendingSyncId] = useState<string | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<AttachmentPreview | null>(null);
  const [taskDraft, setTaskDraft] = useState<MailTaskDraft | null>(null);
  const [classificationCorrection, setClassificationCorrection] = useState<ClassificationCorrectionState | null>(null);
  const [deepOrganizeOpen, setDeepOrganizeOpen] = useState(false);
  const [deepJobId, setDeepJobId] = useState<string | null>(null);
  const [organizeMenuOpen, setOrganizeMenuOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [ruleEdit, setRuleEdit] = useState<{ rule: MailClassificationRule; view: Exclude<MailSmartView, "all"> } | null>(null);
  const [rulePending, setRulePending] = useState<string | null>(null);
  const [ruleFeedback, setRuleFeedback] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [folderPending, setFolderPending] = useState<string | null>(null);
  const [folderFeedback, setFolderFeedback] = useState<string | null>(null);
  const [folderSelections, setFolderSelections] = useState<Record<string, string>>({});
  const [folderPreview, setFolderPreview] = useState<MailFolderMovePreview | null>(null);
  const [folderMoveJobId, setFolderMoveJobId] = useState<string | null>(null);
  const [folderMovePending, setFolderMovePending] = useState(false);
  const [folderMoveError, setFolderMoveError] = useState<string | null>(null);
  const [folderRecoveryOpen, setFolderRecoveryOpen] = useState(false);
  const [automationPreview, setAutomationPreview] = useState<MailFolderMovePreview | null>(null);
  const [automationPending, setAutomationPending] = useState(false);
  const [automationError, setAutomationError] = useState<string | null>(null);
  const [operationsOpen, setOperationsOpen] = useState(false);
  const openConnector = (intent: MailConnectorIntent = "manage") => {
    setConnectorIntent(intent);
    setConnectorOpen(true);
  };
  useEffect(() => {
    const url = new URL(window.location.href);
    const intent = url.searchParams.get("mailConnect");
    if (intent !== "manage" && intent !== "send" && intent !== "organize") return;
    setConnectorIntent(intent);
    setConnectorOpen(true);
    url.searchParams.delete("mailConnect");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("desktopAction") !== "compose-attachment" || !window.myagenttoolDesktop?.pickOutboundMailAttachments) return;
    const next: ComposeState = { id: null, to: "", subject: "", body: "", attachments: [], inReplyTo: null, references: [], sendError: null };
    setCompose(next);
    setComposeBaseline(composeFingerprint(next));
    url.searchParams.delete("desktopAction");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);
  const classificationRules = useQuery({
    queryKey: ["mail-classification-rules"],
    queryFn: mailApi.getClassificationRules,
    enabled: Boolean(mailbox.data?.accounts.some((item) => item.canReceive) && !systemFolder),
    retry: false,
  });
  const classificationQuality = useQuery({
    queryKey: ["mail-classification-quality"],
    queryFn: mailApi.getClassificationQuality,
    enabled: Boolean(rulesOpen && mailbox.data?.accounts.some((item) => item.canReceive) && !systemFolder),
    retry: false,
  });
  const folderSuggestions = useQuery({
    queryKey: ["mail-folder-suggestions"],
    queryFn: mailApi.getFolderSuggestions,
    enabled: Boolean(mailbox.data?.accounts.some((item) => item.canReceive) && !systemFolder),
    retry: false,
  });
  const folderMoveJob = useQuery({
    queryKey: ["mail-folder-move-job", folderMoveJobId],
    queryFn: () => mailApi.getFolderMoveJob(folderMoveJobId!),
    enabled: Boolean(folderMoveJobId),
    refetchInterval: (query) => ["succeeded", "unconfirmed", "recoverable", "conflict"].includes(query.state.data?.job.status ?? "") ? false : 500,
  });
  const folderMoveJobs = useQuery({
    queryKey: ["mail-folder-move-jobs"],
    queryFn: mailApi.getFolderMoveJobs,
    enabled: Boolean(mailbox.data?.accounts.some((item) => item.canReceive)),
    refetchInterval: (query) => query.state.data?.jobs.some((job) => job.status === "moving") ? 1_000 : false,
  });
  const folderAutomations = useQuery({
    queryKey: ["mail-folder-automations"],
    queryFn: mailApi.getFolderAutomations,
    enabled: Boolean(mailbox.data?.accounts.some((item) => item.canReceive)),
    retry: false,
  });
  const deepPreview = useQuery({
    queryKey: ["mail-semantic-preview", 20],
    queryFn: () => mailApi.getSemanticPreview(20),
    enabled: deepOrganizeOpen && !deepJobId,
    retry: false,
  });
  const deepJob = useQuery({
    queryKey: ["mail-classification-job", deepJobId],
    queryFn: () => mailApi.getClassificationJob(deepJobId!),
    enabled: Boolean(deepJobId),
    refetchInterval: (query) => isClassificationJobTerminal(query.state.data?.job.status) ? false : 500,
  });
  const selectedTaskId = mailbox.data?.messages.find((message) => message.id === selectedMessageId)?.task?.id ?? null;
  const responsePackages = useQuery({
    queryKey: ["mail-response-packages", selectedTaskId],
    queryFn: () => api.getMailResponsePackages(selectedTaskId!),
    enabled: Boolean(selectedTaskId),
    refetchInterval: 4_000,
  });
  const taskOperations = useQuery({
    queryKey: ["mail-task-operations"],
    queryFn: () => api.getMailTaskOperations(),
    enabled: operationsOpen,
    refetchInterval: operationsOpen ? 4_000 : false,
  });
  const taskPolicies = useQuery({
    queryKey: ["mail-task-policies"],
    queryFn: () => api.getMailTaskPolicies(),
    enabled: operationsOpen,
  });
  const data = mailbox.data;
  const classificationSummary = data?.classificationSummary ?? null;
  const account = data?.accounts.find((item) => item.canReceive) ?? data?.accounts[0] ?? null;
  const selectedMessage = data?.messages.find((message) => message.id === selectedMessageId) ?? null;
  const syncing = busy === "sync" || data?.sync?.status === "syncing";
  const providerFolders = (data?.folders ?? []).filter((item) => item.kind === "provider");
  const projects = (consoleState.data?.projects ?? []).filter((project) => project.status === "active");
  const folderName = copy.folders[folder as keyof typeof copy.folders]
    ?? providerFolders.find((item) => item.id === folder)?.name
    ?? folder;
  const lastSyncText = data?.sync?.lastSucceededAt
    ? copy.lastSynced.replace("{{time}}", new Intl.DateTimeFormat(i18n.language, { dateStyle: "short", timeStyle: "short" }).format(new Date(data.sync.lastSucceededAt)))
    : null;
  const composeDirty = Boolean(compose && composeFingerprint(compose) !== composeBaseline);
  const ruleSuggestionCount = classificationRules.data?.suggestions.length ?? 0;
  const folderSuggestionCount = folderSuggestions.data?.suggestions.length ?? 0;
  const recoveryFolderJob = folderMoveJobs.data?.jobs?.find((job) => ["moving", "unconfirmed", "recoverable", "conflict"].includes(job.status)) ?? null;
  const organizeSuggestionCount = ruleSuggestionCount + folderSuggestionCount;

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("desktopAction") !== "mail-attachment" || !window.myagenttoolDesktop?.previewMailAttachment) return;
    const requestedFolder = url.searchParams.get("folder")?.trim();
    const requestedPage = Math.max(1, Math.min(10_000, Number(url.searchParams.get("page")) || 1));
    const requestedView = url.searchParams.get("view") as MailSmartView | null;
    const validRequestedView = requestedView && ["all", "needs_attention", "important", "notifications", "subscriptions", "other"].includes(requestedView) ? requestedView : null;
    if (requestedFolder && (folder !== requestedFolder || page !== requestedPage || (validRequestedView && smartView !== validRequestedView))) {
      setFolder(requestedFolder);
      setPage(requestedPage);
      if (validRequestedView) setSmartView(validRequestedView);
      return;
    }
    const requested = url.searchParams.get("message");
    const match = data?.messages.find((message) => message.id === requested || message.messageId === requested);
    if (!match) return;
    setSelectedMessageId(match.id);
    setNotice({ tone: "info", text: copy === COPY.zh ? "已定位到邮件，请在附件旁继续预览或下载。" : "The message is ready. Continue beside the attachment." });
    for (const key of ["desktopAction", "message", "attachment", "mode", "folder", "page", "view"]) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [copy, data?.messages, folder, page, smartView]);

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
    const status = deepJob.data?.job.status;
    if (!isClassificationJobTerminal(status)) return;
    void queryClient.invalidateQueries({ queryKey: ["mailbox"] });
    void queryClient.invalidateQueries({ queryKey: ["mail-semantic-preview"] });
    if (status === "succeeded") setNotice({ tone: "info", text: copy.deepCompleted });
    else if (status === "cancelled") setNotice({ tone: "info", text: copy.deepCancelled });
    else setNotice({ tone: "error", text: copy.deepDegraded });
  }, [copy.deepCancelled, copy.deepCompleted, copy.deepDegraded, deepJob.data?.job.status, queryClient]);

  useEffect(() => {
    if (data?.pagination && data.pagination.page !== page) setPage(data.pagination.page);
  }, [data?.pagination, page]);

  useEffect(() => {
    setPage(1);
    setSelectedMessageId(null);
  }, [deferredQuery, folder, smartView]);

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

  async function organizeMail() {
    setBusy("classify");
    setNotice(null);
    try {
      await mailApi.classifyMailbox(data?.classificationSummary?.classified ? "new_mail" : "rebuild");
      await queryClient.invalidateQueries({ queryKey: ["mailbox"] });
      setNotice({ tone: "info", text: copy.organizeComplete });
    } catch {
      setNotice({ tone: "error", text: copy.organizeFailed });
    } finally {
      setBusy(null);
    }
  }

  async function startDeepOrganize() {
    setBusy("deep");
    setNotice(null);
    try {
      const result = await mailApi.startDeepOrganize(20);
      setDeepJobId(result.job.id);
    } catch {
      setNotice({ tone: "error", text: copy.deepDegraded });
    } finally {
      setBusy(null);
    }
  }

  async function cancelDeepOrganize() {
    if (!deepJobId) return;
    setBusy("deep");
    try {
      await mailApi.cancelClassificationJob(deepJobId);
      await deepJob.refetch();
    } catch {
      setNotice({ tone: "error", text: copy.deepDegraded });
    } finally {
      setBusy(null);
    }
  }

  function closeDeepOrganize() {
    setDeepOrganizeOpen(false);
    setDeepJobId(null);
  }

  async function saveClassificationCorrection() {
    const classification = classificationCorrection?.message.classification;
    if (!classificationCorrection || !classification) return;
    const message = classificationCorrection.message;
    const selected = classificationCorrection.view;
    const currentType = classification.mailType;
    const patch = classificationPatchForView(selected, currentType);
    setBusy("correct");
    try {
      await mailApi.correctClassification(message.id, {
        folderId: message.folderId,
        expectedRevision: classification.revision,
        ...patch,
      });
      setClassificationCorrection(null);
      setSelectedMessageId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["mailbox"] }),
        queryClient.invalidateQueries({ queryKey: ["mail-classification-rules"] }),
        queryClient.invalidateQueries({ queryKey: ["mail-folder-suggestions"] }),
      ]);
    } catch {
      setNotice({ tone: "error", text: copy.correctionFailed });
    } finally {
      setBusy(null);
    }
  }

  async function enableClassificationRule(suggestionId: string) {
    setBusy("rules");
    setRulePending(`enable:${suggestionId}`);
    setRuleFeedback(null);
    try {
      await mailApi.createClassificationRule(suggestionId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["mail-classification-rules"] }),
        queryClient.invalidateQueries({ queryKey: ["mailbox"] }),
        queryClient.invalidateQueries({ queryKey: ["mail-folder-suggestions"] }),
      ]);
      setRuleFeedback({ tone: "info", text: copy.rulesEnabledSuccess });
    } catch {
      setRuleFeedback({ tone: "error", text: copy.rulesFailed });
    } finally {
      setRulePending(null);
      setBusy(null);
    }
  }

  async function changeClassificationRule(rule: MailClassificationRule, action: "pause" | "resume" | "revoke") {
    setBusy("rules");
    setRulePending(`${action}:${rule.id}`);
    setRuleFeedback(null);
    try {
      await mailApi.updateClassificationRule(rule.id, { expectedRevision: rule.revision, action });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["mail-classification-rules"] }),
        queryClient.invalidateQueries({ queryKey: ["mailbox"] }),
        queryClient.invalidateQueries({ queryKey: ["mail-folder-suggestions"] }),
      ]);
      setRuleFeedback({ tone: "info", text: copy.rulesUpdatedSuccess });
    } catch {
      setRuleFeedback({ tone: "error", text: copy.rulesFailed });
    } finally {
      setRulePending(null);
      setBusy(null);
    }
  }

  async function saveClassificationRule() {
    if (!ruleEdit) return;
    setBusy("rules");
    setRulePending(`edit:${ruleEdit.rule.id}`);
    setRuleFeedback(null);
    try {
      await mailApi.updateClassificationRule(ruleEdit.rule.id, {
        expectedRevision: ruleEdit.rule.revision,
        ...classificationPatchForView(ruleEdit.view, ruleEdit.rule.target.mailType),
      });
      setRuleEdit(null);
      setRulesOpen(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["mail-classification-rules"] }),
        queryClient.invalidateQueries({ queryKey: ["mailbox"] }),
        queryClient.invalidateQueries({ queryKey: ["mail-folder-suggestions"] }),
      ]);
      setRuleFeedback({ tone: "info", text: copy.rulesSavedSuccess });
    } catch {
      setRuleFeedback({ tone: "error", text: copy.rulesFailed });
    } finally {
      setRulePending(null);
      setBusy(null);
    }
  }

  async function previewFolderSuggestion(suggestion: MailFolderSuggestion) {
    setFolderPending(suggestion.id);
    setFolderFeedback(null);
    try {
      const selected = folderSelections[suggestion.id];
      const result = await mailApi.createFolderMovePreview(
        suggestion.id,
        selected && selected !== "__suggested__" ? selected : null,
      );
      setRulesOpen(false);
      setFolderPreview(result.preview);
    } catch {
      setFolderFeedback(copy.folderSuggestionFailed);
    } finally {
      setFolderPending(null);
    }
  }

  async function previewFolderAutomation(suggestion: MailFolderSuggestion) {
    setFolderPending(`auto:${suggestion.id}`);
    setFolderFeedback(null);
    setAutomationError(null);
    try {
      const selected = folderSelections[suggestion.id];
      const result = await mailApi.createFolderAutomationPreview(
        suggestion.id,
        selected && selected !== "__suggested__" ? selected : null,
      );
      setRulesOpen(false);
      setAutomationPreview(result.preview);
    } catch (error) {
      const qualityBlocked = error instanceof ApiError && error.code === "mail_folder_automation_quality_gate";
      setFolderFeedback(qualityBlocked ? copy.folderAutomationQualityRequired : copy.folderAutomationFailed);
    } finally {
      setFolderPending(null);
    }
  }

  async function enableFolderAutomation() {
    if (!automationPreview) return;
    setAutomationPending(true);
    setAutomationError(null);
    try {
      const grant = await api.issueApprovalGrant("mail.organize.auto", automationPreview.approvalTarget);
      await mailApi.enableFolderAutomation(automationPreview.id, grant.token);
      setAutomationPreview(null);
      setRulesOpen(true);
      setRuleFeedback({ tone: "info", text: copy.folderAutomationEnabled });
      await queryClient.invalidateQueries({ queryKey: ["mail-folder-automations"] });
    } catch (error) {
      const qualityBlocked = error instanceof ApiError && error.code === "mail_folder_automation_quality_gate";
      setAutomationError(qualityBlocked ? copy.folderAutomationQualityRequired : copy.folderAutomationFailed);
    } finally {
      setAutomationPending(false);
    }
  }

  async function changeFolderAutomation(automation: MailFolderAutomation, action: "pause" | "resume" | "revoke") {
    setRulePending(`auto:${automation.id}`);
    try {
      await mailApi.updateFolderAutomation(automation.id, automation.revision, action);
      await queryClient.invalidateQueries({ queryKey: ["mail-folder-automations"] });
    } catch {
      setRuleFeedback({ tone: "error", text: copy.folderAutomationFailed });
    } finally {
      setRulePending(null);
    }
  }

  async function dryRunFolderAutomation(automation: MailFolderAutomation) {
    setRulePending(`dry:${automation.id}`);
    setRuleFeedback(null);
    try {
      const result = await mailApi.dryRunFolderAutomation(automation.id);
      setRuleFeedback({
        tone: "info",
        text: copy.folderAutomationDryRunResult
          .replace("{{selected}}", String(result.dryRun.selectedCount))
          .replace("{{excluded}}", String(result.dryRun.excludedCount)),
      });
    } catch {
      setRuleFeedback({ tone: "error", text: copy.folderAutomationFailed });
    } finally {
      setRulePending(null);
    }
  }

  async function reconcileFolderMove(job: MailFolderMoveJob) {
    setFolderMovePending(true);
    setFolderMoveError(null);
    try {
      const result = await mailApi.reconcileFolderMoveJob(job.id);
      await queryClient.invalidateQueries({ queryKey: ["mail-folder-move-jobs"] });
      if (result.job.status === "recoverable") {
        const recovery = await mailApi.createFolderRecoveryPreview(job.id);
        setFolderRecoveryOpen(false);
        setFolderPreview(recovery.preview);
        setFolderMoveJobId(null);
      } else if (result.job.status === "succeeded") {
        setFolderRecoveryOpen(false);
        setNotice({ tone: "info", text: copy.folderMoveReconciled });
      } else {
        setFolderMoveError(copy.folderMoveConflict);
      }
    } catch {
      setFolderMoveError(copy.folderMoveReconcileFailed);
    } finally {
      setFolderMovePending(false);
    }
  }

  async function startFolderMove() {
    if (!folderPreview) return;
    setFolderMovePending(true);
    setFolderMoveError(null);
    try {
      const grant = await api.issueApprovalGrant("mail.organize", folderPreview.approvalTarget);
      const result = await mailApi.startFolderMove(folderPreview.id, grant.token);
      setFolderMoveJobId(result.job.id);
    } catch {
      setFolderMoveError(copy.folderMoveFailed);
    } finally {
      setFolderMovePending(false);
    }
  }

  async function openMessage(message: MailboxMessage) {
    setSelectedMessageId(message.id);
    if (message.unread) {
      void mailApi.setMessageRead(message.id, true)
        .then(() => queryClient.invalidateQueries({ queryKey: ["mailbox"] }))
        .catch(() => setNotice({ tone: "error", text: copy.markReadFailed }));
    }
    if (message.bodyFetch?.status === "ready" || (message.fetched && message.attachmentMetadataLoaded && message.bodyContentVersion >= 2)) return;
    try {
      await mailApi.prioritizeBodyPrefetch(message.id);
      await queryClient.invalidateQueries({ queryKey: ["mailbox"] });
    } catch {
      setNotice({ tone: "error", text: copy.bodyUnavailable });
    }
  }

  async function markUnread(message: MailboxMessage) {
    try {
      await mailApi.setMessageRead(message.id, false);
      await queryClient.invalidateQueries({ queryKey: ["mailbox"] });
      setSelectedMessageId(null);
    } catch {
      setNotice({ tone: "error", text: copy.markReadFailed });
    }
  }

  async function previewAttachment(message: MailboxMessage, attachment: MailboxMessage["attachments"][number]) {
    const bridge = window.myagenttoolDesktop;
    if (!bridge?.previewMailAttachment) { setNotice({ tone: "error", text: copy.desktopAttachmentOnly }); return; }
    const result = await bridge.previewMailAttachment({ messageId: message.messageId, folderPath: message.folderPath, attachmentId: attachment.id, ...(message.archive?.ref ? { archiveRef: message.archive.ref } : {}) }).catch(() => ({ ok: false as const, error: "attachment_unavailable" as const }));
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
    const result = await bridge.downloadMailAttachment({ messageId: message.messageId, folderPath: message.folderPath, attachmentId: attachment.id, ...(message.archive?.ref ? { archiveRef: message.archive.ref } : {}) }).catch(() => ({ ok: false as const, error: "attachment_unavailable" as const }));
    if (!result.ok) {
      setNotice({ tone: "error", text: result.error === "download_too_large" ? copy.downloadTooLarge : copy.attachmentUnavailable });
    } else if (result.saved) {
      setNotice({ tone: "info", text: copy.downloadSaved.replace("{{name}}", result.name ?? attachment.name) });
    }
  }

  function showTask(task: NonNullable<MailboxMessage["task"]>) {
    openWorkItem(task.id);
    setSection("task");
  }

  function startTask(message: MailboxMessage) {
    if (message.task) { showTask(message.task); return; }
    const projectId = projects.some((project) => project.id === selectedProjectId)
      ? selectedProjectId!
      : projects[0]?.id ?? "";
    setTaskDraft({
      message,
      projectId,
      title: message.subject || copy.noSubject,
      description: message.body || message.preview || "",
      attachmentIds: [],
    });
    setNotice(null);
  }

  async function createTaskFromMail(executionMode: "manual" | "auto") {
    if (!taskDraft) return;
    if (!taskDraft.projectId) { setNotice({ tone: "error", text: copy.taskProjectRequired }); return; }
    if (!taskDraft.title.trim()) { setNotice({ tone: "error", text: copy.taskTitleRequired }); return; }
    const selected = taskDraft.message.attachments.filter((attachment) => taskDraft.attachmentIds.includes(attachment.id)).slice(0, 6);
    const bridge = window.myagenttoolDesktop;
    if (selected.length && !bridge?.readMailAttachmentForTask) {
      setNotice({ tone: "error", text: copy.taskAttachmentDesktopOnly });
      return;
    }
    setBusy("task");
    setNotice(null);
    try {
      let materialDraftId: string | undefined;
      let materialDraftRevision: number | undefined;
      const uploadedIds: string[] = [];
      const transferable = selected.filter((attachment) => /^[a-f0-9]{64}$/.test(attachment.sha256 ?? ""));
      let skipped = selected.length - transferable.length;
      if (transferable.length) {
        const material = await api.createTaskMaterialDraft(taskDraft.projectId);
        materialDraftId = material.draft.id;
        materialDraftRevision = material.draft.revision;
        for (const attachment of transferable) {
          try {
            const read = await bridge!.readMailAttachmentForTask!({
              messageId: taskDraft.message.messageId,
              folderPath: taskDraft.message.folderPath,
              attachmentId: attachment.id,
              ...(taskDraft.message.archive?.ref ? { archiveRef: taskDraft.message.archive.ref } : {}),
            });
            if (!read.ok
              || read.attachment.id !== attachment.id
              || read.attachment.size !== attachment.size
              || read.attachment.data.byteLength !== attachment.size
              || read.attachment.contentType.toLowerCase() !== (attachment.contentType || "application/octet-stream").toLowerCase()
              || read.attachment.sha256 !== attachment.sha256) {
              skipped += 1;
              continue;
            }
            const file = new File([read.attachment.data], attachment.name, { type: attachment.contentType || "application/octet-stream" });
            const uploaded = await api.uploadTaskMaterialFile(
              taskDraft.projectId,
              materialDraftId,
              `mail-attachment-${uploadedIds.length + 1}`,
              file,
            );
            uploadedIds.push(attachment.id);
            materialDraftRevision = uploaded.draft.revision;
          } catch {
            skipped += 1;
          }
        }
      }
      const result = await api.createMailTask(taskDraft.message.id, {
        projectId: taskDraft.projectId,
        title: taskDraft.title.trim(),
        description: taskDraft.description,
        attachmentIds: uploadedIds,
        executionMode,
        ...(uploadedIds.length && materialDraftId ? { materialDraftId, materialDraftRevision } : {}),
      });
      setTaskDraft(null);
      setNotice({
        tone: "info",
        text: (skipped ? copy.taskCreatedWithSkipped.replace("{{count}}", String(skipped)) : copy.taskCreated)
          .replace("{{ref}}", result.task.localRef),
        task: result.task,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["mailbox"] }),
        queryClient.invalidateQueries({ queryKey: ["console-state"] }),
      ]);
    } catch {
      setNotice({ tone: "error", text: copy.taskFailed });
    } finally {
      setBusy(null);
    }
  }

  function startCompose(message?: MailboxMessage) {
    const subject = message ? `Re: ${message.subject.replace(/^(\s*re\s*:\s*)+/i, "")}` : "";
    const next = { id: null, to: message?.from ?? "", subject, body: "", attachments: [], inReplyTo: message?.messageId ?? null, references: message ? [...message.references, message.messageId] : [], sendError: null };
    setCompose(next);
    setComposeBaseline(composeFingerprint(next));
    setNotice(null);
  }

  function editDraft(draft: MailboxDraft) {
    const next = { id: draft.id, to: draft.to, subject: draft.subject, body: draft.body, attachments: draft.attachments ?? [], inReplyTo: draft.inReplyTo, references: draft.references, sendError: draft.sendError };
    setCompose(next);
    setComposeBaseline(composeFingerprint(next));
    setNotice(null);
  }

  function closeCompose() {
    if (composeDirty) setConfirmComposeClose(true);
    else setCompose(null);
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
      const saved = { ...value, id: result.draft.id, sendError: result.draft.sendError };
      setCompose((current) => {
        if (!current) return current;
        return { ...current, id: result.draft.id, sendError: result.draft.sendError };
      });
      setComposeBaseline(composeFingerprint(saved));
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
      setComposeBaseline("");
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
      setComposeBaseline("");
      await queryClient.invalidateQueries({ queryKey: ["mailbox"] });
    } catch {
      setNotice({ tone: "error", text: copy.saveFailed });
    } finally {
      setBusy(null);
    }
  }

  async function reviewResponsePackage(item: MailResponsePackage, decision: "approve" | "request_changes") {
    setBusy("response");
    try {
      await api.reviewMailResponsePackage(item.id, { expectedRevision: item.revision, decision, ...(decision === "request_changes" ? { feedback: "请根据最新邮件和人工审核意见继续修订。" } : {}) });
      await responsePackages.refetch();
    } catch {
      setNotice({ tone: "error", text: copy.taskFailed });
    } finally {
      setBusy(null);
    }
  }

  async function draftResponsePackage(item: MailResponsePackage) {
    setBusy("response");
    try {
      let revision = item.revision;
      if ((item.candidateOutputAssets?.length ?? 0) > 0 && !item.candidateAttachments.length) {
        const stage = window.myagenttoolDesktop?.stageTaskOutputMailAttachments;
        if (!stage) {
          setNotice({ tone: "error", text: copy.outboundDesktopOnly });
          return;
        }
        const staged = await stage({ files: (item.candidateOutputAssets ?? []).map((asset) => ({
          projectId: asset.projectId,
          worktreeId: asset.worktreeId,
          relativePath: asset.relativePath,
          name: asset.name,
          contentType: asset.contentType,
          sha256: asset.sha256,
        })) });
        if (!staged.ok) throw new Error(staged.error);
        const attached = await api.attachMailResponsePackageFiles(item.id, revision, staged.attachments);
        revision = attached.package.revision;
      }
      const result = await api.createDraftFromMailResponsePackage(item.id, revision);
      await Promise.all([responsePackages.refetch(), queryClient.invalidateQueries({ queryKey: ["mailbox"] })]);
      setNotice({ tone: "info", text: copy.responseDrafted });
      setFolder("drafts");
      setSelectedMessageId(null);
      setViewedDraft(result.draft);
    } catch {
      setNotice({ tone: "error", text: copy.saveFailed });
    } finally {
      setBusy(null);
    }
  }

  async function materializeResponsePackage(workItemId: string, sourceRevision?: number) {
    setBusy("response");
    try {
      await api.materializeMailResponsePackage(workItemId, sourceRevision);
      await responsePackages.refetch();
    } catch {
      setNotice({ tone: "error", text: copy.responsePending });
    } finally {
      setBusy(null);
    }
  }

  async function saveTaskPolicy(input: { projectId: string; mode: MailTaskPolicy["mode"]; senderDomains: string[]; maxPerDay: number }) {
    setBusy("response");
    try {
      await api.upsertMailTaskPolicy(input);
      await Promise.all([taskPolicies.refetch(), taskOperations.refetch()]);
    } finally {
      setBusy(null);
    }
  }

  if (mailbox.isLoading) return <div role="status" className="py-12 text-center text-sm text-muted-foreground">{copy.syncing}</div>;
  if (mailbox.isError && !data) return <div role="alert" className="mx-auto flex max-w-xl flex-col items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-8 text-center"><p className="text-sm font-medium">{copy.loadFailed}</p><Button variant="secondary" onClick={() => void mailbox.refetch()}><RefreshCw />{copy.retry}</Button></div>;

  return (
    <div className="mx-auto max-w-[1500px] space-y-3 sm:space-y-4" data-testid="mail-view">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="hidden sm:block"><SectionHeading eyebrow={copy.eyebrow} title={copy.title} description={copy.description} /></div>
        <h2 className="sr-only sm:hidden">{copy.title}</h2>
        <div className="flex w-full flex-nowrap gap-1.5 sm:w-auto sm:flex-wrap sm:gap-2">
          {account?.canReceive ? <Button size="sm" variant="secondary" onClick={() => void syncMail()} disabled={syncing}><RefreshCw className={cn(syncing && "animate-spin")} />{syncing ? copy.syncing : copy.sync}</Button> : null}
          {account?.canReceive && !systemFolder ? <Button className="hidden sm:inline-flex" variant="secondary" onClick={() => void organizeMail()} disabled={busy === "classify"}><Sparkles />{busy === "classify" ? copy.organizing : copy.organize}</Button> : null}
          {account?.canReceive && !systemFolder ? <Button className="hidden sm:inline-flex" variant="secondary" onClick={() => setDeepOrganizeOpen(true)}><ShieldCheck />{copy.deepOrganize}</Button> : null}
          {account?.canReceive && !systemFolder ? <Button className="hidden sm:inline-flex" variant="secondary" onClick={() => { setRuleFeedback(null); setFolderFeedback(null); setRulesOpen(true); }}><SlidersHorizontal />{copy.rules}{organizeSuggestionCount ? <span aria-hidden className="rounded-full bg-primary/15 px-1.5 text-xs text-primary">{organizeSuggestionCount}</span> : null}</Button> : null}
          {account?.canReceive && canOperateMailAi ? <Button className="hidden sm:inline-flex" variant="secondary" onClick={() => setOperationsOpen(true)}><ListTodo />{copy.aiConsole}</Button> : null}
          {account?.canReceive && !systemFolder ? <Button size="sm" className="sm:hidden" variant="secondary" onClick={() => setOrganizeMenuOpen(true)}><SlidersHorizontal />{copy.organizeMenu}{organizeSuggestionCount ? <span aria-hidden className="rounded-full bg-primary/15 px-1.5 text-xs text-primary">{organizeSuggestionCount}</span> : null}</Button> : null}
          <Button size="sm" onClick={() => startCompose()}><PenLine />{copy.compose}</Button>
        </div>
      </div>

      {notice ? <div role={notice.tone === "error" ? "alert" : "status"} className={cn("flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm", notice.tone === "error" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-primary/30 bg-primary/5 text-foreground")}><span>{notice.text}</span>{notice.tone === "info" && notice.task ? <Button size="sm" variant="secondary" onClick={() => showTask(notice.task!)}><ListTodo />{copy.viewTask}</Button> : null}</div> : null}
      {ruleSuggestionCount && !systemFolder && !rulesOpen && !ruleEdit ? <div role="status" className="hidden flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 sm:flex"><div><p className="text-sm font-medium">{copy.rulesSuggestionNotice.replace("{{count}}", String(ruleSuggestionCount))}</p><p className="text-xs text-muted-foreground">{copy.rulesSuggestionNoticeHint}</p></div><Button size="sm" variant="secondary" onClick={() => { setRuleFeedback(null); setRulesOpen(true); }}>{copy.rulesReview}</Button></div> : null}
      {folderSuggestionCount && !systemFolder && !rulesOpen && !ruleEdit && !folderPreview ? <div role="status" className="hidden flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 sm:flex"><div><p className="text-sm font-medium">{copy.folderSuggestionNotice.replace("{{count}}", String(folderSuggestionCount))}</p><p className="text-xs text-muted-foreground">{copy.folderSuggestionNoticeHint}</p></div><Button size="sm" variant="secondary" onClick={() => { setFolderFeedback(null); setRulesOpen(true); }}>{copy.rulesReview}</Button></div> : null}
      {recoveryFolderJob && !folderPreview && !folderRecoveryOpen ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2"><div><p className="text-sm font-medium">{copy.folderMoveRecoveryNotice}</p><p className="text-xs text-muted-foreground">{copy.folderMoveRecoveryHint}</p></div><Button size="sm" variant="secondary" onClick={() => setFolderRecoveryOpen(true)}>{copy.folderMoveReviewStatus}</Button></div> : null}
      {mailbox.isError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"><span>{copy.loadFailed}</span><Button size="sm" variant="secondary" onClick={() => void mailbox.refetch()}><RefreshCw />{copy.retry}</Button></div> : null}
      {data?.folders.some((item) => item.syncError) ? <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">{copy.folderSyncError}</div> : null}
      {data?.folders.some((item) => item.cursorReset) ? <div role="status" className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">{copy.cursorReset}</div> : null}

      {!data?.accounts.length ? (
        <section className="rounded-2xl border bg-card p-6 text-center sm:p-10">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary"><Mail /></span>
          <h2 className="mt-4 text-lg font-semibold">{copy.connectTitle}</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">{copy.connectHint}</p>
          <p className="mx-auto mt-1 max-w-lg text-xs text-muted-foreground">{copy.connectSimple}</p>
          <Button className="mt-5" onClick={() => openConnector()}>{copy.connectAction}</Button>
        </section>
      ) : (
        <>
          <div className={cn("flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm", account?.canReceive ? "bg-card" : "border-warning/40 bg-warning/10")}>
            <div className="flex min-w-0 items-center gap-2"><span className={cn("size-2 shrink-0 rounded-full", account?.canReceive ? "bg-emerald-500" : "bg-amber-500")} /><span className="shrink-0 font-medium">{account?.name}</span><span className="hidden text-muted-foreground sm:inline">{account?.canReceive ? copy.receiveReady : copy.attention}</span>{lastSyncText ? <span className="truncate text-[11px] text-muted-foreground sm:text-xs">{lastSyncText}</span> : null}</div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {!account?.canReceive ? <Button size="sm" variant="secondary" onClick={() => openConnector()}>{copy.attentionAction}</Button> : null}
              {account?.canReceive ? <Button size="sm" variant="secondary" onClick={() => openConnector()}>{copy.manageConnection}</Button> : null}
            </div>
          </div>

          {!systemFolder && classificationSummary ? <nav className="flex gap-2 overflow-x-auto pb-1" aria-label={copy.organize}>
            {(Object.keys(copy.smartViews) as MailSmartView[]).map((view) => <button key={view} type="button" aria-current={smartView === view ? "page" : undefined} onClick={() => { setSmartView(view); setSelectedMessageId(null); }} className={cn("flex min-w-max items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors", smartView === view ? "border-primary bg-primary/10 font-medium text-primary" : "bg-card text-muted-foreground hover:text-foreground")}><span>{copy.smartViews[view]}</span><span className="text-xs tabular-nums">{classificationSummary.counts[view] ?? 0}</span></button>)}
          </nav> : null}

          <div className="overflow-hidden rounded-2xl border bg-card lg:grid lg:min-h-[620px] lg:grid-cols-[11rem_minmax(20rem,26rem)_minmax(0,1fr)]">
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
                  ? <MessageRow key={(entry as MailboxMessage).id} message={entry as MailboxMessage} copy={copy} selected={selectedMessageId === (entry as MailboxMessage).id} onOpen={openMessage} />
                  : <DraftRow key={(entry as MailboxDraft).id} draft={entry as MailboxDraft} copy={copy} onOpen={folder === "drafts" ? editDraft : setViewedDraft} />)
                  : <div className="p-8 text-center"><p className="font-medium">{!systemFolder ? (query.trim() ? copy.searchEmpty : copy.emptyInbox) : copy.emptyFolder}</p>{!systemFolder && !query.trim() ? <p className="mt-1 text-sm text-muted-foreground">{copy.emptyInboxHint}</p> : null}</div>}
              </div>
              {!systemFolder && data.pagination.totalPages > 1 ? <div className="flex items-center justify-between gap-2 border-t p-2"><Button size="sm" variant="ghost" disabled={!data.pagination.hasPrevious} onClick={() => { setPage((value) => Math.max(1, value - 1)); setSelectedMessageId(null); }}><ChevronLeft />{copy.previousPage}</Button><span className="text-xs text-muted-foreground">{copy.pageStatus.replace("{{page}}", String(data.pagination.page)).replace("{{total}}", String(data.pagination.totalPages))}</span><Button size="sm" variant="ghost" disabled={!data.pagination.hasNext} onClick={() => { setPage((value) => value + 1); setSelectedMessageId(null); }}>{copy.nextPage}<ChevronRight /></Button></div> : null}
            </section>

            <section className={cn("min-w-0", selectedMessage ? "block" : "hidden lg:block")} aria-label={selectedMessage?.subject ?? copy.choose}>
              {selectedMessage ? <div className="max-h-[70vh] overflow-y-auto lg:max-h-[620px]"><MessageDetail message={selectedMessage} copy={copy} canSend={Boolean(account?.canSend)} loading={!selectedMessage.fetched && ["queued", "running", "retry_wait"].includes(selectedMessage.bodyFetch?.status ?? "")} handoffContext={{ folder, page: String(page), view: smartView }} onBack={() => setSelectedMessageId(null)} onReply={() => startCompose(selectedMessage)} onCreateTask={() => startTask(selectedMessage)} onMarkUnread={() => void markUnread(selectedMessage)} onCorrectClassification={() => setClassificationCorrection({ message: selectedMessage, view: classificationViewOf(selectedMessage) })} onPreview={(attachment) => void previewAttachment(selectedMessage, attachment)} onDownload={(attachment) => void downloadAttachment(selectedMessage, attachment)} />{selectedMessage.task ? <MailResponseReviewPanel copy={copy} workItemId={selectedMessage.task.id} sourceRevision={selectedMessage.task.sourceRevision} item={responsePackages.data?.packages.find((item) => item.status !== "superseded") ?? null} loading={responsePackages.isLoading} pending={busy === "response"} onMaterialize={(workItemId, sourceRevision) => void materializeResponsePackage(workItemId, sourceRevision)} onReview={(item, decision) => void reviewResponsePackage(item, decision)} onDraft={(item) => void draftResponsePackage(item)} /> : null}</div> : <div className="grid h-full min-h-80 place-items-center p-8 text-center text-sm text-muted-foreground"><div><Mail className="mx-auto mb-3 size-8 opacity-40" />{copy.choose}</div></div>}
            </section>
          </div>

          {organizeSuggestionCount && !systemFolder && !rulesOpen && !ruleEdit && !folderPreview ? <div role="status" className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 sm:hidden"><div className="min-w-0"><p className="text-sm font-medium">{copy.mobileSuggestionNotice.replace("{{count}}", String(organizeSuggestionCount))}</p><p className="truncate text-xs text-muted-foreground">{copy.mobileSuggestionNoticeHint}</p></div><Button className="shrink-0" size="sm" variant="secondary" onClick={() => { setRuleFeedback(null); setFolderFeedback(null); setRulesOpen(true); }}>{copy.rulesReview}</Button></div> : null}
        </>
      )}

      <ComposeModal copy={copy} value={compose} onChange={setCompose} busy={busy} canSend={Boolean(account?.canSend)} onClose={closeCompose} onSave={() => compose && void persistDraft(compose)} onReview={() => void reviewForSend()} onDelete={() => void removeDraft()} onPickAttachments={() => void pickComposeAttachments()} onPasteAttachments={(files) => void pasteComposeAttachments(files)} onRemoveAttachment={(ref) => setCompose((current) => current ? { ...current, attachments: current.attachments.filter((item) => item.ref !== ref) } : current)} />
      <SendReviewModal copy={copy} draft={reviewDraft} pending={busy === "send"} onClose={() => setReviewDraft(null)} onSend={() => void sendDraft()} />
      <MailDraftDetailModal copy={copy} draft={viewedDraft} onClose={() => setViewedDraft(null)} />
      <ConfirmModal open={confirmComposeClose} title={copy.discardComposeTitle} description={copy.discardComposeDescription} confirmLabel={copy.discardComposeConfirm} destructive onClose={() => setConfirmComposeClose(false)} onConfirm={() => { setConfirmComposeClose(false); setCompose(null); setComposeBaseline(""); }} />
      <MailConnectionModal copy={copy} intent={connectorIntent} open={connectorOpen} onClose={() => setConnectorOpen(false)} onConnected={() => {
        void queryClient.invalidateQueries({ queryKey: ["mailbox"] });
        void queryClient.invalidateQueries({ queryKey: ["mail-folder-suggestions"] });
        window.setTimeout(() => { void queryClient.invalidateQueries({ queryKey: ["mailbox"] }); }, 2_000);
        window.setTimeout(() => { void queryClient.invalidateQueries({ queryKey: ["mailbox"] }); }, 16_000);
      }} />
      <AttachmentPreviewModal copy={copy} preview={attachmentPreview} onClose={() => setAttachmentPreview(null)} />
      <MailTaskReviewModal copy={copy} value={taskDraft} projects={projects} pending={busy === "task"} onChange={setTaskDraft} onClose={() => setTaskDraft(null)} onCreate={(mode) => void createTaskFromMail(mode)} />
      <ClassificationCorrectionModal copy={copy} value={classificationCorrection} pending={busy === "correct"} onChange={setClassificationCorrection} onClose={() => setClassificationCorrection(null)} onSave={() => void saveClassificationCorrection()} />
      <MailOrganizeMenuModal copy={copy} open={organizeMenuOpen} organizing={busy === "classify"} suggestionCount={organizeSuggestionCount} onClose={() => setOrganizeMenuOpen(false)} onBasic={() => { setOrganizeMenuOpen(false); void organizeMail(); }} onDeep={() => { setOrganizeMenuOpen(false); setDeepOrganizeOpen(true); }} onRules={() => { setOrganizeMenuOpen(false); setRuleFeedback(null); setFolderFeedback(null); setRulesOpen(true); }} />
      <DeepOrganizeModal copy={copy} open={deepOrganizeOpen} preview={deepPreview.data?.preview ?? null} previewLoading={deepPreview.isLoading} previewError={deepPreview.isError} job={deepJob.data?.job ?? null} jobLoading={Boolean(deepJobId) && deepJob.isLoading} jobError={deepJob.isError} pending={busy === "deep"} onClose={closeDeepOrganize} onStart={() => void startDeepOrganize()} onCancel={() => void cancelDeepOrganize()} />
      <ClassificationRulesModal copy={copy} open={rulesOpen} data={classificationRules.data ?? null} quality={classificationQuality.data?.quality ?? null} qualityLoading={classificationQuality.isLoading} qualityError={classificationQuality.isError} folderData={folderSuggestions.data ?? null} automationData={folderAutomations.data?.automations ?? []} historyJobs={folderMoveJobs.data?.jobs ?? []} accounts={data?.accounts ?? []} loading={classificationRules.isLoading} error={classificationRules.isError} folderLoading={folderSuggestions.isLoading} folderError={folderSuggestions.isError} pendingKey={rulePending} feedback={ruleFeedback} folderPending={folderPending} folderFeedback={folderFeedback} folderSelections={folderSelections} onFolderSelection={(id, value) => setFolderSelections((current) => ({ ...current, [id]: value }))} onFolderPreview={(suggestion) => void previewFolderSuggestion(suggestion)} onAutomationPreview={(suggestion) => void previewFolderAutomation(suggestion)} onAutomationAction={(automation, action) => void changeFolderAutomation(automation, action)} onAutomationDryRun={(automation) => void dryRunFolderAutomation(automation)} onClose={() => { setRulesOpen(false); setRuleFeedback(null); setFolderFeedback(null); }} onRetry={() => void classificationRules.refetch()} onQualityRetry={() => void classificationQuality.refetch()} onFolderRetry={() => void folderSuggestions.refetch()} onEnable={(id) => void enableClassificationRule(id)} onAction={(rule, action) => void changeClassificationRule(rule, action)} onEdit={(rule) => { setRuleFeedback(null); setFolderFeedback(null); setRulesOpen(false); setRuleEdit({ rule, view: classificationViewForTarget(rule.target) }); }} />
      <ClassificationRuleEditModal copy={copy} value={ruleEdit} accountName={ruleEdit ? accountLabel(ruleEdit.rule.accountId, data?.accounts ?? []) : null} pending={Boolean(ruleEdit && rulePending === `edit:${ruleEdit.rule.id}`)} feedback={ruleFeedback} onChange={setRuleEdit} onClose={() => { setRuleEdit(null); setRuleFeedback(null); setRulesOpen(true); }} onSave={() => void saveClassificationRule()} />
      <FolderMovePreviewModal copy={copy} value={folderPreview} job={folderMoveJob.data?.job ?? null} pending={folderMovePending} error={folderMoveError} accounts={data?.accounts ?? []} onMove={() => void startFolderMove()} onConnect={() => { setFolderPreview(null); setFolderMoveJobId(null); openConnector("organize"); }} onSync={() => { setFolderPreview(null); setFolderMoveJobId(null); void syncMail(); }} onClose={() => { setFolderPreview(null); setFolderMoveJobId(null); setFolderMoveError(null); setRulesOpen(true); }} />
      <FolderAutomationPreviewModal copy={copy} value={automationPreview} pending={automationPending} error={automationError} accounts={data?.accounts ?? []} onEnable={() => void enableFolderAutomation()} onClose={() => { setAutomationPreview(null); setAutomationError(null); setRulesOpen(true); }} />
      <FolderMoveRecoveryModal copy={copy} value={folderRecoveryOpen ? recoveryFolderJob : null} pending={folderMovePending} error={folderMoveError} accounts={data?.accounts ?? []} onSync={() => { setFolderRecoveryOpen(false); void syncMail(); }} onReconcile={(job) => void reconcileFolderMove(job)} onClose={() => { setFolderRecoveryOpen(false); setFolderMoveError(null); }} />
      <MailTaskOperationsModal copy={copy} open={operationsOpen} data={taskOperations.data ?? null} policies={taskPolicies.data?.policies ?? []} projects={projects} loading={taskOperations.isLoading || taskPolicies.isLoading} pending={busy === "response"} canManagePolicies={canManageMailAi} onSave={(input) => void saveTaskPolicy(input)} onClose={() => setOperationsOpen(false)} />
    </div>
  );
}

function MailConnectionModal({ copy, intent, open, onClose, onConnected }: { copy: typeof COPY.zh | typeof COPY.en; intent: MailConnectorIntent; open: boolean; onClose: () => void; onConnected: () => void }) {
  const bridge = window.myagenttoolDesktop;
  const [email, setEmail] = useState("");
  const [authorizationCode, setAuthorizationCode] = useState("");
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [upgradeNeeded, setUpgradeNeeded] = useState(false);
  const [receiveConnected, setReceiveConnected] = useState(false);
  const [sendConnected, setSendConnected] = useState(false);
  const [organizeConnected, setOrganizeConnected] = useState(false);
  const [platformSupported, setPlatformSupported] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAuthorizationCode("");
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open || !bridge?.getMailConnectorStatus) return;
    void bridge.getMailConnectorStatus().then((status) => {
      const provider = status.providers.find((item) => item.id === "netease_163");
      setPlatformSupported(provider?.available !== false);
      if (provider?.account) setEmail(provider.account);
      if (provider?.connected || provider?.credentialStored) setConnectedEmail(provider.account);
      setReceiveConnected(provider?.connected === true);
      setSendConnected(provider?.sendConnected ?? provider?.connected === true);
      setOrganizeConnected(provider?.organizeConnected ?? provider?.connected === true);
      setUpgradeNeeded(provider?.upgradeNeeded === true);
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
    setConnectedEmail(result.account.email);
    setUpgradeNeeded(false);
    setReceiveConnected(true);
    setSendConnected(true);
    setOrganizeConnected(true);
    setAuthorizationCode("");
    onConnected();
  }
  async function disconnect() {
    if (!bridge?.disconnect163Mail || !window.confirm(copy.disconnectConfirm)) return;
    setPending(true);
    setError(null);
    const result = await bridge.disconnect163Mail().catch(() => ({ ok: false as const, error: "unavailable" as const }));
    setPending(false);
    if (!result.ok) { setError(copy.errors[result.error as keyof typeof copy.errors] ?? copy.errors.unavailable); return; }
    setConnectedEmail(null);
    setEmail("");
    setUpgradeNeeded(false);
    setReceiveConnected(false);
    setSendConnected(false);
    setOrganizeConnected(false);
    onConnected();
  }
  const closeModal = () => {
    setAuthorizationCode("");
    setError(null);
    onClose();
  };

  return <Modal open={open} title={copy.connectorTitle} description={copy.connectorDescription} size="lg" onClose={closeModal} closeDisabled={pending} footer={connectedEmail ? <div className="flex justify-end"><Button onClick={closeModal}>{copy.done}</Button></div> : undefined}>
    {!bridge?.getMailConnectorStatus ? <div className="space-y-4 rounded-xl border bg-muted/20 p-5 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-primary/10 text-primary"><MonitorUp /></span>
      <p className="text-sm leading-6 text-muted-foreground">{copy.desktopOnly}</p>
      <a href={`myagenttool://mail/connect?intent=${intent}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><MonitorUp />{copy.continueOnDesktop}</a>
      <p className="text-xs leading-5 text-muted-foreground">{copy.desktopLaunchHint}</p>
    </div> : platformSupported === false ? <div className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-5 text-center"><AlertTriangle className="mx-auto size-8 text-amber-500" /><p className="text-sm text-muted-foreground">{copy.platformUnsupported}</p></div> : connectedEmail ? <div className="space-y-4 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-500/10 text-emerald-600"><ShieldCheck /></span>
      <div><h3 className="font-semibold">{copy.connectSuccess}</h3><p className="mt-1 text-sm text-muted-foreground">{connectedEmail}</p></div>
      <p className="text-sm leading-6 text-muted-foreground">{copy.connectSuccessHint}</p>
      <div className="grid gap-2 text-left sm:grid-cols-3">
        {[[copy.receiveReady, receiveConnected], [copy.organizeConnected, organizeConnected], [copy.sendConnected, sendConnected]].map(([label, ready]) => <div key={String(label)} className={cn("flex items-center gap-2 rounded-xl border p-3 text-sm", ready ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700" : "border-amber-500/30 bg-amber-500/5 text-amber-700")}><ShieldCheck className="size-4 shrink-0" /><span>{label}</span>{ready ? null : <span>· {copy.capabilityPending}</span>}</div>)}
      </div>
      {upgradeNeeded ? <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-left"><p className="text-sm font-medium">{copy.upgradeTitle}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{copy.upgradeHint}</p></div> : null}
      <div className="flex flex-wrap justify-center gap-2"><Button variant="secondary" onClick={() => { setConnectedEmail(null); setAuthorizationCode(""); setError(null); }}>{copy.reconnect}</Button><Button variant="ghost" onClick={() => void disconnect()} disabled={pending}>{pending ? copy.disconnecting : copy.disconnect}</Button></div>
    </div> : <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-3"><div className="flex items-center justify-between gap-2"><span className="font-medium">{copy.provider163}</span><span className={cn("rounded-full px-2 py-0.5 text-xs", upgradeNeeded ? "bg-amber-500/10 text-amber-700" : "bg-muted text-muted-foreground")}>{upgradeNeeded ? copy.upgradeBadge : copy.readyToConnect}</span></div><p className="mt-1 text-xs text-muted-foreground">{copy.provider163Hint}</p></div>
        <div className="rounded-xl border bg-muted/30 p-3 opacity-70"><div className="flex items-center justify-between gap-2"><span className="font-medium">{copy.providerGmail}</span><span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{copy.comingSoon}</span></div></div>
      </div>
      {upgradeNeeded ? <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3"><p className="text-sm font-medium">{copy.upgradeTitle}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{copy.upgradeHint}</p></div> : null}
      <div className="rounded-xl border bg-muted/30 p-3"><p className="text-sm font-medium">1. {copy.authHelpTitle}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{copy.authHelp}</p></div>
      <div className="space-y-3"><p className="text-sm font-medium">2. {copy.connectAndTest}</p><label className="block text-sm font-medium">{copy.accountEmail}<input autoFocus autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@163.com" className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-normal outline-none focus:ring-2 focus:ring-ring" /></label><label className="block text-sm font-medium">{copy.authorizationCode}<input type="password" autoComplete="off" value={authorizationCode} onChange={(event) => setAuthorizationCode(event.target.value)} placeholder={copy.authorizationPlaceholder} className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-normal outline-none focus:ring-2 focus:ring-ring" /></label><p className="flex gap-2 text-xs leading-5 text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />{copy.localSecret}</p></div>
      {error ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
      <Button className="w-full" onClick={() => void connect()} disabled={pending}><RefreshCw className={cn(pending && "animate-spin")} />{pending ? copy.testing : upgradeNeeded ? copy.upgradeAction : copy.connectAndTest}</Button>
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
  sendError: string | null;
}

interface MailTaskDraft {
  message: MailboxMessage;
  projectId: string;
  title: string;
  description: string;
  attachmentIds: string[];
}

interface ClassificationCorrectionState {
  message: MailboxMessage;
  view: Exclude<MailSmartView, "all">;
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

function MessageRow({ message, copy, selected, onOpen }: { message: MailboxMessage; copy: typeof COPY.zh | typeof COPY.en; selected: boolean; onOpen: (message: MailboxMessage) => void }) {
  const view = classificationViewOf(message);
  const sender = mailboxSender(message.from);
  return <button type="button" title={message.from} onClick={() => void onOpen(message)} className={cn("block w-full border-b px-3 py-3 text-left hover:bg-muted/50", selected && "bg-muted", message.unread && "border-l-2 border-l-primary")}>
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <span className="truncate text-xs font-medium text-muted-foreground">{sender.name}</span>
      <time className="shrink-0 text-xs text-muted-foreground">{shortDate(message.date, copy)}</time>
    </div>
    <div className="mt-1 flex min-w-0 items-center gap-2">
      <p className={cn("min-w-0 flex-1 truncate text-[15px] font-medium leading-5", message.unread && "font-semibold text-foreground")}>{message.subject || copy.noSubject}</p>
      {message.classification ? <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px]", view === "needs_attention" ? "bg-primary/10 text-primary" : view === "important" ? "bg-amber-500/10 text-amber-600" : "bg-muted text-muted-foreground")}>{copy.smartViews[view]}</span> : null}
    </div>
    <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-muted-foreground">{message.preview || "…"}</p>
  </button>;
}

function DraftRow({ draft, copy, onOpen }: { draft: MailboxDraft; copy: typeof COPY.zh | typeof COPY.en; onOpen?: (draft: MailboxDraft) => void }) {
  const content = <><div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{draft.to || "—"}</span><span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px]">{copy.status[draft.status as keyof typeof copy.status] ?? draft.status}</span></div><p className="mt-1 truncate text-sm">{draft.subject || copy.noSubject}</p><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{draft.body || "…"}</p>{draft.sendError ? <p className="mt-1 line-clamp-2 text-xs text-destructive">{copy.sendProblem}</p> : null}</>;
  return onOpen ? <button type="button" onClick={() => onOpen(draft)} className="block w-full border-b p-3 text-left hover:bg-muted/50">{content}</button> : <article className="border-b p-3">{content}</article>;
}

function MessageDetail({ message, copy, canSend, loading, handoffContext, onBack, onReply, onCreateTask, onMarkUnread, onCorrectClassification, onPreview, onDownload }: { message: MailboxMessage; copy: typeof COPY.zh | typeof COPY.en; canSend: boolean; loading: boolean; handoffContext: Record<string, string>; onBack: () => void; onReply: () => void; onCreateTask: () => void; onMarkUnread: () => void; onCorrectClassification: () => void; onPreview: (attachment: MailboxMessage["attachments"][number]) => void; onDownload: (attachment: MailboxMessage["attachments"][number]) => void }) {
  const classificationView = classificationViewOf(message);
  const sender = mailboxSender(message.from);
  const archiveAvailable = message.archive?.availability === "available";
  const canPreviewAttachment = Boolean(window.myagenttoolDesktop?.previewMailAttachment);
  const canDownloadAttachment = Boolean(window.myagenttoolDesktop?.downloadMailAttachment);
  return <div className="flex h-full min-h-0 flex-col">
    <div className="border-b p-4">
      <Button className="mb-2 lg:hidden" size="sm" variant="ghost" onClick={onBack}><ArrowLeft />{copy.back}</Button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-xl font-semibold leading-7">{message.subject || copy.noSubject}</h2>
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 text-sm"><span className="font-medium">{sender.name}</span>{sender.address ? <span className="break-all text-xs text-muted-foreground">{sender.address}</span> : null}</p>
          <time className="text-xs text-muted-foreground">{longDate(message.date, copy)}</time>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={onMarkUnread}><MailOpen />{copy.markUnread}</Button>
          <Button size="sm" variant="secondary" onClick={onReply}><Reply />{canSend ? copy.reply : copy.replyDraft}</Button>
          <Button size="sm" onClick={onCreateTask}><ListTodo />{message.task ? copy.linkedTask.replace("{{ref}}", message.task.localRef) : copy.createTask}</Button>
        </div>
      </div>
      {message.classification ? <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs"><span className="rounded-full bg-background px-2 py-0.5 font-medium">{copy.smartViews[classificationView]}</span><span className="min-w-0 flex-1 text-muted-foreground">{copy.classificationWhy.replace("{{reason}}", message.classification.explanation)}{message.classification.uncertain ? ` · ${copy.uncertainClassification}` : ""}</span><Button size="sm" variant="ghost" onClick={onCorrectClassification}>{copy.classificationWrong}</Button></div> : null}
      {message.issueNumber ? <p className="mt-3 text-xs text-primary">{copy.issue.replace("{{number}}", String(message.issueNumber))}</p> : null}
      <details className="group mt-2 text-xs text-muted-foreground">
        <summary className="w-fit cursor-pointer list-none rounded-md px-1 py-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ShieldCheck className="mr-1 inline size-3.5 text-emerald-500" /><span>{archiveAvailable ? copy.securityStored : copy.securityOnline}</span><span className="sr-only"> · {copy.securityDetails}</span></summary>
        <div className="mt-1 space-y-1 rounded-lg border bg-muted/20 px-3 py-2 leading-5">
          <p><AlertTriangle className="mr-1 inline size-3.5 text-amber-500" />{copy.untrusted}</p>
          <p>{copy.localReadHint}</p>
          {message.fetched ? <p>{archiveAvailable ? copy.archiveAvailable : copy.archiveUnavailable}</p> : null}
        </div>
      </details>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      {loading ? <p role="status" className="text-sm text-muted-foreground">{copy.loadingBody}</p> : <MailMessageBody key={message.id} message={message} copy={copy} />}
      {message.attachments?.length ? <section className="mt-6 border-t pt-4" aria-label={copy.attachments}><h3 className="flex items-center gap-2 text-sm font-semibold"><Paperclip className="size-4" />{copy.attachments} ({message.attachments.length})</h3><div className="mt-2 space-y-2">{message.attachments.map((attachment) => <article key={attachment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 p-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{attachment.name}</p><p className="text-xs text-muted-foreground">{formatBytes(attachment.size)}{attachment.localAvailable ? ` · ${copy.attachmentLocal}` : ""}</p></div><div className="flex gap-2">{attachment.previewable && canPreviewAttachment ? <Button size="sm" variant="ghost" onClick={() => onPreview(attachment)}><Eye />{copy.previewAttachment}</Button> : null}{canDownloadAttachment ? <Button size="sm" variant="secondary" onClick={() => onDownload(attachment)}><Download />{copy.downloadAttachment}</Button> : <DesktopHandoffLink section="mail" action="mail-attachment" params={{ ...handoffContext, message: message.id, attachment: attachment.id, mode: attachment.previewable ? "preview" : "download" }} compact>{copy === COPY.zh ? "在桌面版查看" : "Open in desktop"}</DesktopHandoffLink>}</div></article>)}</div></section> : null}
    </div>
  </div>;
}

function MailMessageBody({ message, copy }: { message: MailboxMessage; copy: typeof COPY.zh | typeof COPY.en }) {
  const html = message.bodyHtml ?? "";
  const [showHtml, setShowHtml] = useState(false);
  const [allowRemoteImages, setAllowRemoteImages] = useState(false);
  const [cidImages, setCidImages] = useState<Record<string, string>>({});
  const [inlineImagesLoading, setInlineImagesLoading] = useState(false);

  useEffect(() => {
    setShowHtml(false);
    setAllowRemoteImages(false);
    setCidImages({});
    setInlineImagesLoading(false);
  }, [message.id]);

  async function showSafeHtml() {
    setShowHtml(true);
    const bridge = window.myagenttoolDesktop;
    const inline = message.attachments
      .filter((attachment) => attachment.contentId && !cidImages[normalizeCid(attachment.contentId)] && attachment.previewable && attachment.contentType.startsWith("image/"))
      .slice(0, 10);
    if (!bridge?.previewMailAttachment || !inline.length) return;
    setInlineImagesLoading(true);
    const entries = await Promise.all(inline.map(async (attachment) => {
      const result = await bridge.previewMailAttachment!({ messageId: message.messageId, folderPath: message.folderPath, attachmentId: attachment.id, ...(message.archive?.ref ? { archiveRef: message.archive.ref } : {}) }).catch(() => null);
      if (!result?.ok || result.preview.kind !== "image" || !result.preview.dataBase64) return null;
      const contentType = result.preview.contentType.toLowerCase();
      if (!/^image\/(png|jpeg|gif|webp)$/.test(contentType)) return null;
      return [normalizeCid(attachment.contentId!), `data:${contentType};base64,${result.preview.dataBase64}`] as const;
    }));
    setCidImages((current) => ({ ...current, ...Object.fromEntries(entries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))) }));
    setInlineImagesLoading(false);
  }

  return <div className="space-y-3">
    {message.bodyTruncated ? <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs leading-5"><AlertTriangle className="mr-1 inline size-3.5 text-amber-500" />{copy.bodyTruncated}</div> : null}
    {html ? <div className="flex flex-nowrap items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2"><p className="min-w-0 flex-1 text-xs text-muted-foreground"><span className="sm:hidden">{showHtml ? copy.safeHtmlNotice : copy.htmlTextNoticeCompact}</span><span className="hidden sm:inline">{showHtml ? copy.safeHtmlNotice : copy.htmlTextNotice}</span></p><Button className="shrink-0" size="sm" variant="secondary" onClick={() => showHtml ? setShowHtml(false) : void showSafeHtml()}>{showHtml ? copy.viewPlainText : copy.viewSafeHtml}</Button></div> : null}
    {showHtml && html ? <>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2"><p className="min-w-0 flex-1 text-xs text-muted-foreground">{allowRemoteImages ? copy.remoteImagesLoaded : copy.remoteImagesBlocked}</p><Button size="sm" variant="ghost" onClick={() => setAllowRemoteImages((current) => !current)}>{allowRemoteImages ? copy.blockRemoteImages : copy.loadRemoteImages}</Button></div>
      {inlineImagesLoading ? <p role="status" className="text-xs text-muted-foreground">{copy.inlineImagesLoading}</p> : null}
      <SafeHtmlMailBody html={html} title={copy.safeHtmlTitle} allowRemoteImages={allowRemoteImages} cidImages={cidImages} />
    </> : message.body ? <PlainMailBody body={message.body} /> : <p className="text-sm text-muted-foreground">{message.bodyFetch?.status === "failed" ? copy.bodyDownloadFailed : message.bodyFetch?.status === "unavailable" && message.bodyFetch.lastError === "mail_message_not_found" ? copy.bodyNoLongerAvailable : copy.bodyUnavailable}</p>}
  </div>;
}

function MailTaskReviewModal({ copy, value, projects, pending, onChange, onClose, onCreate }: {
  copy: typeof COPY.zh | typeof COPY.en;
  value: MailTaskDraft | null;
  projects: Array<{ id: string; name: string }>;
  pending: boolean;
  onChange: (value: MailTaskDraft | null) => void;
  onClose: () => void;
  onCreate: (mode: "manual" | "auto") => void;
}) {
  if (!value) return null;
  const canCopyAttachments = Boolean(window.myagenttoolDesktop?.readMailAttachmentForTask);
  const toggleAttachment = (id: string) => {
    const selected = value.attachmentIds.includes(id);
    if (!selected && value.attachmentIds.length >= 6) return;
    onChange({ ...value, attachmentIds: selected ? value.attachmentIds.filter((item) => item !== id) : [...value.attachmentIds, id] });
  };
  const disabled = pending || !value.projectId || !value.title.trim();
  return <Modal open title={copy.taskReviewTitle} description={copy.taskReviewHint} size="lg" onClose={onClose} closeDisabled={pending} footer={<div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={pending}>{copy.close}</Button><Button variant="secondary" onClick={() => onCreate("manual")} disabled={disabled}><ListTodo />{pending ? copy.creatingTask : copy.createTaskNow}</Button><Button onClick={() => onCreate("auto")} disabled={disabled}>{pending ? copy.creatingTask : copy.createAndHandle}</Button></div>}>
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs leading-5 text-muted-foreground"><AlertTriangle className="mr-1 inline size-3.5 text-amber-500" />{copy.taskSourceHint}</div>
      <label className="block text-sm font-medium">{copy.taskProject}<select autoFocus value={value.projectId} onChange={(event) => onChange({ ...value, projectId: event.target.value })} className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-normal outline-none focus:ring-2 focus:ring-ring"><option value="">—</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <label className="block text-sm font-medium">{copy.taskTitle}<input value={value.title} maxLength={300} onChange={(event) => onChange({ ...value, title: event.target.value })} className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-normal outline-none focus:ring-2 focus:ring-ring" /></label>
      <label className="block text-sm font-medium">{copy.taskDescription}<textarea value={value.description} maxLength={20_000} onChange={(event) => onChange({ ...value, description: event.target.value })} placeholder={copy.taskDescriptionPlaceholder} className="mt-1 min-h-36 w-full resize-y rounded-md border bg-background px-3 py-2 font-normal leading-6 outline-none focus:ring-2 focus:ring-ring" /></label>
      {value.message.attachments.length ? <fieldset className="rounded-lg border bg-muted/20 p-3"><legend className="px-1 text-sm font-medium">{copy.attachments}</legend><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{canCopyAttachments ? copy.taskAttachmentsHint : copy.taskAttachmentDesktopOnly}</p>{!canCopyAttachments ? <DesktopHandoffLink section="mail" action="mail-attachment" params={{ message: value.message.id, mode: "task" }} compact>{copy === COPY.zh ? "在桌面版添加附件" : "Add in desktop"}</DesktopHandoffLink> : null}</div><div className="space-y-2">{value.message.attachments.map((attachment) => <label key={attachment.id} className={cn("flex items-center gap-3 rounded-md bg-background px-3 py-2", canCopyAttachments ? "cursor-pointer" : "cursor-not-allowed opacity-60")}><input type="checkbox" checked={value.attachmentIds.includes(attachment.id)} disabled={!canCopyAttachments || (!value.attachmentIds.includes(attachment.id) && value.attachmentIds.length >= 6)} onChange={() => toggleAttachment(attachment.id)} /><Paperclip className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-sm">{attachment.name}</span><span className="text-xs text-muted-foreground">{formatBytes(attachment.size)}</span></label>)}</div></fieldset> : null}
    </div>
  </Modal>;
}

function MailResponseReviewPanel({ copy, workItemId, sourceRevision, item, loading, pending, onMaterialize, onReview, onDraft }: {
  copy: typeof COPY.zh | typeof COPY.en;
  workItemId: string;
  sourceRevision?: number;
  item: MailResponsePackage | null;
  loading: boolean;
  pending: boolean;
  onMaterialize: (workItemId: string, sourceRevision?: number) => void;
  onReview: (item: MailResponsePackage, decision: "approve" | "request_changes") => void;
  onDraft: (item: MailResponsePackage) => void;
}) {
  if (loading) return <div className="mx-4 mb-4 rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">{copy.creatingTask}</div>;
  if (!item) return <div className="mx-4 mb-4 flex items-center justify-between gap-3 rounded-xl border bg-muted/20 p-4"><p className="text-sm text-muted-foreground">{copy.responsePending}</p><Button size="sm" variant="secondary" disabled={pending} onClick={() => onMaterialize(workItemId, sourceRevision)}>{copy.responseLoad}</Button></div>;
  return <section className="mx-4 mb-4 space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4" aria-label={copy.responseReady}>
    <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{copy.responseReady}</h3><span className="rounded-full border bg-background px-2 py-0.5 text-xs text-muted-foreground">v{item.sourceRevision}.{item.revision}</span></div>
    <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{copy.responseAnalysis}</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{item.analysis}</p></div>
    {item.risks.length || item.uncertainties.length ? <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm"><AlertTriangle className="mr-1 inline size-4 text-amber-500" />{[...item.risks, ...item.uncertainties].join("；")}</div> : null}
    <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{copy.responseReply}</p><div className="mt-1 whitespace-pre-wrap rounded-lg border bg-background p-3 text-sm leading-6">{item.proposedReply}</div></div>
    {item.candidateOutputAssets?.length ? <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{copy.attachments}</p><div className="mt-1 space-y-1">{item.candidateOutputAssets.map((asset) => <div key={`${asset.worktreeId ?? "project"}:${asset.relativePath}`} className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm"><Paperclip className="size-4 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{asset.name}</span>{asset.size != null ? <span className="text-xs text-muted-foreground">{formatBytes(asset.size)}</span> : null}</div>)}</div></div> : null}
    <div className="flex flex-wrap justify-end gap-2">
      {item.status === "ready_for_review" ? <Button size="sm" variant="secondary" disabled={pending} onClick={() => onReview(item, "request_changes")}>{copy.responseRevise}</Button> : null}
      {item.status === "ready_for_review" ? <Button size="sm" disabled={pending} onClick={() => onReview(item, "approve")}><ShieldCheck />{copy.responseApprove}</Button> : null}
      {item.status === "approved" ? <Button size="sm" disabled={pending} onClick={() => onDraft(item)}><FilePenLine />{copy.responseDraft}</Button> : null}
      {item.status === "draft_created" ? <span className="text-sm text-emerald-600">{copy.responseDrafted}</span> : null}
    </div>
  </section>;
}

function MailTaskOperationsModal({ copy, open, data, policies, projects, loading, pending, canManagePolicies, onSave, onClose }: {
  copy: typeof COPY.zh | typeof COPY.en;
  open: boolean;
  data: MailTaskOperations | null;
  policies: MailTaskPolicy[];
  projects: Array<{ id: string; name: string }>;
  loading: boolean;
  pending: boolean;
  canManagePolicies: boolean;
  onSave: (input: { projectId: string; mode: MailTaskPolicy["mode"]; senderDomains: string[]; maxPerDay: number }) => void;
  onClose: () => void;
}) {
  const [projectId, setProjectId] = useState("");
  const [mode, setMode] = useState<MailTaskPolicy["mode"]>("shadow");
  const [domain, setDomain] = useState("");
  if (!open) return null;
  const metrics = data?.metrics;
  const cards = metrics ? [
    [copy === COPY.zh ? "关联任务" : "Linked tasks", metrics.linkedTasks],
    [copy === COPY.zh ? "待审核" : "Awaiting review", metrics.awaitingReview],
    [copy === COPY.zh ? "需要恢复" : "Recovery needed", metrics.recoveryRequired],
    [copy === COPY.zh ? "已知成本" : "Known cost", `$${metrics.knownCostUsd.toFixed(4)}${metrics.unmeteredCostEntries ? ` + ${metrics.unmeteredCostEntries} ${copy === COPY.zh ? "笔待计量" : "unmetered"}` : ""}`],
    [copy === COPY.zh ? "影子命中" : "Shadow matches", metrics.shadowMatches],
    [copy === COPY.zh ? "已生成草稿" : "Drafts created", metrics.draftsCreated],
  ] : [];
  return <Modal open title={copy.aiConsoleTitle} description={copy.aiConsoleHint} size="lg" onClose={onClose} footer={<Button onClick={onClose}>{copy.close}</Button>}>
    {loading ? <p className="text-sm text-muted-foreground">{copy.syncing}</p> : <div className="space-y-4">
      <div className={cn("rounded-lg border px-3 py-2 text-sm", data?.killSwitchOpen ? "border-amber-500/40 bg-amber-500/5" : "border-emerald-500/40 bg-emerald-500/5")}>{data?.killSwitchOpen ? (copy === COPY.zh ? "自动化总开关已关闭：规则仅运行影子判断。" : "Automation kill switch is open: rules run in shadow only.") : (copy === COPY.zh ? "自动化总开关已启用；发送邮件仍必须人工确认。" : "Automation is enabled; sending still requires human confirmation.")}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{cards.map(([label, value]) => <div key={String(label)} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{value}</p></div>)}</div>
      <div className="space-y-2 rounded-lg border p-3"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{copy === COPY.zh ? "自动处理规则" : "Automation policies"}</h3><span className="text-xs text-muted-foreground">{policies.length}</span></div>{policies.map((policy) => <div key={policy.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/30 px-3 py-2 text-sm"><span className="truncate">{projects.find((project) => project.id === policy.projectId)?.name ?? policy.projectId}{policy.senderDomains.length ? ` · ${policy.senderDomains.join(", ")}` : ""}</span><span className="shrink-0 text-xs text-muted-foreground">{policy.mode} · {policy.maxPerDay}/{copy === COPY.zh ? "天" : "day"}</span></div>)}{canManagePolicies ? <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"><select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="rounded-md border bg-background px-2 py-2 text-sm"><option value="">{copy === COPY.zh ? "选择项目" : "Choose project"}</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><select value={mode} onChange={(event) => setMode(event.target.value as MailTaskPolicy["mode"])} className="rounded-md border bg-background px-2 py-2 text-sm"><option value="shadow">shadow</option><option value="create_only">create_only</option><option value="create_and_run">create_and_run</option><option value="off">off</option></select><input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder={copy === COPY.zh ? "发件域名（可选）" : "Sender domain (optional)"} className="rounded-md border bg-background px-2 py-2 text-sm" /><Button size="sm" disabled={pending || !projectId} onClick={() => onSave({ projectId, mode, senderDomains: domain.trim() ? [domain.trim()] : [], maxPerDay: 20 })}>{copy === COPY.zh ? "添加" : "Add"}</Button></div> : <p className="text-xs text-muted-foreground">{copy === COPY.zh ? "运营角色可查看运行情况；只有所有者或管理员可以修改规则。" : "Operators can inspect runs; only owners and admins can change policies."}</p>}</div>
      <div><h3 className="mb-2 text-sm font-semibold">{copy === COPY.zh ? "最近时间线" : "Recent timeline"}</h3><div className="max-h-64 space-y-2 overflow-y-auto">{data?.timeline.length ? data.timeline.slice(0, 30).map((entry) => <div key={`${entry.kind}:${entry.id}`} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"><span className="min-w-0 truncate">{entry.kind} · {entry.workItemId ?? entry.id}</span><span className="shrink-0 text-xs text-muted-foreground">{entry.status} · r{entry.revision ?? "-"}</span></div>) : <p className="text-sm text-muted-foreground">{copy === COPY.zh ? "暂无邮件任务记录。" : "No mail task activity yet."}</p>}</div></div>
    </div>}
  </Modal>;
}

function DeepOrganizeModal({ copy, open, preview, previewLoading, previewError, job, jobLoading, jobError, pending, onClose, onStart, onCancel }: {
  copy: typeof COPY.zh | typeof COPY.en;
  open: boolean;
  preview: MailSemanticPreview | null;
  previewLoading: boolean;
  previewError: boolean;
  job: MailClassificationJob | null;
  jobLoading: boolean;
  jobError: boolean;
  pending: boolean;
  onClose: () => void;
  onStart: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  const active = jobLoading || Boolean(job && !isClassificationJobTerminal(job.status));
  const progress = job?.total ? Math.min(100, Math.round((job.processed / job.total) * 100)) : 0;
  const unavailable = previewError || (preview && !preview.available);
  const footer = active
    ? <div className="flex justify-end"><Button variant="secondary" onClick={onCancel} disabled={pending}>{pending ? copy.cancellingDeep : copy.cancelDeep}</Button></div>
    : job
      ? <div className="flex justify-end"><Button onClick={onClose}>{copy.close}</Button></div>
      : <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>{copy.close}</Button><Button onClick={onStart} disabled={pending || previewLoading || unavailable || !preview?.pending}><ShieldCheck />{pending ? copy.deepStarting : copy.deepStart}</Button></div>;
  return <Modal open title={copy.deepTitle} description={copy.deepHint} onClose={onClose} closeDisabled={active} footer={footer}>
    {jobLoading ? <p role="status" className="text-sm text-muted-foreground">{copy.deepLoading}</p> : jobError ? <p className="text-sm text-destructive">{copy.deepDegraded}</p> : job ? <div className="space-y-3">
      <p className="text-sm font-medium">{copy.deepProgress.replace("{{processed}}", String(job.processed)).replace("{{total}}", String(job.total))}</p>
      <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div>
      {job.status === "succeeded" ? <p className="text-sm text-emerald-600">{copy.deepCompleted}</p> : null}
      {["degraded", "interrupted"].includes(job.status) ? <p className="text-sm text-destructive">{copy.deepDegraded}</p> : null}
      {job.status === "cancelled" ? <p className="text-sm text-muted-foreground">{copy.deepCancelled}</p> : null}
    </div> : previewLoading ? <p role="status" className="text-sm text-muted-foreground">{copy.deepLoading}</p> : unavailable ? <p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">{preview?.reason === "circuit_open" ? copy.deepCircuit : copy.deepUnavailable}</p> : preview ? <div className="space-y-3 text-sm">
      <p className="font-medium">{preview.pending ? copy.deepEligible.replace("{{count}}", String(preview.pending)) : copy.deepNoPending}</p>
      {preview.oldestDate && preview.newestDate ? <p className="text-xs text-muted-foreground">{copy.deepRange.replace("{{from}}", longDate(preview.oldestDate, copy)).replace("{{to}}", longDate(preview.newestDate, copy))}</p> : null}
      <ul className="space-y-2 rounded-lg border bg-muted/20 p-3 text-muted-foreground">
        <li>• {copy.deepLocal}</li>
        <li>• {copy.deepCachedOnly}</li>
        <li>• {copy.deepNoActions}</li>
      </ul>
      {preview.model ? <p className="text-xs text-muted-foreground">{preview.model}</p> : null}
    </div> : null}
  </Modal>;
}

function ClassificationCorrectionModal({ copy, value, pending, onChange, onClose, onSave }: {
  copy: typeof COPY.zh | typeof COPY.en;
  value: ClassificationCorrectionState | null;
  pending: boolean;
  onChange: (value: ClassificationCorrectionState | null) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  if (!value) return null;
  const views: Array<Exclude<MailSmartView, "all">> = ["needs_attention", "important", "notifications", "subscriptions", "other"];
  return <Modal open title={copy.correctionTitle} description={copy.correctionHint} onClose={onClose} closeDisabled={pending} footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={pending}>{copy.close}</Button><Button onClick={onSave} disabled={pending}>{pending ? copy.correctionSaving : copy.correctionSave}</Button></div>}>
    <label className="block text-sm font-medium">{copy.correctionLabel}<select autoFocus value={value.view} onChange={(event) => onChange({ ...value, view: event.target.value as Exclude<MailSmartView, "all"> })} className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-normal outline-none focus:ring-2 focus:ring-ring">{views.map((view) => <option key={view} value={view}>{copy.smartViews[view]}</option>)}</select></label>
  </Modal>;
}

function MailOrganizeMenuModal({ copy, open, organizing, suggestionCount, onClose, onBasic, onDeep, onRules }: {
  copy: typeof COPY.zh | typeof COPY.en;
  open: boolean;
  organizing: boolean;
  suggestionCount: number;
  onClose: () => void;
  onBasic: () => void;
  onDeep: () => void;
  onRules: () => void;
}) {
  if (!open) return null;
  const actions = [
    { icon: Sparkles, title: organizing ? copy.organizing : copy.organize, description: copy.organizeBasicHint, onClick: onBasic, disabled: organizing },
    { icon: ShieldCheck, title: copy.deepOrganize, description: copy.organizeDeepHint, onClick: onDeep, disabled: false },
    { icon: SlidersHorizontal, title: copy.rules, description: copy.organizeRulesHint, onClick: onRules, disabled: false, count: suggestionCount },
  ];
  return <Modal open title={copy.organizeMenuTitle} description={copy.organizeMenuHint} onClose={onClose} closeDisabled={organizing} footer={<div className="flex justify-end"><Button variant="secondary" onClick={onClose} disabled={organizing}>{copy.close}</Button></div>}>
    <div className="space-y-2">{actions.map((action) => <button key={action.title} type="button" onClick={action.onClick} disabled={action.disabled} className="flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><action.icon className="size-4" /></span><span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-sm font-medium">{action.title}{action.count ? <span aria-label={`${action.count}`} className="rounded-full bg-primary/15 px-1.5 text-xs text-primary">{action.count}</span> : null}</span><span className="mt-0.5 block text-xs text-muted-foreground">{action.description}</span></span><ChevronRight className="size-4 shrink-0 text-muted-foreground" /></button>)}</div>
  </Modal>;
}

function ClassificationRulesModal({ copy, open, data, quality, qualityLoading, qualityError, folderData, automationData, historyJobs, accounts, loading, error, folderLoading, folderError, pendingKey, feedback, folderPending, folderFeedback, folderSelections, onFolderSelection, onFolderPreview, onAutomationPreview, onAutomationAction, onAutomationDryRun, onClose, onRetry, onQualityRetry, onFolderRetry, onEnable, onAction, onEdit }: {
  copy: typeof COPY.zh | typeof COPY.en;
  open: boolean;
  data: { rules: MailClassificationRule[]; suggestions: MailClassificationRuleSuggestion[] } | null;
  quality: MailClassificationQuality | null;
  qualityLoading: boolean;
  qualityError: boolean;
  folderData: { suggestions: MailFolderSuggestion[]; movesSupported: boolean; automationSupported?: boolean } | null;
  automationData: MailFolderAutomation[];
  historyJobs: MailFolderMoveJob[];
  accounts: MailboxAccount[];
  loading: boolean;
  error: boolean;
  folderLoading: boolean;
  folderError: boolean;
  pendingKey: string | null;
  feedback: { tone: "info" | "error"; text: string } | null;
  folderPending: string | null;
  folderFeedback: string | null;
  folderSelections: Record<string, string>;
  onFolderSelection: (suggestionId: string, value: string) => void;
  onFolderPreview: (suggestion: MailFolderSuggestion) => void;
  onAutomationPreview: (suggestion: MailFolderSuggestion) => void;
  onAutomationAction: (automation: MailFolderAutomation, action: "pause" | "resume" | "revoke") => void;
  onAutomationDryRun: (automation: MailFolderAutomation) => void;
  onClose: () => void;
  onRetry: () => void;
  onQualityRetry: () => void;
  onFolderRetry: () => void;
  onEnable: (suggestionId: string) => void;
  onAction: (rule: MailClassificationRule, action: "pause" | "resume" | "revoke") => void;
  onEdit: (rule: MailClassificationRule) => void;
}) {
  if (!open) return null;
  const matchText = (kind: "sender" | "domain", value: string) => (kind === "sender" ? copy.rulesMatchSender : copy.rulesMatchDomain).replace("{{value}}", value);
  const statusText = (status: MailClassificationRule["status"]) => status === "active" ? copy.rulesActive : status === "paused" ? copy.rulesPaused : copy.rulesRevoked;
  const pauseText = (automation: MailFolderAutomation) => automation.nextAction === "resume_when_ready"
    ? copy.folderAutomationPauseUser
    : automation.nextAction === "sync_and_review"
      ? copy.folderAutomationPauseSync
      : automation.nextAction === "review_classification_quality"
        ? copy.folderAutomationPauseQuality
        : automation.nextAction === "enable_rollout"
          ? copy.folderAutomationPauseRollout
          : copy.folderAutomationPauseAuthorize;
  const pending = Boolean(pendingKey);
  const automationReady = quality?.status === "healthy" && quality.organization.status === "healthy" && folderData?.automationSupported === true;
  return <Modal open title={copy.rulesTitle} description={copy.rulesHint} size="lg" onClose={onClose} closeDisabled={pending} footer={<div className="flex justify-end"><Button variant="secondary" onClick={onClose} disabled={pending}>{copy.close}</Button></div>}>
    {loading ? <p role="status" className="text-sm text-muted-foreground">{copy.rulesLoading}</p> : error ? <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"><span>{copy.rulesFailed}</span><Button size="sm" variant="secondary" onClick={onRetry}>{copy.retry}</Button></div> : <div className="space-y-5">
      {feedback ? <div role={feedback.tone === "error" ? "alert" : "status"} className={cn("rounded-lg border px-3 py-2 text-sm", feedback.tone === "error" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-emerald-500/30 bg-emerald-500/5 text-emerald-700")}>{feedback.text}</div> : null}
      <p className="rounded-lg border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">{copy.rulesNoActions}</p>
      <ClassificationQualityPanel copy={copy} quality={quality} loading={qualityLoading} error={qualityError} onRetry={onQualityRetry} />
      <section aria-label={copy.rulesSuggestions}><h3 className="text-sm font-semibold">{copy.rulesSuggestions}</h3>{data?.suggestions.length ? <div className="mt-2 space-y-3">{data.suggestions.map((suggestion) => <article key={suggestion.id} className="rounded-xl border p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="break-all text-sm font-medium">{matchText(suggestion.matchKind, suggestion.matchValue)}</p><p className="mt-1 text-xs text-muted-foreground">{copy.rulesAccount.replace("{{value}}", accountLabel(suggestion.accountId, accounts))}</p><p className="mt-1 text-xs text-muted-foreground">{copy.rulesEvidence.replace("{{count}}", String(suggestion.evidenceCount))} · {copy.smartViews[classificationViewForTarget(suggestion.target)]}</p><p className="mt-1 text-xs text-muted-foreground">{suggestion.affectedCount ? copy.rulesAffected.replace("{{count}}", String(suggestion.affectedCount)) : copy.rulesFutureOnly}</p></div><Button size="sm" onClick={() => onEnable(suggestion.id)} disabled={pending}>{pendingKey === `enable:${suggestion.id}` ? copy.rulesEnabling : copy.rulesEnable}</Button></div>{suggestion.samples.length ? <div className="mt-3 border-t pt-2"><p className="text-xs font-medium">{copy.rulesSamples}</p><ul className="mt-1 space-y-2 text-xs text-muted-foreground">{suggestion.samples.map((sample) => <li key={sample.messageId} className="min-w-0"><p className="truncate text-foreground">{sample.subject || copy.noSubject}</p><p className="truncate">{sample.from}{sample.date ? ` · ${shortDate(sample.date, copy)}` : ""}</p></li>)}</ul></div> : null}</article>)}</div> : <p className="mt-2 text-sm text-muted-foreground">{copy.rulesSuggestionEmpty}</p>}</section>
      <section aria-label={copy.folderSuggestions}><h3 className="text-sm font-semibold">{copy.folderSuggestions}</h3>{folderLoading ? <p role="status" className="mt-2 text-sm text-muted-foreground">{copy.folderSuggestionLoading}</p> : folderError ? <div role="alert" className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"><span>{copy.folderSuggestionFailed}</span><Button size="sm" variant="secondary" onClick={onFolderRetry}>{copy.retry}</Button></div> : <div className="mt-2 space-y-3">{folderFeedback ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{folderFeedback}</div> : null}{folderData?.suggestions.length ? folderData.suggestions.map((suggestion) => {
        const categoryLabel = copy.smartViews[suggestion.destinationCategory];
        const defaultDestination = suggestion.proposedDestination.folderId ?? "__suggested__";
        const selected = folderSelections[suggestion.id] ?? defaultDestination;
        return <article key={suggestion.id} className="rounded-xl border p-3"><div className="min-w-0"><p className="break-all text-sm font-medium">{matchText(suggestion.matchKind, suggestion.matchValue)}</p><p className="mt-1 text-xs text-muted-foreground">{copy.rulesAccount.replace("{{value}}", accountLabel(suggestion.accountId, accounts))}</p><p className="mt-1 text-xs text-muted-foreground">{(suggestion.proposedDestination.kind === "existing" ? copy.folderSuggestedExisting : copy.folderSuggestedNew).replace("{{value}}", suggestion.proposedDestination.name ?? categoryLabel)}</p><p className="mt-1 text-xs text-muted-foreground">{copy.folderAffected.replace("{{count}}", String(suggestion.affectedCount))}</p>{suggestion.protectedCount ? <p className="mt-1 text-xs text-amber-600">{copy.folderProtected.replace("{{count}}", String(suggestion.protectedCount))}</p> : null}{!automationReady ? <p className="mt-1 text-xs text-muted-foreground">{copy.folderAutomationQualityRequired}</p> : null}</div><div className="mt-3 flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-xs font-medium">{copy.folderDestination}<select value={selected} onChange={(event) => onFolderSelection(suggestion.id, event.target.value)} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm font-normal outline-none focus:ring-2 focus:ring-ring">{suggestion.proposedDestination.kind === "new" ? <option value="__suggested__">{copy.folderSuggestedNew.replace("{{value}}", categoryLabel)}</option> : null}{suggestion.folderOptions.map((folder) => <option key={folder.folderId} value={folder.folderId ?? ""}>{folder.name}</option>)}</select></label><Button size="sm" variant="secondary" onClick={() => onFolderPreview(suggestion)} disabled={Boolean(folderPending || pending)}>{folderPending === suggestion.id ? copy.folderPreviewing : copy.folderPreview}</Button><Button size="sm" onClick={() => onAutomationPreview(suggestion)} disabled={Boolean(folderPending || pending || !automationReady)}>{folderPending === `auto:${suggestion.id}` ? copy.folderPreviewing : copy.folderAutomationEnable}</Button></div></article>;
      }) : <p className="text-sm text-muted-foreground">{copy.folderSuggestionEmpty}</p>}</div>}</section>
      <section aria-label={copy.folderAutomationTitle}>
        <h3 className="text-sm font-semibold">{copy.folderAutomationTitle}</h3>
        {automationData.length ? <div className="mt-2 space-y-2">{automationData.map((automation) => <article key={automation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{automation.destination.name ?? automation.destination.folderPath ?? copy.smartViews[automation.destination.category]}</p>
            <p className="mt-1 text-xs text-muted-foreground">{automation.status === "active" ? copy.folderAutomationActive : automation.status === "paused" ? copy.folderAutomationPaused : copy.rulesRevoked}</p>
            {automation.lastSuccessfulAt ? <p className="mt-1 text-xs text-muted-foreground">{copy.folderAutomationLastSuccess.replace("{{time}}", shortDate(automation.lastSuccessfulAt, copy))} · {copy.folderAutomationSuccessStreak.replace("{{count}}", String(automation.consecutiveSuccessfulBatches))}</p> : null}
            {automation.lastCheckedAt ? <p className="mt-1 text-xs text-muted-foreground">{copy.folderAutomationLastChecked.replace("{{time}}", shortDate(automation.lastCheckedAt, copy))}</p> : null}
            {automation.status === "paused" ? <p className="mt-1 text-xs text-amber-600">{pauseText(automation)}</p> : null}
          </div>
          <div className="flex flex-wrap gap-1">
            {automation.status !== "revoked" ? <Button size="sm" variant="secondary" onClick={() => onAutomationDryRun(automation)} disabled={pending}>{pendingKey === `dry:${automation.id}` ? copy.folderAutomationDryRunning : copy.folderAutomationDryRun}</Button> : null}
            {automation.status === "active" ? <Button size="sm" variant="secondary" onClick={() => onAutomationAction(automation, "pause")} disabled={pending}>{copy.rulesPause}</Button> : automation.status === "paused" && automation.pauseReason === "user_paused" ? <Button size="sm" variant="secondary" onClick={() => onAutomationAction(automation, "resume")} disabled={pending}>{copy.rulesResume}</Button> : null}
            {automation.status !== "revoked" ? <Button size="sm" variant="ghost" onClick={() => onAutomationAction(automation, "revoke")} disabled={pending}>{copy.rulesRevoke}</Button> : null}
          </div>
        </article>)}</div> : <p className="mt-2 text-sm text-muted-foreground">{copy.folderAutomationEmpty}</p>}
      </section>
      <section aria-label={copy.folderHistoryTitle}><h3 className="text-sm font-semibold">{copy.folderHistoryTitle}</h3>{historyJobs.length ? <div className="mt-2 divide-y rounded-xl border px-3">{historyJobs.slice(0, 20).map((job) => <div key={job.id} className="flex items-center justify-between gap-3 py-2 text-sm"><div><p className="font-medium">{job.destination.name ?? job.destination.folderPath ?? copy.smartViews[job.destination.category]}</p><p className="text-xs text-muted-foreground">{job.mode === "automatic" ? copy.folderHistoryAutomatic : job.mode === "recovery" ? copy.folderHistoryRecovery : copy.folderHistoryManual} · {shortDate(job.completedAt ?? job.updatedAt, copy)}</p></div><span className={cn("rounded-full px-2 py-1 text-xs", job.status === "succeeded" ? "bg-emerald-500/10 text-emerald-700" : job.status === "moving" ? "bg-muted" : "bg-amber-500/10 text-amber-700")}>{job.status === "succeeded" ? copy.folderHistorySucceeded.replace("{{count}}", String(job.movedCount)) : job.status === "moving" ? copy.folderHistoryMoving : job.status === "recoverable" ? copy.folderHistoryRecoverable.replace("{{count}}", String(job.pendingCount ?? 0)) : copy.folderHistoryNeedsReview}</span></div>)}</div> : <p className="mt-2 text-sm text-muted-foreground">{copy.folderHistoryEmpty}</p>}</section>
      <section aria-label={copy.rulesExisting}><h3 className="text-sm font-semibold">{copy.rulesExisting}</h3>{data?.rules.length ? <div className="mt-2 space-y-2">{data.rules.map((rule) => <article key={rule.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"><div className="min-w-0"><p className="break-all text-sm font-medium">{matchText(rule.matchKind, rule.matchValue)}</p><p className="mt-1 text-xs text-muted-foreground">{copy.rulesAccount.replace("{{value}}", accountLabel(rule.accountId, accounts))}</p><p className="mt-1 text-xs text-muted-foreground">{statusText(rule.status)} · {copy.smartViews[classificationViewForTarget(rule.target)]}</p></div><div className="flex flex-wrap gap-1"><Button size="sm" variant="ghost" onClick={() => onEdit(rule)} disabled={pending}>{copy.rulesEdit}</Button>{rule.status === "active" ? <Button size="sm" variant="secondary" onClick={() => onAction(rule, "pause")} disabled={pending}>{pendingKey === `pause:${rule.id}` ? copy.rulesUpdating : copy.rulesPause}</Button> : <Button size="sm" variant="secondary" onClick={() => onAction(rule, "resume")} disabled={pending}>{pendingKey === `resume:${rule.id}` ? copy.rulesUpdating : copy.rulesResume}</Button>}{rule.status !== "revoked" ? <Button size="sm" variant="ghost" onClick={() => onAction(rule, "revoke")} disabled={pending}>{pendingKey === `revoke:${rule.id}` ? copy.rulesUpdating : copy.rulesRevoke}</Button> : null}</div></article>)}</div> : <p className="mt-2 text-sm text-muted-foreground">{copy.rulesExistingEmpty}</p>}</section>
    </div>}
  </Modal>;
}

function ClassificationQualityPanel({ copy, quality, loading, error, onRetry }: {
  copy: typeof COPY.zh | typeof COPY.en;
  quality: MailClassificationQuality | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  if (loading) return <section aria-label={copy.qualityTitle}><h3 className="text-sm font-semibold">{copy.qualityTitle}</h3><p role="status" className="mt-2 text-sm text-muted-foreground">{copy.qualityLoading}</p></section>;
  if (error || !quality) return <section aria-label={copy.qualityTitle}><h3 className="text-sm font-semibold">{copy.qualityTitle}</h3><div role="alert" className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"><span>{copy.qualityFailed}</span><Button size="sm" variant="secondary" onClick={onRetry}>{copy.retry}</Button></div></section>;
  const title = quality.status === "healthy" ? copy.qualityHealthy : quality.status === "needs_attention" ? copy.qualityNeedsAttention : copy.qualityCollecting;
  const hint = quality.status === "healthy" ? copy.qualityHealthyHint : quality.status === "needs_attention" ? copy.qualityNeedsAttentionHint : copy.qualityCollectingHint.replace("{{count}}", String(quality.minimumSample));
  const metrics = [
    [copy.qualityCoverage, quality.metrics.coverage.value],
    [copy.qualityUnknown, quality.metrics.unknown.value],
    [copy.qualityCorrections, quality.metrics.corrections.value],
    [copy.qualityJobFailures, quality.metrics.jobFailures.value],
  ] as const;
  return <section aria-label={copy.qualityTitle} className="rounded-xl border bg-muted/10 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-semibold">{copy.qualityTitle}</h3><p className="mt-1 text-sm font-medium">{title}</p></div><span className={cn("rounded-full px-2 py-1 text-xs", quality.status === "healthy" ? "bg-emerald-500/10 text-emerald-700" : quality.status === "needs_attention" ? "bg-amber-500/10 text-amber-700" : "bg-muted text-muted-foreground")}>{quality.sampleSize} / {quality.minimumSample}</span></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{hint}</p><dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{metrics.map(([label, value]) => <div key={label} className="rounded-lg border bg-background p-2"><dt className="text-[11px] text-muted-foreground">{label}</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{formatQualityRate(value)}</dd></div>)}</dl><p className="mt-3 text-xs text-muted-foreground">{quality.organization.completedBatches ? copy.qualityMoveResults.replace("{{unconfirmed}}", String(quality.organization.unconfirmedBatches)).replace("{{total}}", String(quality.organization.completedBatches)) : copy.qualityMoveCollecting}</p><p className="mt-1 text-[11px] text-muted-foreground">{copy.qualityPrivacy}</p></section>;
}

function formatQualityRate(value: number | null) {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

function ClassificationRuleEditModal({ copy, value, accountName, pending, feedback, onChange, onClose, onSave }: {
  copy: typeof COPY.zh | typeof COPY.en;
  value: { rule: MailClassificationRule; view: Exclude<MailSmartView, "all"> } | null;
  accountName: string | null;
  pending: boolean;
  feedback: { tone: "info" | "error"; text: string } | null;
  onChange: (value: { rule: MailClassificationRule; view: Exclude<MailSmartView, "all"> } | null) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  if (!value) return null;
  const views: Array<Exclude<MailSmartView, "all">> = ["needs_attention", "important", "notifications", "subscriptions", "other"];
  const match = (value.rule.matchKind === "sender" ? copy.rulesMatchSender : copy.rulesMatchDomain).replace("{{value}}", value.rule.matchValue);
  return <Modal open title={copy.rulesEdit} description={copy.rulesEditing.replace("{{match}}", match)} onClose={onClose} closeDisabled={pending} footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={pending}>{copy.close}</Button><Button onClick={onSave} disabled={pending}>{pending ? copy.rulesUpdating : copy.rulesSave}</Button></div>}>
    <div className="space-y-3">{accountName ? <p className="text-xs text-muted-foreground">{copy.rulesAccount.replace("{{value}}", accountName)}</p> : null}{feedback ? <div role={feedback.tone === "error" ? "alert" : "status"} className={cn("rounded-lg border px-3 py-2 text-sm", feedback.tone === "error" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-emerald-500/30 bg-emerald-500/5 text-emerald-700")}>{feedback.text}</div> : null}
    <label className="block text-sm font-medium">{copy.correctionLabel}<select autoFocus value={value.view} onChange={(event) => onChange({ ...value, view: event.target.value as Exclude<MailSmartView, "all"> })} className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-normal outline-none focus:ring-2 focus:ring-ring">{views.map((view) => <option key={view} value={view}>{copy.smartViews[view]}</option>)}</select></label>
    <p className="text-xs leading-5 text-muted-foreground">{copy.rulesNoActions}</p></div>
  </Modal>;
}

function FolderMovePreviewModal({ copy, value, job, pending, error, accounts, onMove, onConnect, onSync, onClose }: {
  copy: typeof COPY.zh | typeof COPY.en;
  value: MailFolderMovePreview | null;
  job: MailFolderMoveJob | null;
  pending: boolean;
  error: string | null;
  accounts: MailboxAccount[];
  onMove: () => void;
  onConnect: () => void;
  onSync: () => void;
  onClose: () => void;
}) {
  if (!value) return null;
  const categoryLabel = copy.smartViews[value.destination.category];
  const destinationLabel = value.destination.name ?? value.destination.folderPath ?? categoryLabel;
  const terminal = job && ["succeeded", "unconfirmed"].includes(job.status);
  const footer = <div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={pending || job?.status === "moving"}>{copy.close}</Button>{job?.status === "succeeded" || job?.status === "unconfirmed" ? <Button onClick={onSync}><RefreshCw />{copy.sync}</Button> : !job && value.movesSupported ? <Button onClick={onMove} disabled={pending}><Folder />{pending ? copy.folderMoveStarting : copy.folderMoveConfirm.replace("{{count}}", String(value.selectedCount))}</Button> : !job ? <Button onClick={onConnect}><ShieldCheck />{copy.folderMovePermission}</Button> : null}</div>;
  return <Modal open title={copy.folderPreviewTitle} description={copy.folderPreviewHint} size="lg" onClose={onClose} closeDisabled={pending || job?.status === "moving"} footer={footer}>
    <div className="space-y-4">
      <dl className="grid gap-3 rounded-xl border bg-muted/20 p-3 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-muted-foreground">{copy.folderAccount}</dt><dd className="mt-1 font-medium">{accountLabel(value.accountId, accounts)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{copy.folderDestination}</dt><dd className="mt-1 font-medium">{destinationLabel}</dd></div>
      </dl>
      <p className="text-sm font-medium">{copy.folderPreviewCount.replace("{{selected}}", String(value.selectedCount)).replace("{{total}}", String(value.totalMatched))}</p>
      {value.remainingCount ? <p className="text-xs text-muted-foreground">{copy.folderPreviewRemaining.replace("{{count}}", String(value.remainingCount))}</p> : null}
      {!job ? <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-800">{value.movesSupported ? copy.folderPreviewNoMove : `${copy.folderMovePermissionHint} ${copy.folderPreviewNoMove}`}</div> : null}
      {job?.status === "moving" ? <div role="status" className="rounded-lg border bg-muted/30 p-3 text-sm"><RefreshCw className="mr-2 inline size-4 animate-spin" />{copy.folderMoveProgress.replace("{{count}}", String(job.requestedCount))}</div> : null}
      {job?.status === "succeeded" ? <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-800">{copy.folderMoveSuccess.replace("{{count}}", String(job.movedCount))}</div> : null}
      {job?.status === "unconfirmed" ? <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-800">{copy.folderMoveUnconfirmed}</div> : null}
      {error ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div> : null}
      {!terminal && value.samples.length ? <section aria-label={copy.rulesSamples}><h3 className="text-sm font-semibold">{copy.rulesSamples}</h3><ul className="mt-2 max-h-64 divide-y overflow-y-auto rounded-xl border px-3">{value.samples.map((sample) => <li key={sample.messageId} className="py-2 text-sm"><p className="truncate font-medium">{sample.subject || copy.noSubject}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{sample.from}{sample.date ? ` · ${shortDate(sample.date, copy)}` : ""}</p></li>)}</ul></section> : null}
    </div>
  </Modal>;
}

function FolderAutomationPreviewModal({ copy, value, pending, error, accounts, onEnable, onClose }: {
  copy: typeof COPY.zh | typeof COPY.en;
  value: MailFolderMovePreview | null;
  pending: boolean;
  error: string | null;
  accounts: MailboxAccount[];
  onEnable: () => void;
  onClose: () => void;
}) {
  if (!value) return null;
  const destination = value.destination.name ?? value.destination.folderPath ?? copy.smartViews[value.destination.category];
  return <Modal open title={copy.folderAutomationConfirmTitle} description={copy.folderAutomationConfirmHint} onClose={onClose} closeDisabled={pending} footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={pending}>{copy.close}</Button><Button onClick={onEnable} disabled={pending}>{pending ? copy.folderMoveStarting : copy.folderAutomationConfirm}</Button></div>}>
    <div className="space-y-3"><dl className="grid gap-3 rounded-xl border bg-muted/20 p-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">{copy.folderAccount}</dt><dd className="mt-1 font-medium">{accountLabel(value.accountId, accounts)}</dd></div><div><dt className="text-xs text-muted-foreground">{copy.folderDestination}</dt><dd className="mt-1 font-medium">{destination}</dd></div></dl><p className="text-sm">{copy.folderAutomationScope.replace("{{count}}", String(value.selectedCount))}</p><p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-800">{copy.folderAutomationStandingConsent}</p><p className="text-xs text-muted-foreground">{copy.folderAutomationSafety}</p>{error ? <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}</div>
  </Modal>;
}

function FolderMoveRecoveryModal({ copy, value, pending, error, accounts, onSync, onReconcile, onClose }: {
  copy: typeof COPY.zh | typeof COPY.en;
  value: MailFolderMoveJob | null;
  pending: boolean;
  error: string | null;
  accounts: MailboxAccount[];
  onSync: () => void;
  onReconcile: (job: MailFolderMoveJob) => void;
  onClose: () => void;
}) {
  if (!value) return null;
  const destination = value.destination.name ?? value.destination.folderPath ?? copy.smartViews[value.destination.category];
  return <Modal open title={copy.folderMoveRecoveryNotice} description={copy.folderMoveRecoveryHint} onClose={onClose} closeDisabled={pending} footer={<div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={pending}>{copy.close}</Button><Button variant="secondary" onClick={onSync} disabled={pending}><RefreshCw />{copy.sync}</Button>{value.status !== "moving" ? <Button onClick={() => onReconcile(value)} disabled={pending}>{pending ? copy.folderMoveReconciling : copy.folderMoveReconcile}</Button> : null}</div>}>
    <dl className="grid gap-3 rounded-xl border bg-muted/20 p-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">{copy.folderAccount}</dt><dd className="mt-1 font-medium">{accountLabel(value.accountId, accounts)}</dd></div><div><dt className="text-xs text-muted-foreground">{copy.folderDestination}</dt><dd className="mt-1 font-medium">{destination}</dd></div></dl>
    <div role="alert" className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-800">{value.status === "moving" ? copy.folderMoveProgress.replace("{{count}}", String(value.requestedCount)) : value.status === "recoverable" ? copy.folderMoveRecoverable.replace("{{count}}", String(value.pendingCount ?? 0)) : value.status === "conflict" ? copy.folderMoveConflict : copy.folderMoveUnconfirmed}</div>{error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
  </Modal>;
}

function AttachmentPreviewModal({ copy, preview, onClose }: { copy: typeof COPY.zh | typeof COPY.en; preview: AttachmentPreview | null; onClose: () => void }) {
  if (!preview) return null;
  const dataUrl = preview.dataBase64 ? `data:${preview.contentType};base64,${preview.dataBase64}` : null;
  return <Modal open title={copy.previewTitle} description={`${preview.name} · ${formatBytes(preview.size)}`} size="lg" onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>{copy.close}</Button>}><div className="max-h-[65vh] overflow-auto rounded-lg border bg-background p-3">{preview.kind === "text" ? <pre className="whitespace-pre-wrap break-words text-sm">{preview.text}</pre> : preview.kind === "image" && dataUrl ? <img src={dataUrl} alt={preview.name} className="mx-auto max-h-[58vh] max-w-full object-contain" /> : preview.kind === "pdf" && dataUrl ? <iframe title={preview.name} src={dataUrl} className="h-[58vh] w-full border-0" sandbox="" /> : null}</div></Modal>;
}

function ComposeModal({ copy, value, onChange, busy, canSend, onClose, onSave, onReview, onDelete, onPickAttachments, onPasteAttachments, onRemoveAttachment }: { copy: typeof COPY.zh | typeof COPY.en; value: ComposeState | null; onChange: (value: ComposeState | null) => void; busy: string | null; canSend: boolean; onClose: () => void; onSave: () => void; onReview: () => void; onDelete: () => void; onPickAttachments: () => void; onPasteAttachments: (files: File[]) => void; onRemoveAttachment: (ref: string) => void }) {
  if (!value) return null;
  const canAddAttachments = Boolean(window.myagenttoolDesktop?.pickOutboundMailAttachments);
  const update = (field: "to" | "subject" | "body", next: string) => onChange({ ...value, [field]: next });
  return <Modal open title={value.id ? copy.editDraftTitle : copy.composeTitle} description={copy.composeHint} size="lg" onClose={onClose} footer={<div className="flex flex-wrap items-center justify-between gap-2"><div>{value.id ? <Button variant="ghost" onClick={onDelete} disabled={busy === "delete"}>{copy.deleteDraft}</Button> : null}</div><div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={onSave} disabled={busy === "save"}>{busy === "save" ? copy.saving : copy.save}</Button><Button onClick={onReview} disabled={busy === "save" || !canSend}><Send />{copy.reviewSend}</Button></div></div>}><div className="space-y-3" onPaste={(event) => { const files = [...event.clipboardData.files]; if (files.length && canAddAttachments) { event.preventDefault(); onPasteAttachments(files); } }}>{value.sendError ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"><p className="font-medium text-destructive">{copy.sendProblem}</p><p className="mt-1 break-words text-xs text-muted-foreground">{value.sendError}</p></div> : null}<label className="block text-sm font-medium">{copy.to}<input autoFocus value={value.to} onChange={(event) => update("to", event.target.value)} placeholder={copy.toPlaceholder} className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-normal outline-none focus:ring-2 focus:ring-ring" /></label><label className="block text-sm font-medium">{copy.subject}<input value={value.subject} onChange={(event) => update("subject", event.target.value)} placeholder={copy.subjectPlaceholder} className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-normal outline-none focus:ring-2 focus:ring-ring" /></label><label className="block text-sm font-medium">{copy.body}<textarea value={value.body} onChange={(event) => update("body", event.target.value)} placeholder={copy.bodyPlaceholder} className="mt-1 min-h-64 w-full resize-y rounded-md border bg-background px-3 py-2 font-normal leading-6 outline-none focus:ring-2 focus:ring-ring" /></label><section className="rounded-lg border bg-muted/20 p-3" aria-label={copy.attachments}><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-medium">{copy.attachments}</p><p className="text-xs text-muted-foreground">{canAddAttachments ? `${copy.pasteAttachments} · ${copy.attachmentLimit}` : copy.outboundDesktopOnly}</p></div>{canAddAttachments ? <Button type="button" size="sm" variant="secondary" onClick={onPickAttachments}><Paperclip />{copy.addAttachments}</Button> : <DesktopHandoffLink section="mail" action="compose-attachment" compact>{copy === COPY.zh ? "在桌面版添加附件" : "Add in desktop"}</DesktopHandoffLink>}</div>{value.attachments.length ? <div className="mt-3 space-y-2">{value.attachments.map((attachment) => <div key={attachment.ref} className="flex min-w-0 items-center gap-2 rounded-md bg-background px-3 py-2"><Paperclip className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-sm">{attachment.name}</span><span className="text-xs text-muted-foreground">{formatBytes(attachment.size)}</span><button type="button" className="rounded p-1 hover:bg-muted" aria-label={copy.removeAttachment.replace("{{name}}", attachment.name)} onClick={() => onRemoveAttachment(attachment.ref)}><X className="size-4" /></button></div>)}</div> : null}</section>{!canSend ? <p className="text-xs text-muted-foreground">{copy.sendUnavailable}</p> : null}</div></Modal>;
}

function SendReviewModal({ copy, draft, pending, onClose, onSend }: { copy: typeof COPY.zh | typeof COPY.en; draft: MailboxDraft | null; pending: boolean; onClose: () => void; onSend: () => void }) {
  if (!draft) return null;
  return <Modal open title={copy.sendReviewTitle} description={copy.sendReviewHint} size="lg" onClose={onClose} closeDisabled={pending} footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={pending}>{copy.close}</Button><Button onClick={onSend} disabled={pending}><Send />{pending ? copy.sending : copy.sendNow}</Button></div>}><dl className="space-y-3 text-sm"><div><dt className="text-xs text-muted-foreground">{copy.to}</dt><dd className="mt-1 break-words font-medium">{draft.to}</dd></div><div><dt className="text-xs text-muted-foreground">{copy.subject}</dt><dd className="mt-1 break-words font-medium">{draft.subject || copy.noSubject}</dd></div><div><dt className="text-xs text-muted-foreground">{copy.body}</dt><dd className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border bg-background p-3 leading-6">{draft.body}</dd></div>{draft.attachments?.length ? <div><dt className="text-xs text-muted-foreground">{copy.attachments}</dt><dd className="mt-1 space-y-1">{draft.attachments.map((attachment) => <div key={attachment.ref} className="flex items-center gap-2 rounded-md border px-3 py-2"><Paperclip className="size-4" /><span className="min-w-0 flex-1 truncate">{attachment.name}</span><span className="text-xs text-muted-foreground">{formatBytes(attachment.size)}</span></div>)}</dd></div> : null}</dl></Modal>;
}

function MailDraftDetailModal({ copy, draft, onClose }: { copy: typeof COPY.zh | typeof COPY.en; draft: MailboxDraft | null; onClose: () => void }) {
  if (!draft) return null;
  const unconfirmed = draft.status === "send_unconfirmed";
  return <Modal open title={copy.deliveryDetails} description={draft.subject || copy.noSubject} size="lg" onClose={onClose} footer={<div className="flex justify-end"><Button variant="secondary" onClick={onClose}>{copy.close}</Button></div>}>
    <dl className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><dt className="text-xs text-muted-foreground">{copy.deliveryStatus}</dt><dd className="mt-1 font-medium">{copy.status[draft.status as keyof typeof copy.status] ?? draft.status}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{copy.updatedAt}</dt><dd className="mt-1 font-medium">{longDate(draft.sentAt ?? draft.updatedAt, copy)}</dd></div>
      </div>
      {draft.sendError ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3"><dt className="font-medium text-destructive">{copy.sendProblem}</dt><dd className="mt-1 break-words text-xs text-muted-foreground">{draft.sendError}</dd>{unconfirmed ? <p className="mt-2 text-xs font-medium">{copy.sendUnconfirmedHint}</p> : null}</div> : null}
      <div><dt className="text-xs text-muted-foreground">{copy.to}</dt><dd className="mt-1 break-words font-medium">{draft.to}</dd></div>
      <div><dt className="text-xs text-muted-foreground">{copy.subject}</dt><dd className="mt-1 break-words font-medium">{draft.subject || copy.noSubject}</dd></div>
      <div><dt className="text-xs text-muted-foreground">{copy.body}</dt><dd className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border bg-background p-3 leading-6">{draft.body}</dd></div>
      {draft.attachments?.length ? <div><dt className="text-xs text-muted-foreground">{copy.attachments}</dt><dd className="mt-1 space-y-1">{draft.attachments.map((attachment) => <div key={attachment.ref} className="flex items-center gap-2 rounded-md border px-3 py-2"><Paperclip className="size-4" /><span className="min-w-0 flex-1 truncate">{attachment.name}</span><span className="text-xs text-muted-foreground">{formatBytes(attachment.size)}</span></div>)}</dd></div> : null}
    </dl>
  </Modal>;
}

function composeFingerprint(value: ComposeState) {
  return JSON.stringify({
    id: value.id,
    to: value.to,
    subject: value.subject,
    body: value.body,
    attachments: value.attachments.map(({ ref, name, contentType, size }) => ({ ref, name, contentType, size })),
    inReplyTo: value.inReplyTo,
    references: value.references,
  });
}

function classificationViewOf(message: MailboxMessage): Exclude<MailSmartView, "all"> {
  const classification = message.classification;
  if (!classification) return "other";
  if (["action_required", "reply_expected"].includes(classification.attention)) return "needs_attention";
  if (classification.attention === "important") return "important";
  if (["newsletter", "marketing"].includes(classification.mailType)) return "subscriptions";
  if (["transaction", "account_security", "calendar", "system_notification"].includes(classification.mailType)) return "notifications";
  return "other";
}

function classificationViewForTarget(target: Pick<MailClassification, "attention" | "mailType">): Exclude<MailSmartView, "all"> {
  if (["action_required", "reply_expected"].includes(target.attention)) return "needs_attention";
  if (target.attention === "important") return "important";
  if (["newsletter", "marketing"].includes(target.mailType)) return "subscriptions";
  if (["transaction", "account_security", "calendar", "system_notification"].includes(target.mailType)) return "notifications";
  return "other";
}

function classificationPatchForView(view: Exclude<MailSmartView, "all">, currentType: MailClassification["mailType"]): Pick<MailClassification, "attention" | "mailType" | "suggestedAction"> {
  if (view === "needs_attention") return { attention: "action_required", mailType: currentType === "unknown" ? "human_conversation" : currentType, suggestedAction: "reply" };
  if (view === "important") return { attention: "important", mailType: currentType, suggestedAction: "read" };
  if (view === "notifications") return { attention: "routine", mailType: "system_notification", suggestedAction: "read" };
  if (view === "subscriptions") return { attention: "low_value", mailType: "newsletter", suggestedAction: "archive_candidate" };
  return { attention: "routine", mailType: "other", suggestedAction: "none" };
}

function accountLabel(accountId: string, accounts: MailboxAccount[]) {
  return accounts.find((account) => account.id === accountId)?.name ?? accountId;
}

function isClassificationJobTerminal(status: MailClassificationJob["status"] | undefined) {
  return status ? ["succeeded", "degraded", "cancelled", "interrupted"].includes(status) : false;
}

function mailboxSender(value: string) {
  const match = /^(.*?)\s*<([^<>]+)>\s*$/.exec(value.trim());
  if (!match) return { name: value.trim() || "—", address: "" };
  const name = match[1].trim().replace(/^"|"$/g, "");
  return { name: name || match[2], address: match[2] };
}

function mailLocale(copy: typeof COPY.zh | typeof COPY.en) { return copy === COPY.zh ? "zh-CN" : "en-US"; }
function shortDate(value: string | null, copy: typeof COPY.zh | typeof COPY.en) { const date = value ? new Date(value) : null; return date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(mailLocale(copy), { month: "short", day: "numeric" }).format(date) : ""; }
function longDate(value: string | null, copy: typeof COPY.zh | typeof COPY.en) { const date = value ? new Date(value) : null; return date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(mailLocale(copy), { dateStyle: "medium", timeStyle: "short" }).format(date) : ""; }
function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; return `${(value / (1024 * 1024)).toFixed(1)} MB`; }
