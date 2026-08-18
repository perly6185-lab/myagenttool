import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { Modal } from "@/components/ui/modal";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import type {
  ArticleAnalysis,
  ArticleDerivative,
  ArticleDerivativeRequest,
  ArticleSimilarityMatch,
  ArticleSimilaritySearch,
} from "./article-workflow-types";

interface Messages {
  [key: string]: string | Messages;
}

const messages: Record<"en" | "zh", Messages> = {
  en: {
    provider: { wechat: "WeChat", xiaohongshu: "Xiaohongshu", zhihu: "Zhihu", qichacha: "Qichacha", juejin: "Juejin", jianshu: "Jianshu", web: "Web" },
    analysis: {
      title: "Article analysis",
      localMethod: "Extracted locally from the imported Markdown; the article is not uploaded.",
      coreIdeas: "Core ideas",
      framework: "Article framework",
      keyConcepts: "Key concepts",
      role: {
        introduction: "Introduction",
        development: "Development",
        evidence: "Reasoning",
        boundary: "Limits",
        conclusion: "Conclusion",
      },
    },
    similarity: {
      title: "Similar articles",
      localMethod: "Searches imported Markdown in this project only; no article content is uploaded.",
      summary: "Searched {{indexed}} local article(s) and found {{matches}} match(es).",
      empty: "No sufficiently similar imported articles were found in this project.",
      skipped: "Skipped {{count}} unavailable local article(s).",
      sharedConcepts: "Shared concepts: {{concepts}}",
      reason: {
        core_ideas: "Similar core ideas",
        structure: "Similar structure",
        body: "Related content",
        same_author: "Same author",
        same_provider: "Same platform",
      },
    },
    derivative: {
      title: "Create derivative",
      description: "A governed local Agent creates a new version without overwriting the source.",
      kind: "Format",
      kinds: { article_rewrite: "Deep rewrite", video_script: "Short-video script" },
      tone: "Tone",
      tones: { insightful: "Insightful", practical: "Practical", conversational: "Conversational" },
      length: "Length",
      lengths: { short: "Short", medium: "Medium", long: "Long" },
      audiencePreset: "Audience group",
      audiences: {
        general: "General readers",
        creator: "Content creators",
        product_manager: "Product managers",
        entrepreneur_investor: "Entrepreneurs / investors",
        technical: "Technical readers",
        custom: "Custom audience",
      },
      audienceHints: {
        general: "Plain-language context, everyday relevance, and a low-barrier takeaway.",
        creator: "Editorial angles, reusable workflows, production efficiency, and audience retention.",
        product_manager: "User problems, product value, experience trade-offs, metrics, and validation hypotheses.",
        entrepreneur_investor: "Market opportunity, differentiation, defensibility, business model, scaling, and risk.",
        technical: "Mechanisms, components, data flow, failure modes, engineering trade-offs, and constraints.",
        custom: "The Agent adapts its assumptions, examples, terminology, and structure to your description.",
      },
      audience: "Custom audience",
      audiencePlaceholder: "Describe the audience's role, knowledge, and goals",
      audienceDetails: "Audience details (optional)",
      audienceDetailsPlaceholder: "Add a narrower scenario, experience level, or decision they need to make",
      agePreset: "Age range",
      ages: {
        all: "All ages",
        teen: "Teenagers",
        "18_24": "18–24",
        "25_34": "25–34",
        "35_49": "35–49",
        "50_plus": "50+",
        custom: "Custom age range",
      },
      ageHints: {
        all: "Uses broadly accessible language without age-specific assumptions.",
        teen: "Explains adult contexts clearly while keeping the tone respectful rather than childish.",
        "18_24": "Uses concise examples spanning study, first jobs, independent creation, and early-career choices.",
        "25_34": "Uses efficient, decision-oriented examples without assuming income, family, or a fixed life path.",
        "35_49": "Makes trade-offs explicit and respects accumulated experience without assuming role or digital fluency.",
        "50_plus": "Explains newer platform conventions when needed without equating age with lower ability or technical fluency.",
        custom: "Adapts references, pacing, and context to the supplied range while avoiding demographic stereotypes.",
      },
      customAge: "Custom age range",
      customAgePlaceholder: "For example: 45–60, experienced managers changing careers",
      ageDetails: "Age context (optional)",
      ageDetailsPlaceholder: "Add a life stage or context without making demographic assumptions",
      angle: "Creative angle (optional)",
      anglePlaceholder: "The real competition is how many production decisions the platform makes for users",
      submit: "Start creation",
      statusTitle: "Derivative status",
      state: {
        awaiting_approval: "Awaiting approval",
        queued: "Queued",
        running: "Creating",
        completed: "Completed",
        failed: "Failed",
        canceled: "Canceled",
      },
      invocation: "Invocation",
      targetAudience: "Target audience",
      targetAge: "Target age",
      output: "Output",
      openOutput: "Open derivative Markdown",
      pendingHint: "You can close this dialog; the governed Agent continues in the background.",
      completedHint: "The derivative was validated and attached to this local Issue.",
      failedHint: "The derivative was not attached. Check the invocation details and retry.",
      sourceSafety: "The task treats the imported article as untrusted reference data and instructs the Agent to write only the allocated file; the server attaches only that validated output.",
    },
  },
  zh: {
    provider: { wechat: "公众号", xiaohongshu: "小红书", zhihu: "知乎", qichacha: "企查查", juejin: "掘金", jianshu: "简书", web: "其他网页" },
    analysis: {
      title: "文章分析",
      localMethod: "基于已导入的 Markdown 在本地提取，不会上传文章内容。",
      coreIdeas: "核心思想",
      framework: "框架体系",
      keyConcepts: "关键概念",
      role: { introduction: "引入", development: "展开", evidence: "论证", boundary: "边界与局限", conclusion: "结论" },
    },
    similarity: {
      title: "相似文章",
      localMethod: "仅检索当前项目内已导入的 Markdown，不会上传文章内容。",
      summary: "已检索 {{indexed}} 篇本地文章，找到 {{matches}} 篇相似文章。",
      empty: "当前项目中没有达到相似度阈值的已导入文章。",
      skipped: "已跳过 {{count}} 篇当前不可用的本地文章。",
      sharedConcepts: "共同概念：{{concepts}}",
      reason: { core_ideas: "核心思想相近", structure: "结构相近", body: "正文相关", same_author: "同一作者", same_provider: "同一平台" },
    },
    derivative: {
      title: "文章二创",
      description: "由受治理的本地 Agent 生成新版本，不会覆盖原文。",
      kind: "二创形式",
      kinds: { article_rewrite: "深度改写", video_script: "短视频口播稿" },
      tone: "表达风格",
      tones: { insightful: "洞察分析", practical: "实用具体", conversational: "自然口语" },
      length: "篇幅",
      lengths: { short: "短", medium: "中", long: "长" },
      audiencePreset: "受众群体",
      audiences: {
        general: "普通读者",
        creator: "内容创作者",
        product_manager: "产品经理",
        entrepreneur_investor: "创业者 / 投资人",
        technical: "技术人员",
        custom: "自定义受众",
      },
      audienceHints: {
        general: "补足背景、使用生活化表达，突出与普通人的关系和低门槛结论。",
        creator: "突出选题角度、内容复用、脚本质量、生产效率和读者留存。",
        product_manager: "突出用户问题、产品价值、体验权衡、指标和待验证假设。",
        entrepreneur_investor: "突出市场机会、差异化、壁垒、商业模式、规模化和风险。",
        technical: "突出实现机制、组件、数据流、故障模式、工程权衡和系统边界。",
        custom: "根据你的描述调整知识假设、案例、术语深度、文章结构和结尾行动。",
      },
      audience: "自定义受众",
      audiencePlaceholder: "描述受众的职业、知识背景和阅读目标",
      audienceDetails: "受众补充说明（可选）",
      audienceDetailsPlaceholder: "可补充细分场景、经验水平或需要做出的决策",
      agePreset: "年龄段",
      ages: {
        all: "不限年龄",
        teen: "青少年",
        "18_24": "18–24 岁",
        "25_34": "25–34 岁",
        "35_49": "35–49 岁",
        "50_plus": "50 岁以上",
        custom: "自定义年龄段",
      },
      ageHints: {
        all: "使用普适表达，不对年龄背景作额外假设。",
        teen: "清楚解释成人工作和商业语境，同时保持尊重，不使用幼稚化表达。",
        "18_24": "使用简洁表达，案例覆盖学习、初入职场、独立创作和早期职业选择。",
        "25_34": "偏向高效和决策型表达，但不假设收入、婚育或固定人生路径。",
        "35_49": "明确呈现权衡并尊重既有经验，不假设职业角色、家庭状态或数字熟练度。",
        "50_plus": "必要时解释新平台习惯，但不把年龄等同于能力、技术水平或改变意愿。",
        custom: "根据指定年龄范围调整案例、节奏和上下文，同时避免人口群体刻板印象。",
      },
      customAge: "自定义年龄段",
      customAgePlaceholder: "例如：45–60 岁、正在转型的资深管理者",
      ageDetails: "年龄背景补充（可选）",
      ageDetailsPlaceholder: "可补充人生阶段或使用场景，避免人口属性推断",
      angle: "创作角度（可选）",
      anglePlaceholder: "真正的竞争是平台替用户做了多少内容生产决策",
      submit: "开始二创",
      statusTitle: "二创状态",
      state: { awaiting_approval: "等待审批", queued: "排队中", running: "生成中", completed: "已完成", failed: "失败", canceled: "已取消" },
      invocation: "调用",
      targetAudience: "目标受众",
      targetAge: "目标年龄",
      output: "产物",
      openOutput: "打开二创 Markdown",
      pendingHint: "可以关闭对话框，受治理的 Agent 会在后台继续执行。",
      completedHint: "二创文件已通过校验，并已归入当前本地 Issue。",
      failedHint: "二创文件未能归档，请查看调用详情后重试。",
      sourceSafety: "任务会把导入文章视为不可信参考资料，并要求 Agent 只写入预分配文件；服务端只归档通过校验的该产物。",
    },
  },
};

