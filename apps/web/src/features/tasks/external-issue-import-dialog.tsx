import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, Download, LoaderCircle, Search } from "lucide-react";
import { Field } from "@/components/common/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { api } from "@/data/use-console-actions";
import { ApiError } from "@/lib/api-client";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import type { LocalWorkItem } from "./task-view-types";

type ProviderId = "github" | "gitlab" | "gitea";
const LAST_EXTERNAL_PROVIDER_KEY = "myagenttool:last-external-issue-provider";

function rememberedProvider(): ProviderId {
  try {
    const value = localStorage.getItem(LAST_EXTERNAL_PROVIDER_KEY);
    return value === "gitlab" || value === "gitea" ? value : "github";
  } catch {
    return "github";
  }
}

function rememberProvider(provider: ProviderId) {
  try {
    localStorage.setItem(LAST_EXTERNAL_PROVIDER_KEY, provider);
  } catch {
    // The selection still works for this dialog when storage is unavailable.
  }
}

type ProviderReadiness = {
  id: ProviderId;
  label: string;
  apiSync: boolean;
  webhook: boolean;
};

type GithubAvailability = "idle" | "checking" | "ready" | "unavailable";
type ExternalIssueListRow = { number: number; title: string; body: string; state: "open" | "closed"; labels: string[]; url: string | null; repository: string; updatedAt?: string };

const COPY = {
  zh: {
    title: "从 Issue 创建任务",
    description: "读取外部 Issue 并创建可规划、可执行的任务。此操作不会立即启动 AI。",
    provider: "来源平台",
    project: "归属项目",
    repository: "外部仓库",
    repositoryHint: "填写 owner/repo；GitLab 也支持群组/子群组/project。",
    issueNumber: "Issue 编号",
    issuePlaceholder: "例如 128",
    readiness: "连接状态",
    checking: "正在检查连接…",
    githubReady: "仓库与 GitHub CLI 连接可用。",
    githubMissingRepo: "该项目尚未关联可用的 GitHub 仓库。",
    githubUnavailable: "GitHub 暂不可用：{{message}}。请确认仓库关联，并运行 gh auth login 恢复登录。",
    providerReady: "API 已配置",
    providerMissing: "API 尚未配置；请先设置服务端 URL 和 Token。",
    providerSetup: "服务端需配置 MYAGENTTOOL_{{provider}}_BASE_URL 和 MYAGENTTOOL_{{provider}}_TOKEN。",
    webhookReady: "Webhook 已配置",
    webhookOptional: "Webhook 未配置；仍可手动导入和同步。",
    boundary: "创建后会打开任务。确认目标和材料后，再选择“交给 AI 开始处理”。",
    cancel: "取消",
    import: "创建任务",
    importing: "正在读取并导入…",
    loadFailed: "无法读取 Provider 配置，请刷新后重试。",
    invalidNumber: "请输入有效的正整数 Issue 编号。",
    invalidRepository: "请输入外部仓库路径。",
    credentials: "该 Provider 尚未配置凭据，请先完成服务端配置。",
    githubAuth: "无法读取 GitHub Issue。请确认仓库已关联，并运行 gh auth login 恢复登录。",
    notFound: "没有找到该 Issue，请检查仓库路径和编号。",
    network: "外部平台暂时无法连接，请稍后重试。",
    failed: "导入失败，请检查连接、仓库路径和 Issue 编号。",
    browseTitle: "浏览开放 Issue",
    browseHint: "可搜索、翻页并一次选择多个 Issue 导入。最多选择当前已加载的 20 项。",
    searchPlaceholder: "搜索标题或描述",
    browse: "查询 Issue",
    browsing: "正在查询…",
    noIssues: "没有找到符合条件的开放 Issue。",
    previous: "上一页",
    next: "下一页",
    selected: "已选择 {{count}} 项",
    importSelected: "导入所选 Issue",
    partialFailed: "已导入部分 Issue，其余项目失败；请刷新列表后重试。",
    intakeDisabled: "当前项目已关闭外部 Issue 导入或启用了紧急停止。请在设置中恢复后再导入。",
  },
  en: {
    title: "Import external issue",
    description: "Read an external issue and create a task that can be planned and executed. AI will not start yet.",
    provider: "Source provider",
    project: "Project",
    repository: "External repository",
    repositoryHint: "Use owner/repo. GitLab also supports group/subgroup/project.",
    issueNumber: "Issue number",
    issuePlaceholder: "For example, 128",
    readiness: "Connection",
    checking: "Checking connection…",
    githubReady: "The repository and GitHub CLI connection are ready.",
    githubMissingRepo: "This project does not have a ready GitHub repository.",
    githubUnavailable: "GitHub is unavailable: {{message}}. Confirm the linked repository and run gh auth login to restore access.",
    providerReady: "API configured",
    providerMissing: "API not configured. Set the server URL and token first.",
    providerSetup: "Configure MYAGENTTOOL_{{provider}}_BASE_URL and MYAGENTTOOL_{{provider}}_TOKEN on the server.",
    webhookReady: "Webhook configured",
    webhookOptional: "Webhook not configured. Manual import and sync still work.",
    boundary: "The task opens after creation. Review its goal and materials, then choose “Let AI start”.",
    cancel: "Cancel",
    import: "Create task",
    importing: "Reading and importing…",
    loadFailed: "Provider configuration could not be loaded. Refresh and try again.",
    invalidNumber: "Enter a positive issue number.",
    invalidRepository: "Enter the external repository path.",
    credentials: "This provider has no configured credentials. Complete server setup first.",
    githubAuth: "The GitHub issue could not be read. Confirm the linked repository and run gh auth login to restore access.",
    notFound: "That issue was not found. Check the repository path and issue number.",
    network: "The external provider cannot be reached right now. Try again shortly.",
    failed: "Import failed. Check the connection, repository path, and issue number.",
    browseTitle: "Browse open issues",
    browseHint: "Search, page, and select multiple issues to import. Up to 20 loaded issues can be selected.",
    searchPlaceholder: "Search titles or descriptions",
    browse: "Find issues",
    browsing: "Finding…",
    noIssues: "No matching open issues were found.",
    previous: "Previous",
    next: "Next",
    selected: "{{count}} selected",
    importSelected: "Import selected issues",
    partialFailed: "Some issues were imported and others failed. Refresh the list and retry the remaining items.",
    intakeDisabled: "External issue intake is disabled for this project or emergency stop is active. Re-enable it in Settings before importing.",
  },
} as const;

