import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, CircleAlert, Cloud, Database, FileInput, FileOutput, FileText, FolderOpen, HardDrive, Library, Mail, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LocalContentHealth, LocalContentKind, WorkItemResourcePreflight } from "@/features/local-content/local-content-types";
import { localContentApi, workResourceApi } from "@/features/local-content/local-content-api";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import type { LocalWorkItem } from "./task-view-types";

const COPY = {
  zh: {
    title: "来自我的资料",
    hint: "AI 执行前会再次检查本地原件、连接状态和固定版本；远程数据仅生成受控工作快照。",
    pinned: "已固定版本",
    live: "执行时读取当前原件",
    required: "必需输入",
    optional: "可选参考",
    remove: "移除引用：{{name}}",
    removing: "正在移除…",
    removed: "资料引用已移除，原件仍保留在原位置。",
    removeFailed: "暂时无法移除引用，请刷新任务后重试。",
    ready: "原件可用",
    changed: "原件已变化，请刷新资料记录",
    missing: "原件已移动或缺失",
    checking: "正在检查原件…",
    unknown: "状态未知",
    retryHealth: "重新检查资料状态",
    refresh: "刷新资料记录：{{name}}",
    reveal: "定位原件或所在目录：{{name}}",
    repaired: "资料记录已刷新，将在下次执行时使用当前原件。",
    recoveryFailed: "暂时无法恢复，请确认原件仍在原目录，或从资料库重新选择。",
    resourceHint: "连接数据按引用使用；远程记录不会复制进本机资料库。",
    local: "本地",
    remote: "远程",
    querySource: "查询来源",
    changeTarget: "变更目标",
    resourcePinned: "执行版本已固定",
    useCurrentResource: "使用当前版本：{{name}}",
    acceptCurrentResource: "使用当前版本",
    resourceRepaired: "已更新为当前版本，下次执行会再次校验。",
    preflightReady: "执行资料均可用，启动时还会再检查一次。",
    preflightBlocked: "{{count}} 项必需资料需要处理，AI 暂不会开始执行。",
    preflightWarning: "补充资料存在变化或暂时不可用；不会阻止其他工作。",
    preflightChecking: "正在执行资料预检…",
    preflightUnknown: "暂时无法完成资料预检，请重新检查。",
    recheckPreflight: "重新检查执行资料",
    resourceReady: "当前可用",
    resourceChanged: "版本已变化",
    resourceUnavailable: "来源不可用",
    kinds: { article: "文章", material: "资料", mail: "邮件", task: "任务", task_input: "任务输入", task_output: "任务输出" },
  },
  en: {
    title: "From My materials",
    hint: "Before running, AI checks local originals, connection health, and pinned versions again. Remote data is used only in a controlled working snapshot.",
    pinned: "Version pinned",
    live: "Read current original at run time",
    required: "Required input",
    optional: "Optional reference",
    remove: "Remove reference: {{name}}",
    removing: "Removing…",
    removed: "The reference was removed. The original remains in its existing location.",
    removeFailed: "The reference could not be removed. Refresh the task and try again.",
    ready: "Original available",
    changed: "Original changed; refresh its library record",
    missing: "Original moved or is missing",
    checking: "Checking originals…",
    unknown: "Status unknown",
    retryHealth: "Check reference status again",
    refresh: "Refresh library record: {{name}}",
    reveal: "Locate original or containing folder: {{name}}",
    repaired: "The library record was refreshed. The current original will be used for the next run.",
    recoveryFailed: "Recovery failed. Confirm the original is still in its folder, or select it again from the library.",
    resourceHint: "Connected data is used by reference; remote records are not copied into the local library.",
    local: "Local",
    remote: "Remote",
    querySource: "Query source",
    changeTarget: "Change target",
    resourcePinned: "Execution version pinned",
    useCurrentResource: "Use current version: {{name}}",
    acceptCurrentResource: "Use current version",
    resourceRepaired: "Updated to the current version. It will be checked again before the next run.",
    preflightReady: "Execution resources are available and will be checked again at start time.",
    preflightBlocked: "{{count}} required resource(s) need attention. AI will not start yet.",
    preflightWarning: "An optional resource changed or is unavailable; other work can still proceed.",
    preflightChecking: "Checking execution resources…",
    preflightUnknown: "Resource preflight is temporarily unavailable. Check again.",
    recheckPreflight: "Check execution resources again",
    resourceReady: "Current and available",
    resourceChanged: "Version changed",
    resourceUnavailable: "Source unavailable",
    kinds: { article: "Article", material: "Material", mail: "Mail", task: "Task", task_input: "Task input", task_output: "Task output" },
  },
} as const;

