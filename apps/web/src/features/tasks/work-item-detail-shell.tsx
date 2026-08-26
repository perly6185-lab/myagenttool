import { lazy, Suspense, useEffect, useState } from "react";
import { ConfirmModal } from "@/components/common/confirm-modal";
import { Modal } from "@/components/ui/modal";
import { useConsoleState } from "@/data/use-console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { useUiStore, type WorkItemSection } from "@/store/ui-store";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { WorkItemSummaryView } from "./work-item-summary-view";
import { WorkItemViewSwitch } from "./work-item-view-switch";

const LocalWorkItemDetail = lazy(() => import("./local-work-item-detail")
  .then((module) => ({ default: module.LocalWorkItemDetail })));

export function WorkItemDetailShell() {
  const { i18n } = useAppTranslation();
  const zh = i18n.language.startsWith("zh");
  const { data: consoleState } = useConsoleState();
  const workItemId = useUiStore((state) => state.selectedWorkItemId);
  const mode = useUiStore((state) => state.selectedWorkItemMode);
  const setMode = useUiStore((state) => state.setSelectedWorkItemMode);
  const setSection = useUiStore((state) => state.setSection);
  const setSelectedProjectId = useUiStore((state) => state.setSelectedProjectId);
  const setSelectedWorktreeId = useUiStore((state) => state.setSelectedWorktreeId);
  const setWorktreeOpenIntent = useUiStore((state) => state.setWorktreeOpenIntent);
  const navigate = usePageNavigation();
  const setWorkItemSection = useUiStore((state) => state.setSelectedWorkItemSection);
  const closeWorkItem = useUiStore((state) => state.closeWorkItem);
  const openWorkItem = useUiStore((state) => state.openWorkItem);
  const setComposerDraftTask = useUiStore((state) => state.setComposerDraftTask);
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
            <div className="flex justify-end">
              <WorkItemViewSwitch mode={mode} language={zh ? "zh" : "en"} disabled={dirty} onChange={(nextMode) => {
                if (nextMode === "expert") openExpert("overview");
                else setMode("summary");
              }} />
            </div>
            {mode === "summary" ? (
              <>
                <WorkItemSummaryView
                  workItemId={workItemId}
                  onDirtyChange={setDirty}
                  onCompletedChange={setSummaryCompleted}
                  onOpenExpert={openExpert}
                  onOpenDeliveryChanges={(projectId, worktreeId) => {
                    setSelectedProjectId(projectId);
                    setSelectedWorktreeId(worktreeId);
                    setWorktreeOpenIntent({ worktreeId, view: "changes" });
                    closeWorkItem();
                    navigate("projects");
                  }}
                  onOpenTaskCenter={() => {
                    setMode("expert");
                    setSection("task");
                  }}
                  onOpenSetup={(section) => {
                    navigate(section);
                  }}
                  onCreateTaskDraft={(draft) => {
                    setComposerDraftTask(draft);
                    closeWorkItem();
                    navigate("dashboard");
                  }}
                  onOpenWorkItem={(id) => openWorkItem(id)}
                />
              </>
            ) : (
              <>
                <Suspense fallback={<p className="py-8 text-center text-sm text-muted-foreground">{zh ? "正在加载技术详情…" : "Loading technical details…"}</p>}>
                  <LocalWorkItemDetail
                    workItemId={workItemId}
                    projects={projects}
                    onDirtyChange={setDirty}
                    onChanged={() => window.dispatchEvent(new Event("myagenttool:state-change"))}
                  />
                </Suspense>
              </>
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
