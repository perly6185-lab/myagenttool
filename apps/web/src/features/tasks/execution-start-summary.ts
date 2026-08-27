import type { ProjectSnapshot } from "@/lib/console-state";
import type { AutoRunReadiness } from "./auto-run-readiness-ui";
import type { LocalWorkItem } from "./task-view-types";

type SummaryLanguage = "zh" | "en";

export type ExecutionStartMaterial = {
  id: string;
  title: string;
  source: string;
  role: string;
};

export type ExecutionStartSummary = {
  goal: string;
  acceptanceCriteria: string[];
  verificationSteps: string[];
  repository: { name: string; path: string | null };
  origin: { label: string; kind: string };
  materials: ExecutionStartMaterial[];
  method: { name: string; expectedOutput: string | null; kind: "template" | "custom" };
  delivery: { label: string; destination: "channel" | "task" };
  risks: string[];
  boundary: string;
};

function projectedMaterialSource(source: NonNullable<LocalWorkItem["taskContextSummary"]>["materials"][number]["source"], zh: boolean) {
  const labels = {
    channel_attachment: zh ? "Channel 附件" : "Channel attachment",
    task_file: zh ? "任务文件" : "Task file",
    my_materials: zh ? "我的资料" : "My materials",
    local_resource: zh ? "本地资料" : "Local material",
    remote_resource: zh ? "远程资料" : "Remote material",
    business_record: zh ? "业务记录" : "Business record",
  };
  return labels[source];
}

function projectedMaterialRole(role: NonNullable<LocalWorkItem["taskContextSummary"]>["materials"][number]["role"], zh: boolean) {
  const labels = {
    required_input: zh ? "必须使用" : "Required",
    reference: zh ? "参考" : "Reference",
    query_source: zh ? "查询来源" : "Query source",
    change_target: zh ? "允许修改" : "Change target",
    output: zh ? "结果归档" : "Result archive",
  };
  return labels[role];
}

function projectedOriginLabel(origin: NonNullable<LocalWorkItem["taskContextSummary"]>["origin"], zh: boolean) {
  const labels: Record<string, [string, string]> = {
    manual: ["手工创建", "Created manually"],
    meeting: ["会议", "Meeting"],
    email: ["邮件", "Email"],
    chat: ["聊天", "Chat"],
    phone: ["电话", "Phone"],
    import: ["导入", "Import"],
  };
  return labels[origin.kind]?.[zh ? 0 : 1] ?? origin.label;
}

function projectedMethodName(method: NonNullable<LocalWorkItem["taskContextSummary"]>["method"], zh: boolean) {
  if (method.kind === "template") return method.name;
  if (method.name === "处理方式待确认") return zh ? method.name : "Method needs confirmation";
  if (method.name === "本任务方案") return zh ? method.name : "This task's plan";
  return method.name;
}

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
  const addMaterial = (id: string, title: string | null | undefined, source: string, role: string) => {
    const normalizedTitle = String(title ?? "").trim();
    const key = `${source}:${normalizedTitle}`;
    if (!normalizedTitle || seen.has(key)) return;
    seen.add(key);
    materials.push({ id, title: normalizedTitle, source, role });
  };

  if (item.taskContextSummary) {
    for (const material of item.taskContextSummary.materials) {
      addMaterial(material.id, material.title, projectedMaterialSource(material.source, zh), projectedMaterialRole(material.role, zh));
    }
  } else {
    for (const asset of item.inputAssets ?? []) {
      addMaterial(asset.id ?? asset.path, asset.originalName ?? asset.path, zh ? "本地文件" : "Local file", zh ? "必须使用" : "Required");
    }
    for (const reference of item.localContentRefs ?? []) {
      addMaterial(reference.id, reference.title, zh ? "我的资料" : "My materials", reference.purpose === "required_input" ? (zh ? "必须使用" : "Required") : (zh ? "参考" : "Reference"));
    }
    for (const reference of item.taskResourceRefs ?? []) {
      const locality = reference.locality === "remote"
        ? (zh ? "远程资料" : "Remote material")
        : (zh ? "本地资料" : "Local material");
      const role = reference.purpose === "change_target"
        ? (zh ? "允许修改" : "Change target")
        : reference.purpose === "query_source" ? (zh ? "查询来源" : "Query source") : (zh ? "参考" : "Reference");
      addMaterial(reference.id, reference.title, locality, role);
    }
    for (const binding of item.recordBindings ?? []) {
      addMaterial(binding.id, binding.record?.title, zh ? "业务记录" : "Business record", binding.direction === "output" ? (zh ? "结果归档" : "Result archive") : (zh ? "必须使用" : "Required"));
    }
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
    origin: item.taskContextSummary ? {
      label: projectedOriginLabel(item.taskContextSummary.origin, zh),
      kind: item.taskContextSummary.origin.kind,
    } : {
      label: zh ? "手工创建" : "Created manually",
      kind: "manual",
    },
    materials,
    method: item.taskContextSummary ? {
      name: projectedMethodName(item.taskContextSummary.method, zh),
      expectedOutput: item.taskContextSummary.method.expectedOutput,
      kind: item.taskContextSummary.method.kind,
    } : item.myTemplateBinding ? {
      name: item.myTemplateBinding.name,
      expectedOutput: item.myTemplateBinding.expectedOutput,
      kind: "template",
    } : {
      name: zh ? "本任务方案" : "This task's plan",
      expectedOutput: null,
      kind: "custom",
    },
    delivery: item.taskContextSummary ? {
      label: item.taskContextSummary.delivery.label,
      destination: item.taskContextSummary.delivery.destination,
    } : {
      label: zh ? "当前任务" : "This task",
      destination: "task",
    },
    risks: [...riskSet],
    boundary: zh
      ? "本次确认只会让 AI 按以上任务、资料和检查标准开始处理；后续交付、合并或对外写入仍按各自规则处理。"
      : "This confirmation only starts AI with the task, materials, and checks above. Delivery, merge, or external writes still follow their own controls.",
  };
}
