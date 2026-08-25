import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronUp, ExternalLink, Eye, FilePlus2, Globe2, History, ImagePlus,
  Languages, LayoutTemplate, ListChecks, Loader2, Monitor, Palette, Plus, Rocket, RotateCcw, Save, Settings2, ShieldCheck, Smartphone, Trash2, Upload,
} from "lucide-react";
import { SectionHeading } from "@/components/common/section-heading";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { ApiError } from "@/lib/api/request";
import { useUiStore } from "@/store/ui-store";
import { siteApi } from "./site-api";
import { SitePilotPanel, useSitePilot, type SitePilotController } from "./site-pilot-panel";
import {
  publicationRecoveryKind,
  siteExperienceState,
  siteJourney,
  writeGoLiveHandoff,
  type GoLiveHandoff,
} from "./site-experience-model";
import type { PublicationPlan, Site, SiteAsset, SiteBlock, SiteBlockType, SiteEntry } from "./site-types";

const SITE_KEY = () => {
  const code = new URLSearchParams(window.location.search).get("sitePilot")?.trim();
  return ["my-site", code && code !== "1" ? code : "production"] as const;
};

function errorMessage(error: unknown, zh: boolean) {
  if (error instanceof ApiError) {
    const messages: Record<string, [string, string]> = {
      site_deployment_target_not_ready: ["网站的上线服务还未准备好，请先完成上线设置。", "The website's publishing service is not ready. Complete go-live setup first."],
      site_deployment_busy: ["网站正在执行发布或连接检查，请等待当前操作完成。", "A publication or connection check is already running. Wait for it to finish."],
      site_deployment_credential_unavailable: ["云平台连接已失效，请重新连接后再发布。", "The cloud connection has expired. Reconnect it before publishing."],
      site_publication_plan_stale: ["内容刚刚发生了变化，请重新检查后发布。", "The content changed just now. Review it again before publishing."],
      site_publication_bundle_changed: ["预览内容已经更新，请重新发起发布。", "The preview changed. Start publishing again."],
      site_deployment_recovery_failed: ["新版本未能上线，自动恢复也未完成。请保持窗口打开并联系管理员检查；不要重复发布。", "The new version did not go live and automatic recovery was incomplete. Keep this window open and ask an administrator to check it; do not publish again."],
      site_deployment_ssh_scope_not_ready: ["服务器上的站点发布范围已停用或权限不足，请让维护人员重新验证。", "The server publishing range is disabled or lacks permission. Ask a maintainer to verify it again."],
      site_deployment_ssh_host_not_ready: ["网站服务器当前未通过连接检查，请让维护人员检查主机连接。", "The website server is not currently verified. Ask a maintainer to check the host connection."],
      site_deployment_ssh_fingerprint_changed: ["服务器身份与上次确认的不一致，已停止发布。请让维护人员核对服务器。", "The server identity differs from the confirmed identity, so publishing stopped. Ask a maintainer to inspect the server."],
      site_deployment_ssh_connection_failed: ["暂时无法连接网站服务器，当前线上版本保持不变。", "The website server could not be reached. The current live release remains unchanged."],
      site_deployment_healthcheck_failed: ["新版本从公开网址无法正常打开，系统已恢复发布前的版本。请检查域名和 Web 服务。", "The new release could not be opened at its public address. The pre-publish release was restored. Check the domain and web server."],
      site_deployment_content_mismatch: ["公开网址显示的内容不是本次发布版本，系统已恢复发布前的版本。请检查 Web 根目录或缓存。", "The public address served different content, so the pre-publish release was restored. Check the web root or cache."],
      site_slug_conflict: ["已有同名页面，请换一个标题后再试。", "A page with this address already exists. Choose another title and try again."],
      site_asset_too_large: ["这张图片超过 10 MB，请压缩后重新上传。", "This image is larger than 10 MB. Compress it and upload again."],
      site_asset_type_unsupported: ["图片格式不支持，请使用 PNG、JPG 或 WebP。", "This image format is not supported. Use PNG, JPG, or WebP."],
      site_asset_content_type_mismatch: ["图片文件内容与扩展名不一致，请重新导出后上传。", "The image contents do not match its file type. Export it again and retry."],
      site_asset_limit_reached: ["图片数量已达到上限，请让维护人员清理不再使用的素材。", "The image limit has been reached. Ask a maintainer to remove unused assets."],
      site_asset_storage_limit_reached: ["站点图片存储空间已满，请让维护人员清理不再使用的素材。", "Site image storage is full. Ask a maintainer to remove unused assets."],
    };
    const known = messages[error.code];
    if (known) return known[zh ? 0 : 1];
    if (error.status === 409) return zh ? "内容已在其他位置更新，请刷新后再试。" : "This content changed elsewhere. Refresh and try again.";
    if (error.status >= 500) return zh ? "操作暂时没有完成，现有线上网站不会受影响。请稍后重试。" : "The operation did not complete. The existing live website is unaffected. Try again later.";
  }
  if (error instanceof DOMException && error.name === "TimeoutError") return zh ? "等待时间较长，系统仍可能在检查发布结果，请稍后重新查看网站状态。" : "This is taking longer than expected. The result may still be under review; check the website status again shortly.";
  if (error instanceof Error) return error.message;
  return zh ? "操作未完成，请稍后重试。" : "The action could not be completed. Try again.";
}

function dateLabel(value: string | undefined, locale: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function entryPreviewHref(entry: SiteEntry, site: Site) {
  const locale = entry.locale ?? site.defaultLocale;
  const prefix = locale === site.defaultLocale ? "" : locale === "en-US" ? "/en" : "/zh";
  return entry.slug === "home" ? `${prefix || ""}/` : `${prefix}/${entry.slug}/`;
}

function entryPreviewPath(entry: SiteEntry, site: Site) {
  const path = entryPreviewHref(entry, site).replace(/^\/+|\/+$/g, "");
  return path ? `${path}/index.html` : "index.html";
}

export function MySiteView() {
  const { i18n } = useAppTranslation();
  const zh = i18n.language.startsWith("zh");
  const copy = zh ? {
    eyebrow: "官网发布与维护", title: "我的站点", description: "像填写资料一样维护官网，预览确认后再发布。",
    loading: "正在读取站点…", failed: "暂时无法读取站点", retry: "重新读取",
  } : {
    eyebrow: "Website publishing", title: "My site", description: "Maintain your website like a profile, then preview and confirm before publishing.",
    loading: "Loading site…", failed: "The site is temporarily unavailable", retry: "Try again",
  };
  const query = useQuery({ queryKey: SITE_KEY(), queryFn: siteApi.list });
  const site = query.data?.sites[0] ?? null;
  const pilot = useSitePilot();

  return (
    <div className="space-y-5">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title} description={copy.description} />
      <SitePilotPanel pilot={pilot} zh={zh} siteExists={query.isLoading ? null : Boolean(site)} />
      {query.isLoading ? <Notice title={copy.loading} />
        : query.error ? <Notice title={copy.failed} detail={errorMessage(query.error, zh)} action={<Button variant="secondary" onClick={() => void query.refetch()}>{copy.retry}</Button>} />
        : site ? <SiteWorkspace initialSite={site} zh={zh} pilot={pilot} />
        : <SiteSetup zh={zh} pilot={pilot} />}
    </div>
  );
}

