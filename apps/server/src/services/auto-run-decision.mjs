import { createHash } from "node:crypto";
import { classifyIntentFromText } from "./auto-run-intent.mjs";
import { detectArticleSource } from "./article-imports.mjs";
import { isSpawnedChildBody } from "./auto-run-spawn.mjs";

// The issue decision step (ISSUE_DECISION_AGENT_PLAN.md slice 1). An injectable
// decider (later: the LLM decision agent) proposes a structured decision; this
// module validates it and applies the confidence gates. The model decides, the
// code routes: nothing here executes side effects.
//
// Contract: { path, spawnChildIssues, confidence, rationale, clarifyingQuestions,
// taskUnderstanding?, acceptanceCriteria?, verificationSop?, risks?, decidedBy }.
// The optional planning fields let the same read-only decision hop provide the
// initial execution-plan draft; code still validates and freezes it separately.
//   develop   — concrete, scoped change: go straight to the change flow.
//   design    — open solution space: the deliverable is a design, not a diff.
//   prototype — deep uncertainty: a runnable spike is worth more than analysis.
//   clarify   — under-specified: ask specific questions instead of guessing.
//   decompose — an epic/initiative: break it into governed child issues (a plan,
//               not a diff). Opt-in (epicDecomposition); EPIC_DECOMPOSITION_PLAN.md.

export const AUTO_RUN_PATHS = ["develop", "office", "general", "design", "creative", "content", "prototype", "clarify", "decompose", "evaluate", "summarize"];
export const ROUTING_POLICY_VERSION = "2026-08-20.1";

// Paths whose output is not a product diff. A low-confidence agent decision may
// not send work down these (or spawn issues) — it degrades to clarify instead.
const HEAVY_PATHS = new Set(["office", "general", "design", "creative", "content", "prototype", "decompose", "evaluate", "summarize"]);

const INTENT_TO_PATH = { change: "develop", investigation: "design", question: "clarify", exploration: "evaluate", reading: "summarize" };
// Legacy `intent` field kept on records for continuity with pre-decision runs.
const PATH_TO_INTENT = { develop: "change", office: "change", general: "change", design: "investigation", creative: "change", content: "change", prototype: "investigation", clarify: "question", decompose: "investigation", evaluate: "exploration", summarize: "reading" };
const WORK_KINDS = new Set(["development", "office", "general", "product_design", "creative", "content", "consultation", "unknown"]);

// Local tasks originate from ordinary-language channels as well as the code
// console. Do not interpret every imperative verb as a request to edit source
// code: require positive evidence for programming, office work, or design.
const PROGRAMMING_WORK_RE = /(?:\b(?:api|bug|build|ci|cli|code|commit|compile|database|debug|deploy|endpoint|function|git|issue|lint|merge|migration|package|pr|pull request|query|refactor|release|repo|repository|sdk|server|sql|test|typescript|javascript|python|react|vue)\b|代码|编程|开发|接口|数据库|修复\s*(?:报错|故障|崩溃)|单元测试|集成测试|编译|构建|部署|提交|分支|仓库|服务端|前端|后端|\.\s*(?:js|mjs|cjs|ts|tsx|jsx|py|go|rs|java|kt|swift|sql|sh|vue)\b)/i;
const OFFICE_WORK_RE = /(?:台账|表格|电子表格|工作簿|报价|报价单|订单|合同|发货|回款|收款|汇款|售后|客户|联系人|客户反馈|资料|业务数据|对账|报表|清单|名单|公文|邮件|文档|演示文稿|幻灯片|\b(?:csv|excel|xlsx?|docx?|pptx?|spreadsheet|workbook|ledger|invoice|quotation|contract)\b)/i;
const PRODUCT_DESIGN_WORK_RE = /(?:界面设计|交互设计|产品设计|网页设计|应用设计|原型图|线框图|组件层级|页面流程|\b(?:ui|ux|product design|app design|web design|mockup|wireframe|prototype)\b)/i;
const CREATIVE_WORK_RE = /(?:视觉设计|平面设计|品牌设计|海报|封面|配色|排版|设计稿|效果图|图标|插画|配图|logo|宣传图|横幅|缩略图|\b(?:poster|visual design|graphic design|illustration|banner|thumbnail|logo)\b)/i;
const CONTENT_WORK_RE = /(?:文章|公众号|小红书|微博|自媒体|文案|标题|脚本|口播|视频脚本|分镜|字幕|新闻稿|推文|博客|创作|改写|润色|\b(?:article|blog|copywriting|social post|video script|storyboard|caption|newsletter)\b)/i;
const SOURCE_DEPENDENT_OFFICE_RE = /(?:整理|汇总|合并|转换|导入|提取|核对|清洗|统计|登记|更新|修改|补全|生成|处理).{0,24}(?:资料|数据|反馈|台账|表格|工作簿|报价|订单|合同|发货|回款|售后|客户|名单|报表)|(?:资料|数据|反馈|台账|表格|工作簿|报价|订单|合同|发货|回款|售后|客户|名单|报表).{0,24}(?:整理|汇总|合并|转换|导入|提取|核对|清洗|统计|登记|更新|修改|补全|处理)/i;
const BLANK_OFFICE_TEMPLATE_RE = /(?:空白|新建|从零|模板|示例).{0,12}(?:台账|表格|工作簿|报表)|(?:台账|表格|工作簿|报表).{0,12}(?:空白|新建|从零|模板|示例)/i;
const READ_ONLY_WORK_RE = /(?:只读|不要修改|不修改|查看|查询|列出|统计|核对|分析|总结|摘要|汇总|读取|read[- ]only|do not (?:change|modify)|list|inspect|summari[sz]e)/i;
const FILE_REFERENCE_RE = /(?:附件|刚才(?:的)?文件|这份(?:文件|表格|材料)|上传(?:的)?文件|\.(?:csv|xlsx?|json|docx?|pptx?)\b)/i;
const CONCRETE_GENERAL_WORK_RE = /^(?:请|帮我|麻烦|请帮我|请协助我)?[^\n]{0,12}(?:检查|处理|整理|分析|查询|查看|列出|生成|创建|修改|汇总|总结|翻译|审核|规划|跟踪|下载|发送|发布).{2,}/i;
const VAGUE_GENERAL_WORK_RE = /^(?:(?:请|麻烦)?帮我|请)?(?:处理|整理|检查|查看|看|做)(?:一下|下|这个|它|一下这个)?[。.!！?？]*$/i;