function interpolate(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce((result, [key, value]) => result.replace(`{{${key}}}`, value), template);
}

type ImportCopy = Record<keyof (typeof COPY)["en"], string>;

function importErrorMessage(error: unknown, copy: ImportCopy): string {
  if (!(error instanceof ApiError)) return copy.failed;
  if (error.code === "provider_credentials_not_configured") return copy.credentials;
  if (error.code === "github_auth_required" || error.code === "external_issue_fetch_failed") return copy.githubAuth;
  if (error.code === "github_issue_not_found" || error.code === "provider_http_404") return copy.notFound;
  if (error.code === "provider_network_error" || error.code === "provider_request_failed") return copy.network;
  if (error.code === "invalid_provider_repository_or_issue") return copy.invalidRepository;
  if (error.code === "external_issue_intake_disabled" || error.code === "external_issue_emergency_stop") return copy.intakeDisabled;
  return copy.failed;
}

export function ExternalIssueImportDialog({
  open,
  projects,
  repoProjectIds,
  initialProjectId,
  onClose,
  onImported,
}: {
  open: boolean;
  projects: { id: string; name: string; externalIssuePolicy?: { intakeEnabled: boolean; emergencyStop: boolean } }[];
  repoProjectIds: Set<string>;
  initialProjectId?: string;
  onClose: () => void;
  onImported: (workItem: LocalWorkItem, context: { provider: ProviderId; duplicate: boolean; importedCount?: number; failedCount?: number }) => void;
}) {
  const { i18n } = useAppTranslation();
  const copy = i18n.language.startsWith("zh") ? COPY.zh : COPY.en;
  const [provider, setProvider] = useState<ProviderId>("github");
  const [projectId, setProjectId] = useState("");
  const [repository, setRepository] = useState("");
  const [issueNumber, setIssueNumber] = useState("");
  const [providers, setProviders] = useState<ProviderReadiness[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [githubAvailability, setGithubAvailability] = useState<GithubAvailability>("idle");
  const [githubMessage, setGithubMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [browseQuery, setBrowseQuery] = useState("");
  const [browseIssues, setBrowseIssues] = useState<ExternalIssueListRow[]>([]);
  const [browsePage, setBrowsePage] = useState(1);
  const [browseHasMore, setBrowseHasMore] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseLoaded, setBrowseLoaded] = useState(false);
  const [selectedIssues, setSelectedIssues] = useState<Set<number>>(new Set());

  const selectedProvider = providers.find((candidate) => candidate.id === provider);
  const selectedProject = projects.find((project) => project.id === projectId);
  const projectIntakeAllowed = selectedProject?.externalIssuePolicy?.intakeEnabled !== false
    && selectedProject?.externalIssuePolicy?.emergencyStop !== true;
  const githubProjectReady = repoProjectIds.has(projectId);
  const numericIssue = Number(issueNumber);
  const validIssue = Number.isInteger(numericIssue) && numericIssue > 0;
  const validRepository = provider === "github" || repository.trim().length > 0;
  const providerApiReady = provider === "github" || Boolean(selectedProvider?.apiSync);
  const canSubmit = Boolean(projectId && projectIntakeAllowed && validIssue && validRepository && providerApiReady
    && (provider !== "github" || (githubProjectReady && githubAvailability === "ready")));

  useEffect(() => {
    if (!open) return;
    const preferredProject = initialProjectId && projects.some((project) => project.id === initialProjectId)
      ? initialProjectId
      : projects[0]?.id ?? "";
    setProvider(rememberedProvider());
    setProjectId(preferredProject);
    setRepository("");
    setIssueNumber("");
    setSubmitError(null);
    setBrowseQuery("");
    setBrowseIssues([]);
    setBrowsePage(1);
    setBrowseHasMore(false);
    setBrowseLoaded(false);
    setSelectedIssues(new Set());
    setProvidersError(null);
    setProvidersLoading(true);
    void (api.listWorkItemExternalProviders() as Promise<{ providers: ProviderReadiness[] }>)
      .then((result) => setProviders(result.providers))
      .catch(() => {
        setProviders([]);
        setProvidersError(copy.loadFailed);
      })
      .finally(() => setProvidersLoading(false));
    // Opening the dialog is the reset boundary. Console-state polling may
    // replace the projects array while the user is typing and must not clear
    // their provider, repository, or Issue number.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || provider !== "github") return;
    if (!projectId || !githubProjectReady) {
      setGithubAvailability("unavailable");
      setGithubMessage(copy.githubMissingRepo);
      return;
    }
    let cancelled = false;
    setGithubAvailability("checking");
    setGithubMessage("");
    void (api.listGithubItems(projectId) as Promise<{ available: boolean; message?: string }>)
      .then((result) => {
        if (cancelled) return;
        setGithubAvailability(result.available ? "ready" : "unavailable");
        setGithubMessage(result.available ? "" : result.message ?? copy.failed);
      })
      .catch(() => {
        if (!cancelled) {
          setGithubAvailability("unavailable");
          setGithubMessage(copy.githubAuth);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [copy.failed, copy.githubAuth, copy.githubMissingRepo, githubProjectReady, open, projectId, provider]);

  const readiness = useMemo(() => {
    if (provider === "github") {
      if (githubAvailability === "checking") return { tone: "neutral" as const, icon: LoaderCircle, text: copy.checking, spinning: true };
      if (githubAvailability === "ready") return { tone: "success" as const, icon: CheckCircle2, text: copy.githubReady, spinning: false };
      const text = githubMessage === copy.githubMissingRepo
        ? copy.githubMissingRepo
        : interpolate(copy.githubUnavailable, { message: githubMessage || copy.failed });
      return { tone: "danger" as const, icon: CircleAlert, text, spinning: false };
    }
    if (providersLoading) return { tone: "neutral" as const, icon: LoaderCircle, text: copy.checking, spinning: true };
    if (selectedProvider?.apiSync) return { tone: "success" as const, icon: CheckCircle2, text: copy.providerReady, spinning: false };
    return { tone: "danger" as const, icon: CircleAlert, text: copy.providerMissing, spinning: false };
  }, [copy, githubAvailability, githubMessage, providersLoading, selectedProvider, provider]);

  const submit = async () => {
    setSubmitError(null);
    if (!validIssue) {
      setSubmitError(copy.invalidNumber);
      return;
    }
    if (!validRepository) {
      setSubmitError(copy.invalidRepository);
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.createWorkItemFromExternal({
        projectId,
        provider,
        issueNumber: numericIssue,
        ...(provider === "github" ? {} : { repository: repository.trim() }),
        relation: "source",
        isPrimary: true,
        syncPolicy: "manual",
      }) as { workItem: LocalWorkItem };
      onImported(result.workItem, { provider, duplicate: false });
    } catch (error) {
      if (error instanceof ApiError && error.code === "external_issue_already_linked") {
        const existing = error.details?.workItem as LocalWorkItem | undefined;
        if (existing?.id) {
          onImported(existing, { provider, duplicate: true });
          return;
        }
      }
      setSubmitError(importErrorMessage(error, copy));
    } finally {
      setSubmitting(false);
    }
  };

  const browse = async (page = 1) => {
    if (provider === "github" || !projectId || !projectIntakeAllowed || !repository.trim() || !providerApiReady || browseLoading) return;
    setBrowseLoading(true);
    setSubmitError(null);
    try {
      const result = await api.listWorkItemExternalIssues({
        provider,
        projectId,
        repository: repository.trim(),
        query: browseQuery.trim(),
        page,
        limit: 20,
      }) as { issues?: ExternalIssueListRow[]; page?: number; hasMore?: boolean };
      setBrowseIssues(result.issues ?? []);
      setBrowsePage(result.page ?? page);
      setBrowseHasMore(Boolean(result.hasMore));
      setBrowseLoaded(true);
      setSelectedIssues(new Set());
    } catch (error) {
      setSubmitError(importErrorMessage(error, copy));
    } finally {
      setBrowseLoading(false);
    }
  };

  const importSelected = async () => {
    if (!selectedIssues.size || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const imported: { workItem: LocalWorkItem; duplicate: boolean }[] = [];
    let failed = 0;
    for (const number of selectedIssues) {
      try {
        const result = await api.createWorkItemFromExternal({
          projectId,
          provider,
          issueNumber: number,
          repository: repository.trim(),
          relation: "source",
          isPrimary: true,
          syncPolicy: "manual",
        }) as { workItem: LocalWorkItem };
        imported.push({ workItem: result.workItem, duplicate: false });
      } catch (error) {
        if (error instanceof ApiError && error.code === "external_issue_already_linked") {
          const existing = error.details?.workItem as LocalWorkItem | undefined;
          if (existing?.id) {
            imported.push({ workItem: existing, duplicate: true });
            continue;
          }
        }
        failed += 1;
      }
    }
    setSubmitting(false);
    if (failed) setSubmitError(copy.partialFailed);
    if (imported.length) {
      const first = imported[0];
      onImported(first.workItem, {
        provider,
        duplicate: first.duplicate,
        importedCount: imported.length,
        ...(failed ? { failedCount: failed } : {}),
      });
    }
  };

  const ReadinessIcon = readiness.icon;

  return (
    <Modal open={open} onClose={onClose} title={copy.title} description={copy.description} closeDisabled={submitting}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={copy.provider}>
            <Select value={provider} onChange={(event) => {
              const nextProvider = event.target.value as ProviderId;
              setProvider(nextProvider);
              rememberProvider(nextProvider);
              setSubmitError(null);
              setBrowseIssues([]);
              setBrowseLoaded(false);
              setSelectedIssues(new Set());
            }}>
              <option value="github">GitHub</option>
              <option value="gitlab">GitLab</option>
              <option value="gitea">Gitea</option>
            </Select>
          </Field>
          <Field label={copy.project}>
            <Select value={projectId} onChange={(event) => {
              setProjectId(event.target.value);
              setSubmitError(null);
            }}>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </Select>
          </Field>
        </div>

        {provider !== "github" ? (
          <Field label={copy.repository}>
            <Input aria-label={copy.repository} value={repository} onChange={(event) => { setRepository(event.target.value); setBrowseLoaded(false); setBrowseIssues([]); setSelectedIssues(new Set()); }} placeholder="owner/repo" autoComplete="off" />
            <span className="text-xs text-muted-foreground">{copy.repositoryHint}</span>
          </Field>
        ) : null}

        <Field label={copy.issueNumber}>
          <Input type="number" min="1" step="1" value={issueNumber} onChange={(event) => setIssueNumber(event.target.value)} placeholder={copy.issuePlaceholder} />
        </Field>

        <section className="space-y-2 rounded-lg border border-border bg-muted/30 p-3" aria-label={copy.readiness}>
          <div className="flex items-center gap-2 text-sm">
            <ReadinessIcon className={`size-4 ${readiness.spinning ? "animate-spin" : ""}`} aria-hidden />
            <span className="font-medium">{copy.readiness}</span>
            <Badge tone={readiness.tone}>{readiness.text}</Badge>
          </div>
          {provider !== "github" && selectedProvider?.apiSync ? (
            <p className="text-xs text-muted-foreground">
              {selectedProvider.webhook ? copy.webhookReady : copy.webhookOptional}
            </p>
          ) : null}
          {provider !== "github" && !selectedProvider?.apiSync && !providersLoading ? (
            <p className="break-all font-mono text-xs text-muted-foreground">
              {interpolate(copy.providerSetup, { provider: provider.toUpperCase() })}
            </p>
          ) : null}
          {providersError ? <p className="text-xs text-destructive" role="alert">{providersError}</p> : null}
          {!projectIntakeAllowed ? <p className="text-xs text-destructive" role="alert">{copy.intakeDisabled}</p> : null}
        </section>

        {provider !== "github" && selectedProvider?.apiSync ? (
          <section className="space-y-3 rounded-lg border border-border p-3" aria-labelledby="external-issue-browser-title">
            <div>
              <h3 id="external-issue-browser-title" className="text-sm font-semibold">{copy.browseTitle}</h3>
              <p className="text-xs text-muted-foreground">{copy.browseHint}</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input className="min-w-0 flex-1" aria-label={copy.searchPlaceholder} value={browseQuery} onChange={(event) => setBrowseQuery(event.target.value)} placeholder={copy.searchPlaceholder} />
              <Button variant="secondary" disabled={!projectIntakeAllowed || !repository.trim() || browseLoading} onClick={() => void browse(1)}>
                {browseLoading ? <LoaderCircle className="animate-spin" aria-hidden /> : <Search aria-hidden />}{browseLoading ? copy.browsing : copy.browse}
              </Button>
            </div>
            {browseLoaded ? browseIssues.length ? (
              <div className="space-y-2" aria-live="polite">
                {browseIssues.map((issue) => (
                  <label key={issue.number} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/45">
                    <input
                      className="mt-1 size-4"
                      type="checkbox"
                      checked={selectedIssues.has(issue.number)}
                      onChange={(event) => setSelectedIssues((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(issue.number); else next.delete(issue.number);
                        return next;
                      })}
                    />
                    <span className="min-w-0"><strong className="block text-sm [overflow-wrap:anywhere]">#{issue.number} {issue.title}</strong>{issue.labels?.length ? <span className="mt-1 block text-xs text-muted-foreground">{issue.labels.join(", ")}</span> : null}</span>
                  </label>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground" role="status">{copy.noIssues}</p> : null}
            {browseLoaded ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" disabled={browsePage <= 1 || browseLoading} onClick={() => void browse(browsePage - 1)}><ChevronLeft aria-hidden />{copy.previous}</Button>
                  <Button size="sm" variant="ghost" disabled={!browseHasMore || browseLoading} onClick={() => void browse(browsePage + 1)}>{copy.next}<ChevronRight aria-hidden /></Button>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={selectedIssues.size ? "success" : "neutral"}>{interpolate(copy.selected, { count: String(selectedIssues.size) })}</Badge>
                  <Button size="sm" disabled={!selectedIssues.size || submitting} onClick={() => void importSelected()}>{submitting ? <LoaderCircle className="animate-spin" aria-hidden /> : <Download aria-hidden />}{copy.importSelected}</Button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        <p className="flex items-start gap-2 rounded-lg border border-primary/25 bg-primary/[0.05] p-3 text-xs leading-relaxed">
          <Download className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          {copy.boundary}
        </p>
        {submitError ? <p className="text-sm text-destructive" role="alert">{submitError}</p> : null}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={submitting} onClick={onClose}>{copy.cancel}</Button>
          <Button disabled={!canSubmit || submitting} onClick={() => void submit()}>
            {submitting ? <LoaderCircle className="animate-spin" aria-hidden /> : <Download aria-hidden />}
            {submitting ? copy.importing : copy.import}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
