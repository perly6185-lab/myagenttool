import {
  connectProfessionalTasks,
  PROFESSIONAL_TASK_DEFINITIONS,
  professionalTaskInstanceScopes,
  resolveProfessionalTaskOverlaps,
} from "./professional-task-registry.mjs";

const PLATFORM_PATTERNS = [
  { id: "wechat_official", label: "公众号", pattern: /公众号|微信公众平台|wechat official/i },
  { id: "xiaohongshu", label: "小红书", pattern: /小红书|xiaohongshu|rednote/i },
  { id: "douyin", label: "抖音", pattern: /抖音|douyin|tiktok/i },
  { id: "bilibili", label: "哔哩哔哩", pattern: /哔哩哔哩|b站|bilibili/i },
  { id: "zhihu", label: "知乎", pattern: /知乎|zhihu/i },
  { id: "weibo", label: "微博", pattern: /微博|weibo/i },
];

const TASK_DEFINITIONS = [
  { kind: "coding_digest", domain: "content", label: "编码成果整理", outcome: "形成一份经过脱敏检查、可供后续创作使用的编码成果快照", produces: ["coding_digest"] },
  { kind: "knowledge_analysis", domain: "content", label: "深度分析", outcome: "形成一份可独立使用的深度分析报告", pattern: /(?:深度|系统|全面)(?:分析|研究)|形成(?:一份)?分析报告|(?:先)?看看.{0,12}(?:链接|资料).{0,12}(?:讲了?|说了?|内容)|分析.{0,8}(?:链接|资料)|deep analysis|research report/i, produces: ["analysis_report"] },
  { kind: "content_article", domain: "content", label: "文章创作", outcome: "形成一篇可独立审阅的文章稿件", pattern: /深度文章|长文|公众号文章|技术文章|博客|文章(?:稿件)?|article|long-form|blog/i, produces: ["article_draft"] },
  { kind: "content_image", domain: "content", label: "图片创作", outcome: "形成可独立审阅的封面、配图或图文图片包", pattern: /配图|插图|封面图|图片|图文图片|视觉素材|(?:做|画|生成|准备)\s*[一二三四五六七八九十两\d]{0,3}\s*张?图(?!文)|image|illustration|cover image/i, produces: ["image_set"] },
  { kind: "content_comic", domain: "content", label: "漫画", outcome: "形成可独立审阅的漫画脚本、分镜或成图", pattern: /(?:漫画|条漫|comic|storyboard)/i, produces: ["comic_package"] },
  { kind: "content_voiceover", domain: "content", label: "口播", outcome: "形成可独立审阅的口播稿、音频或字幕", pattern: /(?:口播|播客|配音|voiceover|podcast)/i, produces: ["voiceover_package"] },
  { kind: "content_video", domain: "content", label: "视频", outcome: "形成可独立审阅的视频成品", pattern: /(?:短视频|视频|video)/i, produces: ["video_package"] },
  { kind: "platform_adaptation", domain: "content", label: "平台内容适配", outcome: "形成符合目标平台格式要求、可发布前审阅的内容包", produces: ["platform_package"] },
  { kind: "wechat_draft_sync", domain: "content", label: "保存公众号草稿", outcome: "将一个已适配内容版本保存到指定公众号的草稿箱", externalEffect: true, produces: ["wechat_draft_receipt"] },
  { kind: "content_publish", domain: "content", label: "平台发布", outcome: "将一个已审核内容版本发布到用户指定的平台", pattern: /(?:公开发布|发布到|发到|投放到|群发到|(?:把|将).{0,20}(?:文章|图片|漫画|口播|视频|内容|成品).{0,8}(?:发|发布)|(?:文章|图片|漫画|口播|视频|内容|成品).{0,8}(?:发|发布)(?:到|至|往)?(?:公众号|小红书|抖音|哔哩哔哩|b站|知乎|微博)|publish|post to)/i, requiresApprovedOutput: true, externalEffect: true, produces: ["publication_receipt"] },
  { kind: "software_analysis", domain: "development", label: "需求分析", outcome: "形成可独立确认的需求或问题分析", pattern: /(?:需求分析|问题分析|分析(?:需求|问题|原因)|分析(?:一下)?(?:这个|该|当前)?(?:仓库|项目|系统|代码)|排查(?:一下)?.{0,12}(?:为什么|报错|故障|错误|原因|问题)|看看.{0,16}为什么|技术调研|analy[sz]e requirements|root cause)/i, produces: ["software_analysis"] },
  { kind: "software_implementation", domain: "development", label: "软件实现", outcome: "完成一个边界明确的软件变更", pattern: /(?:(?<!公)开发(?!布)|实现|修改代码|修复代码|修复\s*bug|修(?:掉|好|复).{0,16}(?:问题|故障|错误|bug)|(?:修好|修复)(?=后|再|并|，|,|。|$)|解决.{0,16}(?:问题|故障|错误|bug)|(?:把|将).{0,20}需求.{0,8}(?:做完|完成)|完成(?:这个|该)?需求|implement|fix (?:the )?(?:code|bug))/i, produces: ["software_change"] },
  { kind: "software_verification", domain: "development", label: "软件验证", outcome: "形成独立的测试和验证结果", pattern: /(?:测试|验证|代码审查|test|verify|code review)/i, produces: ["verification_report"] },
  { kind: "software_deployment", domain: "development", label: "部署发布", outcome: "完成一次有明确目标环境的部署", pattern: /(?:部署|上线|发版|deploy|release)/i, externalEffect: true, produces: ["deployment_receipt"] },
  { kind: "business_research", domain: "business", label: "商务调研", outcome: "形成可独立使用的商务调研结果", pattern: /(?:商务调研|客户调研|竞品调研|市场调研|研究.{0,12}竞品|(?:整理|梳理|汇总)(?:一下)?客户资料|客户资料(?:整理|梳理|汇总)|提炼(?:一下)?合同要点|合同要点提炼|business research|market research)/i, produces: ["business_research"] },
  { kind: "business_document", domain: "business", label: "商务材料", outcome: "形成可独立审阅的商务文档", pattern: /(?:(?:准备|制作|撰写|起草|整理|输出|形成|更新|完善|做|写|出(?:一版)?).{0,16}(?:客户方案|报价方案|方案|报价|合同草稿|商务材料|客户汇报|内部汇报|更新说明|跟进邮件|邮件草稿|客户名单|名单|excel|表格)|(?:合同草稿|商务材料|客户汇报|内部汇报|更新说明|邮件草稿)|proposal|quotation|contract draft)/i, produces: ["business_document"] },
  { kind: "business_communication", domain: "business", label: "对外沟通", outcome: "完成一次有明确对象的外部沟通", pattern: /(?:发送邮件|回复客户|联系客户|(?:邮件|报价|方案|名单|文件|资料).{0,12}(?:发|发送|转发)(?:给|至|到).{0,12}(?:客户|销售|同事|负责人|经理|联系人|[\u3400-\u9fff]{1,4}总)|(?:给|向)(?:客户|销售|同事|负责人|经理|联系人|[\u3400-\u9fff]{1,4}总).{0,8}(?:发|发送|转发).{0,8}(?:邮件|消息|报价|方案|文件)|send email|reply to (?:the )?customer)/i, externalEffect: true, produces: ["communication_receipt"] },
  { kind: "business_scheduling", domain: "business", label: "安排日程", outcome: "建立一个时间和参与人明确的日程", pattern: /(?:安排会议|预约会议|安排日程|(?:约|邀请).{0,16}(?:开会|会议|见面|沟通)|(?:会议|见面).{0,10}(?:约|安排)|schedule (?:a )?meeting)/i, externalEffect: true, produces: ["calendar_receipt"] },
  ...PROFESSIONAL_TASK_DEFINITIONS,
];

