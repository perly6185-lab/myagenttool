import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import type { ArticleInspection } from "./article-workflow-types";

const labels = {
  en: {
    source: "Issue source",
    manual: "Manual",
    link: "Import link",
    url: "Public article URL",
    inspect: "Inspect",
    unknown: "Unknown author",
    fallbackDate: "Import date",
    characters: "characters",
    images: "images",
    audio: "audio",
    video: "video",
    publicOnly: "Only publicly accessible HTTPS pages are supported. AI will download the article into its isolated workspace, then read, summarize, and deliver the result.",
    provider: { wechat: "WeChat", xiaohongshu: "Xiaohongshu", zhihu: "Zhihu", juejin: "Juejin", jianshu: "Jianshu", web: "Web" },
  },
  zh: {
    source: "Issue 来源",
    manual: "手动填写",
    link: "从链接导入",
    url: "公开文章链接",
    inspect: "检查链接",
    unknown: "未知作者",
    fallbackDate: "使用导入日期",
    characters: "字",
    images: "张图片",
    audio: "个音频",
    video: "个视频",
    publicOnly: "仅支持可公开访问的 HTTPS 页面。AI 会在隔离工作区下载文章，再阅读、总结并交付结果；不会绕过登录、验证码或访问限制。",
    provider: { wechat: "公众号", xiaohongshu: "小红书", zhihu: "知乎", juejin: "掘金", jianshu: "简书", web: "其他网页" },
  },
} as const;

export default function ArticleImportFields({
  mode,
  sourceUrl,
  projectId,
  inspection,
  pending,
  onModeChange,
  onUrlChange,
  onInspect,
}: {
  mode: "manual" | "url";
  sourceUrl: string;
  projectId: string;
  inspection: ArticleInspection | null;
  pending: boolean;
  onModeChange: (mode: "manual" | "url") => void;
  onUrlChange: (url: string) => void;
  onInspect: () => void;
}) {
  const { i18n } = useAppTranslation();
  const text = labels[i18n.resolvedLanguage?.startsWith("zh") ? "zh" : "en"];
  return (
    <>
      <Field label={text.source}>
        <div className="flex gap-2">
          <Button type="button" variant={mode === "manual" ? "primary" : "secondary"} onClick={() => onModeChange("manual")}>
            {text.manual}
          </Button>
          <Button type="button" variant={mode === "url" ? "primary" : "secondary"} onClick={() => onModeChange("url")}>
            {text.link}
          </Button>
        </div>
      </Field>
      {mode === "url" ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          <Field label={text.url}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="url"
                value={sourceUrl}
                onChange={(event) => onUrlChange(event.target.value)}
                placeholder="https://..."
                autoFocus
              />
              <Button type="button" variant="secondary" disabled={pending || !projectId || !sourceUrl.trim()} onClick={onInspect}>
                {text.inspect}
              </Button>
            </div>
          </Field>
          {inspection ? (
            <div className="rounded-md bg-muted/50 p-3 text-sm" data-testid="article-import-inspection">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{text.provider[inspection.provider]}</Badge>
                <span className="font-medium">{inspection.title}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {inspection.author || text.unknown} · {inspection.publishedAt || text.fallbackDate} ·
                {" "}{inspection.textLength} {text.characters} ·
                {" "}{inspection.mediaCounts.images} {text.images} ·
                {" "}{inspection.mediaCounts.audio} {text.audio} ·
                {" "}{inspection.mediaCounts.video} {text.video}
              </p>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">{text.publicOnly}</p>
        </div>
      ) : null}
    </>
  );
}
