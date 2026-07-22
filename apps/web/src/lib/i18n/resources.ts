export const resources = {
  "en-US": {
    common: {
      sectionGroups: { work: "Work", run: "Run", oversee: "Oversee", configure: "Configure", ledgers: "Ledgers" },
      sections: {
        dashboard: { label: "Overview", blurb: "Start a task and watch it run" }, workBoard: { label: "Status", blurb: "Every work item by state" },
        workspace: { label: "Workspace", blurb: "Project files, transcript, and history in one place" }, documents: { label: "Documents", blurb: "Browse Word, Excel, PowerPoint, and PDF files" }, canvas: { label: "Canvas", blurb: "Draw and edit diagrams and Excalidraw scenes" },
        autoRuns: { label: "Auto-runs", blurb: "Autonomous issue to worktree to PR runs" }, task: { label: "Task", blurb: "GitHub issues and PRs as work items" }, compare: { label: "Compare", blurb: "Run one task on multiple agents side by side" }, automation: { label: "Automation", blurb: "Rules that run agents on a trigger" }, routines: { label: "Routines", blurb: "Scheduled autonomous checks and findings" },
        approvals: { label: "Approvals", blurb: "Every pending human decision in one queue" }, evidence: { label: "Evidence", blurb: "Per-run review, audit, and troubleshooting" }, review: { label: "Review", blurb: "Codex and Claude diff-review findings" }, evalTrend: { label: "Capability", blurb: "Real-agent evaluation trends and regressions" }, audit: { label: "Audit", blurb: "What was recorded and why" },
        projects: { label: "Projects", blurb: "Group work and own budgets" }, agents: { label: "Agents", blurb: "Registered agents and health" }, agentSkills: { label: "Agent Skills", blurb: "Instruction docs rendered into agent runs" }, devices: { label: "Devices", blurb: "Local bridges and platforms" }, discovery: { label: "Discovery", blurb: "Find local agents conservatively" }, integrations: { label: "Integrations", blurb: "Connect unsupported agents" }, tools: { label: "Tools", blurb: "Governed tools you can discover and run" }, applications: { label: "Applications", blurb: "Registered apps and governed capabilities" }, channels: { label: "Channels", blurb: "Messaging channels and their deliveries" },
        invocations: { label: "Invocations", blurb: "Every call, status, and result" }, economics: { label: "Economics", blurb: "Metered AI usage and cost ledger" },
      },
      shell: {
        controlPlane: "Control plane", navLabel: "Control plane sections", footer: "Register agents, route calls, enforce permission, and record what happened.",
        project: "Project", currentProject: "Current project", section: "Section", connected: "Connected", connecting: "Connecting", offline: "Server offline", deviceOnline: "Online and ready", deviceOffline: "Offline", deviceUnknown: "Unknown",
        pending: "{{count}} pending", attention: "{{count}} need attention", registerProject: "Register a project", close: "Close",
        command: { label: "Command palette", placeholder: "Jump to a section…", search: "Search sections", sections: "Sections", noMatch: "No section matches “{{query}}”.", navigate: "navigate", open: "open", toggle: "toggle" },
        skin: { label: "Skin", mode: "Theme mode", default: "Indigo (default)", ocean: "Ocean", ink: "Graphite", light: "Light", dark: "Dark", system: "System" },
      },
      shared: { confirm: "Confirm", cancel: "Cancel", working: "Working…", governedConfirmation: "This action is governed and requires explicit confirmation.", errorTitle: "This view hit an error", errorBody: "The rest of the console still works — switch sections from the sidebar, or try again.", tryAgain: "Try again" },
      login: { signIn: "Sign in", signOut: "Sign out", userId: "User id", password: "Password", signingIn: "Signing in…", failed: "Sign in failed." },
      inspector: { label: "Context inspector", bridgeTitle: "Local Agent Bridge", bridgeBody: "The cloud can request local work, but the bridge owns final execution. Start Desktop Bridge to bring this device online.", discoveryTitle: "Conservative by design", discoveryBody: "Discovery checks only known or user-provided sources and never enables a candidate automatically.", reviewTitle: "Findings, not raw output", reviewBody: "Review findings are structured, non-authoritative output. Raw model transcripts and CLI output stay server-side.", economicsTitle: "One economic ledger", economicsBody: "Agent cost, AI usage, chargeback, and settlement roll up through one ledger." },
      languagePicker: {
        label: "Language",
        english: "English",
        simplifiedChinese: "Simplified Chinese",
      },
    },
  },
  "zh-CN": {
    common: {
      sectionGroups: { work: "工作", run: "运行", oversee: "监督", configure: "配置", ledgers: "台账" },
      sections: {
        dashboard: { label: "概览", blurb: "启动任务并查看运行过程" }, workBoard: { label: "状态", blurb: "按状态查看所有工作项" },
        workspace: { label: "工作区", blurb: "集中查看项目文件、记录与历史" }, documents: { label: "文档", blurb: "浏览 Word、Excel、PowerPoint 和 PDF 文件" }, canvas: { label: "画布", blurb: "绘制和编辑图表及 Excalidraw 场景" },
        autoRuns: { label: "自动运行", blurb: "从 Issue 到工作树和 PR 的自主运行" }, task: { label: "任务", blurb: "将 GitHub Issue 和 PR 作为工作项" }, compare: { label: "对比", blurb: "让多个 Agent 并行执行同一任务" }, automation: { label: "自动化", blurb: "由触发器运行 Agent 的规则" }, routines: { label: "例行任务", blurb: "定时自主检查及其发现" },
        approvals: { label: "审批", blurb: "集中处理所有待人工决策" }, evidence: { label: "证据", blurb: "每次运行的评审、审计与排障" }, review: { label: "评审", blurb: "Codex 和 Claude 的差异评审发现" }, evalTrend: { label: "能力", blurb: "真实 Agent 的评测趋势与回归" }, audit: { label: "审计", blurb: "记录了什么以及为什么" },
        projects: { label: "项目", blurb: "组织工作并管理预算" }, agents: { label: "Agent", blurb: "已注册 Agent 及其健康状态" }, agentSkills: { label: "Agent 技能", blurb: "用于 Agent 运行的指令文档" }, devices: { label: "设备", blurb: "本地桥接与平台" }, discovery: { label: "发现", blurb: "以保守方式发现本地 Agent" }, integrations: { label: "集成", blurb: "连接尚未支持的 Agent" }, tools: { label: "工具", blurb: "可发现和运行的受治理工具" }, applications: { label: "应用", blurb: "已注册应用及受治理能力" }, channels: { label: "渠道", blurb: "消息渠道及其投递" },
        invocations: { label: "调用", blurb: "每次调用、状态与结果" }, economics: { label: "成本", blurb: "AI 用量与成本台账" },
      },
      shell: {
        controlPlane: "控制平面", navLabel: "控制平面栏目", footer: "注册 Agent、路由调用、执行权限并记录发生的一切。",
        project: "项目", currentProject: "当前项目", section: "栏目", connected: "已连接", connecting: "连接中", offline: "服务器离线", deviceOnline: "在线且就绪", deviceOffline: "离线", deviceUnknown: "未知",
        pending: "{{count}} 项待处理", attention: "{{count}} 项需关注", registerProject: "注册项目", close: "关闭",
        command: { label: "命令面板", placeholder: "跳转到栏目…", search: "搜索栏目", sections: "栏目", noMatch: "没有匹配“{{query}}”的栏目。", navigate: "导航", open: "打开", toggle: "切换" },
        skin: { label: "皮肤", mode: "主题模式", default: "靛蓝（默认）", ocean: "海洋", ink: "石墨", light: "亮色", dark: "暗色", system: "跟随系统" },
      },
      shared: { confirm: "确认", cancel: "取消", working: "处理中…", governedConfirmation: "此操作受治理，需要明确确认。", errorTitle: "此视图发生错误", errorBody: "控制台其他部分仍可使用；请从侧栏切换栏目或重试。", tryAgain: "重试" },
      login: { signIn: "登录", signOut: "退出登录", userId: "用户 ID", password: "密码", signingIn: "登录中…", failed: "登录失败。" },
      inspector: { label: "上下文检查器", bridgeTitle: "本地 Agent 桥接", bridgeBody: "云端可以请求本地工作，但最终执行由桥接程序控制。请启动桌面桥接使设备上线。", discoveryTitle: "保守发现", discoveryBody: "发现功能只检查已知或用户提供的来源，绝不会自动启用候选项。", reviewTitle: "结构化发现，而非原始输出", reviewBody: "评审发现是结构化、非权威的输出；原始模型记录和 CLI 输出保留在服务器端。", economicsTitle: "统一成本台账", economicsBody: "Agent 成本、AI 用量、分摊与结算统一汇总到一个台账。" },
      languagePicker: {
        label: "语言",
        english: "英语",
        simplifiedChinese: "简体中文",
      },
    },
  },
} as const;

export const defaultNamespace = "common" as const;
