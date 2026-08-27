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

export type ExecutionStartIssue = {
  code: string;
  severity: "blocking" | "warning" | "notice";
  message: string;
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
  issues: ExecutionStartIssue[];
  clarification: { question: string; resolution: "task_context" | "task_definition" | "template" } | null;
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

  const issueMap = new Map<string, ExecutionStartIssue>();
  const addIssue = (issue: ExecutionStartIssue) => {
    if (!issueMap.has(issue.code)) issueMap.set(issue.code, issue);
  };
  for (const check of readiness?.checks ?? []) {
    if (check.status !== "ok") addIssue({
      code: `readiness:${check.key}`,
      severity: check.status === "blocked" ? "blocking" : "warning",
      message: check.detail,
    });
  }
  const staleRecords = (item.recordBindings ?? []).filter((binding) =>
    ["stale", "needs_confirmation", "unavailable"].includes(binding.resolution.state));
  if (staleRecords.length) {
    addIssue({
      code: "materials:not_ready",
      severity: "blocking",
      message: zh
        ? `${staleRecords.length} 项业务资料尚未就绪，确认前需要刷新或重新选择。`
        : `${staleRecords.length} business material(s) are not ready and must be refreshed or selected again.`,
    });
  }

  const projectedMethod = item.taskContextSummary?.method;
  if (projectedMethod?.kind === "custom" && projectedMethod.name === "处理方式待确认") {
    addIssue({
      code: "method:needs_confirmation",
      severity: "blocking",
      message: zh ? "处理方式尚未确认，请先选择合适的模板或任务方案。" : "The method is not confirmed. Choose a template or task plan first.",
    });
  }
  if (!(item.acceptanceCriteria ?? []).length) {
    addIssue({
      code: "intent:acceptance_missing",
      severity: "blocking",
      message: zh ? "还没有明确怎样算完成。" : "Completion criteria are not defined yet.",
    });
  }
  if (!(item.verificationSop ?? []).length) {
    addIssue({
      code: "intent:verification_missing",
      severity: "blocking",
      message: zh ? "还没有明确完成后怎样检查。" : "Verification steps are not defined yet.",
    });
  }
  if (item.executionContractGate?.intentChanged) {
    addIssue({
      code: "intent:confirmation_stale",
      severity: "warning",
      message: zh
        ? "任务范围在上次确认后发生了变化；本次确认将以当前内容建立新的执行契约。"
        : "The task scope changed after the previous confirmation. This confirmation will create a new contract from the current details.",
    });
  }
  const changeTargetCount = materials.filter((material) => material.role === (zh ? "允许修改" : "Change target")).length;
  if (changeTargetCount) {
    addIssue({
      code: "materials:change_targets",
      severity: "warning",
      message: zh
        ? `AI 被允许修改 ${changeTargetCount} 项资料；开始前请确认这些确实是修改目标。`
        : `AI may modify ${changeTargetCount} material(s). Confirm these are the intended change targets.`,
    });
  }
  if (item.taskContextSummary?.delivery.destination === "channel") {
    addIssue({
      code: "delivery:channel",
      severity: "notice",
      message: zh
        ? `结果确认后将回传到 ${item.taskContextSummary.delivery.label}。`
        : `After review, the result will be returned to ${item.taskContextSummary.delivery.label}.`,
    });
  }
  const intentClarification = item.intentContract?.clarification ?? null;
  if (intentClarification) {
    const messages: Record<string, [string, string]> = {
      read_only_with_change_targets: ["只读要求与资料修改权限冲突。", "The read-only request conflicts with material write access."],
      read_only_with_external_write: ["只读要求与外部写入动作冲突。", "The read-only request conflicts with an external write."],
      platform_target_missing: ["任务缺少明确的目标平台。", "The task has no explicit target platform."],
      template_selection_changed: ["Channel 中确认的模板与任务当前模板不一致。", "The Channel-confirmed template differs from the task's current template."],
      output_format_changed: ["用户要求的结果格式与模板输出格式不一致。", "The requested result format differs from the template output."],
      change_target_not_writable: ["修改目标当前不支持安全写回。", "A change target does not currently support governed write-back."],
    };
    const localized = messages[intentClarification.code]?.[zh ? 0 : 1]
      ?? (zh ? "任务意图存在需要确认的冲突。" : "The task intent contains a conflict that needs confirmation.");
    addIssue({ code: `intent:${intentClarification.code}`, severity: "blocking", message: localized });
  }

  const repositoryPath = project?.path ?? project?.git?.repoPath ?? null;
  const issues = [...issueMap.values()];
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
    issues,
    clarification: intentClarification ? {
      question: zh ? intentClarification.question : ({
        read_only_with_change_targets: "Should this run only read and analyze, or may it modify these materials?",
        read_only_with_external_write: "Should this run only prepare a reviewable result, or write to the external platform?",
        platform_target_missing: "Which platform is this result intended for?",
        template_selection_changed: "Should this run use the Channel-confirmed template or the task's current template?",
        output_format_changed: "Which output format should this run produce?",
        change_target_not_writable: "Should AI prepare change suggestions only, or use a write-enabled material?",
      } as Record<string, string>)[intentClarification.code] ?? "Which interpretation should AI use for this run?",
      resolution: intentClarification.resolution,
    } : null,
    risks: issues.filter((issue) => issue.severity !== "notice").map((issue) => issue.message),
    boundary: zh
      ? "本次确认只会让 AI 按以上任务、资料和检查标准开始处理；后续交付、合并或对外写入仍按各自规则处理。"
      : "This confirmation only starts AI with the task, materials, and checks above. Delivery, merge, or external writes still follow their own controls.",
  };
}