function SiteSetup({ zh, pilot }: { zh: boolean; pilot: SitePilotController }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", description: "", audience: "", primaryAction: zh ? "联系我们" : "Contact us", contactEmail: "" });
  const mutation = useMutation({
    mutationFn: () => siteApi.create({ ...form, defaultLocale: zh ? "zh-CN" : "en-US" }),
    onSuccess: (data) => {
      queryClient.setQueryData(SITE_KEY(), { sites: [data.site], count: 1 });
      void pilot.recordMilestone("site_created");
    },
  });
  const copy = zh ? {
    title: "用 2 分钟创建你的官网", hint: "先填写最重要的信息。系统会自动生成首页、关于、服务、文章和联系页面。",
    name: "站点名称", namePlaceholder: "例如：林月工作室", description: "一句话介绍", descriptionPlaceholder: "告诉访客你是谁、能提供什么",
    audience: "主要服务谁", audiencePlaceholder: "例如：需要品牌内容的创业团队", action: "希望访客做什么", email: "联系邮箱",
    create: "创建站点", creating: "正在创建…", privacy: "创建后默认仅你可预览，只有确认发布后才会公开。",
  } : {
    title: "Create your website in two minutes", hint: "Start with the essentials. Home, About, Services, Articles, and Contact pages are generated for you.",
    name: "Site name", namePlaceholder: "For example: Luna Studio", description: "One-line introduction", descriptionPlaceholder: "Tell visitors who you are and what you offer",
    audience: "Who is it for?", audiencePlaceholder: "For example: early-stage teams needing brand content", action: "What should visitors do?", email: "Contact email",
    create: "Create site", creating: "Creating…", privacy: "Your site stays private for preview until you explicitly publish it.",
  };
  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader><CardTitle>{copy.title}</CardTitle><p className="text-sm text-muted-foreground">{copy.hint}</p></CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
          <Field label={copy.name}><Input required maxLength={120} value={form.name} placeholder={copy.namePlaceholder} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label={copy.description}><Textarea required maxLength={500} value={form.description} placeholder={copy.descriptionPlaceholder} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>
          <Field label={copy.audience}><Input maxLength={300} value={form.audience} placeholder={copy.audiencePlaceholder} onChange={(event) => setForm({ ...form, audience: event.target.value })} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={copy.action}><Input maxLength={200} value={form.primaryAction} onChange={(event) => setForm({ ...form, primaryAction: event.target.value })} /></Field>
            <Field label={copy.email}><Input type="email" maxLength={254} value={form.contactEmail} onChange={(event) => setForm({ ...form, contactEmail: event.target.value })} /></Field>
          </div>
          {mutation.error ? <p role="alert" className="text-sm text-destructive">{errorMessage(mutation.error, zh)}</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <p className="max-w-md text-xs text-muted-foreground">{copy.privacy}</p>
            <Button type="submit" disabled={mutation.isPending || !form.name.trim() || !form.description.trim()}>
              <Globe2 />{mutation.isPending ? copy.creating : copy.create}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SiteWorkspace({ initialSite, zh, pilot }: { initialSite: Site; zh: boolean; pilot: SitePilotController }) {
  const navigate = usePageNavigation();
  const queryClient = useQueryClient();
  const professional = useUiStore((state) => state.experienceMode) === "professional";
  const setExperienceMode = useUiStore((state) => state.setExperienceMode);
  const [site, setSite] = useState(initialSite);
  const [tab, setTab] = useState<"content" | "style">("content");
  const [contentLocale, setContentLocale] = useState<"zh-CN" | "en-US">(initialSite.defaultLocale);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [publishPlan, setPublishPlan] = useState<PublicationPlan | null>(null);
  const [rollbackPlan, setRollbackPlan] = useState<PublicationPlan | null>(null);
  const [goLiveOpen, setGoLiveOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewSeen, setPreviewSeen] = useState(Boolean(initialSite.activePublication));
  const [guideExpanded, setGuideExpanded] = useState(!initialSite.activePublication);
  const supportedLocales = site.settings.supportedLocales ?? [site.defaultLocale];
  const secondaryLocale = supportedLocales.find((locale) => locale !== site.defaultLocale) ?? null;
  const sourceEntries = site.entries.filter((entry) => entry.status !== "archived" && (entry.locale ?? site.defaultLocale) === site.defaultLocale);
  const visibleEntries = contentLocale === site.defaultLocale
    ? sourceEntries
    : [...sourceEntries.map((source) => site.entries.find((entry) => entry.status !== "archived" && entry.translationOf === source.id && (entry.locale ?? site.defaultLocale) === contentLocale) ?? source),
      ...site.entries.filter((entry) => entry.status !== "archived" && !entry.translationOf && (entry.locale ?? site.defaultLocale) === contentLocale)];
  useEffect(() => { if (!supportedLocales.includes(contentLocale)) setContentLocale(site.defaultLocale); }, [contentLocale, site.defaultLocale, supportedLocales]);
  const copy = zh ? {
    preview: "预览", publish: "发布网站", publishing: "正在发布…", content: "页面与文章", style: "站点样式", settings: "专业设置",
    private: "仅自己可见", public: "已公开", releaseReady: "发布版本已生成", initialDraft: "网站初稿有 {{count}} 项内容等待首次发布", unpublished: "{{count}} 项未发布修改", upToDate: "所有修改均已发布",
    lastPublish: "发布状态", noPublish: "尚未发布", quick: "内容管理", quickHint: "打开页面直接修改文字和内容模块。",
    addArticle: "写新文章", edit: "编辑", openPreview: "预览页面", publishedAt: "发布于 {{date}}",
    confirmPublish: "确认发布网站？", publishDetail: "本次会发布 {{count}} 项内容修改，共 {{files}} 个静态文件。发布前不会影响当前线上版本。",
    confirm: "确认发布", cancel: "暂不发布", publishDone: "网站已成功发布。", releaseDone: "发布版本已生成；连接云平台或主机后才会在公网可访问。", restore: "恢复上一版本", restoreTitle: "恢复上一版本？",
    restoreDetail: "线上网站会立即恢复到版本 {{version}}，当前草稿不会丢失。", restoreDone: "线上网站已恢复，未发布草稿保持不变。", restoreLocalDetail: "已生成的网站版本会恢复到版本 {{version}}，当前草稿不会丢失。", restoreLocalDone: "已恢复上一版本，未发布草稿保持不变。",
  } : {
    preview: "Preview", publish: "Publish website", publishing: "Publishing…", content: "Pages & articles", style: "Site style", settings: "Professional settings",
    private: "Private preview", public: "Public", releaseReady: "Release generated", initialDraft: "First publication pending · Ready content: {{count}}", unpublished: "{{count}} unpublished changes", upToDate: "All changes are published",
    lastPublish: "Publishing status", noPublish: "Not published yet", quick: "Content management", quickHint: "Open a page to edit its copy and content blocks.",
    addArticle: "New article", edit: "Edit", openPreview: "Preview page", publishedAt: "Published {{date}}",
    confirmPublish: "Publish this website?", publishDetail: "This publishes {{count}} content changes across {{files}} static files. The live site is unchanged until you confirm.",
    confirm: "Confirm publish", cancel: "Not now", publishDone: "The website was published successfully.", releaseDone: "A release was generated. Connect a cloud platform or host before it is reachable on the public internet.", restore: "Restore previous version", restoreTitle: "Restore the previous version?",
    restoreDetail: "The live website will immediately return to version {{version}}. Your current drafts will not be lost.", restoreDone: "The live website was restored and current drafts were kept.", restoreLocalDetail: "The generated website version will return to version {{version}}. Your current drafts will not be lost.", restoreLocalDone: "The previous version was restored and current drafts were kept.",
  };
  useEffect(() => setSite(initialSite), [initialSite]);
  const publications = useQuery({ queryKey: ["my-site-publications", site.id], queryFn: () => siteApi.publications(site.id), enabled: Boolean(site.activePublicationId) });
  const previousPublication = publications.data?.publications.find((item) => item.id !== site.activePublicationId && item.verification?.status === "healthy") ?? null;
  const publish = useMutation({
    mutationFn: async ({ planId }: { planId?: string }) => {
      if (!planId) return { phase: "review" as const, plan: (await siteApi.createPublicationPlan(site.id)).plan };
      return { phase: "published" as const, ...(await siteApi.confirmPublication(site.id, planId)) };
    },
    onSuccess: (result) => {
      if (result.phase === "review") { setPublishPlan(result.plan); void pilot.recordMilestone("publication_reviewed"); return; }
      setSite(result.site); setPublishPlan(null); setNotice(result.site.deploymentTarget?.kind === "local_directory" ? copy.releaseDone : copy.publishDone);
      queryClient.setQueryData(SITE_KEY(), { sites: [result.site], count: 1 });
      void queryClient.invalidateQueries({ queryKey: ["my-site-publications", site.id] });
      void pilot.recordMilestone("published");
    },
  });
  const publicationProgress = useQuery({
    queryKey: ["my-site-publication-progress", site.id, publishPlan?.id],
    queryFn: () => siteApi.publicationPlan(site.id, publishPlan!.id),
    enabled: Boolean(publish.isPending && publishPlan?.id),
    refetchInterval: publish.isPending ? 1_000 : false,
  });
  const rollback = useMutation({
    mutationFn: async () => {
      if (!previousPublication) throw new Error("No previous publication");
      const created = rollbackPlan ?? (await siteApi.createRollbackPlan(site.id, previousPublication.id)).plan;
      if (!rollbackPlan) { setRollbackPlan(created); return null; }
      return siteApi.confirmRollback(site.id, created.id);
    },
    onSuccess: (result) => {
      if (!result) return;
      const restoredPublic = result.site.visibility === "public" && Boolean(result.site.publicUrl);
      setSite(result.site); setRollbackPlan(null); setNotice(restoredPublic ? copy.restoreDone : copy.restoreLocalDone);
      queryClient.setQueryData(SITE_KEY(), { sites: [result.site], count: 1 });
      void queryClient.invalidateQueries({ queryKey: ["my-site-publications", site.id] });
    },
  });
  const changeCount = publishPlan ? (publishPlan.changes.added?.length ?? 0) + (publishPlan.changes.changed?.length ?? 0) + (publishPlan.changes.removed?.length ?? 0) + (publishPlan.changes.siteChanged ? 1 : 0) : 0;
  const isPublic = site.visibility === "public" && Boolean(site.publicUrl);
  const hasLocalRelease = Boolean(site.activePublication) && !isPublic;
  const journey = siteJourney(site, previewSeen);
  const experienceState = siteExperienceState(site);
  const maintenanceTaskSaved = pilot.session?.scenario === "content_maintenance"
    && pilot.session.milestones.some((milestone) => milestone.key === "content_saved");

  function replaceSite(next: Site) {
    setSite(next);
    queryClient.setQueryData(SITE_KEY(), { sites: [next], count: 1 });
  }

  function openPreview(path = "index.html") {
    setPreviewSeen(true);
    setPreviewPath(path);
    void pilot.recordMilestone("preview_opened");
  }

  function startPublish() {
    publish.reset();
    setNotice(null);
    publish.mutate({});
  }

  function retryPublish() {
    setPublishPlan(null);
    publish.reset();
    publish.mutate({});
  }

  function restoreHealthyRelease() {
    setPublishPlan(null);
    publish.reset();
    rollback.mutate();
  }

  function continueGoLive(handoff: Omit<GoLiveHandoff, "siteId">) {
    writeGoLiveHandoff({ siteId: site.id, ...handoff });
    setGoLiveOpen(false);
    setExperienceMode("professional");
    void (async () => {
      await pilot.recordMilestone("go_live_handoff_completed");
      await pilot.recordMilestone("professional_setup_opened");
    })();
    navigate("siteSettings");
  }

  function openGoLive() {
    setGoLiveOpen(true);
    void pilot.recordMilestone("go_live_handoff_opened");
  }

  function openProfessionalSettings() {
    void pilot.recordMilestone("professional_setup_opened");
    navigate("siteSettings");
  }

  function runJourneyAction() {
    if (journey.nextAction === "preview") openPreview();
    else if (journey.nextAction === "publish") startPublish();
    else if (journey.nextAction === "go_live") openGoLive();
    else if (site.publicUrl) window.open(site.publicUrl, "_blank", "noopener,noreferrer");
  }

  if (pilot.campaignCode && pilot.assignedScenario === "status_understanding") {
    return <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-lg font-semibold">{site.name}</h2><StatusBadge tone={isPublic ? "success" : "neutral"}>{isPublic ? copy.public : hasLocalRelease ? (zh ? "已有本地版本" : "Local release ready") : copy.private}</StatusBadge></div>
          <p className="mt-1 text-sm text-muted-foreground">{zh ? "这是只读判断任务。请根据这里的状态和预览回答上方问题。" : "This is a read-only identification task. Use this status and the preview to answer the question above."}</p>
        </div>
        <Button className="w-full sm:w-auto" variant="secondary" onClick={() => openPreview()}><Eye />{copy.preview}</Button>
      </div>
      <PreviewModal siteId={site.id} path={previewPath} zh={zh} onClose={() => setPreviewPath(null)} />
    </>;
  }

  return <>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-lg font-semibold">{site.name}</h2><StatusBadge tone={isPublic ? "success" : "neutral"}>{isPublic ? copy.public : hasLocalRelease ? (zh ? "已有本地版本" : "Local release ready") : copy.private}</StatusBadge></div>
        <p className="mt-1 text-sm text-muted-foreground">{site.unpublishedCount ? (site.activePublication ? copy.unpublished : copy.initialDraft).replace("{{count}}", String(site.unpublishedCount)) : copy.upToDate}</p>
      </div>
      <div className="flex w-full flex-wrap gap-2 sm:w-auto">
        {professional ? <Button variant="ghost" onClick={openProfessionalSettings}><Settings2 />{copy.settings}</Button> : null}
        <Button className="flex-1 sm:flex-none" variant="secondary" onClick={() => openPreview()}><Eye />{copy.preview}</Button>
        <Button className="flex-1 sm:flex-none" disabled={publish.isPending || site.unpublishedCount === 0} title={site.unpublishedCount === 0 ? (zh ? "网站已经是最新版本" : "The website is already up to date") : undefined} onClick={startPublish}><Rocket />{publish.isPending ? copy.publishing : copy.publish}</Button>
      </div>
    </div>
    {notice ? <div role="status" className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success"><Check className="size-4" />{notice}</div> : null}
    {maintenanceTaskSaved ? <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success/30 bg-success/5 p-3 text-sm">
      <span className="flex items-center gap-2 text-success"><CheckCircle2 className="size-4" />{zh ? "修改已保存，本次任务不需要发布。" : "Your change is saved. Publishing is not required for this task."}</span>
      <Button size="sm" onClick={() => document.getElementById("site-pilot-panel")?.scrollIntoView({ behavior: "smooth", block: "start" })}>{zh ? "提交体验结果" : "Submit pilot result"}</Button>
    </div> : null}
    {publish.error && !publishPlan ? <PublishRecovery error={publish.error} zh={zh} professional={professional} hasActiveRelease={Boolean(site.activePublication)} canRestore={Boolean(previousPublication)} onRetry={retryPublish} onSettings={() => { setExperienceMode("professional"); navigate("siteSettings"); }} onRestore={previousPublication ? restoreHealthyRelease : undefined} /> : null}
    {rollback.error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{errorMessage(rollback.error, zh)}</p> : null}
    <SiteJourneyCard state={experienceState} journey={journey} zh={zh} expanded={guideExpanded} pending={publish.isPending} onToggle={() => setGuideExpanded((value) => !value)} onAction={runJourneyAction} />
    {site.domainTlsBinding ? <DomainTlsJourneyNotice site={site} zh={zh} onContinue={() => { setExperienceMode("professional"); navigate("siteSettings"); }} /> : null}
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div><CardTitle>{copy.quick}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{copy.quickHint}</p></div>
          {tab === "content" ? <div className="flex flex-wrap justify-end gap-2"><NewCaseButton site={site} locale={contentLocale} zh={zh} onCreated={(next, entry, showcaseAdded) => { replaceSite(next); setNotice(showcaseAdded ? (zh ? "案例草稿已保存，并已加入当前语言的首页案例展示。发布后访客即可看到。" : "The case draft is saved and added to this language's home page showcase. Visitors can see it after publishing.") : (zh ? "案例草稿已保存。发布后访客即可看到。" : "The case draft is saved. Visitors can see it after publishing.")); setPreviewPath(entryPreviewPath(entry, site)); void pilot.recordMilestone("content_saved"); }} /><NewArticleButton site={site} locale={contentLocale} zh={zh} onCreated={(next) => { replaceSite(next); void pilot.recordMilestone("content_saved"); }} /></div> : null}
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex gap-1 rounded-lg bg-muted p-1" role="tablist">
            <Tab active={tab === "content"} onClick={() => setTab("content")} icon={LayoutTemplate}>{copy.content}</Tab>
            <Tab active={tab === "style"} onClick={() => setTab("style")} icon={Palette}>{copy.style}</Tab>
          </div>
          {tab === "content" ? <div className="space-y-3">{secondaryLocale ? <Field label={zh ? "正在维护的内容语言" : "Content language"}><Select aria-label={zh ? "内容语言" : "Content language"} value={contentLocale} onChange={(event) => setContentLocale(event.target.value as "zh-CN" | "en-US")}><option value="zh-CN">中文</option><option value="en-US">English</option></Select></Field> : null}<div className="divide-y divide-border rounded-lg border border-border">
            {visibleEntries.map((entry) => { const isPlaceholder = contentLocale !== site.defaultLocale && (entry.locale ?? site.defaultLocale) !== contentLocale; return <div key={`${entry.id}-${contentLocale}`} className="flex flex-wrap items-center gap-3 p-3">
              <span className="grid size-9 place-items-center rounded-lg bg-muted"><LayoutTemplate className="size-4 text-muted-foreground" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{entry.title}</span><span className="block truncate text-xs text-muted-foreground">{professional && !isPlaceholder ? `${entryPreviewHref(entry, site)} · ` : ""}{entry.type === "article" ? (zh ? "文章" : "Article") : entry.type === "case" ? (zh ? "案例" : "Case") : (zh ? "页面" : "Page")}</span></span>
              {isPlaceholder ? <StatusBadge>{zh ? "未翻译" : "Not translated"}</StatusBadge> : null}
              {!isPlaceholder && entry.hasUnpublishedChanges ? <StatusBadge tone="warning">{zh ? "有修改" : "Changed"}</StatusBadge> : null}
              {isPlaceholder ? <CreateTranslationButton site={site} source={entry} locale={contentLocale} zh={zh} onCreated={(next, translated) => { replaceSite(next); setNotice(zh ? "翻译草稿已创建，请继续翻译页面中的可见文字。" : "Translation draft created. Continue translating the visible page text."); setSelectedEntryId(translated.id); }} /> : <><Button size="sm" variant="ghost" aria-label={`${copy.openPreview}${zh ? "：" : ": "}${entry.title}`} onClick={() => openPreview(entryPreviewPath(entry, site))}><Eye />{copy.openPreview}</Button><Button size="sm" variant="secondary" aria-label={`${copy.edit}${zh ? "：" : ": "}${entry.title}`} onClick={() => setSelectedEntryId(entry.id)}>{copy.edit}</Button></>}
            </div>; })}
          </div></div> : <StyleEditor site={site} zh={zh} onSaved={(next) => { replaceSite(next); void pilot.recordMilestone("content_saved"); }} />}
        </CardContent>
      </Card>
      <div className="space-y-4">
        <Card><CardContent className="p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{copy.lastPublish}</p><p className="mt-2 text-lg font-semibold">{isPublic ? (zh ? `线上版本 v${site.activePublication?.version}` : `Live version v${site.activePublication?.version}`) : hasLocalRelease ? (zh ? `本地版本 v${site.activePublication?.version}` : `Local version v${site.activePublication?.version}`) : copy.noPublish}</p>{site.activePublication ? <p className="mt-1 text-xs text-muted-foreground">{(isPublic ? copy.publishedAt : (zh ? "生成于 {{date}}" : "Generated {{date}}")).replace("{{date}}", dateLabel(site.activePublication.activatedAt, zh ? "zh-CN" : "en-US"))}</p> : null}{site.publicUrl ? <a className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline" href={site.publicUrl} target="_blank" rel="noreferrer">{zh ? "打开网站" : "Open website"}<ExternalLink className="size-3.5" /></a> : <div className="mt-3 space-y-2"><p className="text-xs leading-5 text-muted-foreground">{zh ? "当前只有你能预览。完成上线设置后，访客才能通过网址打开。" : "Only you can preview this version. Complete go-live setup before visitors can open it."}</p><Button className="w-full" size="sm" variant="secondary" onClick={openGoLive}><Globe2 />{zh ? "完成上线设置" : "Complete go-live setup"}</Button></div>}</CardContent></Card>
        {previousPublication ? <Card><CardContent className="p-4"><div className="mb-3 flex items-center gap-2"><History className="size-4 text-muted-foreground" /><p className="text-sm font-medium">v{previousPublication.version}</p></div><Button className="w-full" variant="secondary" size="sm" disabled={rollback.isPending} onClick={() => rollback.mutate()}>{copy.restore}</Button></CardContent></Card> : null}
      </div>
    </div>

    <EntryEditor siteId={site.id} entryId={selectedEntryId} zh={zh} onClose={() => setSelectedEntryId(null)} onSaved={(next) => { replaceSite(next); setSelectedEntryId(null); void pilot.recordMilestone("content_saved"); }} />
    <PreviewModal siteId={site.id} path={previewPath} zh={zh} onClose={() => setPreviewPath(null)} />
    <Modal open={Boolean(publishPlan)} closeDisabled={publish.isPending} onClose={() => { setPublishPlan(null); publish.reset(); }} title={publish.isPending ? copy.publishing : copy.confirmPublish} description={publish.isPending ? (zh ? "正在安全发布，当前网站会保留到新版本验证通过。" : "Publishing safely. The current website stays available until the new version is verified.") : (zh ? `本次会发布 ${changeCount} 项内容修改。现有网站会保持可用，直到新版本检查完成。` : `This publishes ${changeCount} content changes. The existing website stays available until the new version passes its checks.`)} footer={publish.isPending ? <div className="flex justify-end"><Button disabled><Loader2 className="animate-spin" />{copy.publishing}</Button></div> : publish.error ? <div className="flex justify-end"><Button variant="secondary" onClick={() => { setPublishPlan(null); publish.reset(); }}>{zh ? "稍后处理" : "Handle later"}</Button></div> : <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setPublishPlan(null)}>{copy.cancel}</Button><Button onClick={() => publish.mutate({ planId: publishPlan!.id })}><Rocket />{copy.confirm}</Button></div>}><div className="space-y-4">{publish.isPending ? <PublishProgress plan={publicationProgress.data?.plan ?? publishPlan} zh={zh} professional={professional} /> : <PlanSummary plan={publishPlan} site={site} zh={zh} />}{publish.error ? <PublishRecovery error={publish.error} zh={zh} professional={professional} hasActiveRelease={Boolean(site.activePublication)} canRestore={Boolean(previousPublication)} onRetry={retryPublish} onSettings={() => { setPublishPlan(null); setExperienceMode("professional"); navigate("siteSettings"); }} onRestore={previousPublication ? restoreHealthyRelease : undefined} /> : null}</div></Modal>
    <Modal open={Boolean(rollbackPlan)} onClose={() => setRollbackPlan(null)} title={copy.restoreTitle} description={(isPublic ? copy.restoreDetail : copy.restoreLocalDetail).replace("{{version}}", String(rollbackPlan?.changes.toVersion ?? ""))} footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setRollbackPlan(null)}>{copy.cancel}</Button><Button disabled={rollback.isPending} onClick={() => rollback.mutate()}><History />{copy.restore}</Button></div>}><div className="space-y-2 text-sm text-muted-foreground"><p>{isPublic ? (zh ? "网站全部公开页面、文章和图片会恢复到该版本。" : "All public pages, articles, and images will return to that version.") : (zh ? "已生成版本中的页面、文章和图片会恢复到该版本。" : "Pages, articles, and images in the generated release will return to that version.")}</p><p>{zh ? `你当前的 ${site.unpublishedCount} 项未发布修改会继续保留，可以稍后再次发布。` : `Your ${site.unpublishedCount} unpublished changes will be kept so you can publish them later.`}</p></div></Modal>
    <GoLiveGuide open={goLiveOpen} zh={zh} onClose={() => setGoLiveOpen(false)} onContinue={continueGoLive} />
  </>;
}

