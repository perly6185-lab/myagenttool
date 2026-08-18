import { createHash } from "node:crypto";

import { detectPromptInjection } from "@myagenttool/protocol/issue-prompt";

export const MAIL_CLASSIFIER_VERSION = 1;

export const MAIL_ATTENTION_VALUES = Object.freeze([
  "action_required",
  "reply_expected",
  "important",
  "routine",
  "low_value",
  "unknown",
]);

export const MAIL_TYPE_VALUES = Object.freeze([
  "human_conversation",
  "customer_or_project",
  "transaction",
  "account_security",
  "calendar",
  "system_notification",
  "newsletter",
  "marketing",
  "personal",
  "other",
  "unknown",
]);

export const MAIL_SUGGESTED_ACTION_VALUES = Object.freeze([
  "reply",
  "create_task",
  "review_attachment",
  "read",
  "archive_candidate",
  "none",
]);

const ATTENTION = new Set(MAIL_ATTENTION_VALUES);
const TYPES = new Set(MAIL_TYPE_VALUES);
const ACTIONS = new Set(MAIL_SUGGESTED_ACTION_VALUES);

const AUTOMATED_SENDER_RE = /(?:^|[<@._+-])(no[-_.]?reply|do[-_.]?not[-_.]?reply|notification|notifications|notify|mailer|robot|system|service)(?:[>@._+-]|$)/i;
const ACTION_RE = /(?:请(?:尽快)?(?:确认|审批|签署|提交|处理|回复)|待(?:确认|审批|签署|提交|处理|回复)|需要(?:您|你)?(?:确认|审批|签署|提交|处理|回复)|action required|approval required|please (?:confirm|approve|sign|submit|respond|reply)|response required|requires? your action)/i;
const REPLY_RE = /(?:请回复|烦请|能否|是否可以|请问|回复确认|could you|would you|can you|please reply|please respond|let me know|need your (?:input|feedback|confirmation)|\?|？)/i;
const URGENT_RE = /(?:紧急|重要提醒|立即处理|尽快|到期|逾期|urgent|important|immediate(?:ly)?|due (?:today|soon)|overdue|deadline)/i;
const SECURITY_RE = /(?:验证码|登录提醒|安全警报|安全提醒|密码重置|异常登录|验证代码|一次性密码|verification code|security alert|new sign[- ]?in|password reset|one[- ]time (?:code|password)|\botp\b|two-factor|2fa)/i;
const TRANSACTION_RE = /(?:账单|发票|收据|付款|支付|订单|物流|发货|退款|对账|invoice|receipt|payment|order (?:confirmed|confirmation)|shipment|shipping|delivery update|refund|statement)/i;
const CALENDAR_RE = /(?:会议邀请|日程邀请|会议变更|会议取消|calendar invitation|invitation:|meeting (?:invite|updated|cancelled)|accepted:|declined:)/i;
const NEWSLETTER_RE = /(?:newsletter|digest|周刊|月刊|简报|每周精选|unsubscribe|退订)/i;
const MARKETING_RE = /(?:限时|优惠|促销|折扣|立减|新品|会员专享|sale|discount|promotion|special offer|limited[- ]time|exclusive offer)/i;
const CUSTOMER_PROJECT_RE = /(?:客户|项目|交付|验收|需求|报价|询价|合同|customer|client|project|delivery|acceptance|requirement|quotation|quote|rfq|contract)/i;

function bounded(value, max) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function unique(values, max = 8) {
  return [...new Set(values)].slice(0, max);
}

export function mailMessageKey(message) {
  return hash([
    bounded(message?.applicationId, 160),
    bounded(message?.folderId ?? "inbox", 100),
    bounded(message?.messageId, 998),
  ].join("\0"));
}

