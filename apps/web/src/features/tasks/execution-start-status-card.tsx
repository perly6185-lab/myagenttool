import { AlertTriangle, Bot, CheckCircle2, Clock3, LoaderCircle, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LocalWorkItem } from "./task-view-types";

type Receipt = NonNullable<LocalWorkItem["executionStartReceipt"]>;

const REASON_COPY: Record<string, [string, string]> = {
  waiting_for_turn: ["已进入队列，系统会按优先级和截止风险安排。", "Queued. The scheduler will use priority and deadline risk."],
  waiting_capacity: ["当前执行名额已满，释放后会自动重试。", "Execution capacity is full. The task will retry automatically."],
  repository_agent_unavailable: ["当前没有可用的本地开发助手。请检查设备和 Agent。", "No local development assistant is available. Check the device and agent."],
  task_agent_unavailable: ["当前没有可处理此任务的助手。", "No assistant is currently available for this task."],
  work_item_record_bindings_stale: ["任务引用的业务资料已经变化，需要刷新后才能开始。", "Business materials changed and must be refreshed before starting."],
  dependencies_unresolved: ["仍在等待前置任务完成。", "Waiting for prerequisite tasks to finish."],
  artifacts_unavailable: ["前置任务尚未提供本任务需要的成果。", "A prerequisite has not produced the required result yet."],
  not_before_reached: ["尚未到允许开始的时间。", "The allowed start time has not arrived yet."],
  future_pull_forward_disabled: ["任务已安排在未来日期，项目不允许提前执行。", "The task is scheduled for a future date and cannot be pulled forward."],
  execution_paused: ["自动处理已暂停，恢复后会重新进入队列。", "Automatic work is paused. Resume it to return to the queue."],
  waiting_for_user: ["开始前还需要你或相关人员补充信息。", "More information is required from you or another person before starting."],
  scheduler_dependencies_unavailable: ["执行服务暂时未就绪，系统会继续重试。", "The execution service is temporarily unavailable and will keep retrying."],
  execution_target_unavailable: ["已登记的执行记录暂时无法找到，请查看执行详情。", "The recorded execution target is unavailable. Open execution details."],
  automatic_execution_disabled: ["自动处理已关闭。重新检查后，系统会恢复本次启动。", "Automatic work is off. Recheck to resume this start."],
  work_item_not_open: ["任务已经关闭，无法继续启动。", "The task is closed and cannot be started."],
  planning_status_not_executable: ["任务当前还未准备好执行，请先调整任务状态。", "The task is not ready to run. Update its planning status first."],
  active_execution: ["任务已有一项执行正在进行，请查看执行详情。", "This task already has an active execution. Open execution details."],
  execution_starting: ["系统正在创建执行，请稍候。", "The execution is being created. Please wait."],
  direct_task_runner_unavailable: ["通用任务执行服务暂时不可用，稍后可重新检查。", "The general task runner is temporarily unavailable. Recheck later."],
  record_binding_freshness_check_failed: ["业务资料检查暂未完成，稍后可重新检查。", "The business material check did not finish. Recheck later."],
  execution_refused: ["执行服务没有接受本次启动，稍后可重新检查。", "The execution service did not accept this start. Recheck later."],
  execution_start_failed: ["启动时遇到问题，稍后可重新检查。", "The start encountered a problem. Recheck later."],
};

const STATUS_COPY: Record<Receipt["status"], [string, string]> = {
  queued: ["排队中", "Queued"],
  starting: ["正在启动", "Starting"],
  started: ["执行中", "Started"],
  blocked: ["等待处理", "Needs attention"],
  paused: ["已暂停", "Paused"],
  cancelled: ["已取消", "Cancelled"],
};

const PHASE_COPY: Record<string, [string, string]> = {
  queued: ["排队中", "Queued"],
  pending: ["准备中", "Pending"],
  claimed: ["已接单", "Claimed"],
  running: ["执行中", "Running"],
  awaiting_approval: ["等待确认", "Awaiting approval"],
  verifying: ["验证中", "Verifying"],
  completed: ["已完成", "Completed"],
  succeeded: ["已完成", "Succeeded"],
  failed: ["执行失败", "Failed"],
  blocked: ["遇到阻塞", "Blocked"],
  cancelled: ["已取消", "Cancelled"],
  timed_out: ["已超时", "Timed out"],
  rejected: ["未获批准", "Rejected"],
  execution_admission: ["正在分配", "Assigning"],
};

