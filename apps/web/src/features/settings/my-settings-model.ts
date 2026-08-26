import type { SectionKey, SettingsCategoryKey } from "@/store/ui-store";

export type MySettingsCategoryKey = SettingsCategoryKey;

export interface MySettingsCategory {
  key: MySettingsCategoryKey;
  sections: readonly SectionKey[];
}

/**
 * The single discovery map for low-frequency and professional capabilities.
 * Pages keep their canonical section URLs so notifications, bookmarks, and
 * task-detail deep links remain stable while the global shell stays concise.
 */
export const MY_SETTINGS_CATEGORIES: readonly MySettingsCategory[] = [
  { key: "execution", sections: ["devices", "agents", "agentSkills", "discovery", "tools"] },
  { key: "connections", sections: ["siteSettings", "applications", "integrations", "channels", "sessions"] },
  { key: "automation", sections: ["automation", "routines", "autoRuns"] },
  { key: "governance", sections: ["approvals", "audit"] },
  { key: "resources", sections: ["economics"] },
  { key: "diagnostics", sections: ["invocations", "evidence", "review", "compare", "evalTrend"] },
] as const;

export const MY_SETTINGS_SECTION_KEYS = MY_SETTINGS_CATEGORIES.flatMap((category) => category.sections);

const SETTINGS_SEARCH_ALIASES: Partial<Record<SectionKey, readonly string[]>> = {
  myHosts: ["host", "ssh", "sftp", "server", "remote files", "主机", "服务器", "远程文件", "文件传输"],
  siteSettings: ["site", "hosting", "deployment", "domain", "website", "站点", "托管", "部署", "域名", "官网"],
  devices: ["computer", "desktop bridge", "runtime", "电脑", "本机", "执行环境"],
  agents: ["assistant", "executor", "模型", "助手", "执行器"],
  agentSkills: ["instructions", "prompt", "skill", "指令", "提示词", "技能"],
  discovery: ["scan", "detect", "扫描", "检测", "发现"],
  tools: ["mcp", "command", "cli", "命令", "工具"],
  applications: ["app", "capability", "software", "能力", "软件", "应用"],
  integrations: ["connector", "provider", "连接器", "接入"],
  channels: ["message", "notification", "delivery", "消息", "通知", "投递"],
  sessions: ["login", "cookie", "profile", "登录", "会话", "保活"],
  automation: ["schedule", "trigger", "rule", "排期", "触发器", "规则"],
  routines: ["recurring", "cron", "periodic", "定时", "周期", "例行"],
  autoRuns: ["autopilot", "execution", "自动执行", "自主运行"],
  approvals: ["decision", "permission", "review queue", "决策", "权限", "待确认"],
  audit: ["history", "compliance", "log", "历史", "合规", "日志"],
  economics: ["budget", "cost", "usage", "token", "预算", "费用", "用量"],
  invocations: ["run", "execution record", "调用", "运行记录", "执行记录"],
  evidence: ["proof", "artifact", "证据", "产物"],
  review: ["finding", "code review", "technical review", "代码审查", "技术审查", "发现"],
  compare: ["benchmark", "parallel", "对照", "并行"],
  evalTrend: ["evaluation", "regression", "quality", "评测", "回归", "质量"],
};

export function settingsSearchAliases(section: SectionKey): string {
  return SETTINGS_SEARCH_ALIASES[section]?.join(" ") ?? "";
}

export function isMySettingsSection(section: SectionKey): boolean {
  return MY_SETTINGS_SECTION_KEYS.includes(section);
}

export function settingsCategoryForSection(section: SectionKey): MySettingsCategoryKey | null {
  return MY_SETTINGS_CATEGORIES.find((category) => category.sections.includes(section))?.key ?? null;
}
