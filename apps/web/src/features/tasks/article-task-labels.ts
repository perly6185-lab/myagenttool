import { useAppTranslation } from "@/lib/i18n/use-app-translation";

const labels = {
  en: {
    importBinding: "Article import",
    derivativeBinding: "Article derivative",
    importStarted: "Article import started",
    derivativeStarted: "Article derivative started",
    viewAnalysis: "View analysis",
    openAnalysis: "Open analysis Markdown",
    findSimilar: "Find similar articles",
    createDerivative: "Create derivative",
    openDerivative: "Open derivative Markdown",
    retryImport: "Retry import",
    interrupted: "The server restarted during import. No partial files were kept; retry to continue.",
    creatingWorktree: "Creating an isolated worktree…",
    importQueued: "Article import queued…",
    createAndImport: "Create and import",
    importState: {
      queued: "Waiting in the import queue…",
      running: "Downloading article and media…",
      completed: "Article imported into the issue worktree.",
      failed: "Article import failed.",
      canceled: "Article import canceled.",
    },
    derivativeState: {
      awaiting_approval: "Awaiting approval",
      queued: "Queued",
      running: "Creating",
      completed: "Completed",
      failed: "Failed",
      canceled: "Canceled",
    },
  },
  zh: {
    importBinding: "文章导入",
    derivativeBinding: "文章二创",
    importStarted: "已启动文章导入",
    derivativeStarted: "已启动文章二创",
    viewAnalysis: "查看文章分析",
    openAnalysis: "打开分析 Markdown",
    findSimilar: "查找相似文章",
    createDerivative: "文章二创",
    openDerivative: "打开二创 Markdown",
    retryImport: "重试导入",
    interrupted: "导入期间服务发生重启，未保留不完整文件；可点击重试继续。",
    creatingWorktree: "正在创建隔离工作树…",
    importQueued: "文章导入已排队…",
    createAndImport: "创建并导入",
    importState: {
      queued: "正在等待导入队列…",
      running: "正在下载正文和媒体…",
      completed: "文章已导入 Issue 工作树。",
      failed: "文章导入失败。",
      canceled: "文章导入已取消。",
    },
    derivativeState: {
      awaiting_approval: "等待审批",
      queued: "排队中",
      running: "生成中",
      completed: "已完成",
      failed: "失败",
      canceled: "已取消",
    },
  },
} as const;

export function useArticleTaskLabels() {
  const { i18n } = useAppTranslation();
  return labels[i18n.resolvedLanguage?.startsWith("zh") ? "zh" : "en"];
}
