import type { SectionKey } from "@/store/ui-store";

export type AutoRunReadinessCheck = {
  key: string;
  label: string;
  status: "ok" | "warn" | "blocked";
  detail: string;
};

export type AutoRunReadiness = {
  ready: boolean;
  checks: AutoRunReadinessCheck[];
};

type ReadinessLanguage = "zh" | "en";

const READINESS_LABELS: Record<ReadinessLanguage, Record<string, string>> = {
  zh: {
    project: "项目",
    agent: "任务助手",
    git: "代码仓库",
    bridge: "这台电脑",
    verify: "结果检查",
    budget: "费用额度",
    killSwitch: "自动运行",
    breaker: "失败保护",
    capacity: "运行名额",
    preflight: "启动条件",
  },
  en: {
    project: "Project",
    agent: "Task assistant",
    git: "Code repository",
    bridge: "This computer",
    verify: "Result checks",
    budget: "Spending limit",
    killSwitch: "Automatic runs",
    breaker: "Failure protection",
    capacity: "Run capacity",
    preflight: "Start requirements",
  },
};

/** Keep server diagnostics out of the ordinary-user task flow. */
export function readableAutoRunReadinessCheck(
  check: AutoRunReadinessCheck,
  language: ReadinessLanguage,
): AutoRunReadinessCheck {
  const zh = language === "zh";
  const blocked = check.status === "blocked";
  const details: Record<string, string> = zh ? {
    project: "当前项目信息不可用。请返回项目设置检查后再试。",
    agent: blocked
      ? "这个项目还没有可用的任务助手。选择一个助手后，就能把任务交给 AI。"
      : "任务助手的状态还未确认，建议先检查后再使用。",
    git: "当前项目还没有可用的代码仓库。请先在项目设置中完成关联。",
    bridge: "这台电脑尚未连接任务运行服务。请打开桌面版并完成连接。",
    verify: "尚未设置自动检查。AI 可以运行，但结果需要你手动确认。",
    budget: blocked ? "项目费用额度已用完。调整额度后才能继续。" : "尚未设置费用上限，连续运行前建议先设置。",
    killSwitch: "自动运行已在设置中暂停。恢复后才能继续。",
    breaker: "连续失败触发了自动暂停。请检查最近一次失败后再恢复。",
    capacity: "当前 AI 任务已达到同时运行上限。完成一个任务后即可继续。",
    preflight: "暂时无法确认 AI 的启动条件。请重新检查。",
  } : {
    project: "The current project is unavailable. Check project settings and try again.",
    agent: blocked
      ? "This project does not have an available task assistant. Choose one before handing work to AI."
      : "The task assistant status is not confirmed yet. Check it before relying on it.",
    git: "This project does not have an available code repository. Connect one in project settings.",
    bridge: "This computer is not connected to the task runner. Open the desktop app and connect it.",
    verify: "Automatic result checks are not configured. AI can run, but you will need to verify the result manually.",
    budget: blocked ? "The project spending limit has been reached. Adjust it before continuing." : "No spending limit is set. Add one before unattended runs.",
    killSwitch: "Automatic runs are paused in settings. Resume them before continuing.",
    breaker: "Repeated failures triggered an automatic pause. Review the latest failure before resuming.",
    capacity: "The AI run limit is currently full. Continue after another task finishes.",
    preflight: "AI start requirements could not be confirmed. Check again.",
  };
  return {
    ...check,
    label: READINESS_LABELS[language][check.key] ?? check.label,
    detail: details[check.key] ?? check.detail,
  };
}

export function readinessFixLabel(readiness: AutoRunReadiness | null, language: ReadinessLanguage): string {
  const key = readiness?.checks.find((check) => check.status === "blocked")?.key;
  const labels: Record<ReadinessLanguage, Record<string, string>> = {
    zh: { agent: "选择任务助手", bridge: "连接这台电脑", git: "打开项目设置", project: "打开项目设置", budget: "调整费用额度", killSwitch: "恢复自动运行", breaker: "查看失败原因", capacity: "查看运行任务" },
    en: { agent: "Choose task assistant", bridge: "Connect this computer", git: "Open project settings", project: "Open project settings", budget: "Adjust spending limit", killSwitch: "Resume automatic runs", breaker: "Review failure", capacity: "View running tasks" },
  };
  return labels[language][key ?? ""] ?? (language === "zh" ? "打开设置" : "Open settings");
}

export function readinessSetupSection(readiness: AutoRunReadiness | null): SectionKey {
  const keys = new Set((readiness?.checks ?? [])
    .filter((check) => check.status === "blocked")
    .map((check) => check.key));
  // The readiness check covers the project's agent assignment, not merely
  // agent registration. Auto-run setup is where ordinary users can choose the
  // project default and immediately re-check readiness.
  if (keys.has("agent")) return "autoRuns";
  if (keys.has("bridge")) return "devices";
  if (keys.has("git") || keys.has("project") || keys.has("verify")) return "projects";
  if (keys.has("budget")) return "economics";
  if (keys.has("killSwitch") || keys.has("breaker") || keys.has("capacity")) return "autoRuns";
  return "settings";
}