function valueAt(source: Messages, path: string) {
  return path.split(".").reduce<string | Messages | undefined>(
    (value, part) => typeof value === "object" && value ? value[part] : undefined,
    source,
  );
}

function interpolate(value: string, variables?: Record<string, string | number>) {
  if (!variables) return value;
  return value.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(variables[key] ?? ""));
}

export default function ArticleWorkflowDialogs({
  analysis,
  similarArticles,
  derivativeContext,
  derivative,
  pending,
  onCloseAnalysis,
  onCloseSimilarity,
  onCloseDerivative,
  onOpenSimilar,
  onOpenOutput,
  onCreateDerivative,
}: {
  analysis: ArticleAnalysis | null;
  similarArticles: ArticleSimilaritySearch | null;
  derivativeContext: { sourceJobId: string; worktreeId: string } | null;
  derivative: ArticleDerivative | null;
  pending: boolean;
  onCloseAnalysis: () => void;
  onCloseSimilarity: () => void;
  onCloseDerivative: () => void;
  onOpenSimilar: (match: ArticleSimilarityMatch) => void;
  onOpenOutput: (asset: { path: string; worktreeId: string }) => void;
  onCreateDerivative: (request: ArticleDerivativeRequest) => void;
}) {
  const { i18n } = useAppTranslation();
  const locale = i18n.resolvedLanguage?.startsWith("zh") ? "zh" : "en";
  const text = (key: string, variables?: Record<string, string | number>) => {
    const value = valueAt(messages[locale], key);
    return interpolate(typeof value === "string" ? value : key, variables);
  };
  const [kind, setKind] = useState<ArticleDerivative["kind"]>("article_rewrite");
  const [tone, setTone] = useState<ArticleDerivative["tone"]>("insightful");
  const [length, setLength] = useState<ArticleDerivative["length"]>("medium");
  const [audiencePreset, setAudiencePreset] = useState<ArticleDerivative["audiencePreset"]>("general");
  const [audience, setAudience] = useState("");
  const [agePreset, setAgePreset] = useState<ArticleDerivative["agePreset"]>("all");
  const [ageDetails, setAgeDetails] = useState("");
  const [angle, setAngle] = useState("");
  const [requestKey] = useState(() => globalThis.crypto?.randomUUID?.()
    ?? `article-derivative-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  return (
    <>
      <Modal
        open={Boolean(analysis)}
        title={analysis?.title ?? text("analysis.title")}
        description={text("analysis.localMethod")}
        onClose={onCloseAnalysis}
      >
        {analysis ? (
          <div className="max-h-[65vh] space-y-5 overflow-y-auto pr-1 text-sm">
            <section>
              <h4 className="mb-2 font-semibold">{text("analysis.coreIdeas")}</h4>
              <ul className="list-disc space-y-2 pl-5">
                {analysis.coreIdeas.map((idea) => <li key={idea}>{idea}</li>)}
              </ul>
            </section>
            <section>
              <h4 className="mb-2 font-semibold">{text("analysis.framework")}</h4>
              <ol className="space-y-2">
                {analysis.framework.map((section) => (
                  <li key={`${section.order}:${section.heading}`} className="rounded-md border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>{section.order}. {section.heading}</strong>
                      <Badge tone="neutral">{text(`analysis.role.${section.role}`)}</Badge>
                    </div>
                    <p className="mt-1 text-muted-foreground">{section.summary}</p>
                  </li>
                ))}
              </ol>
            </section>
            {analysis.keyConcepts.length ? (
              <section>
                <h4 className="mb-2 font-semibold">{text("analysis.keyConcepts")}</h4>
                <div className="flex flex-wrap gap-1">
                  {analysis.keyConcepts.map((concept) => <Badge key={concept} tone="neutral">{concept}</Badge>)}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
      </Modal>
      <Modal
        open={Boolean(similarArticles)}
        title={text("similarity.title")}
        description={similarArticles
          ? text("similarity.summary", {
            indexed: similarArticles.indexedCount,
            matches: similarArticles.matches.length,
          })
          : text("similarity.localMethod")}
        onClose={onCloseSimilarity}
      >
        {similarArticles?.matches.length ? (
          <div className="max-h-[65vh] space-y-2 overflow-y-auto pr-1">
            {similarArticles.skippedCount ? (
              <p className="text-xs text-muted-foreground">
                {text("similarity.skipped", { count: similarArticles.skippedCount })}
              </p>
            ) : null}
            {similarArticles.matches.map((match) => (
              <article key={match.articleId} className="rounded-md border border-border p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <button type="button" className="text-left font-semibold text-primary hover:underline"
                      onClick={() => onOpenSimilar(match)}>
                      {match.title}
                    </button>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {match.localRef}
                      {" · "}{text(`provider.${match.provider ?? "web"}`)}
                      {match.author ? ` · ${match.author}` : ""}
                      {match.publishedAt ? ` · ${match.publishedAt}` : ""}
                    </p>
                  </div>
                  <Badge tone={match.score >= 0.5 ? "success" : "neutral"}>
                    {Math.round(match.score * 100)}%
                  </Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {match.reasons.map((reason) => (
                    <Badge key={reason} tone="neutral">{text(`similarity.reason.${reason}`)}</Badge>
                  ))}
                </div>
                {match.sharedConcepts.length ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {text("similarity.sharedConcepts", { concepts: match.sharedConcepts.join("、") })}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        ) : similarArticles ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>{text("similarity.empty")}</p>
            {similarArticles.skippedCount ? (
              <p>{text("similarity.skipped", { count: similarArticles.skippedCount })}</p>
            ) : null}
          </div>
        ) : null}
      </Modal>
      <Modal
        open={Boolean(derivativeContext)}
        title={derivative ? text("derivative.statusTitle") : text("derivative.title")}
        description={derivative ? undefined : text("derivative.description")}
        onClose={onCloseDerivative}
        size="lg"
      >
        {derivative ? (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={derivative.state === "completed"
                ? "success"
                : derivative.state === "failed" ? "danger" : "warning"}>
                {text(`derivative.state.${derivative.state}`)}
              </Badge>
              <Badge tone="neutral">{text(`derivative.kinds.${derivative.kind}`)}</Badge>
              <Badge tone="neutral">{text(`derivative.tones.${derivative.tone}`)}</Badge>
              <Badge tone="neutral">{text(`derivative.audiences.${derivative.audiencePreset}`)}</Badge>
              <Badge tone="neutral">{text(`derivative.ages.${derivative.agePreset}`)}</Badge>
            </div>
            <dl className="space-y-2 rounded-md border border-border p-3 text-xs">
              <div>
                <dt className="text-muted-foreground">{text("derivative.invocation")}</dt>
                <dd className="break-all font-mono">{derivative.invocationId}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{text("derivative.targetAudience")}</dt>
                <dd className="break-words">{derivative.audience}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{text("derivative.targetAge")}</dt>
                <dd className="break-words">{derivative.targetAge}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{text("derivative.output")}</dt>
                <dd className="break-all font-mono">{derivative.outputPath}</dd>
              </div>
            </dl>
            {derivative.state === "completed" ? (
              <>
                <p className="text-muted-foreground">{text("derivative.completedHint")}</p>
                <div className="flex justify-end">
                  <Button onClick={() => onOpenOutput({
                    path: derivative.outputPath,
                    worktreeId: derivative.worktreeId,
                  })}>
                    {text("derivative.openOutput")}
                  </Button>
                </div>
              </>
            ) : derivative.state === "failed" || derivative.state === "canceled" ? (
              <div className="space-y-1 text-destructive">
                <p>{text("derivative.failedHint")}</p>
                {derivative.error ? <p className="font-mono text-xs">{derivative.error}</p> : null}
              </div>
            ) : (
              <p className="text-muted-foreground">{text("derivative.pendingHint")}</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={text("derivative.kind")}>
                <Select value={kind} onChange={(event) => setKind(event.target.value as ArticleDerivative["kind"])}>
                  <option value="article_rewrite">{text("derivative.kinds.article_rewrite")}</option>
                  <option value="video_script">{text("derivative.kinds.video_script")}</option>
                </Select>
              </Field>
              <Field label={text("derivative.tone")}>
                <Select value={tone} onChange={(event) => setTone(event.target.value as ArticleDerivative["tone"])}>
                  <option value="insightful">{text("derivative.tones.insightful")}</option>
                  <option value="practical">{text("derivative.tones.practical")}</option>
                  <option value="conversational">{text("derivative.tones.conversational")}</option>
                </Select>
              </Field>
            </div>
            <Field label={text("derivative.length")}>
              <Select value={length} onChange={(event) => setLength(event.target.value as ArticleDerivative["length"])}>
                <option value="short">{text("derivative.lengths.short")}</option>
                <option value="medium">{text("derivative.lengths.medium")}</option>
                <option value="long">{text("derivative.lengths.long")}</option>
              </Select>
            </Field>
            <Field label={text("derivative.audiencePreset")}>
              <Select value={audiencePreset}
                onChange={(event) => {
                  setAudiencePreset(event.target.value as ArticleDerivative["audiencePreset"]);
                  setAudience("");
                }}>
                <option value="general">{text("derivative.audiences.general")}</option>
                <option value="creator">{text("derivative.audiences.creator")}</option>
                <option value="product_manager">{text("derivative.audiences.product_manager")}</option>
                <option value="entrepreneur_investor">{text("derivative.audiences.entrepreneur_investor")}</option>
                <option value="technical">{text("derivative.audiences.technical")}</option>
                <option value="custom">{text("derivative.audiences.custom")}</option>
              </Select>
            </Field>
            <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
              {text(`derivative.audienceHints.${audiencePreset}`)}
            </p>
            <Field label={text(audiencePreset === "custom" ? "derivative.audience" : "derivative.audienceDetails")}>
              <Input value={audience} maxLength={200}
                placeholder={text(audiencePreset === "custom"
                  ? "derivative.audiencePlaceholder"
                  : "derivative.audienceDetailsPlaceholder")}
                onChange={(event) => setAudience(event.target.value)} />
            </Field>
            <Field label={text("derivative.agePreset")}>
              <Select value={agePreset}
                onChange={(event) => {
                  setAgePreset(event.target.value as ArticleDerivative["agePreset"]);
                  setAgeDetails("");
                }}>
                <option value="all">{text("derivative.ages.all")}</option>
                <option value="teen">{text("derivative.ages.teen")}</option>
                <option value="18_24">{text("derivative.ages.18_24")}</option>
                <option value="25_34">{text("derivative.ages.25_34")}</option>
                <option value="35_49">{text("derivative.ages.35_49")}</option>
                <option value="50_plus">{text("derivative.ages.50_plus")}</option>
                <option value="custom">{text("derivative.ages.custom")}</option>
              </Select>
            </Field>
            <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
              {text(`derivative.ageHints.${agePreset}`)}
            </p>
            <Field label={text(agePreset === "custom" ? "derivative.customAge" : "derivative.ageDetails")}>
              <Input value={ageDetails} maxLength={100}
                placeholder={text(agePreset === "custom"
                  ? "derivative.customAgePlaceholder"
                  : "derivative.ageDetailsPlaceholder")}
                onChange={(event) => setAgeDetails(event.target.value)} />
            </Field>
            <Field label={text("derivative.angle")}>
              <Textarea value={angle} maxLength={500}
                placeholder={text("derivative.anglePlaceholder")}
                onChange={(event) => setAngle(event.target.value)} />
            </Field>
            <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
              {text("derivative.sourceSafety")}
            </p>
            <div className="flex justify-end">
              <Button disabled={pending
                || (audiencePreset === "custom" && !audience.trim())
                || (agePreset === "custom" && !ageDetails.trim())}
                onClick={() => onCreateDerivative({
                  kind,
                  tone,
                  length,
                  audiencePreset,
                  audience: audience.trim(),
                  agePreset,
                  ageDetails: ageDetails.trim(),
                  angle: angle.trim(),
                  idempotencyKey: requestKey,
                })}>
                {text("derivative.submit")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