const DEFAULT_CONTENT_PROPOSAL_KINDS = new Set(["knowledge_analysis", "content_article", "content_image", "content_comic", "content_voiceover", "content_video"]);
const CODING_SOURCE_RE = /(?:今天|今日|本周|这次|刚才|最近|当前).{0,12}(?:编码|代码|开发|提交|commit)|(?:编码|代码|开发|提交|commit).{0,12}(?:工作|成果|记录|内容|过程|变更)/i;
const CONTENT_TARGET_RE = /文章|博客|公众号|小红书|配图|插图|图片|漫画|口播|视频|发布|article|blog|image|video|publish/i;
const CODING_DIGEST_ACTION_RE = /整理|总结|复盘|提炼|汇总|转成|做成|写成|内容化|记录|summari[sz]e|digest|recap/i;
const WECHAT_DRAFT_SYNC_RE = /(?:保存|同步|存入|放到).{0,12}(?:公众号|微信公众平台).{0,8}(?:草稿箱|草稿)|(?:公众号|微信公众平台).{0,12}(?:草稿箱|草稿)/i;
const CONTENT_OUTPUT_KINDS = new Set([
  "content_article", "content_image", "content_comic", "content_voiceover", "content_video",
]);
const CONTENT_KIND_PATTERNS = [
  { kind: "content_article", label: "文章", pattern: /文章|长文|博客|稿件|article|blog/i },
  { kind: "content_image", label: "图片", pattern: /配图|插图|封面图|图片|图文|(?:做|画|生成|准备)\s*[一二三四五六七八九十两\d]{0,3}\s*张?图(?!文)|image|illustration/i },
  { kind: "content_comic", label: "漫画", pattern: /漫画|条漫|comic|storyboard/i },
  { kind: "content_voiceover", label: "口播", pattern: /口播|播客|配音|voiceover|podcast/i },
  { kind: "content_video", label: "视频", pattern: /短视频|视频|video/i },
];

function bounded(value, max = 1_000) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function materialSummary(materials) {
  return (Array.isArray(materials) ? materials : []).slice(0, 10).map((material) => ({
    id: bounded(material?.id, 200) || null,
    contentId: bounded(material?.contentId, 200) || null,
    title: bounded(material?.title, 300) || "未命名资料",
  }));
}

function firstMatch(pattern, statement) {
  const flags = pattern.flags.replace("g", "");
  return new RegExp(pattern.source, flags).exec(statement);
}

function negatedAt(statement, index) {
  return /(?:(?:不要|不用|无需|(?<!分)别|取消|排除|先别|暂不|暂时不|先不)(?:再)?(?:去)?(?:写|创作|生成|整理|改写|润色|做|画|跑|执行|进行|测试|验证|部署|上线|发版|发到?|发送|发布|同步|投放|提交|发起|送审|联系|跟进|催|回复|安排|预约|邀约|处理|开发|实现|修改|修订|审查|审核|审)?(?:一下|一遍|一次)?|(?:暂时|暂且|先|目前|现在)?\s*不(?:写|发|做|跑|测试|验证|部署|上线|提交|送审|联系|跟进|回复|安排|处理|审查|审核|审|$)|(?:^|[，,。；;：:\s])(?:暂时|暂且|先|目前|现在)?\s*(?:不|别|无需))\s*$/i
    .test(statement.slice(Math.max(0, index - 24), index));
}