export function classifyLocalWorkKind(link, issueBody = "", projectContext = null) {
  const title = String(link?.title ?? "");
  const body = String(issueBody ?? "");
  const text = `${title}\n${body}`;
  const inputAssets = Array.isArray(projectContext?.inputAssets) ? projectContext.inputAssets : [];
  const hasInput = inputAssets.length > 0 || FILE_REFERENCE_RE.test(text);
  if (PROGRAMMING_WORK_RE.test(text)) return { kind: "development", confidence: 0.88, hasInput };
  if (PRODUCT_DESIGN_WORK_RE.test(text)) return { kind: "product_design", confidence: 0.86, hasInput };
  if (CREATIVE_WORK_RE.test(text)) return { kind: "creative", confidence: 0.86, hasInput };
  if (CONTENT_WORK_RE.test(text)) return { kind: "content", confidence: 0.84, hasInput };
  if (OFFICE_WORK_RE.test(text)) {
    return {
      kind: "office",
      confidence: 0.84,
      hasInput,
      needsSource: SOURCE_DEPENDENT_OFFICE_RE.test(text) && !BLANK_OFFICE_TEMPLATE_RE.test(text) && !hasInput,
      readOnly: READ_ONLY_WORK_RE.test(text),
    };
  }
  const conversationalIntent = classifyIntentFromText(title, body);
  if (conversationalIntent === "question") return { kind: "consultation", confidence: 0.75, hasInput };
  if (!VAGUE_GENERAL_WORK_RE.test(title.trim())
    && (CONCRETE_GENERAL_WORK_RE.test(title.trim()) || CONCRETE_GENERAL_WORK_RE.test(body.trim()))) {
    return { kind: "general", confidence: 0.72, hasInput };
  }
  return { kind: "unknown", confidence: 0.25, hasInput };
}