function DomainTlsJourneyNotice({ site, zh, onContinue }: { site: Site; zh: boolean; onContinue: () => void }) {
  const binding = site.domainTlsBinding!;
  const active = binding.status === "active";
  const attention = binding.status === "needs_attention" || binding.status === "renewal_due";
  const title = active
    ? (zh ? "网站安全连接已启用" : "Secure website connection is active")
    : attention
      ? (zh ? "网站安全连接需要处理" : "Secure website connection needs attention")
      : (zh ? "网站域名已保存，HTTPS 尚未完成" : "Website domain saved; HTTPS is not finished yet");
  const detail = active
    ? (zh ? `访客可通过 https://${binding.hostname}/ 安全访问。` : `Visitors can securely open https://${binding.hostname}/.`)
    : attention
      ? (zh ? "网站内容和旧版本不会被自动删除，请让配置人员重新检查域名、证书和服务器。" : "Website content and the previous release remain intact. Ask the setup owner to recheck the domain, certificate, and server.")
      : (zh ? "当前仍可继续编辑和预览；完成证书签发和服务器检查后，访客才能通过 HTTPS 打开。" : "You can keep editing and previewing. Visitors can use HTTPS after certificate issuance and server checks are complete.");
  return <div className={`flex flex-wrap items-center gap-3 rounded-xl border p-4 ${active ? "border-success/30 bg-success/5" : attention ? "border-warning/30 bg-warning/5" : "border-border bg-card"}`}>
    <span className={`grid size-10 shrink-0 place-items-center rounded-lg ${active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}><ShieldCheck className="size-5" /></span>
    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{title}</p><StatusBadge tone={active ? "success" : attention ? "warning" : "neutral"}>{binding.accessMode === "private_lan" ? (zh ? "仅局域网" : "Private LAN") : (zh ? "公网" : "Public")}</StatusBadge></div><p className="mt-1 text-sm text-muted-foreground">{detail}</p></div>
    {!active ? <Button variant="secondary" onClick={onContinue}><Settings2 />{zh ? "继续上线设置" : "Continue setup"}</Button> : site.publicUrl ? <a className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline" href={site.publicUrl} target="_blank" rel="noreferrer">{zh ? "打开网站" : "Open website"}<ExternalLink className="size-3.5" /></a> : null}
  </div>;
}

function SiteJourneyCard({ state, journey, zh, expanded, pending, onToggle, onAction }: {
  state: ReturnType<typeof siteExperienceState>;
  journey: ReturnType<typeof siteJourney>;
  zh: boolean;
  expanded: boolean;
  pending: boolean;
  onToggle: () => void;
  onAction: () => void;
}) {
  const stateCopy = zh ? {
    draft: ["初稿", "网站内容已经生成，先检查访客会看到的效果。"],
    changes: ["有修改", "修改已经安全保存，发布后访客才会看到。"],
    local: ["本地版本", "网站版本已经生成，但访客还不能通过互联网打开。"],
    public: ["已上线", "访客可以打开网站；后续修改仍需再次发布。"],
  } : {
    draft: ["Draft", "Your content is ready. Preview what visitors will see next."],
    changes: ["Changes ready", "Changes are safely saved and become visible only after publishing."],
    local: ["Local release", "A website release exists, but visitors cannot open it on the internet yet."],
    public: ["Live", "Visitors can open the website. Future changes still need to be published."],
  };
  const steps = zh ? [
    ["content", "内容已准备"], ["preview", "检查网站预览"], ["publish", "发布最新内容"], ["online", "访客可以访问"],
  ] as const : [
    ["content", "Content ready"], ["preview", "Review preview"], ["publish", "Publish latest content"], ["online", "Visitors can access it"],
  ] as const;
  const actionLabels = zh ? { preview: "先预览网站", publish: "发布最新修改", go_live: "完成上线设置", open_site: "打开网站" }
    : { preview: "Preview website", publish: "Publish latest changes", go_live: "Complete go-live setup", open_site: "Open website" };
  const [stateLabel, stateDetail] = stateCopy[state];
  return <Card><CardContent className="p-4">
    <div className="flex flex-wrap items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><ListChecks className="size-5" /></span>
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{zh ? "网站发布进度" : "Website publishing progress"}</p><StatusBadge tone={state === "public" ? "success" : state === "changes" ? "warning" : "neutral"}>{stateLabel}</StatusBadge></div><p className="mt-0.5 text-sm text-muted-foreground">{stateDetail}</p></div>
      <Button variant="ghost" size="sm" aria-expanded={expanded} onClick={onToggle}>{expanded ? (zh ? "收起步骤" : "Hide steps") : (zh ? `查看步骤 ${journey.completed}/${journey.total}` : `View steps ${journey.completed}/${journey.total}`)}{expanded ? <ChevronUp /> : <ChevronDown />}</Button>
    </div>
    {expanded ? <div className="mt-4 border-t border-border pt-4"><ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{steps.map(([key, label], index) => {
      const done = journey.steps[key];
      return <li key={key} className={`rounded-lg border p-3 ${done ? "border-success/30 bg-success/5" : "border-border"}`}><span className="flex items-center gap-2 text-sm font-medium">{done ? <CheckCircle2 className="size-4 text-success" /> : <span className="grid size-5 place-items-center rounded-full bg-muted text-xs">{index + 1}</span>}{label}</span></li>;
    })}</ol><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{zh ? "保存不会自动公开；只有确认发布后才会生成新版本。" : "Saving never publishes automatically; a new release is created only after confirmation."}</p><Button disabled={pending} onClick={onAction}>{journey.nextAction === "preview" ? <Eye /> : journey.nextAction === "publish" ? <Rocket /> : journey.nextAction === "go_live" ? <Globe2 /> : <ExternalLink />}{actionLabels[journey.nextAction]}</Button></div></div> : null}
  </CardContent></Card>;
}

function PublishRecovery({ error, zh, professional, hasActiveRelease, canRestore, onRetry, onSettings, onRestore }: {
  error: unknown;
  zh: boolean;
  professional: boolean;
  hasActiveRelease: boolean;
  canRestore: boolean;
  onRetry: () => void;
  onSettings: () => void;
  onRestore?: () => void;
}) {
  const code = error instanceof ApiError ? error.code : null;
  const kind = publicationRecoveryKind(code);
  const safety = kind === "manual_recovery"
    ? (zh ? "系统无法确认当前线上指针，请不要重复发布；维护人员应先检查服务器上的 current。" : "The current live pointer could not be confirmed. Do not republish; a maintainer should inspect current on the server first.")
    : hasActiveRelease
      ? (zh ? "当前可用版本没有被替换，访客仍会看到发布前的网站。" : "The current working release was not replaced; visitors still see the previous website.")
      : (zh ? "失败的版本没有公开，当前仍只有你能预览。" : "The failed release was not made public; only you can preview the site.");
  return <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
    <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" /><div className="min-w-0 flex-1"><p className="font-medium text-destructive">{zh ? "这次发布没有完成" : "This publication did not complete"}</p><p className="mt-1 text-sm text-foreground">{errorMessage(error, zh)}</p><p className="mt-1 text-sm text-muted-foreground">{safety}</p>{professional && code ? <p className="mt-2 font-mono text-xs text-muted-foreground">error={code}{error instanceof ApiError ? ` · http=${error.status}` : ""}</p> : null}</div></div>
    <div className="mt-3 flex flex-wrap justify-end gap-2">
      {kind === "configuration" ? <Button variant="secondary" onClick={onSettings}><Settings2 />{zh ? "检查上线设置" : "Check go-live settings"}</Button> : null}
      {kind === "manual_recovery" && canRestore && onRestore ? <Button variant="secondary" onClick={onRestore}><History />{zh ? "恢复上一健康版本" : "Restore last healthy release"}</Button> : null}
      {kind === "manual_recovery" && (!canRestore || !onRestore) ? <Button variant="secondary" onClick={onSettings}><Settings2 />{zh ? "查看专业诊断" : "Open professional diagnostics"}</Button> : null}
      {kind === "retry" ? <Button onClick={onRetry}><RotateCcw />{zh ? "重新检查并发布" : "Review and retry"}</Button> : null}
    </div>
  </div>;
}

function StyleEditor({ site, zh, onSaved }: { site: Site; zh: boolean; onSaved: (site: Site) => void }) {
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState(site.settings);
  const assets = useQuery({ queryKey: ["my-site-assets", site.id], queryFn: () => siteApi.assets(site.id) });
  useEffect(() => setSettings(site.settings), [site.settings]);
  const mutation = useMutation({ mutationFn: () => siteApi.update(site.id, { expectedRevision: site.revision, settings }), onSuccess: (data) => onSaved(data.site) });
  const logoUpload = useMutation({
    mutationFn: async (file: File) => {
      const uploaded = await siteApi.uploadAsset(site.id, file);
      const latest = await siteApi.list();
      const freshSite = latest.sites.find((item) => item.id === site.id);
      if (!freshSite) throw new Error("site_not_found");
      const updated = await siteApi.update(site.id, { expectedRevision: freshSite.revision, settings: { ...freshSite.settings, logoAssetId: uploaded.asset.id } });
      return { ...uploaded, site: updated.site };
    },
    onSuccess: (data) => {
      onSaved(data.site);
      void queryClient.invalidateQueries({ queryKey: ["my-site-assets", site.id] });
    },
  });
  return <div className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={zh ? "整体风格" : "Theme"}><Select value={String(settings.theme ?? "ocean")} onChange={(event) => setSettings({ ...settings, theme: event.target.value as "ocean" | "ink" | "warm" })}><option value="ocean">{zh ? "清晰蓝" : "Clear blue"}</option><option value="ink">{zh ? "简约黑" : "Minimal ink"}</option><option value="warm">{zh ? "温暖米色" : "Warm neutral"}</option></Select></Field>
      <Field label={zh ? "品牌色" : "Brand color"}><Input type="color" className="p-1" value={String(settings.brandColor ?? "#155eef")} onChange={(event) => setSettings({ ...settings, brandColor: event.target.value })} /></Field>
    </div>
    <Field label={zh ? "站点标志" : "Site logo"} asGroup><div className="flex flex-wrap gap-2"><Select aria-label={zh ? "已选择的站点标志" : "Selected site logo"} className="min-w-48 flex-1" value={String(settings.logoAssetId ?? "")} onChange={(event) => setSettings({ ...settings, logoAssetId: event.target.value || null })}><option value="">{zh ? "不使用标志" : "No logo"}</option>{assets.data?.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</Select><label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-secondary px-3 py-2 text-sm font-medium hover:bg-secondary/80"><Upload className="size-4" />{logoUpload.isPending ? (zh ? "上传中…" : "Uploading…") : (zh ? "上传新标志" : "Upload new logo")}<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" disabled={logoUpload.isPending} onChange={(event) => { const file = event.target.files?.[0]; if (file) logoUpload.mutate(file); event.currentTarget.value = ""; }} /></label></div></Field>
    <Field label={zh ? "页脚文字" : "Footer text"}><Input maxLength={300} value={String(settings.footerText ?? "")} onChange={(event) => setSettings({ ...settings, footerText: event.target.value })} /></Field>
    {mutation.error || logoUpload.error ? <p role="alert" className="text-sm text-destructive">{errorMessage(mutation.error ?? logoUpload.error, zh)}</p> : null}
    <div className="flex justify-end"><Button disabled={mutation.isPending} onClick={() => mutation.mutate()}><Save />{mutation.isPending ? (zh ? "正在保存…" : "Saving…") : (zh ? "保存样式" : "Save style")}</Button></div>
  </div>;
}

function EntryEditor({ siteId, entryId, zh, onClose, onSaved }: { siteId: string; entryId: string | null; zh: boolean; onClose: () => void; onSaved: (site: Site) => void }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["my-site-entry", siteId, entryId], queryFn: () => siteApi.getEntry(siteId, entryId!), enabled: Boolean(entryId) });
  const assets = useQuery({ queryKey: ["my-site-assets", siteId], queryFn: () => siteApi.assets(siteId), enabled: Boolean(entryId) });
  const [draft, setDraft] = useState<SiteEntry | null>(null);
  const [focusAssetId, setFocusAssetId] = useState<string | null>(null);
  useEffect(() => { if (query.data?.entry) setDraft(query.data.entry); }, [query.data]);
  const dirty = Boolean(draft && query.data?.entry && entryFingerprint(draft) !== entryFingerprint(query.data.entry));
  const requestClose = () => {
    if (dirty && !window.confirm(zh ? "还有未保存的修改，确定离开吗？" : "You have unsaved changes. Leave anyway?")) return;
    onClose();
  };
  const mutation = useMutation({
    mutationFn: () => siteApi.updateEntry(siteId, draft!.id, { expectedRevision: draft!.revision, title: draft!.title, summary: draft!.summary, slug: draft!.slug, status: draft!.status, blocks: draft!.blocks ?? [], note: zh ? "在普通视图中编辑" : "Edited in ordinary view" }),
    onSuccess: (data) => onSaved(data.site),
  });
  const upload = useMutation({
    mutationFn: (file: File) => siteApi.uploadAsset(siteId, file),
    onSuccess: (data) => {
      setFocusAssetId(data.asset.id);
      void queryClient.invalidateQueries({ queryKey: ["my-site-assets", siteId] });
      void queryClient.invalidateQueries({ queryKey: SITE_KEY() });
    },
  });
  const blockNames: Record<SiteBlockType, string> = zh ? { hero: "首屏介绍", rich_text: "正文", service_cards: "服务卡片", case_cards: "案例卡片", article_list: "文章列表", gallery: "图片集", metrics: "数据指标", faq: "常见问题", contact: "联系方式", cta: "行动按钮" } : { hero: "Hero", rich_text: "Text", service_cards: "Service cards", case_cards: "Case cards", article_list: "Article list", gallery: "Gallery", metrics: "Metrics", faq: "FAQ", contact: "Contact", cta: "Call to action" };
  function updateBlock(index: number, next: SiteBlock) { if (draft) setDraft({ ...draft, blocks: (draft.blocks ?? []).map((block, blockIndex) => blockIndex === index ? next : block) }); }
  function addBlock(type: SiteBlockType) {
    if (!draft) return;
    const defaults: Record<SiteBlockType, Record<string, unknown>> = {
      hero: { title: zh ? "新的介绍" : "New introduction", subtitle: "" }, rich_text: { title: zh ? "新段落" : "New section", paragraphs: [""] },
      service_cards: { title: zh ? "服务" : "Services", items: [{ title: "", description: "" }] }, case_cards: { title: zh ? "案例" : "Cases", items: [{ title: "", description: "" }] },
      article_list: { title: zh ? "最新文章" : "Latest articles" }, gallery: { title: zh ? "图片" : "Gallery", items: [] }, metrics: { title: zh ? "数据" : "Metrics", items: [{ label: "", value: "" }] },
      faq: { title: zh ? "常见问题" : "FAQ", items: [{ question: "", answer: "" }] }, contact: { title: zh ? "联系我们" : "Contact us", description: "" }, cta: { title: zh ? "准备好开始了吗？" : "Ready to begin?", description: "", label: zh ? "联系我们" : "Contact us", url: "/contact/" },
    };
    setDraft({ ...draft, blocks: [...(draft.blocks ?? []), { id: `block-${Date.now()}`, type, data: defaults[type] }] });
  }
  return <Modal open={Boolean(entryId)} onClose={requestClose} title={draft?.title ?? (zh ? "编辑内容" : "Edit content")} description={dirty ? (zh ? "有未保存的修改。保存后仍需发布，访客才会看到。" : "You have unsaved changes. Save and publish before visitors can see them.") : (zh ? "直接修改访客会看到的文字和内容模块。" : "Edit the copy and content blocks visitors will see.")} size="xl" footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={requestClose}>{zh ? "取消" : "Cancel"}</Button><Button disabled={!draft || mutation.isPending || !dirty} onClick={() => mutation.mutate()}><Save />{mutation.isPending ? (zh ? "正在保存…" : "Saving…") : dirty ? (zh ? "保存修改" : "Save changes") : (zh ? "已保存" : "Saved")}</Button></div>}>
    {!draft ? <p className="text-sm text-muted-foreground">{query.error ? errorMessage(query.error, zh) : (zh ? "正在加载…" : "Loading…")}</p> : <div className="space-y-5">
      <Field label={zh ? "页面标题" : "Page title"}><Input maxLength={200} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></Field>
      <Field label={zh ? "页面摘要" : "Page summary"}><Textarea maxLength={500} value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></Field>
      <div className="rounded-lg border border-border p-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium">{zh ? "图片素材" : "Images"}</p><p className="text-xs text-muted-foreground">{zh ? "上传后会自动优化；原图始终保留。可在首屏或图片集中选择，也可调整裁剪位置。" : "Images are optimized automatically while originals are kept. Select them in hero or gallery blocks, and adjust the crop position when needed."}</p></div><label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-secondary px-3 py-2 text-sm font-medium hover:bg-secondary/80"><Upload className="size-4" />{upload.isPending ? (zh ? "上传中…" : "Uploading…") : (zh ? "上传图片" : "Upload image")}<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" disabled={upload.isPending} onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.currentTarget.value = ""; }} /></label></div>{assets.data?.assets.length ? <div className="mt-3 flex gap-2 overflow-x-auto pb-1">{assets.data.assets.map((asset) => <button type="button" key={asset.id} aria-label={`${zh ? "调整图片展示位置" : "Adjust image position"}: ${asset.name}`} aria-pressed={focusAssetId === asset.id} onClick={() => setFocusAssetId(focusAssetId === asset.id ? null : asset.id)} className={`w-24 shrink-0 rounded-md p-1 text-left ${focusAssetId === asset.id ? "bg-primary/10 ring-2 ring-primary" : "hover:bg-muted"}`}><img src={siteApi.assetContentUrl(siteId, asset.id)} alt={asset.altText || asset.name} style={{ objectPosition: `${asset.focalPoint?.x ?? 50}% ${asset.focalPoint?.y ?? 50}%` }} className="h-14 w-full rounded-md border border-border object-cover" /><p className="mt-1 truncate text-[11px] text-muted-foreground">{asset.name}</p><span className="block text-[10px] text-primary">{zh ? "调整位置" : "Adjust"}</span></button>)}</div> : null}{focusAssetId ? <AssetFocusEditor siteId={siteId} asset={assets.data?.assets.find((asset) => asset.id === focusAssetId) ?? null} zh={zh} /> : null}{upload.error ? <p role="alert" className="mt-2 text-sm text-destructive">{errorMessage(upload.error, zh)}</p> : null}</div>
      <div className="space-y-3">{(draft.blocks ?? []).map((block, index) => <BlockEditor key={block.id} block={block} name={blockNames[block.type]} zh={zh} assets={assets.data?.assets ?? []} onChange={(next) => updateBlock(index, next)} onRemove={() => setDraft({ ...draft, blocks: (draft.blocks ?? []).filter((_, blockIndex) => blockIndex !== index) })} />)}</div>
      <div className="rounded-lg border border-dashed border-border p-3"><p className="mb-2 text-xs font-medium text-muted-foreground">{zh ? "添加内容模块" : "Add content block"}</p><div className="flex flex-wrap gap-2">{(["rich_text", "service_cards", "gallery", "faq", "cta", "contact"] as SiteBlockType[]).map((type) => <Button key={type} size="sm" variant="secondary" onClick={() => addBlock(type)}><Plus />{blockNames[type]}</Button>)}</div></div>
      {mutation.error ? <p role="alert" className="text-sm text-destructive">{errorMessage(mutation.error, zh)}</p> : null}
    </div>}
  </Modal>;
}

function AssetFocusEditor({ siteId, asset, zh }: { siteId: string; asset: SiteAsset | null; zh: boolean }) {
  const queryClient = useQueryClient();
  const [point, setPoint] = useState({ x: 50, y: 50 });
  useEffect(() => {
    if (asset) setPoint({ x: asset.focalPoint?.x ?? 50, y: asset.focalPoint?.y ?? 50 });
  }, [asset]);
  const mutation = useMutation({
    mutationFn: () => siteApi.updateAsset(siteId, asset!.id, { expectedRevision: asset!.revision, focalPoint: point }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["my-site-assets", siteId] });
      void queryClient.invalidateQueries({ queryKey: SITE_KEY() });
    },
  });
  if (!asset) return null;
  const changed = point.x !== (asset.focalPoint?.x ?? 50) || point.y !== (asset.focalPoint?.y ?? 50);
  return <div className="mt-3 grid gap-3 rounded-lg bg-muted/50 p-3 sm:grid-cols-[minmax(180px,1fr)_minmax(220px,1fr)]">
    <div><img src={siteApi.assetContentUrl(siteId, asset.id)} alt={asset.altText || asset.name} style={{ objectPosition: `${point.x}% ${point.y}%` }} className="aspect-video w-full rounded-md border border-border object-cover" /><p className="mt-1 text-xs text-muted-foreground">{zh ? "预览会按当前焦点裁剪，网站仍保留完整原图。" : "The preview crops around this focus point; the full original remains available."}</p></div>
    <div className="space-y-3"><Field label={`${zh ? "左右位置" : "Horizontal position"} · ${point.x}%`}><input aria-label={zh ? "左右焦点位置" : "Horizontal focus position"} className="w-full accent-primary" type="range" min="0" max="100" value={point.x} onChange={(event) => setPoint({ ...point, x: Number(event.target.value) })} /></Field><Field label={`${zh ? "上下位置" : "Vertical position"} · ${point.y}%`}><input aria-label={zh ? "上下焦点位置" : "Vertical focus position"} className="w-full accent-primary" type="range" min="0" max="100" value={point.y} onChange={(event) => setPoint({ ...point, y: Number(event.target.value) })} /></Field><Button size="sm" disabled={!changed || mutation.isPending} onClick={() => mutation.mutate()}><Save />{mutation.isPending ? (zh ? "正在保存…" : "Saving…") : changed ? (zh ? "保存图片位置" : "Save image position") : (zh ? "位置已保存" : "Position saved")}</Button>{mutation.error ? <p role="alert" className="text-sm text-destructive">{errorMessage(mutation.error, zh)}</p> : null}</div>
  </div>;
}

function BlockEditor({ block, name, zh, assets, onChange, onRemove }: { block: SiteBlock; name: string; zh: boolean; assets: SiteAsset[]; onChange: (block: SiteBlock) => void; onRemove: () => void }) {
  const data = block.data;
  const textFields = ["eyebrow", "title", "subtitle", "description", "primaryLabel", "label", "url", "email"].filter((key) => key in data);
  const items = Array.isArray(data.items) ? data.items as Array<Record<string, unknown>> : null;
  const paragraphs = Array.isArray(data.paragraphs) ? data.paragraphs.map(String) : null;
  const updateData = (next: Record<string, unknown>) => onChange({ ...block, data: { ...data, ...next } });
  return <div className={`rounded-lg border p-4 ${block.hidden ? "border-dashed opacity-70" : "border-border"}`}>
    <div className="mb-3 flex items-center justify-between gap-2"><div><p className="text-sm font-semibold">{name}</p><label className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={Boolean(block.hidden)} onChange={(event) => onChange({ ...block, hidden: event.target.checked })} />{zh ? "暂时隐藏此模块" : "Hide this block"}</label></div><Button variant="ghost" size="icon" aria-label={zh ? `删除${name}` : `Remove ${name}`} onClick={onRemove}><Trash2 /></Button></div>
    <div className="grid gap-3 sm:grid-cols-2">{textFields.map((key) => <Field key={key} label={fieldLabel(key, zh)}><Input value={String(data[key] ?? "")} onChange={(event) => updateData({ [key]: event.target.value })} /></Field>)}</div>
    {block.type === "hero" ? <div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label={zh ? "首屏图片" : "Hero image"}><Select value={String(data.assetId ?? "")} onChange={(event) => updateData({ assetId: event.target.value || undefined })}><option value="">{zh ? "不使用图片" : "No image"}</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</Select></Field><Field label={zh ? "图片说明（供读屏使用）" : "Image description"}><Input value={String(data.imageAlt ?? "")} onChange={(event) => updateData({ imageAlt: event.target.value })} /></Field></div> : null}
    {paragraphs ? <div className="mt-3"><Field label={zh ? "正文（每行一段）" : "Body (one paragraph per line)"}><Textarea rows={5} value={paragraphs.join("\n")} onChange={(event) => updateData({ paragraphs: event.target.value.split("\n") })} /></Field></div> : null}
    {items ? <div className="mt-3 space-y-2">{items.map((item, index) => <div key={index} className="grid gap-2 rounded-md bg-muted/50 p-2 sm:grid-cols-2">{block.type === "gallery" ? <Select aria-label={`${zh ? "图片" : "Image"} ${index + 1}`} value={String(item.assetId ?? "")} onChange={(event) => updateData({ items: items.map((row, rowIndex) => rowIndex === index ? { ...row, assetId: event.target.value } : row) })}><option value="">{zh ? "选择图片" : "Select image"}</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</Select> : null}{Object.keys(item).filter((key) => key !== "assetId" && typeof item[key] === "string").map((key) => <Input key={key} aria-label={`${fieldLabel(key, zh)} ${index + 1}`} placeholder={fieldLabel(key, zh)} value={String(item[key] ?? "")} onChange={(event) => updateData({ items: items.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: event.target.value } : row) })} />)}<Button size="sm" variant="ghost" onClick={() => updateData({ items: items.filter((_, rowIndex) => rowIndex !== index) })}><Trash2 />{zh ? "移除" : "Remove"}</Button></div>)}{block.type === "gallery" ? <Button size="sm" variant="secondary" disabled={!assets.length} onClick={() => updateData({ items: [...items, { assetId: assets[0]?.id ?? "", alt: "", caption: "" }] })}><ImagePlus />{zh ? "添加图片" : "Add image"}</Button> : null}</div> : null}
  </div>;
}

function blankTranslationData(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.length ? value.map((item) => blankTranslationData(item, key)) : [];
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, blankTranslationData(child, childKey)]));
  if (typeof value !== "string") return value;
  return ["assetId", "url", "primaryUrl", "email", "phone"].includes(key) ? value : "";
}

function CreateTranslationButton({ site, source, locale, zh, onCreated }: { site: Site; source: SiteEntry; locale: "zh-CN" | "en-US"; zh: boolean; onCreated: (site: Site, entry: SiteEntry) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const query = useQuery({ queryKey: ["my-site-entry", site.id, source.id], queryFn: () => siteApi.getEntry(site.id, source.id), enabled: open });
  const mutation = useMutation({
    mutationFn: () => {
      const blocks = (query.data?.entry.blocks ?? []).map((block) => ({ ...block, id: `${block.id.slice(0, 96)}-${locale === "en-US" ? "en" : "zh"}`, data: blankTranslationData(block.data) as Record<string, unknown> }));
      const hero = blocks.find((block) => block.type === "hero");
      if (hero) hero.data = { ...hero.data, title, subtitle: summary };
      return siteApi.createEntry(site.id, { type: source.type, slug: source.slug, title, summary, blocks, locale, translationOf: source.id });
    },
    onSuccess: (data) => { onCreated(data.site, data.entry); setOpen(false); setTitle(""); setSummary(""); },
  });
  const requestClose = () => {
    if ((title || summary) && !window.confirm(zh ? "翻译草稿还没有创建，确定离开吗？" : "The translation draft has not been created. Leave anyway?")) return;
    setOpen(false); setTitle(""); setSummary("");
  };
  const language = locale === "zh-CN" ? (zh ? "中文" : "Chinese") : (zh ? "英文" : "English");
  return <><Button size="sm" variant="secondary" aria-label={`${zh ? `创建${language}版` : `Create ${language} version`}${zh ? "：" : ": "}${source.title}`} onClick={() => setOpen(true)}><Languages />{zh ? `创建${language}版` : `Create ${language} version`}</Button><Modal open={open} onClose={requestClose} title={zh ? `创建${language}翻译草稿` : `Create ${language} translation draft`} description={zh ? "先翻译标题和摘要。创建后会打开完整页面，继续翻译其余可见文字。" : "Translate the title and summary first. The full page opens next so you can translate the remaining visible text."} footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={requestClose}>{zh ? "取消" : "Cancel"}</Button><Button disabled={!title.trim() || !summary.trim() || query.isLoading || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? <Loader2 className="animate-spin" /> : <Languages />}{zh ? "创建并继续翻译" : "Create and continue"}</Button></div>}><div className="space-y-4"><div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground"><p>{zh ? `原文：${source.title}` : `Source: ${source.title}`}</p><p className="mt-1">{zh ? "图片和安全链接会保留；其他原文不会直接公开到翻译页面。" : "Images and safe links are retained; other source-language text is not copied into the translated page."}</p></div><Field label={zh ? `${language}标题` : `${language} title`}><Input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} /></Field><Field label={zh ? `${language}摘要` : `${language} summary`}><Textarea value={summary} maxLength={500} rows={3} onChange={(event) => setSummary(event.target.value)} /></Field>{query.error || mutation.error ? <p role="alert" className="text-sm text-destructive">{errorMessage(query.error ?? mutation.error, zh)}</p> : null}</div></Modal></>;
}

function NewCaseButton({ site, locale, zh, onCreated }: { site: Site; locale: "zh-CN" | "en-US"; zh: boolean; onCreated: (site: Site, entry: SiteEntry, showcaseAdded: boolean) => void }) {
  const queryClient = useQueryClient();
  const emptyForm = () => ({ title: "", summary: "", client: "", challenge: "", approach: "", outcome: "", coverAssetId: "", galleryAssetIds: [] as string[] });
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(emptyForm);
  const assets = useQuery({ queryKey: ["my-site-assets", site.id], queryFn: () => siteApi.assets(site.id), enabled: open });
  const dirty = Boolean(form.title || form.summary || form.client || form.challenge || form.approach || form.outcome || form.coverAssetId || form.galleryAssetIds.length);
  const reset = () => { setForm(emptyForm()); setStep(0); };
  const requestClose = () => {
    if (dirty && !window.confirm(zh ? "案例还没有保存，确定离开吗？" : "This case has not been saved. Leave anyway?")) return;
    setOpen(false);
    reset();
  };
  const upload = useMutation({
    mutationFn: (file: File) => siteApi.uploadAsset(site.id, file),
    onSuccess: (data) => {
      setForm((current) => ({ ...current, coverAssetId: current.coverAssetId || data.asset.id }));
      void queryClient.invalidateQueries({ queryKey: ["my-site-assets", site.id] });
      void queryClient.invalidateQueries({ queryKey: SITE_KEY() });
    },
  });
  const mutation = useMutation({
    mutationFn: () => {
      const stamp = Date.now().toString(36);
      const blocks: SiteBlock[] = [
        { id: `case-hero-${stamp}`, type: "hero", data: { eyebrow: form.client || (zh ? "客户案例" : "Client case"), title: form.title, subtitle: form.summary, ...(form.coverAssetId ? { assetId: form.coverAssetId, imageAlt: form.title } : {}) } },
        { id: `case-challenge-${stamp}`, type: "rich_text", data: { title: zh ? "背景与目标" : "Background and goal", paragraphs: [form.challenge] } },
        { id: `case-approach-${stamp}`, type: "rich_text", data: { title: zh ? "我们如何解决" : "What we did", paragraphs: [form.approach] } },
        { id: `case-outcome-${stamp}`, type: "rich_text", data: { title: zh ? "成果" : "Outcome", paragraphs: form.outcome.split("\n").map((value) => value.trim()).filter(Boolean) } },
        ...(form.galleryAssetIds.length ? [{ id: `case-gallery-${stamp}`, type: "gallery" as const, data: { title: zh ? "案例图片" : "Case images", items: form.galleryAssetIds.map((assetId) => ({ assetId, alt: form.title, caption: "" })) } }] : []),
        { id: `case-cta-${stamp}`, type: "cta", data: { title: zh ? "希望获得类似成果？" : "Looking for a similar outcome?", description: site.primaryAction, label: site.primaryAction || (zh ? "联系我们" : "Contact us"), url: "/contact/" } },
      ];
      return siteApi.createEntry(site.id, { type: "case", slug: `case-${stamp}`, title: form.title, summary: form.summary, blocks, locale });
    },
    onSuccess: (data) => {
      onCreated(data.site, data.entry, Boolean(data.caseShowcaseAdded));
      setOpen(false);
      reset();
    },
  });
  const canContinue = step === 0 ? Boolean(form.title.trim() && form.summary.trim())
    : step === 1 ? Boolean(form.challenge.trim() && form.approach.trim() && form.outcome.trim())
      : true;
  const labels = zh ? ["基本信息", "过程与成果", "图片与确认"] : ["Basics", "Story and outcome", "Images and review"];
  const selectedCover = assets.data?.assets.find((asset) => asset.id === form.coverAssetId) ?? null;
  return <><Button size="sm" variant="secondary" onClick={() => setOpen(true)}><ImagePlus />{zh ? "添加案例" : "Add case"}</Button><Modal open={open} onClose={requestClose} title={zh ? "添加客户案例" : "Add a client case"} description={zh ? `第 ${step + 1}/3 步：${labels[step]}。页面地址和展示结构由系统自动生成。` : `Step ${step + 1} of 3: ${labels[step]}. The page address and layout are generated automatically.`} size="xl" footer={<div className="flex w-full flex-wrap justify-end gap-2"><Button variant="secondary" onClick={requestClose}>{zh ? "取消" : "Cancel"}</Button>{step > 0 ? <Button variant="secondary" onClick={() => setStep((value) => value - 1)}>{zh ? "上一步" : "Back"}</Button> : null}{step < 2 ? <Button disabled={!canContinue} onClick={() => setStep((value) => value + 1)}>{zh ? "下一步" : "Next"}</Button> : <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}><Eye />{mutation.isPending ? (zh ? "正在保存…" : "Saving…") : (zh ? "保存并预览" : "Save and preview")}</Button>}</div>}>
    <div className="space-y-4">
      <ol className="grid grid-cols-3 gap-2" aria-label={zh ? "案例创建进度" : "Case creation progress"}>{labels.map((label, index) => <li key={label} className={`rounded-md p-2 text-center text-xs font-medium ${index === step ? "bg-primary text-primary-foreground" : index < step ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{index + 1}. {label}</li>)}</ol>
      {step === 0 ? <div className="space-y-4"><Field label={zh ? "案例名称" : "Case title"}><Input required maxLength={200} value={form.title} placeholder={zh ? "例如：帮助山岚品牌提升咨询转化" : "For example: Improving inquiry conversion for Northwind"} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field><Field label={zh ? "一句话成果" : "One-line outcome"}><Textarea required maxLength={500} rows={3} value={form.summary} placeholder={zh ? "用访客能理解的话说明最终带来了什么改变" : "Describe the final change in language visitors can understand"} onChange={(event) => setForm({ ...form, summary: event.target.value })} /></Field><Field label={zh ? "客户或项目名称（可选）" : "Client or project name (optional)"}><Input maxLength={120} value={form.client} placeholder={zh ? "不方便公开时可以留空" : "Leave blank if it should remain private"} onChange={(event) => setForm({ ...form, client: event.target.value })} /></Field><p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{zh ? "请只填写已经获得公开许可的信息，不必填写客户联系方式、合同金额或其他隐私资料。" : "Only include information you are allowed to publish. Client contact details, contract values, and other private data are not needed."}</p></div> : null}
      {step === 1 ? <div className="space-y-4"><Field label={zh ? "当时遇到什么问题？" : "What problem did they face?"}><Textarea required maxLength={4000} rows={4} value={form.challenge} placeholder={zh ? "说明背景、目标和主要困难" : "Explain the background, goal, and main challenge"} onChange={(event) => setForm({ ...form, challenge: event.target.value })} /></Field><Field label={zh ? "你是怎么解决的？" : "How did you solve it?"}><Textarea required maxLength={4000} rows={4} value={form.approach} placeholder={zh ? "概括关键做法，不需要写成技术报告" : "Summarize the key approach without turning it into a technical report"} onChange={(event) => setForm({ ...form, approach: event.target.value })} /></Field><Field label={zh ? "最终取得了什么成果？" : "What was the outcome?"}><Textarea required maxLength={4000} rows={4} value={form.outcome} placeholder={zh ? "可以每行写一项可验证的成果" : "You can put one verifiable result on each line"} onChange={(event) => setForm({ ...form, outcome: event.target.value })} /></Field></div> : null}
      {step === 2 ? <div className="space-y-4"><div className="rounded-lg border border-border p-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium">{zh ? "案例图片（可选）" : "Case images (optional)"}</p><p className="text-xs text-muted-foreground">{zh ? "没有图片也能保存；上传后会自动优化。" : "You can save without images; uploads are optimized automatically."}</p></div><label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-secondary px-3 py-2 text-sm font-medium hover:bg-secondary/80"><Upload className="size-4" />{upload.isPending ? (zh ? "上传中…" : "Uploading…") : (zh ? "上传图片" : "Upload image")}<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" disabled={upload.isPending} onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.currentTarget.value = ""; }} /></label></div><div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label={zh ? "封面图片" : "Cover image"}><Select aria-label={zh ? "案例封面图片" : "Case cover image"} value={form.coverAssetId} onChange={(event) => setForm({ ...form, coverAssetId: event.target.value })}><option value="">{zh ? "不使用封面" : "No cover"}</option>{assets.data?.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</Select></Field>{selectedCover ? <img src={siteApi.assetContentUrl(site.id, selectedCover.id)} alt={selectedCover.altText || selectedCover.name} style={{ objectPosition: `${selectedCover.focalPoint?.x ?? 50}% ${selectedCover.focalPoint?.y ?? 50}%` }} className="aspect-video w-full rounded-md border border-border object-cover" /> : <div className="grid min-h-24 place-items-center rounded-md bg-muted text-xs text-muted-foreground">{zh ? "未选择封面" : "No cover selected"}</div>}</div>{assets.data?.assets.length ? <Field label={zh ? "正文图片（最多 6 张）" : "Body images (up to 6)"} asGroup><div className="mt-2 grid gap-2 sm:grid-cols-2">{assets.data.assets.map((asset) => { const selected = form.galleryAssetIds.includes(asset.id); return <label key={asset.id} className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 ${selected ? "border-primary bg-primary/5" : "border-border"}`}><input type="checkbox" checked={selected} disabled={!selected && form.galleryAssetIds.length >= 6} onChange={(event) => setForm({ ...form, galleryAssetIds: event.target.checked ? [...form.galleryAssetIds, asset.id] : form.galleryAssetIds.filter((id) => id !== asset.id) })} /><img src={siteApi.assetContentUrl(site.id, asset.id)} alt="" className="size-10 rounded object-cover" /><span className="min-w-0 truncate text-sm">{asset.name}</span></label>; })}</div></Field> : null}{upload.error ? <p role="alert" className="mt-2 text-sm text-destructive">{errorMessage(upload.error, zh)}</p> : null}</div><div className="rounded-lg border border-border p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{zh ? "保存前确认" : "Review before saving"}</p><h3 className="mt-2 text-lg font-semibold">{form.title}</h3><p className="mt-1 text-sm text-muted-foreground">{form.summary}</p><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div><dt className="font-medium">{zh ? "背景" : "Background"}</dt><dd className="mt-1 line-clamp-3 text-muted-foreground">{form.challenge}</dd></div><div><dt className="font-medium">{zh ? "做法" : "Approach"}</dt><dd className="mt-1 line-clamp-3 text-muted-foreground">{form.approach}</dd></div><div><dt className="font-medium">{zh ? "成果" : "Outcome"}</dt><dd className="mt-1 line-clamp-3 text-muted-foreground">{form.outcome}</dd></div></dl><p className="mt-4 rounded-md bg-primary/5 p-3 text-xs text-muted-foreground">{zh ? "保存后将生成案例详情页；首次添加案例时，首页会自动出现“精选案例”。保存不会自动公开，仍需确认发布。" : "Saving creates a case detail page. The first case also adds a Featured cases section to the home page. Saving does not publish automatically."}</p></div></div> : null}
      {mutation.error ? <p role="alert" className="text-sm text-destructive">{errorMessage(mutation.error, zh)}</p> : null}
    </div>
  </Modal></>;
}

function NewArticleButton({ site, locale, zh, onCreated }: { site: Site; locale: "zh-CN" | "en-US"; zh: boolean; onCreated: (site: Site) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const mutation = useMutation({ mutationFn: () => siteApi.createEntry(site.id, { type: "article", slug: `${locale === "zh-CN" ? "article" : "post"}-${Date.now().toString(36)}`, title, summary, locale, blocks: [{ id: `article-${Date.now()}`, type: "rich_text", data: { title, paragraphs: body.split("\n").filter(Boolean) } }] }), onSuccess: (data) => { onCreated(data.site); setOpen(false); setTitle(""); setSummary(""); setBody(""); } });
  const dirty = Boolean(title || summary || body);
  const requestClose = () => {
    if (dirty && !window.confirm(zh ? "文章还没有保存，确定离开吗？" : "This article has not been saved. Leave anyway?")) return;
    setOpen(false);
  };
  return <><Button size="sm" onClick={() => setOpen(true)}><FilePlus2 />{zh ? "写新文章" : "New article"}</Button><Modal open={open} onClose={requestClose} title={zh ? "写新文章" : "New article"} description={zh ? "先写下标题和正文，保存后仍可继续修改。" : "Start with a title and body. You can keep editing after saving."} footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={requestClose}>{zh ? "取消" : "Cancel"}</Button><Button disabled={!title.trim() || mutation.isPending} onClick={() => mutation.mutate()}>{zh ? "保存草稿" : "Save draft"}</Button></div>}><div className="space-y-3"><Field label={zh ? "标题" : "Title"}><Input value={title} onChange={(event) => setTitle(event.target.value)} /></Field><Field label={zh ? "摘要" : "Summary"}><Input value={summary} onChange={(event) => setSummary(event.target.value)} /></Field><Field label={zh ? "正文" : "Body"}><Textarea rows={8} value={body} placeholder={zh ? "开始写文章，每个自然段可直接换行。" : "Start writing. Use a new line for each paragraph."} onChange={(event) => setBody(event.target.value)} /></Field>{mutation.error ? <p className="text-sm text-destructive">{errorMessage(mutation.error, zh)}</p> : null}</div></Modal></>;
}

function PreviewModal({ siteId, path, zh, onClose }: { siteId: string; path: string | null; zh: boolean; onClose: () => void }) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const query = useQuery({ queryKey: ["my-site-preview", siteId, path], queryFn: () => siteApi.preview(siteId, path!), enabled: Boolean(path) });
  const previewHtml = query.data ? Object.entries(query.data.preview.assetPaths ?? {}).reduce(
    (html, [assetPath, descriptor]) => {
      const asset = typeof descriptor === "string" ? { assetId: descriptor } : descriptor;
      return html.replaceAll(assetPath, siteApi.assetContentUrl(siteId, asset.assetId, asset.variant));
    },
    query.data.preview.html.replace('<link rel="stylesheet" href="/assets/site.css">', `<style>${query.data.preview.styles}</style>`),
  ) : "";
  return <Modal open={Boolean(path)} onClose={onClose} title={zh ? "网站预览" : "Website preview"} description={zh ? "这是未发布草稿的安全预览。" : "This is a safe preview of your unpublished draft."} size="viewport" bodyClassName="flex min-h-0 flex-1 justify-center overflow-auto rounded-lg bg-muted/50" headerActions={<div className="flex rounded-md bg-muted p-1"><Button size="sm" variant={device === "desktop" ? "secondary" : "ghost"} aria-label={zh ? "桌面预览" : "Desktop preview"} onClick={() => setDevice("desktop")}><Monitor /></Button><Button size="sm" variant={device === "mobile" ? "secondary" : "ghost"} aria-label={zh ? "手机预览" : "Mobile preview"} onClick={() => setDevice("mobile")}><Smartphone /></Button></div>}>
    {query.data ? <iframe title={zh ? "网站草稿预览" : "Website draft preview"} sandbox="allow-same-origin" srcDoc={previewHtml} className={`min-h-[32rem] rounded-lg border-0 bg-white shadow-sm transition-[width] ${device === "mobile" ? "w-[390px] max-w-full flex-none" : "w-full flex-1"}`} /> : <div className="grid flex-1 place-items-center text-sm text-muted-foreground">{query.error ? errorMessage(query.error, zh) : (zh ? "正在生成预览…" : "Generating preview…")}</div>}
  </Modal>;
}

function GoLiveGuide({ open, zh, onClose, onContinue }: { open: boolean; zh: boolean; onClose: () => void; onContinue: (handoff: Omit<GoLiveHandoff, "siteId">) => void }) {
  const [step, setStep] = useState(0);
  const [audience, setAudience] = useState<"global" | "mainland">("global");
  const [address, setAddress] = useState<"platform" | "custom">("platform");
  const [assistance, setAssistance] = useState<"self" | "technical">("self");
  useEffect(() => { if (open) setStep(0); }, [open]);
  const descriptions = zh ? ["第 1/3 步：选择访客主要所在区域。", "第 2/3 步：选择访客以后使用的网址。", "第 3/3 步：决定由谁完成云平台配置。"]
    : ["Step 1 of 3: Choose where most visitors are located.", "Step 2 of 3: Choose the address visitors will use.", "Step 3 of 3: Decide who will finish the hosting setup."];
  return <Modal open={open} onClose={onClose} title={zh ? "让访客可以打开网站" : "Make your website available to visitors"} description={descriptions[step]} footer={<div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" onClick={onClose}>{zh ? "稍后设置" : "Set up later"}</Button>{step > 0 ? <Button variant="secondary" onClick={() => setStep((value) => value - 1)}>{zh ? "上一步" : "Back"}</Button> : null}<Button onClick={() => step < 2 ? setStep((value) => value + 1) : onContinue({ audience, address, assistance })}>{step < 2 ? (zh ? "下一步" : "Next") : <><Settings2 />{zh ? "打开配置页面" : "Open setup page"}</>}</Button></div>}>
    <div className="space-y-3">
      <ol className="grid grid-cols-3 gap-2" aria-label={zh ? "上线设置进度" : "Go-live setup progress"}>{[0, 1, 2].map((index) => <li key={index} className={`h-1.5 rounded-full ${index <= step ? "bg-primary" : "bg-muted"}`}><span className="sr-only">{index + 1}</span></li>)}</ol>
      {step === 0 ? <div className="space-y-3"><ChoiceButton selected={audience === "global"} onClick={() => setAudience("global")} title={zh ? "主要面向全球访客" : "Primarily global visitors"} detail={zh ? "推荐使用全球云托管，连接完成后可以先使用平台提供的网址。" : "Global cloud hosting is recommended and can provide a platform address after connection."} /><ChoiceButton selected={audience === "mainland"} onClick={() => setAudience("mainland")} title={zh ? "主要面向中国大陆访客" : "Primarily visitors in mainland China"} detail={zh ? "推荐使用阿里云 OSS + CDN；使用中国内地域名时还需完成 ICP 备案。" : "Alibaba Cloud OSS + CDN is recommended; mainland China domains also require ICP filing."} />{audience === "mainland" ? <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">{zh ? "备案不会在这里自动完成。可以先维护和预览网站，备案与云资源资料稍后填写。" : "Regulatory filing is not completed automatically here. You can keep editing and previewing while filing and cloud details are prepared."}</p> : null}</div> : null}
      {step === 1 ? <div className="space-y-3"><ChoiceButton selected={address === "platform"} onClick={() => setAddress("platform")} title={zh ? "先使用托管平台网址" : "Start with a hosting platform address"} detail={zh ? "适合尽快上线；完成托管连接后获得可访问地址，以后仍可绑定自己的域名。" : "Best for going live sooner. Connect hosting first, then add your own domain later."} /><ChoiceButton selected={address === "custom"} onClick={() => setAddress("custom")} title={zh ? "使用自己的域名" : "Use my own domain"} detail={zh ? "需要已有域名，并由配置人员完成解析、HTTPS 和必要的备案检查。" : "Requires an existing domain plus DNS, HTTPS, and any required filing checks."} /></div> : null}
      {step === 2 ? <div className="space-y-3"><ChoiceButton selected={assistance === "self"} onClick={() => setAssistance("self")} title={zh ? "我自己完成配置" : "I will complete setup"} detail={zh ? "下一页会显示托管方式、连接状态和逐步检查清单。所有真实资料仍由你填写。" : "The next page shows hosting, connection status, and a checklist. You will enter all real values there."} /><ChoiceButton selected={assistance === "technical"} onClick={() => setAssistance("technical")} title={zh ? "交给技术人员配置" : "Ask a technical person to configure it"} detail={zh ? "可以把下一页交给负责云平台的人员；日常内容维护仍留在普通视图。" : "Hand the next page to whoever manages cloud hosting; daily content work remains in Ordinary view."} /><div className="rounded-lg border border-border p-3 text-sm"><p className="font-medium">{zh ? "配置交接摘要" : "Setup handoff summary"}</p><ul className="mt-2 space-y-1 text-muted-foreground"><li>• {audience === "mainland" ? (zh ? "推荐：中国大陆云托管（阿里云 OSS + CDN）" : "Recommended: Mainland China hosting (Alibaba Cloud OSS + CDN)") : (zh ? "推荐：全球云托管" : "Recommended: Global cloud hosting")}</li><li>• {address === "custom" ? (zh ? "网址：自己的域名" : "Address: custom domain") : (zh ? "网址：先使用平台网址" : "Address: platform address first")}</li><li>• {zh ? "账号、Bucket、域名等真实资料尚未填写" : "No real account, Bucket, or domain details have been entered"}</li></ul></div></div> : null}
    </div>
  </Modal>;
}

function ChoiceButton({ selected, onClick, title, detail }: { selected: boolean; onClick: () => void; title: string; detail: string }) {
  return <button type="button" aria-label={title} aria-pressed={selected} onClick={onClick} className={`w-full rounded-lg border p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}><span className="flex items-center gap-2 font-medium">{selected ? <CheckCircle2 className="size-4 text-primary" /> : <span className="size-4 rounded-full border border-border" />}{title}</span><span className="mt-1 block pl-6 text-sm leading-5 text-muted-foreground">{detail}</span></button>;
}

function PlanSummary({ plan, site, zh }: { plan: PublicationPlan | null; site: Site; zh: boolean }) {
  if (!plan) return null;
  const entries = new Map(site.entries.map((entry) => [entry.id, entry.title]));
  const siteSettingsChangeId = "__site_settings__";
  const assetChangeIds = (plan.changes.assetsChanged ?? []).map((id) => `__asset__:${id}`);
  const groups = [
    [zh ? "新增" : "Added", plan.changes.added ?? []],
    [zh ? "修改" : "Changed", [...(plan.changes.changed ?? []), ...(plan.changes.siteChanged ? [siteSettingsChangeId] : []), ...assetChangeIds]],
    [zh ? "移除" : "Removed", plan.changes.removed ?? []],
  ] as const;
  return <div className="space-y-4"><div className="grid grid-cols-3 gap-3">{groups.map(([label, values]) => <div key={label} className="rounded-lg bg-muted p-3 text-center"><p className="text-xl font-semibold">{values.length}</p><p className="text-xs text-muted-foreground">{label}</p></div>)}</div><div className="space-y-2">{groups.filter(([, values]) => values.length).map(([label, values]) => <div key={label} className="rounded-lg border border-border p-3"><p className="text-xs font-semibold text-muted-foreground">{label}</p><ul className="mt-1 space-y-1 text-sm">{values.slice(0, 6).map((id, index) => <li key={id}>• {id === siteSettingsChangeId ? (zh ? "站点信息和样式" : "Site information and style") : id.startsWith("__asset__:") ? (zh ? "图片展示位置" : "Image display position") : entries.get(id) ?? (zh ? `已移除的内容 ${index + 1}` : `Removed content ${index + 1}`)}</li>)}</ul>{values.length > 6 ? <p className="mt-1 text-xs text-muted-foreground">{zh ? `另有 ${values.length - 6} 项` : `${values.length - 6} more`}</p> : null}</div>)}</div><p className="text-sm text-muted-foreground">{site.deploymentTarget?.kind === "local_directory" ? (zh ? "发布位置：仅生成本地版本，不会自动公开到互联网。" : "Destination: local release only; it will not be published to the internet automatically.") : (zh ? `发布位置：${site.deploymentTarget?.displayName ?? "已连接的上线服务"}` : `Destination: ${site.deploymentTarget?.displayName ?? "connected publishing service"}`)}</p></div>;
}

function PublishProgress({ plan, zh, professional }: { plan: PublicationPlan | null; zh: boolean; professional: boolean }) {
  if (!plan) return null;
  const stage = plan.progress?.stage ?? "preparing";
  const active = stage === "validating_target" || stage === "preparing" ? 0
    : stage === "uploading" || stage === "verifying_upload" ? 1
      : ["activating", "refreshing_cdn", "recovering_previous"].includes(stage) ? 2
        : 3;
  const labels = zh ? ["准备文件", "上传网站", "更新线上网站", "验证上线"] : ["Prepare", "Upload", "Update live site", "Verify online"];
  return <div className="space-y-4"><ol className="grid gap-2 sm:grid-cols-4">{labels.map((label, index) => <li key={label} className={`rounded-lg border p-3 ${index < active ? "border-success/30 bg-success/5" : index === active ? "border-primary/40 bg-primary/5" : "border-border"}`}><span className="flex items-center gap-2 text-sm font-medium">{index < active ? <CheckCircle2 className="size-4 text-success" /> : index === active ? <Loader2 className="size-4 animate-spin text-primary" /> : <span className="grid size-4 place-items-center rounded-full bg-muted text-[10px]">{index + 1}</span>}{label}</span>{index === 1 && stage === "uploading" && plan.progress?.itemsTotal ? <span className="mt-1 block text-xs text-muted-foreground">{plan.progress.itemsCompleted ?? 0}/{plan.progress.itemsTotal}</span> : null}</li>)}</ol>{stage === "refreshing_cdn" ? <p className="text-sm text-muted-foreground">{zh ? "云平台正在刷新全球缓存，通常需要几分钟，请保持此窗口打开。" : "The cloud platform is refreshing its cache. This can take several minutes; keep this window open."}</p> : null}{stage === "recovering_previous" ? <p className="text-sm text-warning">{zh ? "新版本验证未通过，正在自动恢复上一健康版本。" : "The new release did not verify. Restoring the previous healthy version automatically."}</p> : null}{professional ? <p className="font-mono text-xs text-muted-foreground">stage={stage} · {plan.progress?.updatedAt ?? "—"}</p> : null}</div>;
}

function Tab({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: typeof Palette; children: React.ReactNode }) {
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${active ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"}`}><Icon className="size-4" />{children}</button>;
}

function Field({ label, children, asGroup = false }: { label: string; children: React.ReactNode; asGroup?: boolean }) {
  if (asGroup) return <fieldset className="block space-y-1.5"><legend className="text-xs font-medium text-muted-foreground">{label}</legend>{children}</fieldset>;
  return <label className="block space-y-1.5"><span className="text-xs font-medium text-muted-foreground">{label}</span>{children}</label>;
}
function Notice({ title, detail, action }: { title: string; detail?: string; action?: React.ReactNode }) { return <Card><CardContent className="flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center"><p className="font-medium">{title}</p>{detail ? <p className="text-sm text-muted-foreground">{detail}</p> : null}{action}</CardContent></Card>; }
function entryFingerprint(entry: SiteEntry) { return JSON.stringify({ title: entry.title, summary: entry.summary, slug: entry.slug, status: entry.status, blocks: entry.blocks ?? [] }); }
function fieldLabel(key: string, zh: boolean) { const labels: Record<string, [string, string]> = { eyebrow: ["上方小标题", "Eyebrow"], title: ["标题", "Title"], subtitle: ["副标题", "Subtitle"], description: ["说明", "Description"], primaryLabel: ["主按钮文字", "Primary button"], label: ["名称", "Label"], value: ["数值", "Value"], question: ["问题", "Question"], answer: ["回答", "Answer"], url: ["链接", "Link"], email: ["邮箱", "Email"] }; return labels[key]?.[zh ? 0 : 1] ?? key; }