function excludedAfter(statement, index, length) {
  const after = statement.slice(index + length, index + length + 18);
  return /^(?:这项|这个|它|也|则|就)?\s*(?:(?:暂时|暂且|先|目前|现在)?\s*(?:不要|不用|不再|不做|不提交|不送审|不联系|不跟进|不回复|不安排|先别|别做|暂不做)|(?:暂时|先|后面|以后|稍后)\s*(?:不做|不用做|不提交|再说))/i.test(after);
}

function deferredInsideMatch(value) {
  return /(?:会议|见面).{0,8}(?:下周|改天|以后|回头|稍后)\s*再(?:约|安排)/i.test(value);
}

function requestedMatch(statement, pattern) {
  const flags = [...new Set(`${pattern.flags}g`.split(""))].join("");
  const matcher = new RegExp(pattern.source, flags);
  let match;
  while ((match = matcher.exec(statement))) {
    if (!/(?:不要|不用|无需|暂时不|暂不|先不|先别|(?<!分)别|不)\s*(?:写|画|跑|测试|验证|部署|上线|发|发布|同步|投放|做|提交|发起|送审|联系|跟进|催|回复|安排|预约|邀约|修改|修订|审查|审核|审)/i.test(match[0])
      && !deferredInsideMatch(match[0])
      && !negatedAt(statement, match.index)
      && !excludedAfter(statement, match.index, match[0].length)) return match;
    if (!match[0].length) matcher.lastIndex += 1;
  }
  return null;
}

function definitionRequested(statement, definition) {
  if (!definition?.pattern) return false;
  return Boolean(requestedMatch(statement, definition.pattern));
}

function describesExistingInput(statement, kind) {
  if (kind === "content_article") {
    const saysArticleExists = /(?:文章|稿件)(?:已经|已|本来就|现成)?有了|已有(?:文章|稿件)|现成(?:的)?(?:文章|稿件)|(?:文章|稿件)(?:已经|已)(?:完成|写好|准备好)|(?:把|将)(?:这篇|该篇|现成)?(?:文章|稿件).{0,12}(?:发布|发到|同步|保存|上传|存入)/i.test(statement);
    const asksForArticle = /(?:写|创作|生成|整理|改写|润色|做成|输出).{0,10}(?:文章|稿件)|(?:文章|稿件).{0,8}(?:创作|改写|润色)/i.test(statement);
    return saysArticleExists && !asksForArticle;
  }
  if (kind === "software_verification") {
    const saysVerificationPassed = /(?:已经|已)(?:经|完成)?(?:测试|验证)(?:通过|完成)|(?:测试|验证)(?:已经|已)?通过/i.test(statement);
    const asksForVerification = /(?:跑|执行|进行|补|重新|再|做).{0,8}(?:测试|验证)|(?:测试|验证)(?:一下|一遍|一次|并确认)/i.test(statement);
    return saysVerificationPassed && !asksForVerification;
  }
  if (kind === "legal_contract_review") {
    const saysReviewExists = /(?:合同|协议)(?:已经|已)(?:审完|审查完成|审核完成)|已有(?:合同|协议)?审查报告|按(?:审查|审核)(?:结果|意见|建议).{0,12}(?:修改|修订|改)/i.test(statement);
    const asksForReview = /(?:重新|再|补充|继续).{0,8}(?:审查|审核|检查)|(?:审查|审核|检查).{0,8}(?:一遍|一次|一下)/i.test(statement);
    return saysReviewExists && !asksForReview;
  }
  if (kind === "data_analysis") {
    const saysAnalysisExists = /(?:数据|销售|经营|业务)?分析(?:已经|已)(?:完成|做完)|(?:已有|现成)(?:数据|销售|经营|业务)?分析(?:报告|结果)|(?:数据|销售|经营|业务)?分析(?:报告|结果)(?:已有|现成)|根据(?:分析报告|分析结果).{0,12}(?:生成|制作|绘制|输出|做).{0,6}(?:图|图表|看板)/i.test(statement);
    const asksForAnalysis = /(?:重新|再|补充|继续).{0,8}(?:分析|统计|洞察)/i.test(statement);
    return saysAnalysisExists && !asksForAnalysis;
  }
  if (kind === "finance_reconciliation") {
    const saysReconciliationExists = /根据(?:对账差异|对账结果|对账报告)|已有对账(?:差异|结果|报告)|对账(?:已经|已)(?:完成|做完)/i.test(statement);
    const asksForReconciliation = /(?:重新|再|补充|继续).{0,8}(?:对账|核对)/i.test(statement);
    return saysReconciliationExists && !asksForReconciliation;
  }
  return false;
}

export function platformTargetsIn(statement) {
  const matches = PLATFORM_PATTERNS.map((platform) => platformTargetMatch(statement, platform))
    .filter(Boolean).sort((left, right) => left.index - right.index);
  return matches.map(({ id, label }) => ({ id, label }));
}

function platformTargetMatch(statement, platform) {
  const flags = [...new Set(`${platform.pattern.flags}g`.split(""))].join("");
  const matcher = new RegExp(platform.pattern.source, flags);
  let match;
  while ((match = matcher.exec(statement))) {
    const before = statement.slice(Math.max(0, match.index - 16), match.index);
    const after = statement.slice(match.index + match[0].length, match.index + match[0].length + 12);
    const contentDescriptor = /^(?:风格|格式|文章|稿件|排版|标题)/i.test(after)
      && !/(?:发布到|发到|投放到|同步到|保存到|上传到|群发到)\s*$/i.test(before);
    if (!contentDescriptor && !negatedAt(statement, match.index)) {
      return { id: platform.id, label: platform.label, index: match.index, length: match[0].length };
    }
    if (!match[0].length) matcher.lastIndex += 1;
  }
  return null;
}

