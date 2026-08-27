import type { ProjectSnapshot } from "@/lib/console-state";
import type { AutoRunReadiness } from "./auto-run-readiness-ui";
import type { LocalWorkItem } from "./task-view-types";

type SummaryLanguage = "zh" | "en";

export type ExecutionStartMaterial = {
  id: string;
  title: string;
  source: string;
};

export type ExecutionStartSummary = {
  goal: string;
  acceptanceCriteria: string[];
  verificationSteps: string[];
  repository: { name: string; path: string | null };
  materials: ExecutionStartMaterial[];
  template: { name: string; expectedOutput: string } | null;
  risks: string[];
  boundary: string;
};

export function deriveExecutionStartSummary({
  item,
  project,
  readiness,
  language,
}: {
  item: LocalWorkItem;
  project: ProjectSnapshot | null;
  readiness: AutoRunReadiness | null;
  language: SummaryLanguage;
}): ExecutionStartSummary {
  const zh = language === "zh";
  const materials: ExecutionStartMaterial[] = [];
  const seen = new Set<string>();
  const addMaterial = (id: string, title: string | null | undefined, source: string) => {
    const normalizedTitle = String(title ?? "").trim();
    const key = `${source}:${normalizedTitle}`;
    if (!normalizedTitle || seen.has(key)) return;
    seen.add(key);
    materials.push({ id, title: normalizedTitle, source });
  };

  for (const asset of item.inputAssets ?? []) {
    addMaterial(asset.id ?? asset.path, asset.originalName ?? asset.path, zh ? "本地文件" : "Local file");
  }
  for (const reference of item.localContentRefs ?? []) {
    addMaterial(reference.id, reference.title, zh ? "我的资料" : "My materials");
  }
  for (const reference of item.taskResourceRefs ?? []) {
    const locality = reference.locality === "remote"
      ? (zh ? "远程资料" : "Remote material")
      : (zh ? "本地资料" : "Local material");
    addMaterial(reference.id, reference.title, locality);
  }
  for (const binding of item.recordBindings ?? []) {
    addMaterial(binding.id, binding.record?.title, zh ? "业务记录" : "Business record");
  }

  const riskSet = new Set<string>();
  for (const check of readiness?.checks ?? []) {
    if (check.status !== "ok") riskSet.add(check.detail);
  }
  const staleRecords = (item.recordBindings ?? []).filter((binding) =>
    ["stale", "needs_confirmation", "unavailable"].includes(binding.resolution.state));
  if (staleRecords.length) {
    riskSet.add(zh
      ? `${staleRecords.length} 项业务资料尚未就绪，确认前需要刷新或重新选择。`
      : `${staleRecords.length} business material(s) are not ready and must be refreshed or selected again.`);
  }

  const repositoryPath = project?.path ?? project?.git?.repoPath ?? null;
  return {
    goal: item.channelTaskContract?.goal?.trim()
      || item.intentStatement?.trim()
      || item.title.trim(),
    acceptanceCriteria: [...(item.acceptanceCriteria ?? [])],
    verificationSteps: [...(item.verificationSop ?? [])],
    repository: {
      name: project?.name ?? (zh ? "当前项目" : "Current project"),
      path: repositoryPath,
    },
    materials,
    template: item.myTemplateBinding ? {
      name: item.myTemplateBinding.name,
      expectedOutput: item.myTemplateBinding.expectedOutput,
    } : null,
    risks: [...riskSet],
    boundary: zh
      ? "本次确认只会让 AI 按以上任务、资料和检查标准开始处理；后续交付、合并或对外写入仍按各自规则处理。"
      : "This confirmation only starts AI with the task, materials, and checks above. Delivery, merge, or external writes still follow their own controls.",
  };
}