function localWorkDecision(link, issueBody, projectContext) {
  if (link?.type !== "local_issue") return null;
  // Desktop-created Local Issues keep the established issue-routing behavior.
  // The stricter ordinary-language gate is for Channel-origin work, where the
  // user did not choose a development workflow and must never be assumed to
  // want code changes merely because their sentence is imperative.
  if (projectContext?.channelOrigin !== true && link?.channelOrigin !== true) return null;
  const work = classifyLocalWorkKind(link, issueBody, projectContext);
  const base = {
    spawnChildIssues: false,
    workKind: work.kind,
    decidedBy: "heuristic",
    via: "heuristic",
  };
  if (work.kind === "development") return {
    ...base, path: "develop", confidence: work.confidence,
    rationale: "Local task contains explicit programming or repository evidence.",
    clarifyingQuestions: [],
  };
  if (work.kind === "product_design") return {
    ...base, path: "design", confidence: work.confidence,
    rationale: "Local task requests a design deliverable.",
    clarifyingQuestions: [],
  };
  if (work.kind === "creative") return {
    ...base, path: "creative", confidence: work.confidence,
    rationale: "Local task requests a concrete visual or brand creative deliverable.",
    clarifyingQuestions: [],
  };
  if (work.kind === "content") return {
    ...base, path: "content", confidence: work.confidence,
    rationale: "Local task requests a written or self-media content deliverable.",
    clarifyingQuestions: [],
  };
  if (work.kind === "office" && work.needsSource) return {
    ...base, path: "clarify", confidence: 0.92,
    rationale: "The office task depends on source material, but no input file or bound source was found.",
    clarifyingQuestions: ["请发送要处理的原始文件，或说明文件在当前项目中的位置；收到后我会先只读检查，再继续整理。"],
  };
  if (work.kind === "office" && work.readOnly) return {
    ...base, path: "office", confidence: work.confidence,
    rationale: "Local task is an explicit read-only office or data request.",
    clarifyingQuestions: [],
  };
  if (work.kind === "office") return {
    ...base, path: "office", confidence: work.confidence,
    rationale: "Local task requests a concrete office artifact and has sufficient source context.",
    clarifyingQuestions: [],
  };
  if (work.kind === "general") return {
    ...base, path: "general", confidence: work.confidence,
    rationale: "Local task contains a concrete action and object without requiring a specialist code, office, or design workflow.",
    clarifyingQuestions: [],
  };
  if (work.kind === "consultation") return {
    ...base, path: "clarify", confidence: work.confidence,
    rationale: "Local task is phrased as a question and does not authorize an implementation.",
    clarifyingQuestions: ["你希望我先回答这个问题，还是根据现有材料实际处理并交付结果？"],
  };
  return {
    ...base, path: "clarify", confidence: work.confidence,
    rationale: "The local task lacks enough evidence to choose office, programming, or design execution safely.",
    clarifyingQuestions: ["请补充要处理的对象（文件、项目或素材）和希望得到的结果；如果已有材料，请直接发送。"],
  };
}

/**
 * Deterministic epic/initiative detector. An epic is a PARENT of work, not a work
 * item — its title is `[Epic]`/`[Initiative]` or its Project Fields say so. Used
 * (only when epicDecomposition is on) to route to the decompose path regardless of
 * what the develop-shaped title heuristic would otherwise say.
 */
export function isEpicIssue({ link, issueBody } = {}) {
  if (/^\s*\[(epic|initiative)\]/i.test(String(link?.title ?? ""))) return true;
  return /(^|\n)\s*type:\s*(epic|initiative)\b/i.test(String(issueBody ?? ""));
}

export function epicDecision() {
  return {
    path: "decompose",
    spawnChildIssues: true,
    confidence: 0.95,
    rationale: "Epic/Initiative detected — decompose into governed child issues.",
    clarifyingQuestions: [],
    decidedBy: "heuristic",
    via: "epic-detector",
  };
}

export function decisionConfig(env = process.env) {
  const raw = Number(env.MYAGENTTOOL_AUTORUN_DECISION_MIN_CONFIDENCE);
  return {
    minConfidence: Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.6,
    // Hybrid fast path (on by default): strong lexical signals skip the decider;
    // only ambiguous "change-shaped" titles pay the LLM hop.
    fastPath: env.MYAGENTTOOL_AUTORUN_DECIDER_FAST_PATH !== "0",
    modelVersion: String(env.MYAGENTTOOL_AUTORUN_DECIDER_MODEL_VERSION ?? "").trim() || null,
  };
}

export function intentForPath(path) {
  return PATH_TO_INTENT[path] ?? "change";
}