function kindIcon(kind: LocalContentKind) {
  if (kind === "mail") return Mail;
  if (kind === "task_input") return FileInput;
  if (kind === "task_output") return FileOutput;
  if (kind === "task") return FileText;
  return Archive;
}

export function TaskContentReferences({
  item,
  readOnly = false,
  onUpdated,
}: {
  item: LocalWorkItem;
  readOnly?: boolean;
  onUpdated: (item: LocalWorkItem, notice: string) => void;
}) {
  const { i18n } = useAppTranslation();
  const copy = COPY[i18n.language.startsWith("zh") ? "zh" : "en"];
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingRecoveryId, setPendingRecoveryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const references = item.localContentRefs ?? [];
  const resourceReferences = item.taskResourceRefs ?? [];
  const allReferenceKey = [...references.map((reference) => reference.id), ...resourceReferences.map((reference) => reference.id)].join(",");
  const referenceKey = references.map((reference) => reference.contentId).join(",");
  const contentIds = useMemo(() => referenceKey ? referenceKey.split(",") : [], [referenceKey]);
  const [healthRecords, setHealthRecords] = useState<LocalContentHealth[]>([]);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState(false);
  const [preflight, setPreflight] = useState<WorkItemResourcePreflight | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightError, setPreflightError] = useState(false);
  const loadHealth = useCallback(async (showLoading = false) => {
    if (!contentIds.length) {
      setHealthRecords([]);
      return;
    }
    if (showLoading) setHealthLoading(true);
    try {
      const response = await localContentApi.health(contentIds);
      setHealthRecords(response.health);
      setHealthError(false);
    } catch {
      setHealthError(true);
    } finally {
      if (showLoading) setHealthLoading(false);
    }
  }, [contentIds]);
  const loadPreflight = useCallback(async (showLoading = false) => {
    if (!allReferenceKey) {
      setPreflight(null);
      return;
    }
    if (showLoading) setPreflightLoading(true);
    try {
      const response = await workResourceApi.preflightWorkItem(item.id);
      setPreflight(response.preflight);
      setPreflightError(false);
    } catch {
      setPreflightError(true);
    } finally {
      if (showLoading) setPreflightLoading(false);
    }
  }, [allReferenceKey, item.id]);

  useEffect(() => {
    let active = true;
    const refresh = async (showLoading = false) => {
      if (!active) return;
      await loadHealth(showLoading);
    };
    void refresh(true);
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [item.id, loadHealth]);

  useEffect(() => {
    let active = true;
    const refresh = async (showLoading = false) => {
      if (!active) return;
      await loadPreflight(showLoading);
    };
    void refresh(true);
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [item.id, loadPreflight]);

  const healthById = new Map(healthRecords.map((entry) => [entry.contentId, entry]));
  const preflightById = new Map((preflight?.references ?? []).map((entry) => [entry.referenceId, entry]));

  if (!references.length && !resourceReferences.length) return null;

  async function remove(referenceId: string) {
    if (pendingId) return;
    setPendingId(referenceId);
    setError(null);
    try {
      const response = await localContentApi.removeFromWorkItem(item.id, referenceId, item.revision);
      const next = response.workItem as LocalWorkItem;
      onUpdated(next, copy.removed);
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "local-content-reference-remove", workItemId: next.id } }));
    } catch {
      setError(copy.removeFailed);
    } finally {
      setPendingId(null);
    }
  }

  async function removeResource(referenceId: string) {
    if (pendingId) return;
    setPendingId(referenceId);
    setError(null);
    try {
      const response = await workResourceApi.removeFromWorkItem(item.id, referenceId, item.revision);
      const next = response.workItem as LocalWorkItem;
      onUpdated(next, copy.removed);
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "work-resource-reference-remove", workItemId: next.id } }));
    } catch {
      setError(copy.removeFailed);
    } finally {
      setPendingId(null);
    }
  }

  async function refreshResourceReference(referenceId: string) {
    if (pendingRecoveryId) return;
    setPendingRecoveryId(referenceId);
    setError(null);
    try {
      const response = await workResourceApi.refreshWorkItemReference(item.id, referenceId, item.revision);
      const next = response.workItem as LocalWorkItem;
      await loadPreflight();
      onUpdated(next, copy.resourceRepaired);
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "work-resource-reference-refresh", workItemId: next.id } }));
    } catch {
      setError(copy.recoveryFailed);
    } finally {
      setPendingRecoveryId(null);
    }
  }

  async function refreshReference(contentId: string) {
    if (pendingRecoveryId) return;
    setPendingRecoveryId(contentId);
    setError(null);
    try {
      await localContentApi.refresh(contentId);
      await loadHealth();
      onUpdated(item, copy.repaired);
    } catch {
      setError(copy.recoveryFailed);
    } finally {
      setPendingRecoveryId(null);
    }
  }

  async function revealReference(contentId: string) {
    if (pendingRecoveryId) return;
    setPendingRecoveryId(contentId);
    setError(null);
    try {
      await localContentApi.revealContainer(contentId);
    } catch {
      setError(copy.recoveryFailed);
    } finally {
      setPendingRecoveryId(null);
    }
  }

  return (
    <div className="mt-4 border-t border-border/70 pt-3">
      <div className="flex items-center gap-2">
        <Library className="size-4 text-primary" aria-hidden />
        <h5 className="text-sm font-medium">{copy.title}</h5>
        <Badge tone="neutral">{references.length + resourceReferences.length}</Badge>
        {healthError ? <Button size="sm" variant="ghost" disabled={healthLoading} onClick={() => void loadHealth(true)}>
          <RefreshCw className={healthLoading ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden />{copy.retryHealth}
        </Button> : null}
        <Button size="sm" variant="ghost" disabled={preflightLoading} aria-label={copy.recheckPreflight} onClick={() => void loadPreflight(true)}>
          <RefreshCw className={preflightLoading ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden />
        </Button>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{copy.hint}</p>
      <p className={`mt-2 rounded-lg border px-3 py-2 text-xs ${preflightError ? "border-warning/40 bg-warning/[0.07]" : preflight?.counts.blocking ? "border-destructive/30 bg-destructive/[0.06] text-destructive" : "border-border bg-muted/35 text-muted-foreground"}`} role="status">
        {preflightError ? copy.preflightUnknown
          : !preflight ? copy.preflightChecking
            : preflight?.counts.blocking ? copy.preflightBlocked.replace("{{count}}", String(preflight.counts.blocking))
              : preflight && (preflight.counts.changed || preflight.counts.unavailable || preflight.counts.unknown) ? copy.preflightWarning
                : copy.preflightReady}
      </p>
      <div className="mt-2 space-y-2">
        {references.map((reference) => {
          const Icon = kindIcon(reference.kind);
          const currentHealth = healthById.get(reference.contentId);
          const unhealthy = currentHealth && currentHealth.state !== "ready";
          return (
            <div key={reference.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/45 px-3 py-2 text-sm">
              <Icon className="size-4 shrink-0 text-primary" aria-hidden />
              <span className="min-w-[10rem] flex-1 truncate">{reference.title}</span>
              <Badge tone="neutral">{copy.kinds[reference.kind]}</Badge>
              <Badge tone="neutral">{reference.purpose === "reference" ? copy.optional : copy.required}</Badge>
              <span className="text-xs text-muted-foreground">{reference.fingerprintPinned ? copy.pinned : copy.live}</span>
              {healthLoading ? <span className="text-xs text-muted-foreground">{copy.checking}</span> : currentHealth ? (
                <Badge tone={unhealthy ? "warning" : "success"}>
                  {currentHealth.state === "ready" ? copy.ready : currentHealth.state === "changed" ? copy.changed : copy.missing}
                </Badge>
              ) : healthError ? <Badge tone="warning">{copy.unknown}</Badge> : null}
              {unhealthy && currentHealth?.canRefresh ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={Boolean(pendingRecoveryId)}
                  aria-label={copy.refresh.replace("{{name}}", reference.title)}
                  onClick={() => void refreshReference(reference.contentId)}
                >
                  <RefreshCw className={pendingRecoveryId === reference.contentId ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden />
                </Button>
              ) : null}
              {unhealthy && currentHealth?.canReveal ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={Boolean(pendingRecoveryId)}
                  aria-label={copy.reveal.replace("{{name}}", reference.title)}
                  onClick={() => void revealReference(reference.contentId)}
                >
                  <FolderOpen className="size-3.5" aria-hidden />
                </Button>
              ) : null}
              {unhealthy ? <CircleAlert className="size-4 text-warning" aria-hidden /> : null}
              {!readOnly ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="hover:text-destructive"
                  disabled={Boolean(pendingId)}
                  aria-label={copy.remove.replace("{{name}}", reference.title)}
                  onClick={() => void remove(reference.id)}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  {pendingId === reference.id ? copy.removing : null}
                </Button>
              ) : null}
            </div>
          );
        })}
        {resourceReferences.map((reference) => {
          const LocationIcon = reference.locality === "local" ? HardDrive : Cloud;
          const currentPreflight = preflightById.get(reference.id);
          const resourceUnhealthy = currentPreflight && currentPreflight.status !== "ready";
          return <div key={reference.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/45 px-3 py-2 text-sm">
            <Database className="size-4 shrink-0 text-primary" aria-hidden />
            <span className="min-w-[10rem] flex-1 truncate">{reference.title}</span>
            <Badge tone="neutral"><LocationIcon className="mr-1 size-3" aria-hidden />{reference.locality === "local" ? copy.local : copy.remote}</Badge>
            <Badge tone="neutral">{reference.purpose === "query_source" ? copy.querySource : reference.purpose === "change_target" ? copy.changeTarget : copy.optional}</Badge>
            {reference.versionPinned ? <span className="text-xs text-muted-foreground">{copy.resourcePinned}</span> : null}
            <span className="text-xs text-muted-foreground">{reference.sourceLabel}</span>
            {currentPreflight ? <Badge tone={resourceUnhealthy ? "warning" : "success"}>{currentPreflight.status === "ready" ? copy.resourceReady : currentPreflight.status === "changed" ? copy.resourceChanged : currentPreflight.status === "unavailable" ? copy.resourceUnavailable : copy.unknown}</Badge> : preflightError ? <Badge tone="warning">{copy.unknown}</Badge> : null}
            {!readOnly && currentPreflight?.canAcceptCurrentVersion ? <Button size="sm" variant="secondary" disabled={Boolean(pendingRecoveryId)} aria-label={copy.useCurrentResource.replace("{{name}}", reference.title)} onClick={() => void refreshResourceReference(reference.id)}><RefreshCw className={pendingRecoveryId === reference.id ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden />{copy.acceptCurrentResource}</Button> : null}
            {resourceUnhealthy ? <CircleAlert className="size-4 text-warning" aria-hidden /> : null}
            {!readOnly ? <Button size="sm" variant="ghost" className="hover:text-destructive" disabled={Boolean(pendingId)} aria-label={copy.remove.replace("{{name}}", reference.title)} onClick={() => void removeResource(reference.id)}><Trash2 className="size-3.5" aria-hidden />{pendingId === reference.id ? copy.removing : null}</Button> : null}
          </div>;
        })}
      </div>
      {resourceReferences.length ? <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{copy.resourceHint}</p> : null}
      {error ? <p className="mt-2 text-sm text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}