export function mailHeaderFingerprint(message) {
  const headers = message?.classificationHeaders ?? {};
  return hash(JSON.stringify({
    applicationId: bounded(message?.applicationId, 160),
    folderId: bounded(message?.folderId ?? "inbox", 100),
    messageId: bounded(message?.messageId, 998),
    from: bounded(message?.from, 998),
    subject: bounded(message?.subject, 400),
    date: bounded(message?.date, 100),
    headers: {
      listId: bounded(headers.listId, 255),
      listUnsubscribe: headers.listUnsubscribe === true,
      autoSubmitted: bounded(headers.autoSubmitted, 80).toLowerCase(),
      precedence: bounded(headers.precedence, 80).toLowerCase(),
    },
  }));
}

export function validateMailClassificationPatch(input = {}) {
  const attention = bounded(input.attention, 40);
  const mailType = bounded(input.mailType, 60);
  const suggestedAction = bounded(input.suggestedAction, 40);
  if (!ATTENTION.has(attention) || !TYPES.has(mailType) || !ACTIONS.has(suggestedAction)) return null;
  return { attention, mailType, suggestedAction };
}

export function classifyMailHeader(message = {}) {
  const from = bounded(message.from, 998);
  const subject = bounded(message.subject, 400);
  const text = `${from}\n${subject}`;
  const headers = message.classificationHeaders ?? {};
  const listSignal = Boolean(headers.listId || headers.listUnsubscribe);
  const bulkSignal = /^(?:bulk|list|junk)$/i.test(bounded(headers.precedence, 80));
  const autoSubmitted = bounded(headers.autoSubmitted, 80);
  const automated = AUTOMATED_SENDER_RE.test(from) || (autoSubmitted && !/^no$/i.test(autoSubmitted));
  const injection = detectPromptInjection(subject);
  const reasons = [];

  let mailType = "unknown";
  let attention = "unknown";
  let suggestedAction = "none";
  let confidence = 0.45;

  if (SECURITY_RE.test(text)) {
    mailType = "account_security";
    attention = "important";
    suggestedAction = "read";
    confidence = 0.94;
    reasons.push("account_security_language");
  } else if (CALENDAR_RE.test(text)) {
    mailType = "calendar";
    attention = "important";
    suggestedAction = "read";
    confidence = 0.9;
    reasons.push("calendar_language");
  } else if (TRANSACTION_RE.test(text)) {
    mailType = "transaction";
    attention = ACTION_RE.test(subject) || URGENT_RE.test(subject) ? "action_required" : "routine";
    suggestedAction = attention === "action_required" ? "read" : "none";
    confidence = 0.88;
    reasons.push("transaction_language");
  } else if (listSignal || bulkSignal || NEWSLETTER_RE.test(text)) {
    mailType = MARKETING_RE.test(text) ? "marketing" : "newsletter";
    attention = "low_value";
    suggestedAction = "archive_candidate";
    confidence = listSignal ? 0.96 : bulkSignal ? 0.91 : 0.84;
    reasons.push(listSignal ? "mailing_list_header" : bulkSignal ? "bulk_header" : "newsletter_language");
  } else if (automated) {
    mailType = MARKETING_RE.test(text) ? "marketing" : "system_notification";
    attention = URGENT_RE.test(subject) ? "important" : mailType === "marketing" ? "low_value" : "routine";
    suggestedAction = mailType === "marketing" ? "archive_candidate" : "read";
    confidence = 0.82;
    reasons.push("automated_sender");
  } else {
    if (CUSTOMER_PROJECT_RE.test(text)) {
      mailType = "customer_or_project";
      confidence = 0.76;
      reasons.push("customer_project_language");
    } else if (/^(?:re|回复|答复)\s*:/i.test(subject)) {
      mailType = "human_conversation";
      confidence = 0.72;
      reasons.push("conversation_thread");
    }

    if (ACTION_RE.test(subject)) {
      attention = "action_required";
      suggestedAction = "reply";
      confidence = Math.max(confidence, 0.88);
      reasons.push("action_language");
    } else if (REPLY_RE.test(subject)) {
      attention = "reply_expected";
      suggestedAction = "reply";
      confidence = Math.max(confidence, 0.78);
      reasons.push("reply_language");
    } else if (URGENT_RE.test(subject)) {
      attention = "important";
      suggestedAction = "read";
      confidence = Math.max(confidence, 0.78);
      reasons.push("urgent_language");
    } else if (mailType !== "unknown") {
      attention = "routine";
      suggestedAction = "read";
    }
  }

  if (injection.suspicious) reasons.push("prompt_injection_signal");
  return {
    attention,
    mailType,
    suggestedAction,
    confidence: Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100,
    reasonCodes: unique(reasons),
    explanation: classificationExplanation({ attention, mailType }),
    promptInjectionSignal: injection.suspicious,
  };
}