/** Today's title+body heuristic mapped onto the decision contract. Always available. */
export function heuristicDecision(link, issueBody = null, projectContext = null) {
  const body = String(issueBody ?? "");
  const intent = classifyIntentFromText(link?.title ?? "", body);
  // An article URL (WeChat/Zhihu/Juejin/Jiansu/Xiaohongshu) in the body is an
  // unambiguous "read + summarize" intent — route straight to summarize (the
  // article-imports pipeline downloads it into the worktree, the agent reads +
  // summarizes). Checked before the GitHub-URL branch: an article provider is
  // never a repo, so there is nothing to clarify.
  const articleUrl = body.match(/https?:\/\/[^\s)]+/i)?.[0] ?? null;
  if (articleUrl) {
    try {
      const provider = detectArticleSource(articleUrl);
      if (provider && provider !== "web") {
        return {
          path: "summarize",
          spawnChildIssues: false,
          confidence: 0.9,
          rationale: `Body references a ${provider} article (${articleUrl}).`,
          clarifyingQuestions: [],
          decidedBy: "heuristic",
          via: "heuristic",
        };
      }
    } catch { /* not a URL detectArticleSource can parse — fall through */ }
  }
  // If the body references a GitHub URL but the title does not make the
  // user's intent clear, route to clarify with structured suggested actions
  // so the human can choose (evaluate / develop / reference-only).
  const gitUrl = body.match(/(https?:\/\/github\.com\/[^\s)]+\.git\b|https?:\/\/github\.com\/[^\s)]+(?!\/))/i)?.[0] ?? null;
  if (gitUrl && intent !== "exploration") {
    return {
      path: "clarify",
      spawnChildIssues: false,
      confidence: 0.3,
      rationale: `Body references ${gitUrl} but the title does not make the user's intent clear.`,
      clarifyingQuestions: ["What do you want to do with this GitHub repository?"],
      suggestedActions: [
        { id: "evaluate", label: "评估体验", description: "探索项目、启动试用、输出体验报告", payload: { path: "evaluate", repoUrl: gitUrl } },
        { id: "develop", label: "改代码", description: "在项目中修改代码、修复问题或实现功能", payload: { path: "develop", repoUrl: gitUrl } },
        { id: "ignore", label: "只是参考链接", description: "这个 URL 只是引用,不需要操作项目", payload: null },
      ],
      decidedBy: "heuristic",
      via: "heuristic",
    };
  }
  const local = localWorkDecision(link, issueBody, projectContext);
  if (local) return local;
  return {
    path: INTENT_TO_PATH[intent] ?? "develop",
    spawnChildIssues: false,
    confidence: 0.3,
    rationale: `Title heuristic classified this as "${intent}".`,
    clarifyingQuestions: [],
    decidedBy: "heuristic",
    via: "heuristic",
  };
}

/** Validate a raw (agent-produced) decision against the contract; null if unusable. */
export function normalizeDecision(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!AUTO_RUN_PATHS.includes(raw.path)) return null;
  const confidence = Number(raw.confidence);
  const stringList = (value, limit, maxLength = 2_000) => Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim())
      .map((item) => item.trim().slice(0, maxLength)).slice(0, limit)
    : [];
  return {
    path: raw.path,
    spawnChildIssues: raw.spawnChildIssues === true,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
    rationale: typeof raw.rationale === "string" ? raw.rationale.slice(0, 2000) : "",
    clarifyingQuestions: Array.isArray(raw.clarifyingQuestions)
      ? raw.clarifyingQuestions.filter((q) => typeof q === "string" && q.trim()).slice(0, 5)
      : [],
    taskUnderstanding: typeof raw.taskUnderstanding === "string"
      ? raw.taskUnderstanding.trim().slice(0, 4_000)
      : "",
    acceptanceCriteria: stringList(raw.acceptanceCriteria, 30),
    verificationSop: stringList(raw.verificationSop, 30),
    risks: stringList(raw.risks, 20, 1_000),
    workKind: WORK_KINDS.has(raw.workKind) ? raw.workKind : null,
    // Structured action suggestions for clarify/needs-input runs (e.g. the
    // heuristic detected a GitHub URL in the body but the user's intent —
    // evaluate vs. reference vs. develop — is ambiguous). Each action carries
    // a payload that the retry cycle passes back to startAutoRun.
    suggestedActions: Array.isArray(raw.suggestedActions)
      ? raw.suggestedActions.filter((a) => a?.id && a?.label).map((a) => ({
          id: String(a.id),
          label: String(a.label).slice(0, 80),
          description: typeof a.description === "string" ? a.description.slice(0, 200) : "",
          payload: a.payload ?? null,
        })).slice(0, 5)
      : [],
    decidedBy: "agent",
  };
}

/**
 * Resolve the decision for an issue: ask the injected decider, validate, apply
 * the confidence gates, fall back to the heuristic on any failure. Never throws.
 *
 * Gates apply to AGENT decisions only — the heuristic is the trusted floor (it
 * is exactly today's behavior), so gating it would change behavior when no
 * agent is configured.
 */
