type TemplateMatchLike = {
  state?: "matched" | "ambiguous" | "missing" | string;
  decision?: { kind?: string; confidence?: string } | null;
} | null;

const LOW_RISK_KNOWLEDGE_WORK_RE = /(?:总结|摘要|分析|拆解|比较|对比|提炼|翻译|润色|改写|标题|大纲|文案|文章|公众号|小红书|口播|脚本|选题|周报草稿|summary|summari[sz]e|analy[sz]e|compare|translate|polish|rewrite|headline|outline|copywriting|article|newsletter|social post|video script|brainstorm)/i;
const EXTERNAL_OR_MUTATING_WORK_RE = /(?:发送|发给|回复客户|发布到|直接发布|上传到|删除|移除|覆盖|付款|支付|下单|退款|转账|修改代码|修复代码|改文件|修改文件|部署|安装|提交代码|合并|send\b|reply to|publish\b|post to|upload to|delete|remove|overwrite|pay\b|purchase|refund|transfer|modify (?:the )?(?:code|file)|fix (?:the )?(?:code|bug)|deploy|install|commit|merge)/i;

/**
 * The user's click on “Let AI handle it” is already explicit authorization
 * for reversible, local knowledge work. Keep a second review step for
 * ambiguous results, attachments, file/code mutations and external actions.
 */
export function canStartLowRiskKnowledgeTaskDirectly({
  goal,
  attachmentCount = 0,
  templateMatch = null,
}: {
  goal: string;
  attachmentCount?: number;
  templateMatch?: TemplateMatchLike;
}) {
  const text = String(goal ?? "").trim();
  if (!text || attachmentCount > 0) return false;
  if (templateMatch?.state === "ambiguous" || templateMatch?.decision?.kind === "confirm_output") return false;
  return LOW_RISK_KNOWLEDGE_WORK_RE.test(text) && !EXTERNAL_OR_MUTATING_WORK_RE.test(text);
}