export function classificationExplanation({ attention, mailType } = {}) {
  if (attention === "action_required") return "主题包含明确的确认、提交或处理要求。";
  if (attention === "reply_expected") return "主题看起来在直接提问或等待回复。";
  if (mailType === "account_security") return "这看起来是账号登录、验证或安全提醒。";
  if (mailType === "calendar") return "这看起来是会议或日程通知。";
  if (mailType === "transaction") return "这看起来是订单、付款、账单或物流回执。";
  if (mailType === "newsletter") return "邮件头或主题显示这是一封订阅邮件。";
  if (mailType === "marketing") return "这看起来是促销或营销邮件。";
  if (mailType === "system_notification") return "发件地址和主题显示这是一封自动通知。";
  if (mailType === "customer_or_project") return "主题包含客户、项目或交付相关信息。";
  if (attention === "important") return "主题包含需要优先阅读的信号。";
  return "目前没有足够信息做出更具体的判断。";
}

export function publicMailClassification(record) {
  if (!record) return null;
  const effective = record.manualOverride ?? record.ruleOverride ?? record;
  const confidence = Number(record.confidence) || 0;
  const source = record.manualOverride ? "manual" : record.ruleOverride ? "rule" : record.stage === "semantic" ? "semantic" : "header";
  return {
    attention: effective.attention,
    mailType: effective.mailType,
    suggestedAction: effective.suggestedAction,
    label: classificationLabel(effective),
    explanation: record.manualOverride
      ? "你已手动调整这封邮件的分类。"
      : record.ruleOverride
        ? "这封邮件匹配了你已启用的个人分类规则。"
        : bounded(record.explanation, 160),
    uncertain: !record.manualOverride && !record.ruleOverride && confidence < 0.85,
    confirmationState: record.confirmationState,
    revision: record.revision,
    source,
    ...(record.appliedRuleId ? { ruleId: record.appliedRuleId } : {}),
  };
}

function classificationLabel(value) {
  if (value.attention === "action_required") return "待处理";
  if (value.attention === "reply_expected") return "待回复";
  if (value.attention === "important") return "重要";
  if (value.mailType === "newsletter") return "订阅";
  if (value.mailType === "marketing") return "推广";
  if (["transaction", "calendar", "system_notification", "account_security"].includes(value.mailType)) return "通知";
  return "其他";
}

export function mailClassificationViewMatches(classification, view) {
  const value = classification?.manualOverride ?? classification?.ruleOverride ?? classification;
  if (!value || !view || view === "all") return true;
  if (view === "needs_attention") return ["action_required", "reply_expected"].includes(value.attention);
  if (view === "important") return value.attention === "important";
  if (view === "notifications") return ["transaction", "account_security", "calendar", "system_notification"].includes(value.mailType)
    && !["action_required", "reply_expected"].includes(value.attention);
  if (view === "subscriptions") return ["newsletter", "marketing"].includes(value.mailType);
  if (view === "other") return !mailClassificationViewMatches(classification, "needs_attention")
    && !mailClassificationViewMatches(classification, "important")
    && !mailClassificationViewMatches(classification, "notifications")
    && !mailClassificationViewMatches(classification, "subscriptions");
  return true;
}
