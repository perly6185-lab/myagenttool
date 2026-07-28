import { GitBranch, Save, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

export function WorkItemExecutionActions({
  itemId,
  open,
  pending,
  canSave,
  worktreeReady = true,
  autoRunReady = true,
  autoRunBlockedReason = "",
  onCreateWorktree,
  onStartAutoRun,
  onTransition,
  onSave,
}: {
  itemId: string;
  open: boolean;
  pending: boolean;
  canSave: boolean;
  worktreeReady?: boolean;
  autoRunReady?: boolean;
  autoRunBlockedReason?: string;
  onCreateWorktree: () => void;
  onStartAutoRun: () => void;
  onTransition: () => void;
  onSave: () => void;
}) {
  const { t } = useAppTranslation();
  return (
    <div id={`work-item-execution-${itemId}`} className="scroll-mt-12 sticky bottom-0 z-10 grid grid-cols-2 gap-2 border-t border-border bg-background/95 py-2 backdrop-blur sm:static sm:flex sm:flex-wrap sm:justify-end sm:border-0 sm:bg-transparent sm:py-0">
      <Button className="w-full sm:w-auto" variant="secondary" disabled={pending || !open || !worktreeReady} title={!worktreeReady ? autoRunBlockedReason : undefined} onClick={onCreateWorktree}>
        <GitBranch className="mr-1 size-4" />{t("taskLocal.createWorktree")}
      </Button>
      <Button className="w-full sm:w-auto" disabled={pending || !open || !autoRunReady} title={!autoRunReady ? autoRunBlockedReason : undefined} onClick={onStartAutoRun}>
        <Zap className="mr-1 size-4" />{t("taskLocal.startAutoRun")}
      </Button>
      <Button className="w-full sm:w-auto" variant="secondary" disabled={pending} onClick={onTransition}>
        {t(open ? "taskLocal.close" : "taskLocal.reopen")}
      </Button>
      <Button className="w-full sm:w-auto" disabled={pending || !canSave} onClick={onSave}>
        <Save className="mr-1 size-4" />{t("taskLocal.save")}
      </Button>
    </div>
  );
}