function reasonCopy(receipt: Receipt, zh: boolean) {
  const code = receipt.reasonCode ?? "";
  const exact = REASON_COPY[code];
  if (exact) return exact[zh ? 0 : 1];
  if (code.startsWith("specialized_capability_unavailable:")) {
    return zh
      ? "当前没有可处理这类任务的能力或连接器，请检查配置后重新检查。"
      : "The required capability or connector is unavailable. Check the setup, then recheck.";
  }
  return receipt.reasonDetail && receipt.reasonDetail !== code ? receipt.reasonDetail : null;
}

function presentation(receipt: Receipt, zh: boolean) {
  const failedPhase = ["failed", "blocked", "cancelled", "timed_out", "rejected"].includes(receipt.phase ?? "");
  if (receipt.status === "cancelled") return { title: zh ? "本次启动已取消" : "This start was cancelled", tone: "neutral" as const, icon: X };
  if (receipt.status === "paused") return { title: zh ? "AI 启动已暂停" : "AI start is paused", tone: "neutral" as const, icon: Clock3 };
  if (receipt.status === "blocked" || failedPhase) return { title: zh ? "AI 暂时无法开始" : "AI cannot start yet", tone: "warning" as const, icon: AlertTriangle };
  if (receipt.status === "starting") return { title: zh ? "正在为 AI 准备执行" : "Preparing AI execution", tone: "running" as const, icon: LoaderCircle };
  if (receipt.status === "started") return { title: zh ? "AI 已开始处理" : "AI has started", tone: "success" as const, icon: CheckCircle2 };
  return { title: zh ? "AI 已接单，正在排队" : "AI accepted the task and is queued", tone: "running" as const, icon: Bot };
}

export function ExecutionStartStatusCard({
  receipt,
  language,
  agentName,
  pendingAction,
  onRecheck,
  onCancel,
  onOpenDetails,
}: {
  receipt: Receipt;
  language: "zh" | "en";
  agentName?: string | null;
  pendingAction: "recheck" | "cancel" | null;
  onRecheck: () => void;
  onCancel?: () => void;
  onOpenDetails: () => void;
}) {
  const zh = language === "zh";
  const view = presentation(receipt, zh);
  const Icon = view.icon;
  const reason = reasonCopy(receipt, zh);
  const badgeLabel = receipt.status === "started" && receipt.phase
    ? (PHASE_COPY[receipt.phase]?.[zh ? 0 : 1] ?? STATUS_COPY.started[zh ? 0 : 1])
    : STATUS_COPY[receipt.status][zh ? 0 : 1];
  const requestedAt = receipt.requestedAt
    ? new Intl.DateTimeFormat(zh ? "zh-CN" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(receipt.requestedAt))
    : null;
  return (
    <section className="rounded-xl border border-primary/25 bg-primary/[0.045] p-4" aria-label={zh ? "AI 启动状态" : "AI start status"} data-testid="execution-start-status">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className={receipt.status === "starting" ? "size-4 animate-spin" : "size-4"} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold">{view.title}</h4>
            <Badge tone={view.tone}>{badgeLabel}</Badge>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {reason ?? receipt.reasonDetail ?? (receipt.status === "started"
              ? (zh ? "任务已绑定到本次执行，后续进度会继续显示在当前任务中。" : "The task is bound to this execution. Progress will continue here.")
              : (zh ? "启动请求已经保存，刷新页面也不会丢失。" : "The start request is saved and survives a refresh."))}
          </p>
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {requestedAt ? <div><dt className="inline">{zh ? "接单时间：" : "Accepted: "}</dt><dd className="inline">{requestedAt}</dd></div> : null}
            {agentName ? <div><dt className="inline">{zh ? "处理助手：" : "Assistant: "}</dt><dd className="inline">{agentName}</dd></div> : null}
            {receipt.targetId ? <div className="min-w-0"><dt className="inline">{zh ? "执行编号：" : "Execution: "}</dt><dd className="inline break-all font-mono">{receipt.targetId}</dd></div> : null}
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            {["queued", "blocked"].includes(receipt.status) ? (
              <Button size="sm" variant="secondary" disabled={pendingAction !== null} onClick={onRecheck}><RefreshCw className={pendingAction === "recheck" ? "animate-spin" : undefined} aria-hidden />{pendingAction === "recheck" ? (zh ? "正在检查…" : "Rechecking…") : (zh ? "重新检查" : "Recheck")}</Button>
            ) : null}
            <Button size="sm" variant="ghost" disabled={pendingAction !== null} onClick={onOpenDetails}>{zh ? "查看执行详情" : "Execution details"}</Button>
            {receipt.canCancel && onCancel ? (
              <Button size="sm" variant="ghost" disabled={pendingAction !== null} onClick={onCancel}><X aria-hidden />{pendingAction === "cancel" ? (zh ? "正在取消…" : "Cancelling…") : (zh ? "取消本次启动" : "Cancel this start")}</Button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