function hasPlatformAlternative(statement, platforms) {
  if (platforms.length < 2) return false;
  const indexed = platforms.map((platform) => {
    const match = firstMatch(PLATFORM_PATTERNS.find((candidate) => candidate.id === platform.id)?.pattern, statement);
    return { ...platform, index: match?.index ?? -1, length: match?.[0]?.length ?? 0 };
  }).filter((platform) => platform.index >= 0).sort((left, right) => left.index - right.index);
  return indexed.some((platform, index) => {
    const next = indexed[index + 1];
    return next && /(?:或|或者|还是|二选一|任选其一|\/)/.test(statement.slice(platform.index + platform.length, next.index));
  });
}

function contentKindsIn(statement, allowedKinds = null) {
  const allowed = allowedKinds ? new Set(allowedKinds) : null;
  return CONTENT_KIND_PATTERNS
    .filter((entry) => (!allowed || allowed.has(entry.kind)) && requestedMatch(statement, entry.pattern))
    .map((entry) => entry.kind);
}

function normalizedPublicationAssignments(assignments, platforms, contentKinds) {
  const platformById = new Map(platforms.map((platform) => [platform.id, platform]));
  const allowedKinds = new Set(contentKinds);
  const byPlatform = new Map();
  for (const assignment of Array.isArray(assignments) ? assignments : []) {
    const platformId = bounded(assignment?.platform?.id ?? assignment?.platformId, 80);
    if (!platformById.has(platformId)) continue;
    const selected = (assignment?.contentKinds ?? []).filter((kind) => allowedKinds.has(kind));
    if (!selected.length) continue;
    byPlatform.set(platformId, {
      platform: platformById.get(platformId),
      contentKinds: [...new Set([...(byPlatform.get(platformId)?.contentKinds ?? []), ...selected])],
    });
  }
  return [...byPlatform.values()];
}

/**
 * Reads an explicit user mapping such as “文章发公众号，图片发小红书”.
 * A phrase that merely lists outputs and platforms in separate clauses is
 * intentionally not treated as a mapping; the caller should ask one question.
 */
