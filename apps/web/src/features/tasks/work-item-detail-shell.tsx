import { lazy, Suspense, useEffect, useState } from "react";
import { ConfirmModal } from "@/components/common/confirm-modal";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useConsoleState } from "@/data/use-console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { useUiStore, type WorkItemDetailMode, type WorkItemSection } from "@/store/ui-store";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { WorkItemSummaryView } from "./work-item-summary-view";

const LocalWorkItemDetail = lazy(() => import("./task-view")
  .then((module) => ({ default: module.LocalWorkItemDetail })));

export function WorkItemDetailShell() {
  const { i18n } = useAppTranslation();
  const zh = i18n.language.startsWith("zh");
  const { data: consoleState } = useConsoleState();
  const workItemId = useUiStore((state) => state.selectedWorkItemId);
  const mode = useUiStore((state) => state.selectedWorkItemMode);
  const preference = useUiStore((state) => state.workItemDetailPreference);
  const setMode = useUiStore((state) => state.setSelectedWorkItemMode);
  const setPreference = useUiStore((state) => state.setWorkItemDetailPreference);
  const setSection = useUiStore((state) => state.setSection);
  const navigate = usePageNavigation();
  const setWorkItemSection = useUiStore((state) => state.setSelectedWorkItemSection);
  const closeWorkItem = useUiStore((state) => state.closeWorkItem);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [summaryCompleted, setSummaryCompleted] = useState<boolean | null>(null);

  useEffect(() => {
    setDirty(false);
    setSummaryCompleted(null);
  }, [mode, workItemId]);

  const close = () => {
    if (dirty) setConfirmClose(true);
    else closeWorkItem();
  };
  const openExpert = (section: WorkItemSection = "overview") => {
    setWorkItemSection(section);
    setMode("expert");
  };
  const switchMode = (next: WorkItemDetailMode) => {
    if (dirty) return;
    setMode(next);
  };
  const projects = (consoleState?.projects ?? []).map((project) => ({ id: project.id, name: project.name }));

  return (
    <>
      <Modal
        open={Boolean(workItemId)}
        onClose={close}
        title={zh ? "任务详情" : "Task details"}
        description={mode === "summary"
          ? summaryCompleted
            ? (zh ? "查看最终结果和你的确认记录" : "Review the final result and your confirmation")
            : (zh ? "专注任务目标、当前进展和下一步" : "Focused on the task goal, current progress, and next step")
          : (zh ? "完整执行、验证和审计工作台" : "Complete execution, verification, and audit workspace")}
        size={mode === "expert" ? "full" : "2xl"}
      >
        {workItemId ? (
          <div className="space-y-4" data-testid="work-item-detail-shell" data-detail-mode={mode}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
              <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1" aria-label={zh ? "详情显示方式" : "Detail display mode"}>
                <Button size="sm" disabled={dirty && mode !== "summary"} variant={mode === "summary" ? "secondary" : "ghost"} aria-pressed={mode === "summary"} onClick={() => switchMode("summary")}>
                  {zh ? "简洁详情" : "Simple details"}
                </Button>
                <Button size="sm" disabled={dirty && mode !== "expert"} variant={mode === "expert" ? "secondary" : "ghost"} aria-pressed={mode === "expert"} onClick={() => switchMode("expert")}>
                  {zh ? "专业详情" : "Expert details"}
                </Button>
              </div>
              {preference !== mode ? (
                <Button size="sm" variant="ghost" onClick={() => setPreference(mode)}>
                  {zh ? "设为默认视图" : "Make this my default"}
                </Button>
              ) : <span className="text-xs text-muted-foreground">{zh ? "当前默认视图" : "Current default"}</span>}
            </div>

            {mode === "summary" ? (
              <WorkItemSummaryView
                workItemId={workItemId}
                onDirtyChange={setDirty}
                onCompletedChange={setSummaryCompleted}
                onOpenExpert={openExpert}
                onOpenTaskCenter={() => {
                  setMode("expert");
                  setSection("task");
                }}
                onOpenSetup={(section) => {
                  navigate(section);
                }}
              />
            ) : (
              <Suspense fallback={<p className="py-8 text-center text-sm text-muted-foreground">{zh ? "正在加载专业详情…" : "Loading expert details…"}</p>}>
                <LocalWorkItemDetail
                  workItemId={workItemId}
                  projects={projects}
                  onDirtyChange={setDirty}
                  onChanged={() => window.dispatchEvent(new Event("myagenttool:state-change"))}
                />
              </Suspense>
            )}
          </div>
        ) : null}
      </Modal>
      <ConfirmModal
        open={confirmClose}
        title={zh ? "放弃未保存的修改？" : "Discard unsaved changes?"}
        description={zh ? "关闭详情会丢失尚未保存的内容。" : "Closing the details will discard unsaved content."}
        destructive
        onClose={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false);
          setDirty(false);
          closeWorkItem();
        }}
      />
    </>
  );
}

export default WorkItemDetailShell;
