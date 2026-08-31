import type { ChannelDelivery, ChannelTaskRequest, ChannelTaskRevision, ChannelTaskThread } from "@/lib/console-state";
import type { Tone } from "@/lib/readable-labels";

export type ChannelTaskUserAction =
  | "reply_in_channel"
  | "open_approvals"
  | "retry_task"
  | "retry_delivery"
  | "fix_with_ai"
  | "rerun_verification"
  | "open_sessions"
  | "view_task";

export type ChannelTaskUserState = {
  label: string;
  tone: Tone;
  nextStep: string;
  action: ChannelTaskUserAction | null;
  actionLabel: string | null;
};

type ChannelTaskUserStateInput = {
  thread: ChannelTaskThread;
  task?: ChannelTaskRequest | null;
  delivery?: ChannelDelivery | null;
  revision?: ChannelTaskRevision | null;
  now?: number;
};

/**
 * Converts the persisted task state into one ordinary-user status and one
 * next step. Internal task actions remain available beside this summary, but
 * the default wording should answer: "What do I do now?"
 */
export function channelTaskUserState({ thread, task, delivery, revision, now = Date.now() }: ChannelTaskUserStateInput): ChannelTaskUserState {
  if (delivery?.status === "sent_unconfirmed"
    && (delivery.taskContext?.deliveryKind === "result" || ["succeeded", "failed"].includes(thread.status))) {
    const retryAt = Date.parse(delivery.nextManualRetryAt ?? "");
    const coolingDown = Number.isFinite(retryAt) && retryAt > now;
    return {
      label: "微信未确认送达",
      tone: "warning",
      nextStep: coolingDown
        ? "微信已接受结果，客户端可能正在延迟展示。为避免之后收到重复消息，请稍后再发送；本地结果现在就能查看。"
        : "微信接口已接受结果，但没有确认客户端已经显示。如果微信里没有结果，可以明确再次发送。",
      action: coolingDown ? (thread.workItemId ? "view_task" : null) : "retry_delivery",
      actionLabel: coolingDown ? (thread.workItemId ? "查看本地结果" : null) : "再次发送结果",
    };
  }

  if (delivery?.status === "failed_terminal") {
    return {
      label: "结果未送达",
      tone: "danger",
      nextStep: "任务结果已经生成，但消息没有送达；可以重新发送结果。",
      action: "retry_delivery",
      actionLabel: "重新发送结果",
    };
  }

  // Prefer the shared WorkItem journey for completion and verification. The
  // thread remains conversation state, but it must not independently promote a
  // task to "completed" while canonical task evidence still needs review.
  if (task?.journey?.stage === "verification_failed" || task?.journey?.stage === "needs_attention") {
    const canFix = task.journey.stage === "verification_failed" && task.actions.fixWithAi === true;
    const canReverify = task.journey.stage === "verification_failed" && task.actions.rerunVerification === true;
    return {
      label: "结果需要处理",
      tone: "danger",
      nextStep: canFix
        ? `${task.resultVerification?.summary ?? "检查发现结果仍有未通过项"}。可以让 AI 按检查结果继续返工，原结果和记录会保留。`
        : canReverify
          ? `${task.resultVerification?.summary ?? "检查结果需要确认"}。可以重新运行验证，不会重新执行或发送结果。`
          : task.resultVerification?.summary
            ?? "任务结果或完成依据仍有未通过项，请打开任务查看并按检查结果处理。",
      action: canFix ? "fix_with_ai" : canReverify ? "rerun_verification" : thread.workItemId ? "view_task" : null,
      actionLabel: canFix ? "让 AI 按检查返工" : canReverify ? "重新运行验证" : thread.workItemId ? "查看检查结果" : null,
    };
  }

  if (task?.journey?.stage === "ready_to_complete") {
    return {
      label: "结果待确认",
      tone: "warning",
      nextStep: task.journey.result.verified
        ? "结果和检查已经就绪，请查看并确认；确认后才会计为真正完成。"
        : "结果已经生成，但完成依据仍需核对，请打开任务查看检查情况。",
      action: thread.workItemId ? "view_task" : null,
      actionLabel: thread.workItemId ? "查看并确认" : null,
    };
  }

  if (task?.journey?.stage === "completed") {
    return {
      label: "已真正完成",
      tone: "success",
      nextStep: "任务状态、结果检查和投递依据已经闭环；需要时可以查看结果或继续提出修改。",
      action: thread.workItemId ? "view_task" : null,
      actionLabel: thread.workItemId ? "查看任务结果" : null,
    };
  }

  if (thread.status === "awaiting_confirmation") {
    if (revision?.status === "awaiting_confirmation" || thread.revisionId) {
      return {
        label: "等待确认修改",
        tone: "warning",
        nextStep: `本次修改${revision?.feedback ? `：${revision.feedback}` : "已准备好"}。原结果会保留，确认后才会重新处理。`,
        action: "reply_in_channel",
        actionLabel: null,
      };
    }
    return {
      label: "等待确认",
      tone: "warning",
      nextStep: "请在微信回复“确认”开始，也可以继续补充要求或回复“取消”。",
      action: "reply_in_channel",
      actionLabel: null,
    };
  }

  if (thread.status === "waiting_user") {
    return {
      label: "等待你补充",
      tone: "warning",
      nextStep: "请在微信补充缺少的信息，系统会接着处理当前任务。",
      action: "reply_in_channel",
      actionLabel: null,
    };
  }

  if (thread.status === "waiting_upstream") {
    const dependencies = [...new Set(thread.dependencyTaskTitles ?? [])].filter(Boolean).slice(0, 4);
    return {
      label: "等待前置结果",
      tone: "running",
      nextStep: dependencies.length
        ? `正在等待“${dependencies.join("、")}”完成；所需成品符合要求后系统会自动继续，不需要重复发送相同内容。`
        : "前面的资料或成品还在准备，完成后系统会自动继续；不需要重复发送相同内容。",
      action: null,
      actionLabel: null,
    };
  }

  if (thread.status === "waiting_approval") {
    if (thread.waitingFor === "delivery") {
      return {
        label: "等待确认应用",
        tone: "warning",
        nextStep: "结果已经准备好，请在桌面端确认是否应用变更。",
        action: "open_approvals",
        actionLabel: "前往确认",
      };
    }
    return {
      label: "等待确认",
      tone: "warning",
      nextStep: "请在桌面端确认后继续执行。",
      action: "open_approvals",
      actionLabel: "前往确认",
    };
  }

  if (thread.status === "failed" || thread.status === "needs_attention") {
    if (thread.waitingFor === "upstream_unavailable" || thread.attentionReason?.startsWith("upstream_")) {
      const blockers = [...new Set((thread.upstreamBlockers ?? []).map((blocker) => blocker.title).filter(Boolean))].slice(0, 4);
      return {
        label: "等待上游恢复",
        tone: "warning",
        nextStep: blockers.length
          ? `依赖的“${blockers.join("、")}”没有完成。恢复或重试该任务后，本任务会继续；其他独立任务不受影响。`
          : "依赖的任务没有完成。恢复或重试上游任务后，本任务会继续；其他独立任务不受影响。",
        action: null,
        actionLabel: null,
      };
    }
    if (thread.attentionReason === "wechat_login_required") {
      return {
        label: "需要登录公众号",
        tone: "warning",
        nextStep: "草稿保存尚未开始。前往网站登录扫码，登录完成后系统可恢复原任务。",
        action: "open_sessions",
        actionLabel: "前往登录",
      };
    }
    if (thread.attentionReason === "wechat_draft_outcome_unknown") {
      return {
        label: "等待核对草稿",
        tone: "warning",
        nextStep: "请先查看公众号草稿箱：找到草稿就确认完成；确认没有草稿后，系统才会安全重试。",
        action: null,
        actionLabel: null,
      };
    }
    if (task?.actions.retry) {
      return {
        label: thread.status === "failed" ? "执行失败" : "需要处理",
        tone: "danger",
        nextStep: "任务没有顺利完成，可以重试；如果资料或要求有变化，请先补充说明。",
        action: "retry_task",
        actionLabel: "重试任务",
      };
    }
    return {
      label: thread.status === "failed" ? "执行失败" : "需要处理",
      tone: "danger",
      nextStep: "请查看任务详情，确认资料或执行环境后再继续。",
      action: "view_task",
      actionLabel: thread.workItemId ? "查看任务详情" : null,
    };
  }

  if (thread.status === "paused") {
    return {
      label: "已暂停",
      tone: "warning",
      nextStep: "需要继续时，请在微信回复“继续”；不再需要时可以回复“取消”。",
      action: "reply_in_channel",
      actionLabel: null,
    };
  }

  if (thread.status === "succeeded") {
    if (task?.resultVerification?.status === "failed") {
      return {
        label: "结果需要检查",
        tone: "danger",
        nextStep: `${task.resultVerification.summary ?? "结果检查还有未通过的项目"} 可以打开任务详情查看具体文件，或直接告诉我需要怎么调整。`,
        action: thread.workItemId ? "view_task" : null,
        actionLabel: thread.workItemId ? "查看检查结果" : null,
      };
    }
    return {
      label: "已完成",
      tone: "success",
      nextStep: task?.resultVerification?.status === "passed"
        ? "结果数量、格式和内容检查已通过；可以查看结果，或继续告诉我需要怎么修改。"
        : thread.workItemId ? "可以查看任务详情，或继续告诉我需要怎么修改。" : "可以继续告诉我需要怎么修改。",
      action: thread.workItemId ? "view_task" : null,
      actionLabel: thread.workItemId ? "查看任务详情" : null,
    };
  }

  if (thread.status === "cancelled") {
    return {
      label: "已取消",
      tone: "neutral",
      nextStep: "如果仍需要处理，可以重新描述需求创建一个新任务。",
      action: null,
      actionLabel: null,
    };
  }

  if (thread.status === "running") {
    return {
      label: "执行中",
      tone: "running",
      nextStep: "系统正在处理，完成后会通知你；不需要重复发送相同内容。",
      action: null,
      actionLabel: null,
    };
  }

  if (thread.status === "queued") {
    return {
      label: "排队中",
      tone: "running",
      nextStep: "任务正在等待执行，系统会自动开始；不需要重复发送相同内容。",
      action: null,
      actionLabel: null,
    };
  }

  return {
    label: "处理中",
    tone: "neutral",
    nextStep: thread.nextAction ?? "系统正在准备任务，稍后会告诉你下一步。",
    action: null,
    actionLabel: null,
  };
}