export function publicationAssignmentsIn(statement, { platforms = null, contentKinds = null } = {}) {
  const value = bounded(statement, 4_000);
  const availablePlatforms = Array.isArray(platforms) ? platforms : platformTargetsIn(value);
  const availableKinds = Array.isArray(contentKinds) ? contentKinds : contentKindsIn(value);
  if (!value || !availablePlatforms.length || !availableKinds.length) return [];

  const allToAll = /^(?:全部|所有)(?:内容|成品)?都?(?:发|发布|适配)$/i.test(value)
    || /(?:全部|所有)(?:内容|成品)?都?(?:发|发布|适配)到/i.test(value)
    || /(?:全部|所有|这些|以上|两种|几种).{0,8}(?:内容|成品)?(?:都|全部)?(?:发|发布|适配).{0,12}(?:全部|所有|这些|以上|两个|各个)?平台|(?:都|全部)(?:发|发布|适配)到(?:这|以上|全部|所有|两个|各个)/i.test(value);
  if (allToAll) {
    return availablePlatforms.map((platform) => ({ platform, contentKinds: [...availableKinds] }));
  }

  const assignments = [];
  const clauses = value.split(/[；;。\n]|，(?=[^，]{0,30}(?:发|发布|适配|同步|公众号|小红书|抖音|哔哩哔哩|知乎|微博))/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  for (const clause of clauses) {
    const clausePlatforms = availablePlatforms.filter((platform) =>
      PLATFORM_PATTERNS.find((entry) => entry.id === platform.id)?.pattern.test(clause));
    const clauseKinds = contentKindsIn(clause, availableKinds);
    if (!clausePlatforms.length || !clauseKinds.length) continue;
    for (const platform of clausePlatforms) assignments.push({ platform, contentKinds: clauseKinds });
  }
  return normalizedPublicationAssignments(assignments, availablePlatforms, availableKinds);
}

const ARTIFACT_FORMATS = {
  coding_digest: { extensions: [".md", ".txt"], families: ["markdown", "text"] },
  analysis_report: { extensions: [".md", ".txt", ".docx", ".pdf"] },
  article_draft: {
    extensions: [".md", ".txt", ".docx", ".pdf"],
    quality: { minChars: 800, minSections: 3 },
  },
  image_set: { extensions: [".png", ".jpg", ".jpeg", ".webp", ".gif"], families: ["image"] },
  comic_package: {
    extensions: [".png", ".jpg", ".jpeg", ".webp", ".md", ".pdf"],
    quality: { minPages: 4 },
  },
  voiceover_package: {
    extensions: [".mp3", ".wav", ".m4a", ".aac", ".md", ".txt"],
    quality: { minDurationSeconds: 30 },
  },
  video_package: {
    extensions: [".mp4", ".mov", ".webm", ".mkv"],
    families: ["video"],
    quality: { minWidth: 1280, minHeight: 720 },
  },
  platform_package: { extensions: [".md", ".txt", ".json", ".zip"] },
  wechat_article_package: { extensions: [".json"], families: ["text"] },
  wechat_draft_receipt: { extensions: [".json"] },
  software_analysis: { extensions: [".md", ".txt", ".pdf"] },
  software_change: { extensions: [".diff", ".patch", ".zip", ".md", ".txt"] },
  verification_report: { extensions: [".json", ".md", ".txt", ".xml"] },
  deployment_receipt: { extensions: [".json", ".md", ".txt"] },
  business_research: { extensions: [".md", ".txt", ".docx", ".pdf", ".xlsx"] },
  business_document: { extensions: [".md", ".txt", ".docx", ".pdf", ".xlsx"] },
  communication_receipt: { extensions: [".json", ".md", ".txt"] },
  calendar_receipt: { extensions: [".json", ".md", ".txt", ".ics"] },
  publication_receipt: { extensions: [".json", ".md", ".txt"] },
  candidate_shortlist: { extensions: [".xlsx", ".csv", ".md", ".docx", ".pdf"] },
  interview_schedule_receipt: { extensions: [".ics", ".json", ".md", ".txt"] },
  reconciliation_report: { extensions: [".xlsx", ".csv", ".md", ".docx", ".pdf"] },
  payment_request_draft: { extensions: [".md", ".docx", ".pdf"] },
  payment_request_receipt: { extensions: [".json", ".md", ".pdf"] },
  contract_review: { extensions: [".md", ".docx", ".pdf"] },
  legal_document: { extensions: [".docx", ".pdf", ".md"] },
  support_triage: { extensions: [".xlsx", ".csv", ".md"] },
  customer_response_draft: { extensions: [".md", ".txt", ".docx"] },
  procurement_comparison: { extensions: [".xlsx", ".csv", ".md", ".pdf"] },
  procurement_request_draft: { extensions: [".md", ".docx", ".pdf"] },
  procurement_request_receipt: { extensions: [".json", ".md", ".pdf"] },
  sales_pipeline: { extensions: [".xlsx", ".csv", ".json"] },
  sales_followup_receipt: { extensions: [".json", ".md", ".txt"] },
  retrospective_report: { extensions: [".md", ".docx", ".pdf"] },
  presentation_deck: { extensions: [".pptx", ".pdf"] },
  translated_document: { extensions: [".docx", ".pdf", ".md", ".txt"] },
  data_analysis_report: { extensions: [".xlsx", ".csv", ".md", ".docx", ".pdf"] },
  data_visualization_package: { extensions: [".xlsx", ".png", ".jpg", ".pdf", ".html"] },
};

function requestedCount(statement, kind) {
  if (kind !== "content_image") return 1;
  const match = statement.match(/(?:做|生成|创作|准备|要)?\s*([一二三四五六七八九十两\d]{1,3})\s*(?:张|幅|套|个)?(?:配图|插图|图片|封面)/);
  if (!match) return 1;
  const chinese = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  return Math.min(100, Math.max(1, Number(match[1]) || chinese[match[1]] || 1));
}

function artifactRequirements(definition, statement, produces = definition.produces ?? []) {
  return produces.map((kind) => ({
    kind,
    minCount: requestedCount(statement, definition.kind),
    ...(ARTIFACT_FORMATS[kind] ?? {}),
  }));
}

function taskFrom(definition, { intentId, statement, sources, key = definition.kind, title = definition.label,
  platform = null, requires = [], consumes = [], produces = null, approvalRequired = null, gate = null,
  executionInstructions = null, instanceScope = null } = {}) {
  const outputKinds = produces ?? definition.produces ?? [];
  return {
    key,
    kind: definition.kind,
    domain: definition.domain,
    title,
    outcome: platform ? `${definition.outcome}：${platform.label}` : definition.outcome,
    intentId,
    intentStatement: statement,
    creationBasis: "explicit_user_intent",
    planningHorizon: "committed",
    sourceContentIds: sources.map((source) => source.contentId).filter(Boolean),
    sourceTitles: sources.map((source) => source.title),
    requires: [...new Set(requires)],
    artifactContract: {
      consumes: [...new Set(consumes)],
      produces: [...outputKinds],
      requirements: artifactRequirements(definition, statement, outputKinds),
      ...(["software_implementation", "software_verification"].includes(definition.kind)
        ? { verification: { requiredKinds: ["test", "build"] } }
        : {}),
    },
    platform,
    ...(instanceScope ? { instanceScope } : {}),
    approvalRequired: approvalRequired ?? Boolean(definition.externalEffect || definition.requiresApprovedOutput),
    gate: gate ?? (definition.requiresApprovedOutput ? "approved_output_required" : definition.externalEffect ? "external_effect_approval" : null),
    ...(executionInstructions ? { executionInstructions } : {}),
  };
}

function topologicallyOrderedTasks(tasks) {
  const pending = [...tasks];
  const ordered = [];
  const created = new Set();
  while (pending.length) {
    const index = pending.findIndex((task) => (task.requires ?? []).every((key) => created.has(key)));
    if (index < 0) return tasks;
    const [task] = pending.splice(index, 1);
    ordered.push(task);
    created.add(task.key);
  }
  return ordered;
}

function professionalActionClarification(statement, tasks) {
  if (tasks.length || !/(?:合同|协议|客户|数字|数据|简历|候选人|发票|流水|供应商|工单|投诉|商机|CRM)/i.test(statement)) return null;
  // A concrete file mutation already has an executable, preview-gated path in
  // Channel. Business nouns in its surrounding explanation (for example
  // “客户已确认，把 orders.csv 的状态改成已下单”) must not downgrade that
  // precise operation into a generic professional-intent question.
  if (/(?:\.csv\b|\.xlsx?\b|文件|表格|工作簿|sheet)/i.test(statement)
    && /(?:修改|更新|删除|清空|新增|追加|覆盖|替换|回填|写入|写回|移动|重命名|改(?:一下|为|成)|调整|纠正|同步回)/i.test(statement)) return null;
  if (/(?:整理|汇总|归类|分类|提取|筛选).{0,20}(?:合同|协议|客户|数字|数据|简历|候选人|发票|流水|供应商|工单|投诉|商机|CRM)|(?:合同|协议|客户|数字|数据|简历|候选人|发票|流水|供应商|工单|投诉|商机|CRM).{0,20}(?:整理|汇总|归类|分类|提取|筛选)/i.test(statement)) return null;
  if (!/(?:处理|看看|看一下|弄一下|搞一下|怎么办|做一下|帮我|这些|这批)/i.test(statement)) return null;
  return {
    kind: "professional_action",
    prompt: "我看到了你要处理的业务资料，但还不确定要得到什么结果。请直接说希望我做什么，例如“审查合同风险”“分析数据趋势”或“整理客户方案”。",
  };
}

function requiresPlatformAccountChoice(statement, platforms, providedTargets) {
  if (!/(?:第[一二三四五六七八九十\d]+个|另一个|其他账号|公司(?:的)?).{0,8}(?:公众号|微信公众平台|小红书|抖音|知乎|微博)/i.test(statement)) return false;
  if (Array.isArray(providedTargets) && providedTargets.some((target) => target?.accountId || target?.applicationId)) return false;
  return platforms.length > 0;
}

export function proposeNextTasks({ domain = "content", materials = [] } = {}) {
  const selected = domain === "content"
    ? TASK_DEFINITIONS.filter((definition) => DEFAULT_CONTENT_PROPOSAL_KINDS.has(definition.kind))
    : TASK_DEFINITIONS.filter((definition) => definition.domain === domain && !definition.externalEffect);
  const sources = materialSummary(materials);
  return selected.map((definition) => ({
    id: `proposal_${definition.kind}`,
    kind: definition.kind,
    label: definition.label,
    outcome: definition.outcome,
    state: "suggested",
    createsTask: false,
    sourceContentIds: sources.map((source) => source.contentId).filter(Boolean),
  }));
}

export function planDiscreteTasks({
  text,
  domain = null,
  materials = [],
  intentId = null,
  platformTargets = null,
  publicationAssignments = null,
  excludeKinds = [],
  excludeTaskKeys = [],
} = {}) {
  const statement = bounded(text, 4_000);
  const sources = materialSummary(materials);
  const resolvedIntentId = bounded(intentId, 200) || null;
  const platforms = Array.isArray(platformTargets) ? platformTargets : platformTargetsIn(statement);
  const excluded = new Set((Array.isArray(excludeKinds) ? excludeKinds : [])
    .map((kind) => bounded(kind, 80))
    .filter(Boolean));
  const excludedKeys = new Set((Array.isArray(excludeTaskKeys) ? excludeTaskKeys : [])
    .map((key) => bounded(key, 160))
    .filter(Boolean));
  const isCodingSource = CODING_SOURCE_RE.test(statement) && CONTENT_TARGET_RE.test(statement);
  const tasks = [];
  const add = (kind, options = {}) => {
    const definition = TASK_DEFINITIONS.find((candidate) => candidate.kind === kind);
    const key = options.key ?? definition?.kind;
    if (!definition || excluded.has(kind) || excludedKeys.has(key) || (domain && definition.domain !== domain)) return;
    tasks.push(taskFrom(definition, { intentId: resolvedIntentId, statement, sources, ...options }));
  };

  if (statement && isCodingSource && CODING_DIGEST_ACTION_RE.test(statement)) add("coding_digest");
  for (const definition of TASK_DEFINITIONS) {
    if (!definitionRequested(statement, definition)) continue;
    if (describesExistingInput(statement, definition.kind)) continue;
    if (definition.kind === "content_publish" || (definition.kind === "software_implementation" && isCodingSource)) continue;
    const instanceScopes = professionalTaskInstanceScopes(statement, definition.kind);
    if (instanceScopes.length > 1) {
      instanceScopes.forEach((instanceScope, index) => add(definition.kind, {
        key: `${definition.kind}:${index + 1}`,
        title: `${instanceScope} · ${definition.label}`,
        instanceScope,
      }));
      continue;
    }
    if (tasks.some((task) => task.kind === definition.kind)) continue;
    add(definition.kind);
  }
  if (tasks.some((task) => task.kind === "procurement_quote_comparison")
    && !tasks.some((task) => task.kind === "procurement_approval_draft")
    && /(?:申请单|审批单).{0,10}(?:准备|起草|整理|创建)(?:好|一份)?|(?:准备|起草|整理|创建).{0,10}(?:申请单|审批单)/i.test(statement)) {
    add("procurement_approval_draft");
  }
  if (tasks.some((task) => task.kind === "finance_payment_request")
    && !tasks.some((task) => task.kind === "finance_payment_request_draft")
    && /(?:准备|起草|整理).{0,8}(?:申请|申请单).{0,12}(?:提交|发起|送审|走).{0,8}(?:付款|支付|报销)/i.test(statement)) {
    add("finance_payment_request_draft");
  }
  if (!tasks.some((task) => task.kind === "legal_document_revision")
    && /(?:合同|协议)/i.test(statement)
    && /(?:按|根据).{0,16}(?:意见|建议|结果).{0,12}(?:直接|重新|再)?(?:改|修改|修订)(?:一版|一下)?|(?:直接|重新|再)(?:改|修改|修订)(?:一版|一下)/i.test(statement)
    && !/(?:不要|不用|无需|先别|暂不|先不).{0,4}(?:改|修改|修订)/i.test(statement)) {
    add("legal_document_revision");
  }
  resolveProfessionalTaskOverlaps(tasks, statement);

  const digest = tasks.find((task) => task.kind === "coding_digest");
  const analysis = tasks.find((task) => task.kind === "knowledge_analysis");
  const article = tasks.find((task) => task.kind === "content_article");
  const image = tasks.find((task) => task.kind === "content_image");
  const creativeOutputs = tasks.filter((task) => CONTENT_OUTPUT_KINDS.has(task.kind));
  if (digest) {
    for (const output of creativeOutputs) {
      output.requires = [digest.key];
      output.artifactContract.consumes = ["coding_digest"];
    }
  }
  const imageAfterArticle = /(?:文章|稿件).{0,8}(?:确认|审核|通过|满意|完成|写好).{0,5}(?:后|再).{0,8}(?:图片|配图|插图|封面)/i.test(statement);
  const imageUsesArticle = Boolean(article && image && (
    /(?:文章|稿件).{0,20}(?:配图|插图|封面)/i.test(statement)
    || /(?:根据|基于|按照|围绕)(?:这篇|该篇|上述|前面的|刚才的)?(?:文章|稿件).{0,10}(?:图片|配图|插图|封面)/i.test(statement)
    || /(?:为|给)(?:这篇|该篇|上述|前面的|刚才的)?(?:文章|稿件)(?:做|生成|准备|创作)?(?:图片|配图|插图|封面)/i.test(statement)
    || imageAfterArticle
  ));
  if (imageUsesArticle) {
    image.requires = [article.key];
    image.artifactContract.consumes = ["article_draft"];
    if (imageAfterArticle) {
      image.approvalRequired = true;
      image.gate = "upstream_review_required";
    }
  }

  const articleAfterAnalysis = Boolean(analysis && article
    && /(?:先|先行).{0,20}(?:看看|分析|研究).{0,30}(?:觉得|确认|判断).{0,8}(?:合适|可用|通过).{0,8}(?:再|才).{0,8}(?:写|做|整理).{0,6}文章/i.test(statement));
  if (articleAfterAnalysis) {
    article.requires = [analysis.key];
    article.artifactContract.consumes = ["analysis_report"];
    article.approvalRequired = true;
    article.gate = "upstream_review_required";
  }
  const imageAfterAnalysis = Boolean(analysis && image
    && /(?:先|先行).{0,20}(?:看看|分析|研究).{0,30}(?:觉得|确认|判断|如果|要是)?.{0,8}(?:合适|可用|通过).{0,8}(?:再|才).{0,8}(?:做|画|生成|准备).{0,6}(?:图片|配图|插图|封面|图)/i.test(statement));
  if (imageAfterAnalysis) {
    image.requires = [analysis.key];
    image.artifactContract.consumes = ["analysis_report"];
    image.approvalRequired = true;
    image.gate = "upstream_review_required";
  }

  const softwareAnalysis = tasks.find((task) => task.kind === "software_analysis");
  const softwareImplementation = tasks.find((task) => task.kind === "software_implementation");
  const softwareVerification = tasks.find((task) => task.kind === "software_verification");
  const softwareDeployment = tasks.find((task) => task.kind === "software_deployment");
  if (softwareAnalysis && softwareImplementation) {
    softwareImplementation.requires = [softwareAnalysis.key];
    softwareImplementation.artifactContract.consumes = ["software_analysis"];
  }
  if (softwareImplementation && softwareVerification) {
    softwareVerification.requires = [softwareImplementation.key];
    softwareVerification.artifactContract.consumes = ["software_change"];
  }
  if (softwareDeployment && softwareVerification) {
    softwareDeployment.requires = [softwareVerification.key];
    softwareDeployment.artifactContract.consumes = ["verification_report"];
  } else if (softwareDeployment && softwareImplementation) {
    softwareDeployment.requires = [softwareImplementation.key];
    softwareDeployment.artifactContract.consumes = ["software_change"];
  }
  if (softwareAnalysis && article
    && /(?:分析结果|分析报告|排查结果|调研结果).{0,16}(?:整理|写|改写|做成|转成|输出).{0,8}(?:文章|博客|稿件)/i.test(statement)) {
    article.requires = [softwareAnalysis.key];
    article.artifactContract.consumes = ["software_analysis"];
  }

  const businessResearch = tasks.find((task) => task.kind === "business_research");
  const businessDocument = tasks.find((task) => task.kind === "business_document");
  const businessCommunication = tasks.find((task) => task.kind === "business_communication");
  if (businessResearch && businessDocument
    && /(?:调研|研究|整理|提炼).{0,30}(?:后|再|然后|之后|基于|根据).{0,20}(?:方案|报价|材料|汇报|邮件|说明)/i.test(statement)) {
    businessDocument.requires = [businessResearch.key];
    businessDocument.artifactContract.consumes = ["business_research"];
  }
  if (businessDocument && businessCommunication) {
    businessCommunication.requires = [businessDocument.key];
    businessCommunication.artifactContract.consumes = ["business_document"];
  }
  connectProfessionalTasks(tasks);

  const contentOutputs = tasks.filter((task) => CONTENT_OUTPUT_KINDS.has(task.kind));
  const publishRequested = !excluded.has("content_publish")
    && !excluded.has("platform_adaptation")
    && definitionRequested(statement, TASK_DEFINITIONS.find((definition) => definition.kind === "content_publish"));
  const draftSyncRequested = WECHAT_DRAFT_SYNC_RE.test(statement);
  const platformAlternative = publishRequested && !Array.isArray(platformTargets) && hasPlatformAlternative(statement, platforms);
  const platformAccountChoice = (publishRequested || draftSyncRequested)
    && requiresPlatformAccountChoice(statement, platforms, platformTargets);
  const explicitAssignments = normalizedPublicationAssignments(
    publicationAssignments ?? publicationAssignmentsIn(statement, {
      platforms,
      contentKinds: contentOutputs.map((task) => task.kind),
    }),
    platforms,
    contentOutputs.map((task) => task.kind),
  );
  const needsContentMapping = (publishRequested || draftSyncRequested)
    && platforms.length > 0
    && contentOutputs.length > 1
    && explicitAssignments.length === 0;
  const automaticAssignments = contentOutputs.length === 1
    ? platforms.map((platform) => ({ platform, contentKinds: [contentOutputs[0].kind] }))
    : explicitAssignments;
  const assignmentByPlatform = new Map(automaticAssignments.map((assignment) => [assignment.platform.id, assignment]));
  if ((publishRequested || draftSyncRequested) && platforms.length && !platformAlternative && !platformAccountChoice && !needsContentMapping) {
    for (const platform of platforms) {
      if (draftSyncRequested && !publishRequested && platform.id !== "wechat_official") continue;
      const assignedKinds = assignmentByPlatform.get(platform.id)?.contentKinds ?? [];
      const assignedOutputs = assignedKinds.length
        ? contentOutputs.filter((task) => assignedKinds.includes(task.kind))
        : [];
      const adaptationKey = `platform_adaptation:${platform.id}`;
      const adaptationProduces = platform.id === "wechat_official" ? ["wechat_article_package"] : ["platform_package"];
      add("platform_adaptation", {
        key: adaptationKey,
        title: `${platform.label}内容适配`,
        platform,
        requires: assignedOutputs.map((task) => task.key),
        consumes: assignedOutputs.flatMap((task) => task.artifactContract.produces),
        produces: adaptationProduces,
        executionInstructions: platform.id === "wechat_official"
          ? "交付且只交付一个 .json 文章包，字段为 schemaVersion=1、title、author、digest、contentHtml、cover、bodyImages、sourceUrl、packageDigest。当前草稿执行器只支持 cover=null 且 bodyImages=[]。packageDigest 必须是 sha256: 加上 canonical JSON（按 title、author、digest、contentHtml、cover、bodyImages、sourceUrl 顺序）的 SHA-256 十六进制值。"
          : null,
      });
      let publishDependencies = [adaptationKey];
      let publishConsumes = adaptationProduces;
      if (platform.id === "wechat_official") {
        const draftKey = `wechat_draft_sync:${platform.id}`;
        add("wechat_draft_sync", {
          key: draftKey,
          title: "保存到公众号草稿箱",
          platform,
          requires: [adaptationKey],
          consumes: ["wechat_article_package"],
        });
        publishDependencies = [adaptationKey, draftKey];
        publishConsumes = ["wechat_article_package", "wechat_draft_receipt"];
      }
      if (!publishRequested) continue;
      add("content_publish", {
        key: `content_publish:${platform.id}`,
        title: `发布到${platform.label}`,
        platform,
        requires: publishDependencies,
        consumes: publishConsumes,
      });
    }
  }

  const domains = [...new Set(tasks.map((task) => task.domain))];
  const professionalClarification = professionalActionClarification(statement, tasks);
  const clarification = platformAlternative
    ? {
        kind: "platform_choice",
        options: platforms,
        prompt: `你提到了“${platforms.map((platform) => platform.label).join("”或“")}”。这是二选一，还是都发布？请直接回复一个平台名称，或回复“都发布”。`,
      }
    : publishRequested && !platforms.length
      ? {
        kind: "platform_targets",
        prompt: "你希望发布到哪些平台？请直接回复平台名称，例如“公众号和小红书”。确认平台后，我再一次性创建完整步骤。",
      }
      : platformAccountChoice
        ? {
            kind: "account_choice",
            platforms,
            prompt: "你提到了特定平台账号。请从已连接账号中确认要使用哪一个；确认前我不会创建保存草稿或公开发布任务。",
          }
      : needsContentMapping
        ? {
            kind: "publication_content_mapping",
            platforms,
            contentOptions: contentOutputs.map((task) => ({ kind: task.kind, label: CONTENT_KIND_PATTERNS.find((entry) => entry.kind === task.kind)?.label ?? task.title })),
            prompt: `你准备了${contentOutputs.map((task) => CONTENT_KIND_PATTERNS.find((entry) => entry.kind === task.kind)?.label ?? task.title).join("、")}，并提到了${platforms.map((platform) => platform.label).join("、")}。请告诉我各自发布到哪里，例如“文章发公众号，图片发小红书”；如果全部内容都要适配到全部平台，也可以直接说“全部都发”。`,
          }
        : professionalClarification;
  return {
    goal: statement ? {
      id: resolvedIntentId,
      title: statement.slice(0, 120),
      statement,
      outcome: tasks.length > 1 ? `完成“${statement.slice(0, 80)}”并得到可检查的阶段结果` : tasks[0]?.outcome ?? "等待明确下一项任务",
      domains,
      platforms,
    } : null,
    intent: statement ? { id: resolvedIntentId, statement, source: "explicit_user" } : null,
    tasks: topologicallyOrderedTasks(tasks),
    clarification,
    proposals: tasks.length ? [] : proposeNextTasks({ domain: domain ?? "content", materials: sources }),
  };
}

export function taskDefinition(kind) {
  return TASK_DEFINITIONS.find((definition) => definition.kind === kind) ?? null;
}