export async function resolveDecision({
  link,
  issueBody = null,
  projectContext = null,
  decideIssuePath,
  minConfidence = decisionConfig().minConfidence,
  fastPath = decisionConfig().fastPath,
  modelVersion = decisionConfig().modelVersion,
  epicDecomposition = false,
} = {}) {
  const finalize = (decision) => ({
    ...decision,
    evidence: {
      policyVersion: ROUTING_POLICY_VERSION,
      modelVersion,
      minConfidence,
      inputDigest: createHash("sha256").update(JSON.stringify({
        type: link?.type ?? null,
        number: link?.number ?? null,
        title: link?.title ?? "",
        body: issueBody ?? "",
        projectContextDigest: projectContext?.digest ?? null,
      })).digest("hex"),
    },
  });
  // Opt-in epic decomposition wins over every other route: an epic is never a
  // single develop/design run. Deterministic — no decider hop, no LLM variance.
  // GATED on a NON-child body: a spawned child (depth-1 marker) with an [Epic]-
  // shaped title must NOT re-decompose into grandchildren. (review: depth-1 gate)
  if (epicDecomposition && !isSpawnedChildBody(issueBody) && isEpicIssue({ link, issueBody })) return finalize(epicDecision());
  const floor = heuristicDecision(link, issueBody, projectContext);
  // Missing source material and genuinely unclassified Channel prose are hard
  // safety facts, not a model preference. Even with fast-path disabled, do not
  // spend an execution run before the user has supplied the required context.
  if (link?.type === "local_issue" && projectContext?.channelOrigin === true && floor.path === "clarify") {
    return finalize(floor);
  }
  // The fallback floor reads the body too (best-effort when no agent is
  // configured); the change-title guard keeps a clear change from being flipped.
  if (typeof decideIssuePath !== "function") return finalize(floor);

  // Hybrid fast path: question/investigation TITLES are strong lexical signals
  // the heuristic reads reliably — skip the decider hop. Deliberately title-only:
  // a mere body mention is weaker and should pay the decider, not fast-path. The
  // weak default ("looks like a change") is exactly where ambiguity lives.
  if (fastPath) {
    const quick = heuristicDecision(link, null, projectContext);
    if (quick.path !== "develop") {
      return finalize({ ...quick, via: "fast-path", rationale: `${quick.rationale} (Fast path: strong lexical signal, decider skipped.)` });
    }
  }

  const startedAt = Date.now();
  let decision = null;
  try {
    decision = normalizeDecision(await decideIssuePath({ link, issueBody, projectContext }));
  } catch {
    decision = null;
  }
  const latencyMs = Date.now() - startedAt;
  // Decider errored: fall back TITLE-ONLY, matching the fast path. Reading the body
  // here would make the SAME issue route differently on a transient decider hiccup
  // (develop→PR when it answers, design→no-code when it times out). The body-aware
  // heuristic is reserved for the no-decider deployment above, where it's stable.
  if (!decision) return finalize({ ...heuristicDecision(link, null, projectContext), via: "fallback", latencyMs });
  decision = { ...decision, via: "agent", latencyMs };
  if (link?.type === "local_issue" && projectContext?.channelOrigin === true) {
    const classified = classifyLocalWorkKind(link, issueBody, projectContext);
    if (classified.kind !== "unknown") decision.workKind = classified.kind;
  }
  if (decision.confidence < minConfidence && (HEAVY_PATHS.has(decision.path) || decision.spawnChildIssues)) {
    return finalize({
      ...decision,
      path: "clarify",
      spawnChildIssues: false,
      rationale: `${decision.rationale ? `${decision.rationale} ` : ""}(Degraded to clarify: confidence ${decision.confidence.toFixed(2)} below ${minConfidence} for a heavy path.)`,
    });
  }
  // A low-confidence DEVELOP decision that the agent ITSELF flagged with open
  // questions degrades to clarify — cheaper to ask than to burn a run on a guess.
  // Guarded tightly: a confident develop, or one with no questions, still proceeds
  // (a human reviews the diff regardless), and the heuristic floor — which never
  // raises questions — is never gated. Asking needlessly is friction, so we only
  // ask when the decider explicitly said it lacks what it needs.
  if (decision.path === "develop" && decision.confidence < minConfidence && decision.clarifyingQuestions.length > 0) {
    return finalize({
      ...decision,
      path: "clarify",
      spawnChildIssues: false,
      rationale: `${decision.rationale ? `${decision.rationale} ` : ""}(Degraded to clarify: develop confidence ${decision.confidence.toFixed(2)} below ${minConfidence} with open questions.)`,
    });
  }
  return finalize(decision);
}
