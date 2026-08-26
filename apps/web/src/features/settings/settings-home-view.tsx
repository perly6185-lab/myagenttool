import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, Clock3, HardDrive, Search, Star, Trash2 } from "lucide-react";
import { pageRegistration } from "@/app/sections";
import { SectionHeading } from "@/components/common/section-heading";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { StatusBadge } from "@/components/ui/badge";
import { api } from "@/data/use-console-actions";
import { useConsoleState } from "@/data/use-console-state";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { ApiError, type TaskMaterialStorage } from "@/lib/api-client";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { deriveApplicationDependencyState } from "./application-dependency-state";
import { MY_SETTINGS_CATEGORIES, settingsSearchAliases, type MySettingsCategoryKey } from "./my-settings-model";
import { canDiscoverProfessionalPage, canManageProfessionalSettings } from "@/app/page-access";
import { useSessionUser } from "@/hooks/use-session-user";
import { useUiStore } from "@/store/ui-store";
import { WorkProfileReview } from "@/features/me/work-profile-review";
import { AdvancedProjectsSettings } from "@/features/projects/projects-view";
import { ReportSchedulePanel } from "@/features/work-board/work-board-view";

function formatBytes(bytes: number, locale: string) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: value >= 10 ? 1 : 2 }).format(value)} ${unit}`;
}

function matchesSettingsQuery(text: string, query: string): boolean {
  const searchable = text.toLowerCase();
  return query.split(/\s+/).filter(Boolean).every((token) => searchable.includes(token));
}

export function SettingsHomeView({ embedded = false }: { embedded?: boolean }) {
  const { t, i18n } = useAppTranslation();
  const navigate = usePageNavigation();
  const { data: state } = useConsoleState();
  const sessionUser = useSessionUser();
  const canManage = canManageProfessionalSettings(sessionUser?.role);
  const professionalMode = useUiStore((store) => store.experienceMode) === "professional";
  const query = useUiStore((store) => store.settingsQuery);
  const setQuery = useUiStore((store) => store.setSettingsQuery);
  const selectedCategory = useUiStore((store) => store.settingsCategory);
  const setSelectedCategory = useUiStore((store) => store.setSettingsCategory);
  const settingsScrollTop = useUiStore((store) => store.settingsScrollTop);
  const setSettingsScrollTop = useUiStore((store) => store.setSettingsScrollTop);
  const recentSections = useUiStore((store) => store.recentSettingsSections);
  const favoriteSections = useUiStore((store) => store.favoriteSettingsSections);
  const toggleFavorite = useUiStore((store) => store.toggleFavoriteSettingsSection);
  const rootRef = useRef<HTMLDivElement>(null);
  const restoredScrollTopRef = useRef(settingsScrollTop);
  const [applicationId, setApplicationId] = useState("");
  const [materialStorage, setMaterialStorage] = useState<TaskMaterialStorage | null>(null);
  const [storageLoading, setStorageLoading] = useState(true);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupPending, setCleanupPending] = useState(false);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  const currentProject = (state?.projects ?? []).find((project) => project.id === state?.currentProjectId) ?? state?.projects?.[0] ?? null;
  const [externalPolicy, setExternalPolicy] = useState({ intakeEnabled: true, writebackEnabled: true, autoExecutionEnabled: false, emergencyStop: false });
  const [externalPolicyPending, setExternalPolicyPending] = useState(false);
  const [externalPolicyNotice, setExternalPolicyNotice] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [advancedProjectsOpen, setAdvancedProjectsOpen] = useState(false);
  const zh = i18n.language.startsWith("zh");
  const externalCopy = zh ? {
    title: "外部 Issue 项目开关",
    description: "控制当前项目与 GitHub、GitLab、Gitea 的接入边界。关闭后服务端也会拒绝对应操作。",
    intake: "允许导入或绑定外部 Issue",
    intakeHint: "关闭后不能新增外部来源，本地已有任务不受影响。",
    writeback: "允许回写外部 Issue",
    writebackHint: "关闭后仍可查看与拉取，但不能推送或关闭外部 Issue。",
    auto: "允许外部 Issue 自动触发执行",
    autoHint: "仅为后续自动化授权；人工点击启动不受此开关影响。",
    stop: "紧急停止外部 Issue 操作",
    stopHint: "立即暂停导入、绑定、同步和回写；不会删除已有数据。",
    save: "保存项目开关",
    saving: "正在保存…",
    saved: "项目开关已保存并立即生效。",
    failed: "暂时无法保存，原有开关保持不变。",
    unavailable: "请先选择一个项目。",
  } : {
    title: "External issue project controls",
    description: "Set the GitHub, GitLab, and Gitea boundary for the current project. Disabled operations are rejected by the server too.",
    intake: "Allow external issue intake and binding",
    intakeHint: "Turning this off blocks new external sources without changing existing local tasks.",
    writeback: "Allow external issue writeback",
    writebackHint: "Pull and viewing remain available, but pushes and remote closure are blocked.",
    auto: "Allow external issues to trigger automatic execution",
    autoHint: "This authorizes future automation only; a person can still start an existing local task.",
    stop: "Emergency-stop external issue operations",
    stopHint: "Immediately pauses intake, binding, sync, and writeback without deleting data.",
    save: "Save project controls",
    saving: "Saving…",
    saved: "Project controls were saved and are active now.",
    failed: "Controls could not be saved. The previous settings remain active.",
    unavailable: "Select a project first.",
  };
  const storageCopy = zh ? {
    title: "本机参考材料空间",
    description: "仅占用当前设备。进行中任务的材料不会被自动清理。",
    loading: "正在读取本机空间…",
    unavailable: "暂时无法读取本机材料空间，请稍后重试。",
    retry: "重新读取",
    used: "已使用",
    reclaimable: "可安全释放",
    scope: "{{files}} 个文件：来自 {{completed}} 个超过保留期的已完成任务、{{drafts}} 个过期的未完成上传。",
    none: "目前没有可安全清理的材料；已用空间来自进行中的任务，或仍在保留期内的已完成任务。",
    action: "释放空间",
    confirmTitle: "释放本机参考材料空间？",
    confirmDescription: "本次只清理过期草稿，以及已完成任务超过保留期的材料。进行中任务不受影响。",
    confirmDetail: "将释放 {{bytes}}，涉及 {{files}} 个文件。已完成任务材料默认保留 {{days}} 天。清理后原文件无法从本机恢复。",
    confirm: "确认释放",
    cancel: "暂不清理",
    cleaning: "正在安全清理…",
    cleaned: "已释放 {{bytes}} 本机空间。",
    changed: "材料状态已变化，已重新计算可释放空间，请再次确认。",
    cleanupFailed: "暂时无法释放空间，材料未被清理，请稍后重试。",
  } : {
    title: "Local reference material storage",
    description: "This uses only the current device. Materials for active tasks are never cleaned automatically.",
    loading: "Reading local storage…",
    unavailable: "Local material storage is temporarily unavailable. Try again later.",
    retry: "Try again",
    used: "Used",
    reclaimable: "Safe to free",
    scope: "Files: {{files}} · Completed tasks past retention: {{completed}} · Expired unfinished uploads: {{drafts}}.",
    none: "There is currently nothing safe to clean up; used space belongs to active tasks or completed tasks still within retention.",
    action: "Free space",
    confirmTitle: "Free local reference material storage?",
    confirmDescription: "This only removes expired drafts and materials from completed tasks after the retention period. Active tasks are unaffected.",
    confirmDetail: "This will free {{bytes}} across {{files}} files. Completed-task materials are kept for {{days}} days by default. Removed source files cannot be restored on this device.",
    confirm: "Confirm cleanup",
    cancel: "Not now",
    cleaning: "Cleaning safely…",
    cleaned: "Freed {{bytes}} of local storage.",
    changed: "Material state changed. The cleanup preview was refreshed; review it and confirm again.",
    cleanupFailed: "Storage could not be freed. No materials were cleaned; try again later.",
  };
  const locale = zh ? "zh-CN" : "en-US";

  async function loadMaterialStorage() {
    setStorageLoading(true);
    try {
      setMaterialStorage(await api.getTaskMaterialStorage());
    } catch {
      setMaterialStorage(null);
    } finally {
      setStorageLoading(false);
    }
  }

  useEffect(() => { void loadMaterialStorage(); }, []);

  useEffect(() => {
    if (embedded) return undefined;
    const main = rootRef.current?.closest("main");
    if (!main) return undefined;
    const frame = requestAnimationFrame(() => {
      main.scrollTop = restoredScrollTopRef.current;
    });
    return () => {
      cancelAnimationFrame(frame);
      setSettingsScrollTop(main.scrollTop);
    };
  }, [embedded, setSettingsScrollTop]);

  useEffect(() => {
    if (!selectedCategory || query.trim()) return undefined;
    const frame = requestAnimationFrame(() => document.getElementById(`settings-category-${selectedCategory}`)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [query, selectedCategory]);

  useEffect(() => {
    const policy = currentProject?.externalIssuePolicy;
    setExternalPolicy({
      intakeEnabled: policy?.intakeEnabled !== false,
      writebackEnabled: policy?.writebackEnabled !== false,
      autoExecutionEnabled: policy?.autoExecutionEnabled === true,
      emergencyStop: policy?.emergencyStop === true,
    });
    setExternalPolicyNotice(null);
  }, [currentProject?.id, currentProject?.externalIssuePolicy]);

  async function saveExternalPolicy() {
    if (!currentProject || externalPolicyPending) return;
    setExternalPolicyPending(true);
    setExternalPolicyNotice(null);
    try {
      await api.updateProject(currentProject.id, { externalIssuePolicy: externalPolicy });
      setExternalPolicyNotice(externalCopy.saved);
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "external-issue-policy", projectId: currentProject.id } }));
    } catch {
      setExternalPolicyNotice(externalCopy.failed);
    } finally {
      setExternalPolicyPending(false);
    }
  }

  async function cleanupMaterialStorage() {
    if (!materialStorage || !materialStorage.reclaimableBytes) return;
    setCleanupPending(true);
    setStorageNotice(null);
    try {
      const result = await api.cleanupTaskMaterialStorage(materialStorage.previewToken);
      setMaterialStorage(result.usage);
      setStorageNotice(storageCopy.cleaned.replace("{{bytes}}", formatBytes(result.reclaimedBytes, locale)));
      setCleanupOpen(false);
    } catch (error) {
      setStorageNotice(error instanceof ApiError && error.code === "task_material_cleanup_preview_stale" ? storageCopy.changed : storageCopy.cleanupFailed);
      setCleanupOpen(false);
      await loadMaterialStorage();
    } finally {
      setCleanupPending(false);
    }
  }
  const normalized = query.trim().toLowerCase();
  const categoryAttention: Record<MySettingsCategoryKey, number> = {
    execution: state ? (state.device?.status === "online" ? 0 : 1) + (state.agents ?? []).filter((item) => item.status === "disabled" || item.health?.status === "unhealthy").length : 0,
    connections: (state?.applications ?? []).filter((item) => item.status !== "active" || item.localReadiness?.state === "repair_required").length
      + (state?.channelOperations ?? []).filter((item) => !item.ready || item.health === "attention").length,
    automation: (state?.scheduleHealth ?? []).filter((item) => item.needsAttention).length,
    governance: state?.pendingDecisions?.length ?? 0,
    resources: (state?.budgetStatuses ?? []).filter((item) => item.over).length,
    diagnostics: (state?.invocations ?? []).filter((item) => ["failed", "timed_out", "refused"].includes(item.status ?? "")).length,
  };
  const categories = useMemo(() => MY_SETTINGS_CATEGORIES.map((category) => ({
    ...category,
    pages: category.sections
      .filter((key) => (key !== "siteSettings" && key !== "myHosts") || professionalMode)
      .filter((key) => canDiscoverProfessionalPage(key, sessionUser?.role))
      .map((key) => pageRegistration(key))
      .filter((page) => !normalized || matchesSettingsQuery(`${t(page.labelKey)} ${t(page.blurbKey)} ${settingsSearchAliases(page.key)}`, normalized)),
  })).filter((category) => category.pages.length > 0), [normalized, professionalMode, sessionUser?.role, t]);
  const quickAccessPages = useMemo(() => {
    const keys = [...favoriteSections, ...recentSections.filter((key) => !favoriteSections.includes(key))];
    return keys
      .filter((key, index) => keys.indexOf(key) === index && ((key !== "siteSettings" && key !== "myHosts") || professionalMode) && canDiscoverProfessionalPage(key, sessionUser?.role))
      .map((key) => pageRegistration(key));
  }, [favoriteSections, professionalMode, recentSections, sessionUser?.role]);

  const readyAgents = (state?.agents ?? []).filter((item) => item.status !== "disabled" && item.health?.status !== "unhealthy").length;
  const readyApplications = (state?.applications ?? []).filter((item) => item.status === "active" && item.localReadiness?.state !== "repair_required").length;
  const readyChannels = (state?.channelOperations ?? []).filter((item) => item.ready && item.health !== "attention").length;
  const checks = [
    { key: "device", label: "settingsHome.checks.device" as const, fix: "settingsHome.fixes.device" as const, ready: state?.device?.status === "online", section: "devices" as const },
    { key: "agent", label: "settingsHome.checks.agent" as const, fix: "settingsHome.fixes.agent" as const, ready: readyAgents > 0, section: "agents" as const },
    { key: "application", label: "settingsHome.checks.application" as const, fix: "settingsHome.fixes.application" as const, ready: readyApplications > 0, section: "applications" as const },
    { key: "channel", label: "settingsHome.checks.channel" as const, fix: "settingsHome.fixes.channel" as const, ready: readyChannels > 0, section: "channels" as const, optional: true },
  ];
  const needsFix = checks.filter((item) => !item.ready && !item.optional);
  const applications = state?.applications ?? [];
  const selectedApplication = applications.find((item) => item.id === applicationId) ?? applications[0] ?? null;
  const dependencyState = deriveApplicationDependencyState(selectedApplication, state);
  const relatedInvocations = (state?.invocations ?? []).filter((item) =>
    item.options?.metadata?.applicationId === selectedApplication?.id
    || (state?.applicationResults ?? []).some((result) => result.applicationId === selectedApplication?.id && result.invocationId === item.id));
  const relatedAgentIds = new Set(relatedInvocations.map((item) => item.agentId).filter(Boolean));
  const relatedAgents = (state?.agents ?? []).filter((item) => relatedAgentIds.has(item.id));
  const applicationCapabilities = new Set((selectedApplication?.probe?.capabilities ?? []).map((item) => item.name));
  const relatedInvocationIds = new Set(relatedInvocations.map((item) => item.id));
  const relatedChannelIds = new Set((state?.channelDeliveries ?? [])
    .filter((item) => item.invocationId && relatedInvocationIds.has(item.invocationId))
    .map((item) => item.channelId));
  const matchedCapabilities = [...applicationCapabilities].filter((name) =>
    relatedAgents.some((item) => (item.capabilities ?? []).some((capability) => capability.name === name)));
  const setupStages = [
    { key: "application", ready: selectedApplication?.status === "active" && selectedApplication.localReadiness?.state !== "repair_required", reason: selectedApplication ? `${selectedApplication.name} · ${selectedApplication.localReadiness?.state ?? selectedApplication.status}` : t("settingsHome.noApplication"), section: "applications" as const },
    { key: "agent", ready: relatedAgents.some((item) => item.status !== "disabled" && item.health?.status !== "unhealthy"), reason: relatedAgents.map((item) => item.name).join(", ") || t("settingsHome.noActualLink"), section: "agents" as const },
    { key: "tool", ready: matchedCapabilities.length > 0, reason: matchedCapabilities.join(", ") || t("settingsHome.noActualLink"), section: "tools" as const },
    { key: "channel", ready: (state?.channelOperations ?? []).some((item) => relatedChannelIds.has(item.id) && item.ready && item.health !== "attention"), reason: [...relatedChannelIds].join(", ") || t("settingsHome.noActualLink"), section: "channels" as const, optional: true },
  ];
  const settingSearchTargets = [
    { id: "settings-personalization", title: zh ? "AI 个性化" : "AI personalization", description: zh ? "查看和修正 AI 对你工作方式的理解" : "Review and correct how AI understands your work" },
    ...(canManage ? [
    { id: "settings-recommended", title: t("settingsHome.recommended"), description: needsFix.map((item) => t(item.fix)).join(" ") },
    { id: "settings-readiness", title: t("settingsHome.health"), description: checks.map((item) => t(item.label)).join(" ") },
    { id: "settings-projects", title: zh ? "高级项目设置" : "Advanced project settings", description: zh ? "仓库、工作树、隔离、预算和归档" : "Repository, worktree, isolation, budget, and archive controls" },
    { id: "settings-external-issues", title: externalCopy.title, description: externalCopy.description },
    { id: "settings-storage", title: storageCopy.title, description: storageCopy.description },
    ...(state?.reportSchedule ? [{ id: "settings-report-schedule", title: zh ? "定时报告" : "Scheduled reports", description: zh ? "配置任务状态报告的发送周期与接收位置" : "Configure when task-status reports are sent and where they are delivered" }] : []),
    { id: "settings-capability-path", title: t("settingsHome.setupGuide"), description: t("settingsHome.setupGuideHint") },
    ] : []),
  ];
  const matchingSettingTargets = normalized
    ? settingSearchTargets.filter((item) => matchesSettingsQuery(`${item.title} ${item.description}`, normalized))
    : [];

  return (
    <div ref={rootRef} className="space-y-5">
      {!embedded ? <SectionHeading eyebrow={t("settingsHome.eyebrow")} title={t("settingsHome.title")} description={t("settingsHome.description")} /> : null}
      {!embedded ? <Card>
        <CardHeader>
          <CardTitle>{t("settingsHome.professionalAreas")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("settingsHome.professionalAreasHint")}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" aria-label={t("settingsHome.search")} placeholder={t("settingsHome.searchPlaceholder")} />
          </div>
          {!normalized && !selectedCategory && quickAccessPages.length ? (
            <section className="space-y-2" aria-labelledby="settings-quick-access">
              <h2 id="settings-quick-access" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{zh ? "收藏与最近访问" : "Favorites and recent"}</h2>
              <div className="flex flex-wrap gap-2">
                {quickAccessPages.map((page) => {
                  const favorite = favoriteSections.includes(page.key);
                  return (
                    <div key={page.key} className="flex items-center rounded-lg border bg-muted/15">
                      <button type="button" onClick={() => navigate(page.key)} className="flex items-center gap-2 rounded-l-lg px-3 py-2 text-sm hover:bg-muted">
                        {favorite ? <Star className="size-3.5 fill-current text-warning" aria-hidden /> : <Clock3 className="size-3.5 text-muted-foreground" aria-hidden />}
                        {t(page.labelKey)}
                      </button>
                      <button type="button" aria-label={favorite ? `${zh ? "取消收藏" : "Remove from favorites"} ${t(page.labelKey)}` : `${zh ? "收藏" : "Favorite"} ${t(page.labelKey)}`} onClick={() => toggleFavorite(page.key)} className="rounded-r-lg border-l p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
                        <Star className={`size-3.5 ${favorite ? "fill-current text-warning" : ""}`} aria-hidden />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
          {normalized || selectedCategory ? (
            <div className="space-y-3">
              {!normalized && selectedCategory ? (
                <button type="button" className="inline-flex items-center gap-1 rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => {
                  const previousCategory = selectedCategory;
                  setSelectedCategory(null);
                  requestAnimationFrame(() => document.getElementById(`settings-category-button-${previousCategory}`)?.focus());
                }}>
                  <ArrowLeft className="size-4" aria-hidden />{t("settingsHome.allCategories")}
                </button>
              ) : null}
              <div className="grid gap-3 lg:grid-cols-2">
                {categories.filter((category) => normalized || !selectedCategory || category.key === selectedCategory).map((category) => (
                  <section key={category.key} className="rounded-xl border bg-muted/15 p-3" aria-labelledby={`settings-category-${category.key}`}>
                    <h2 id={`settings-category-${category.key}`} tabIndex={-1} className="text-sm font-semibold outline-none">{t(`settingsHome.categories.${category.key}.title`)}</h2>
                    <p className="mb-2 text-xs text-muted-foreground">{t(`settingsHome.categories.${category.key}.hint`)}</p>
                    <div className="grid gap-1 sm:grid-cols-2">
                      {category.pages.map((page) => {
                        const Icon = page.icon;
                        const favorite = favoriteSections.includes(page.key);
                        return (
                          <div key={page.key} className="flex min-w-0 items-start rounded-lg hover:bg-muted">
                            <button type="button" onClick={() => navigate(page.key)} className="flex min-w-0 flex-1 items-start gap-2 p-2 text-left">
                              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                              <span className="min-w-0"><strong className="block text-sm font-medium">{t(page.labelKey)}</strong><span className="block text-xs text-muted-foreground">{t(page.blurbKey)}</span></span>
                            </button>
                            <button type="button" aria-label={favorite ? `${zh ? "取消收藏" : "Remove from favorites"} ${t(page.labelKey)}` : `${zh ? "收藏" : "Favorite"} ${t(page.labelKey)}`} onClick={() => toggleFavorite(page.key)} className="m-1 rounded p-1.5 text-muted-foreground hover:bg-background hover:text-foreground">
                              <Star className={`size-3.5 ${favorite ? "fill-current text-warning" : ""}`} aria-hidden />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {categories.map((category) => (
                <button id={`settings-category-button-${category.key}`} key={category.key} type="button" onClick={() => {
                  setSelectedCategory(category.key);
                  requestAnimationFrame(() => document.getElementById(`settings-category-${category.key}`)?.focus());
                }} className="flex min-h-28 items-start gap-3 rounded-xl border bg-muted/15 p-4 text-left hover:bg-muted/50">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{t(`settingsHome.categories.${category.key}.title`)}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{t(`settingsHome.categories.${category.key}.hint`)}</span>
                    <span className="mt-3 block text-[11px] text-muted-foreground">{t("settingsHome.capabilityCount", { count: category.pages.length })}</span>
                    {categoryAttention[category.key] ? <span className="mt-1 block text-[11px] font-medium text-warning">{t("shell.attention", { count: categoryAttention[category.key] })}</span> : null}
                  </span>
                  <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              ))}
            </div>
          )}
          {matchingSettingTargets.length ? (
            <div className="grid gap-2 sm:grid-cols-2" aria-label={t("settingsHome.search")}>
              {matchingSettingTargets.map((item) => (
                <button key={item.id} type="button" className="flex items-center justify-between gap-3 rounded-lg border p-3 text-left hover:bg-muted" onClick={() => document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                  <span><strong className="block text-sm">{item.title}</strong><span className="block text-xs text-muted-foreground">{item.description}</span></span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              ))}
            </div>
          ) : null}
          {!categories.length && !matchingSettingTargets.length ? <p className="text-sm text-muted-foreground">{t("settingsHome.noMatch")}</p> : null}
          {!canManage && sessionUser?.role ? (
            <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground" role="status">
              {t("settingsRole.limited", { role: t(`identity.role.${sessionUser.role}`) })}
            </p>
          ) : null}
        </CardContent>
      </Card> : null}
      <Card id="settings-personalization">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>{zh ? "AI 个性化" : "AI personalization"}</CardTitle>
              <p className="text-sm text-muted-foreground">{zh ? "低频核实 AI 对你的角色、领域和工作偏好的理解。" : "Occasionally review how AI understands your role, domain, and work preferences."}</p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setProfileOpen((open) => !open)}>{profileOpen ? (zh ? "收起" : "Close") : (zh ? "查看工作画像" : "Review work profile")}</Button>
          </div>
        </CardHeader>
        {profileOpen ? <CardContent><WorkProfileReview /></CardContent> : null}
      </Card>
      {canManage ? <>
      {needsFix.length ? (
        <Card id="settings-recommended">
          <CardHeader><CardTitle>{t("settingsHome.recommended")}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {needsFix.map((check, index) => (
              <button key={check.key} type="button" onClick={() => navigate(check.section)} className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted">
                <span>{index + 1}. {t(check.fix)}</span><span aria-hidden>→</span>
              </button>
            ))}
          </CardContent>
        </Card>
      ) : null}
      <Card id="settings-projects">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>{zh ? "高级项目设置" : "Advanced project settings"}</CardTitle>
              <p className="text-sm text-muted-foreground">{zh ? "管理仓库、工作树、运行隔离、预算和归档。普通项目页不会显示这些低频选项。" : "Manage repositories, worktrees, run isolation, budgets, and archives outside the everyday project view."}</p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setAdvancedProjectsOpen((open) => !open)}>{advancedProjectsOpen ? (zh ? "收起" : "Close") : (zh ? "打开高级设置" : "Open advanced settings")}</Button>
          </div>
        </CardHeader>
        {advancedProjectsOpen ? <CardContent><AdvancedProjectsSettings /></CardContent> : null}
      </Card>
      {state?.reportSchedule ? (
        <section id="settings-report-schedule" aria-label={zh ? "报告调度" : "Report schedule"}>
          <ReportSchedulePanel
            schedule={state.reportSchedule}
            channels={(state.channelOperations ?? []).map((channel) => ({ id: channel.id, name: channel.name }))}
            conversations={state.channelConversations ?? []}
          />
        </section>
      ) : null}
      <Card id="settings-external-issues">
        <CardHeader>
          <CardTitle>{externalCopy.title}</CardTitle>
          <p className="text-sm text-muted-foreground">{currentProject ? `${currentProject.name} · ${externalCopy.description}` : externalCopy.unavailable}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {([
            ["intakeEnabled", externalCopy.intake, externalCopy.intakeHint],
            ["writebackEnabled", externalCopy.writeback, externalCopy.writebackHint],
            ["autoExecutionEnabled", externalCopy.auto, externalCopy.autoHint],
            ["emergencyStop", externalCopy.stop, externalCopy.stopHint],
          ] as const).map(([key, label, hint]) => (
            <label key={key} className={`flex items-start gap-3 rounded-lg border p-3 ${key === "emergencyStop" && externalPolicy[key] ? "border-destructive/45 bg-destructive/[0.05]" : ""}`}>
              <input
                className="mt-1 size-4"
                type="checkbox"
                checked={externalPolicy[key]}
                disabled={!currentProject || externalPolicyPending}
                onChange={(event) => setExternalPolicy((current) => ({ ...current, [key]: event.target.checked }))}
              />
              <span className="min-w-0"><strong className="block text-sm">{label}</strong><span className="block text-xs text-muted-foreground">{hint}</span></span>
            </label>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={`text-xs ${externalPolicyNotice === externalCopy.failed ? "text-destructive" : "text-muted-foreground"}`} role={externalPolicyNotice ? "status" : undefined}>{externalPolicyNotice}</p>
            <Button size="sm" disabled={!currentProject || externalPolicyPending} onClick={() => { void saveExternalPolicy(); }}>
              {externalPolicyPending ? externalCopy.saving : externalCopy.save}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card id="settings-readiness">
        <CardHeader><CardTitle>{t("settingsHome.health")}</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {checks.map((check) => (
            <button key={check.key} type="button" onClick={() => navigate(check.section)} className="rounded-lg border p-3 text-left hover:bg-muted">
              <span className="flex items-center justify-between gap-2 text-sm font-medium">
                {t(check.label)}
                {check.ready ? <CheckCircle2 className="size-4 text-success" /> : <AlertTriangle className="size-4 text-warning" />}
              </span>
              <StatusBadge tone={check.ready ? "success" : check.optional ? "neutral" : "warning"}>
                {t(check.ready ? "settingsHome.ready" : check.optional ? "settingsHome.optional" : "settingsHome.needsSetup")}
              </StatusBadge>
            </button>
          ))}
        </CardContent>
      </Card>
      <Card id="settings-storage">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><HardDrive className="size-5" aria-hidden />{storageCopy.title}</CardTitle>
          <p className="text-sm text-muted-foreground">{storageCopy.description}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {storageLoading ? <p className="text-sm text-muted-foreground" role="status">{storageCopy.loading}</p> : materialStorage ? (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">{storageCopy.used}</p>
                  <p className="text-lg font-semibold">{formatBytes(materialStorage.usedBytes, locale)} <span className="text-sm font-normal text-muted-foreground">/ {formatBytes(materialStorage.limitBytes, locale)}</span></p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">{storageCopy.reclaimable}</p>
                  <p className="text-sm font-medium">{formatBytes(materialStorage.reclaimableBytes, locale)}</p>
                </div>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label={storageCopy.used}
                aria-valuemin={0}
                aria-valuemax={materialStorage.limitBytes}
                aria-valuenow={Math.min(materialStorage.usedBytes, materialStorage.limitBytes)}
              >
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.min(100, materialStorage.limitBytes ? (materialStorage.usedBytes / materialStorage.limitBytes) * 100 : 0)}%` }} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground" role={storageNotice ? "status" : undefined}>{storageNotice ?? (!materialStorage.reclaimableBytes ? storageCopy.none : storageCopy.scope
                  .replace("{{files}}", String(materialStorage.fileCount))
                  .replace("{{completed}}", String(materialStorage.completedTaskCount ?? 0))
                  .replace("{{drafts}}", String(materialStorage.expiredDraftCount ?? 0)))}</p>
                <Button size="sm" variant="secondary" disabled={!materialStorage.reclaimableBytes} onClick={() => setCleanupOpen(true)}><Trash2 aria-hidden />{storageCopy.action}</Button>
              </div>
            </>
          ) : <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-warning" role="alert">{storageCopy.unavailable}</p><Button size="sm" variant="secondary" onClick={() => { void loadMaterialStorage(); }}>{storageCopy.retry}</Button></div>}
        </CardContent>
      </Card>
      <Card id="settings-capability-path">
        <CardHeader><CardTitle>{t("settingsHome.setupGuide")}</CardTitle><p className="text-sm text-muted-foreground">{t("settingsHome.setupGuideHint")}</p></CardHeader>
        <CardContent className="space-y-3">
          <Select aria-label={t("settingsHome.applicationPicker")} value={selectedApplication?.id ?? ""} onChange={(event) => setApplicationId(event.target.value)}>
            {!applications.length ? <option value="">{t("settingsHome.noApplication")}</option> : null}
            {applications.map((application) => <option key={application.id} value={application.id}>{application.name}</option>)}
          </Select>
          <p className="text-xs text-muted-foreground">{t("dependencyLifecycle.summary", { state: t(`dependencyLifecycle.${dependencyState.lifecycle}`) })}</p>
          <div className="grid gap-2 sm:grid-cols-4">
          {setupStages.map((stage, index) => (
            <button key={stage.key} type="button" onClick={() => navigate(stage.section)} className="rounded-lg border p-3 text-left hover:bg-muted">
              <span className="text-xs text-muted-foreground">{index + 1}</span>
              <strong className="block text-sm">{t(stage.key === "application" ? "settingsHome.guide.application" : stage.key === "agent" ? "settingsHome.guide.agent" : stage.key === "tool" ? "settingsHome.guide.tool" : "settingsHome.guide.channel")}</strong>
              <span className="text-xs text-muted-foreground">{t(stage.ready ? "settingsHome.ready" : stage.optional ? "settingsHome.optional" : "settingsHome.needsSetup")}</span>
              <span className="mt-1 block truncate text-[11px] text-muted-foreground" title={stage.reason}>{t("settingsHome.basis", { basis: stage.reason })}</span>
            </button>
          ))}
          </div>
        </CardContent>
      </Card>
      </> : null}
      <Modal open={cleanupOpen} onClose={() => setCleanupOpen(false)} title={storageCopy.confirmTitle} description={storageCopy.confirmDescription} closeDisabled={cleanupPending}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{storageCopy.scope
            .replace("{{files}}", String(materialStorage?.fileCount ?? 0))
            .replace("{{completed}}", String(materialStorage?.completedTaskCount ?? 0))
            .replace("{{drafts}}", String(materialStorage?.expiredDraftCount ?? 0))}</p>
          <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
            {storageCopy.confirmDetail
              .replace("{{bytes}}", formatBytes(materialStorage?.reclaimableBytes ?? 0, locale))
              .replace("{{files}}", String(materialStorage?.fileCount ?? 0))
              .replace("{{days}}", String(materialStorage?.retentionDays ?? 30))}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={cleanupPending} onClick={() => setCleanupOpen(false)}>{storageCopy.cancel}</Button>
            <Button disabled={cleanupPending} onClick={() => { void cleanupMaterialStorage(); }}><Trash2 aria-hidden />{cleanupPending ? storageCopy.cleaning : storageCopy.confirm}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
