import { useRef, useState } from "react";
import { HardDrive, Paperclip, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { api } from "@/data/use-console-actions";
import {
  MAX_TASK_MATERIALS,
  TaskMaterialPicker,
  selectTaskMaterialFiles,
  type TaskMaterialSelection,
} from "@/features/dashboard/task-material-picker";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { ApiError, type TaskMaterialDraft, type TaskMaterialStorage } from "@/lib/api-client";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import type { LocalWorkItem } from "./task-view-types";

const COPY = {
  zh: {
    add: "添加参考文件",
    drop: "拖放文件到这里，或点击选择文件",
    limit: "最多 6 个文件，每个不超过 50MB",
    retry: "重试",
    remove: "移除 {{name}}",
    rejected: "部分文件未能添加。单个文件不能超过 50MB，最多添加 6 个非空文件。",
    uploadFailed: "文件准备失败，请重试或移除。",
    capacityFull: "本机参考文件空间已满。请释放本机材料存储空间后重试。",
    manageSpace: "管理本机空间",
    storageTitle: "释放本机空间并继续添加？",
    storageDescription: "无需离开当前任务。只会清理过期草稿和超过保留期的已完成任务材料，进行中的任务不受影响。",
    storageLoading: "正在检查可安全释放的空间…",
    storageUsed: "本机已使用 {{used}} / {{limit}}",
    storageSafe: "可安全释放 {{bytes}}（{{count}} 个文件）",
    storageScope: "清理范围：{{completed}} 个超过保留期的已完成任务，{{drafts}} 个过期的未完成上传。",
    storageImpact: "这些原文件清理后无法从本机恢复；已完成任务材料默认保留 {{days}} 天。",
    storageNone: "目前没有可自动清理的空间：现有材料仍被任务使用或处于保留期。当前文件仍保留在这里；如进入完整空间管理，返回后需要重新选择。",
    storageConfirm: "释放 {{bytes}} 并自动重试",
    storageSettings: "打开完整空间管理",
    storageChanged: "材料状态刚刚发生变化，已重新计算，请再次确认。",
    storageFailed: "暂时无法释放空间，文件仍保留在这里，请稍后重试。",
    automatic: "选择后会自动上传并加入任务，无需再次确认。",
    processing: "正在上传并加入任务…",
    cancel: "关闭",
    next: "参考文件已加入任务，AI 处理或重新执行任务时会使用。",
    future: "参考文件已加入任务。本次 AI 运行不变，重新执行任务时会使用。",
    addedOne: "{{name}} 已加入任务。",
    addedMany: "{{count}} 个文件已加入任务。",
    cancelUpload: "取消上传",
    checkingCancel: "正在确认取消…",
    canceled: "已取消上传，任务未加入该文件。",
    cancelCheckFailed: "暂时无法确认取消结果，请重试。",
    attachFailed: "暂时无法加入任务，请刷新任务后重试。",
  },
  en: {
    add: "Add reference files",
    drop: "Drop files here or choose files",
    limit: "Up to 6 files, 50MB each",
    retry: "Retry",
    remove: "Remove {{name}}",
    rejected: "Some files could not be added. Each file must be non-empty and under 50MB; up to 6 files are allowed.",
    uploadFailed: "A file could not be prepared. Retry or remove it.",
    capacityFull: "Local reference-file storage is full. Free some local material storage, then try again.",
    manageSpace: "Manage local storage",
    storageTitle: "Free local space and continue adding?",
    storageDescription: "Stay in this task. Only expired drafts and completed-task materials past retention are cleaned; active tasks are unaffected.",
    storageLoading: "Checking what can be safely freed…",
    storageUsed: "Local use: {{used}} / {{limit}}",
    storageSafe: "Safe to free: {{bytes}} across {{count}} files",
    storageScope: "Cleanup scope — completed tasks past retention: {{completed}}; expired unfinished uploads: {{drafts}}.",
    storageImpact: "Removed source files cannot be restored on this device. Completed-task materials are kept for {{days}} days by default.",
    storageNone: "Nothing can be cleaned automatically: existing materials are still used by tasks or within retention. The selected file stays here; if you open full storage management, select it again after returning.",
    storageConfirm: "Free {{bytes}} and retry automatically",
    storageSettings: "Open full storage management",
    storageChanged: "Material state just changed. The safe amount was recalculated; review it and confirm again.",
    storageFailed: "Space could not be freed. The selected file is still here; try again later.",
    automatic: "Selected files upload and join the task automatically. No second confirmation is needed.",
    processing: "Uploading and adding to the task…",
    cancel: "Close",
    next: "Reference files added. AI will use them when it processes or reruns this task.",
    future: "Reference files added. This AI run is unchanged; AI will use them when you rerun the task.",
    addedOne: "{{name}} added to this task.",
    addedMany: "{{count}} files added to this task.",
    cancelUpload: "Cancel upload",
    checkingCancel: "Checking cancellation…",
    canceled: "Upload canceled. The file was not added to the task.",
    cancelCheckFailed: "The cancellation could not be confirmed yet. Try again.",
    attachFailed: "The files could not be added. Refresh the task and try again.",
  },
};

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

export function TaskMaterialEditor({ item, onUpdated }: { item: LocalWorkItem; onUpdated: (item: LocalWorkItem, notice: string) => void }) {
  const { i18n } = useAppTranslation();
  const navigate = usePageNavigation();
  const copy = COPY[i18n.language.startsWith("zh") ? "zh" : "en"];
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<TaskMaterialSelection[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [capacityBlocked, setCapacityBlocked] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);
  const [storageLoading, setStorageLoading] = useState(false);
  const [storagePending, setStoragePending] = useState(false);
  const [storage, setStorage] = useState<TaskMaterialStorage | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const filesRef = useRef<TaskMaterialSelection[]>([]);
  const draft = useRef<TaskMaterialDraft | null>(null);
  const draftPromise = useRef<Promise<TaskMaterialDraft> | null>(null);
  const uploadControllers = useRef(new Map<string, AbortController>());
  const cancelRequested = useRef(new Set<string>());
  const attachInFlight = useRef(false);

  function remember(next: TaskMaterialDraft) {
    if (!draft.current || next.revision >= draft.current.revision) draft.current = next;
  }

  function updateFiles(updater: (current: TaskMaterialSelection[]) => TaskMaterialSelection[]) {
    const next = updater(filesRef.current);
    filesRef.current = next;
    setFiles(next);
  }

  async function ensureDraft() {
    if (draft.current) return draft.current;
    if (draftPromise.current) return draftPromise.current;
    draftPromise.current = (async () => {
      const response = await api.createTaskMaterialDraft(item.projectId) as { draft: TaskMaterialDraft };
      remember(response.draft);
      return response.draft;
    })();
    try { return await draftPromise.current; } finally { draftPromise.current = null; }
  }

  async function upload(selection: TaskMaterialSelection) {
    updateFiles((current) => current.map((row) => row.id === selection.id ? { ...row, status: "uploading", error: undefined } : row));
    const controller = new AbortController();
    uploadControllers.current.set(selection.id, controller);
    try {
      const currentDraft = await ensureDraft();
      const response = await api.uploadTaskMaterialFile(item.projectId, currentDraft.id, selection.id, selection.file, controller.signal) as { draft: TaskMaterialDraft; asset: { id: string } };
      remember(response.draft);
      if (cancelRequested.current.has(selection.id)) {
        updateFiles((current) => current.map((row) => row.id === selection.id ? { ...row, status: "checking" } : row));
        return null;
      }
      updateFiles((current) => current.map((row) => row.id === selection.id ? { ...row, status: "ready", assetId: response.asset.id } : row));
      setCapacityBlocked(false);
      return null;
    } catch (error) {
      if (cancelRequested.current.has(selection.id) || controller.signal.aborted) {
        updateFiles((current) => current.map((row) => row.id === selection.id ? { ...row, status: "checking" } : row));
        return null;
      }
      const capacityExceeded = error instanceof ApiError && error.code === "task_material_local_capacity_exceeded";
      updateFiles((current) => current.map((row) => row.id === selection.id ? { ...row, status: "failed", error: capacityExceeded ? "capacity" : undefined } : row));
      if (capacityExceeded) setCapacityBlocked(true);
      return capacityExceeded ? copy.capacityFull : copy.uploadFailed;
    } finally {
      uploadControllers.current.delete(selection.id);
    }
  }

  async function reconcileCancellation(selection: TaskMaterialSelection) {
    updateFiles((current) => current.map((row) => row.id === selection.id ? { ...row, status: "checking", error: undefined } : row));
    setFeedback(copy.checkingCancel);
    try {
      const currentDraft = await ensureDraft();
      let latest: TaskMaterialDraft | null = null;
      let emptyConfirmations = 0;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          const response = await api.getTaskMaterialDraft(item.projectId, currentDraft.id) as { draft: TaskMaterialDraft };
          latest = response.draft;
          if (latest.assets?.some((asset) => asset.clientFileId === selection.id)) break;
          emptyConfirmations += 1;
          if (emptyConfirmations >= 2) break;
        } catch {
          // Retry below. A failed read cannot prove that the upload was canceled.
        }
        if (attempt < 3) await new Promise((resolve) => window.setTimeout(resolve, 150));
      }
      if (!latest || (!latest.assets?.some((asset) => asset.clientFileId === selection.id) && emptyConfirmations < 2)) {
        throw new Error("task_material_cancel_reconcile_failed");
      }
      remember(latest);
      const committed = latest.assets?.find((asset) => asset.clientFileId === selection.id);
      if (committed) {
        const removed = await api.removeTaskMaterialFile(item.projectId, latest.id, committed.id, latest.revision) as { draft: TaskMaterialDraft };
        remember(removed.draft);
      }
      cancelRequested.current.delete(selection.id);
      updateFiles((current) => current.filter((row) => row.id !== selection.id));
      setFeedback(copy.canceled);
      if (filesRef.current.length && filesRef.current.every((row) => row.status === "ready")) {
        setPending(true);
        await attachIfReady(copy.canceled);
      } else {
        setPending(false);
      }
    } catch {
      updateFiles((current) => current.map((row) => row.id === selection.id ? { ...row, status: "failed", error: "cancel_reconcile" } : row));
      setFeedback(copy.cancelCheckFailed);
      setPending(false);
    }
  }

  async function cancelUpload(id: string) {
    const selection = filesRef.current.find((row) => row.id === id);
    if (!selection || selection.status !== "uploading") return;
    cancelRequested.current.add(id);
    updateFiles((current) => current.map((row) => row.id === id ? { ...row, status: "checking" } : row));
    uploadControllers.current.get(id)?.abort();
    await reconcileCancellation(selection);
  }

  async function addFiles(input: FileList) {
    const result = selectTaskMaterialFiles(input, Math.max(0, MAX_TASK_MATERIALS - files.length));
    setFeedback(result.rejected ? copy.rejected : null);
    if (!result.selected.length) return;
    updateFiles((current) => [...current, ...result.selected]);
    setPending(true);
    const errors = (await Promise.all(result.selected.map(upload))).filter(Boolean);
    if (errors.length) {
      setFeedback(errors[0]);
      setPending(false);
      return;
    }
    await attachIfReady(result.rejected ? copy.rejected : null);
  }


  async function retrySelection(selection: TaskMaterialSelection) {
    setPending(true);
    setFeedback(null);
    setCapacityBlocked(false);
    if (selection.error === "cancel_reconcile") {
      await reconcileCancellation(selection);
      return;
    }
    const error = await upload(selection);
    if (error) {
      setFeedback(error);
      setPending(false);
      return;
    }
    await attachIfReady();
  }

  async function loadStorageRecovery() {
    setStorageLoading(true);
    setStorageError(null);
    try {
      setStorage(await api.getTaskMaterialStorage());
    } catch {
      setStorage(null);
      setStorageError(copy.storageFailed);
    } finally {
      setStorageLoading(false);
    }
  }

  function openStorageRecovery() {
    setStorageOpen(true);
    void loadStorageRecovery();
  }

  async function recoverCapacity() {
    if (!storage?.reclaimableBytes || storagePending) return;
    setStoragePending(true);
    setStorageError(null);
    try {
      const result = await api.cleanupTaskMaterialStorage(storage.previewToken);
      setStorage(result.usage);
      const blocked = filesRef.current.filter((row) => row.status === "failed" && row.error === "capacity");
      setStorageOpen(false);
      if (!blocked.length) return;
      setPending(true);
      const errors = (await Promise.all(blocked.map(upload))).filter(Boolean);
      if (errors.length) {
        setFeedback(errors[0]);
        setPending(false);
        return;
      }
      await attachIfReady();
    } catch (error) {
      const message = error instanceof ApiError && error.code === "task_material_cleanup_preview_stale" ? copy.storageChanged : copy.storageFailed;
      await loadStorageRecovery();
      setStorageError(message);
    } finally {
      setStoragePending(false);
    }
  }

  async function removeSelection(id: string) {
    const selection = files.find((row) => row.id === id);
    if (!selection || selection.status === "uploading") return;
    if (selection.assetId && draft.current) {
      try {
        const response = await api.removeTaskMaterialFile(item.projectId, draft.current.id, selection.assetId, draft.current.revision) as { draft: TaskMaterialDraft };
        remember(response.draft);
      } catch {
        setFeedback(copy.uploadFailed);
        return;
      }
    }
    updateFiles((current) => current.filter((row) => row.id !== id));
    if (filesRef.current.length && filesRef.current.every((row) => row.status === "ready")) {
      setPending(true);
      await attachIfReady();
    }
  }

  function reset() {
    for (const controller of uploadControllers.current.values()) controller.abort();
    uploadControllers.current.clear();
    cancelRequested.current.clear();
    setOpen(false);
    filesRef.current = [];
    setFiles([]);
    setFeedback(null);
    setCapacityBlocked(false);
    setStorageOpen(false);
    setStorage(null);
    setStorageError(null);
    draft.current = null;
  }

  async function attachIfReady(additionalNotice: string | null = null) {
    if (attachInFlight.current) return;
    const currentDraft = draft.current;
    if (!currentDraft || !filesRef.current.length || filesRef.current.some((row) => row.status !== "ready")) {
      setPending(false);
      return;
    }
    attachInFlight.current = true;
    setFeedback(null);
    try {
      const response = await api.addWorkItemMaterials(item.id, {
        expectedRevision: item.revision,
        materialDraftId: currentDraft.id,
        materialDraftRevision: currentDraft.revision,
      }) as { workItem: LocalWorkItem; appliesTo: "next_execution" | "future_execution" };
      const names = filesRef.current.map((row) => row.file.name);
      const subject = names.length === 1
        ? copy.addedOne.replace("{{name}}", names[0])
        : copy.addedMany.replace("{{count}}", String(names.length));
      const effect = response.appliesTo === "future_execution" ? copy.future : copy.next;
      const notice = `${subject} ${effect}`;
      onUpdated(response.workItem, additionalNotice ? `${notice} ${additionalNotice}` : notice);
      reset();
    } catch {
      setFeedback(copy.attachFailed);
    } finally {
      attachInFlight.current = false;
      setPending(false);
    }
  }

  if (!open) return <Button size="sm" variant="secondary" onClick={() => setOpen(true)}><Paperclip aria-hidden />{copy.add}</Button>;
  return (
    <div className="w-full space-y-3 rounded-lg border border-border p-3 sm:w-[24rem]">
      <TaskMaterialPicker
        files={files}
        onFiles={(input) => { void addFiles(input); }}
        onRemove={(id) => { void removeSelection(id); }}
        onRetry={(id) => { const selection = filesRef.current.find((row) => row.id === id); if (selection) void retrySelection(selection); }}
        onCancel={(id) => { void cancelUpload(id); }}
        label={copy.add}
        dropLabel={copy.drop}
        limitLabel={copy.limit}
        removeLabel={(name) => copy.remove.replace("{{name}}", name)}
        retryLabel={copy.retry}
        cancelLabel={copy.cancelUpload}
        checkingLabel={copy.checkingCancel}
        feedback={feedback}
        disabled={pending}
      />
      {capacityBlocked ? <Button size="sm" variant="secondary" onClick={openStorageRecovery}><HardDrive aria-hidden />{copy.manageSpace}</Button> : null}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" role={pending ? "status" : undefined}>{pending ? copy.processing : copy.automatic}</p>
        <Button size="sm" variant="ghost" disabled={pending} onClick={reset}>{copy.cancel}</Button>
      </div>
      <Modal open={storageOpen} onClose={() => setStorageOpen(false)} title={copy.storageTitle} description={copy.storageDescription} closeDisabled={storagePending}>
        <div className="space-y-4">
          {storageLoading ? <p className="text-sm text-muted-foreground" role="status">{copy.storageLoading}</p> : storage ? (
            <div className="space-y-2 rounded-lg border p-3 text-sm">
              <p>{copy.storageUsed
                .replace("{{used}}", formatBytes(storage.usedBytes, i18n.language))
                .replace("{{limit}}", formatBytes(storage.limitBytes, i18n.language))}</p>
              <p className="font-medium">{copy.storageSafe
                .replace("{{bytes}}", formatBytes(storage.reclaimableBytes, i18n.language))
                .replace("{{count}}", String(storage.fileCount))}</p>
              {storage.reclaimableBytes ? <><p className="text-xs text-muted-foreground">{copy.storageScope
                .replace("{{completed}}", String(storage.completedTaskCount ?? 0))
                .replace("{{drafts}}", String(storage.expiredDraftCount ?? 0))}</p><p className="text-xs text-muted-foreground">{copy.storageImpact.replace("{{days}}", String(storage.retentionDays))}</p></> : <p className="text-xs text-muted-foreground">{copy.storageNone}</p>}
            </div>
          ) : null}
          {storageError ? <p className="text-sm text-destructive" role="alert">{storageError}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" disabled={storagePending} onClick={() => { setStorageOpen(false); navigate("settings"); }}>{copy.storageSettings}</Button>
            {storage?.reclaimableBytes ? <Button disabled={storagePending || storageLoading} onClick={() => { void recoverCapacity(); }}><Trash2 aria-hidden />{copy.storageConfirm.replace("{{bytes}}", formatBytes(storage.reclaimableBytes, i18n.language))}</Button> : null}
          </div>
        </div>
      </Modal>
    </div>
  );
}
