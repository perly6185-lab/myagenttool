import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, CircleAlert, FileInput, FileOutput, FileText, FolderOpen, Library, Mail, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LocalContentHealth, LocalContentKind } from "@/features/local-content/local-content-types";
import { localContentApi } from "@/features/local-content/local-content-api";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import type { LocalWorkItem } from "./task-view-types";

const COPY = {
  zh: {
    title: "资料库引用",
    hint: "引用指向本机唯一原件；AI 执行时会在受控工作区创建工作副本。",
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
    kinds: { article: "文章", material: "资料", mail: "邮件", task: "任务", task_input: "任务输入", task_output: "任务输出" },
  },
  en: {
    title: "Library references",
    hint: "References point to one on-device original. AI creates a working copy in the controlled workspace when it runs.",
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
  const referenceKey = references.map((reference) => reference.contentId).join(",");
  const contentIds = useMemo(() => referenceKey ? referenceKey.split(",") : [], [referenceKey]);
  const [healthRecords, setHealthRecords] = useState<LocalContentHealth[]>([]);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState(false);
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

  const healthById = new Map(healthRecords.map((entry) => [entry.contentId, entry]));

  if (!references.length) return null;

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
        <Badge tone="neutral">{references.length}</Badge>
        {healthError ? <Button size="sm" variant="ghost" disabled={healthLoading} onClick={() => void loadHealth(true)}>
          <RefreshCw className={healthLoading ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden />{copy.retryHealth}
        </Button> : null}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{copy.hint}</p>
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
      </div>
      {error ? <p className="mt-2 text-sm text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}
