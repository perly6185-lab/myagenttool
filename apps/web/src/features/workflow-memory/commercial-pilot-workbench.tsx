import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardCheck, Download, Loader2, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  workflowMemoryApi,
  type CommercialPilotCaseDraft,
  type CommercialPilotDocumentRole,
  type CommercialPilotReleaseReview,
  type CommercialPilotReviewDimension,
  type CommercialPilotReviewItem,
  type CommercialPilotSafetyDraft,
  type CommercialPilotWorkbench,
  type CommercialPilotWorkbenchDraftInput,
} from "@/features/workflow-memory/workflow-memory-api";
import { ApiError, getSessionUser, SESSION_CHANGED_EVENT } from "@/lib/api-client";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

const TRAITS = ["duplicate", "missing_fact", "conflicting_fact", "restart", "concurrency"] as const;
const REVIEW_DIMENSIONS = [
  "performance",
  "security",
  "privacy",
  "accessibility",
  "localization",
  "migration",
  "rollback",
] as const;
const DOCUMENT_ROLES: CommercialPilotDocumentRole[] = [
  "inquiry",
  "quotation",
  "order",
  "inquiry_ledger",
  "quotation_ledger",
  "order_ledger",
  "unknown",
];

const COPY = {
  en: {
    title: "Formal pilot",
    summary: "Prepare authorized cases and governed evidence before release.",
    open: "Open pilot workbench",
    noProject: "Choose a project before preparing a pilot.",
    loading: "Loading pilot evidence…",
    loadFailed: "Pilot evidence could not be loaded.",
    retry: "Retry loading",
    cases: "Authorized cases",
    casesHint: "Select authorized real or deidentified routine tasks, then confirm the expected result.",
    authorization: "Data authorization",
    review: "Release review",
    safety: "Safety evidence",
    pilotId: "Pilot ID",
    description: "Description",
    classification: "Data classification",
    deidentified: "Deidentified",
    real: "Authorized real data",
    scope: "Authorized scope",
    consent: "I confirm these files are authorized for this local pilot.",
    template: "Output template ID",
    role: "Expected document type",
    outcome: "Expected business outcome",
    relationship: "This case must match a historical file",
    artifact: "Expected historical file",
    traits: "Case conditions",
    selected: "selected",
    complete: "complete",
    remove: "Remove",
    noCases: "No routine tasks are currently eligible.",
    noEvidence: "No proven evidence is available yet.",
    chooseEvidence: "Choose proven evidence",
    reviewer: "Reviewer role",
    overallReview: "I confirm all seven release checks have been reviewed.",
    save: "Save pilot",
    collect: "Generate evidence package",
    saving: "Saving…",
    collecting: "Collecting…",
    saved: "Draft saved",
    go: "GO",
    noGo: "NO-GO",
    currentGate: "Latest release decision",
    remaining: "Remaining checks",
    ready: "Evidence form is valid and can be collected.",
    savedProgress: "Saved evidence completeness",
    templates: "Templates",
    outcomes: "Outcomes",
    recovery: "Recovery conditions",
    checks: "checks",
    metrics: "Latest aggregate metrics",
    roleAccuracy: "Document role Top-1",
    relationshipAccuracy: "Relationship Top-1",
    completionRate: "Completion",
    approvalCoverage: "Approval coverage",
    recoveryRate: "Recovery pass rate",
    safetyRate: "Safety pass rate",
    duplicates: "Duplicate objects/rows",
    close: "Close",
    previous: "Previous",
    next: "Next",
    history: "Evidence history",
    noHistory: "No evidence package has been generated yet.",
    current: "Current",
    outdated: "Outdated",
    revoked: "Revoked",
    exportMarkdown: "Export Markdown",
    exportJson: "Export JSON",
    revoke: "Revoke",
    compare: "Compare with current",
    comparison: "Version changes",
    openTask: "Resolve in task",
    status: "Review result",
    pending: "Pending",
    passed: "Passed",
    failed: "Failed",
    reviewNote: "Review conclusion",
    reviewEvidence: "Evidence references (comma separated)",
    verified: "Verified",
    autoPrepare: "Auto-prepare pilot",
    preparing: "Preparing…",
    prepared: "Pilot cases and available evidence were prepared.",
    createGapIssues: "Create gap tasks",
    creatingGapIssues: "Creating tasks…",
    gapTasksCreated: "Gap tasks are ready.",
    evidenceGaps: "Actionable evidence gaps",
    noGaps: "No actionable evidence gaps remain.",
    openGapTask: "Open task",
    submitReview: "Submit this review",
    submittingReview: "Submitting…",
    rollout: "Pilot rollout",
    rolloutOff: "Off",
    rolloutShadow: "Shadow validation",
    rolloutEnabled: "Enabled",
    independentReview: "At least two different reviewers are required for final approval.",
    coverageGap: "Complete case coverage",
    authorizationGap: "Complete data authorization",
    reviewGap: "Complete independent release reviews",
    safetyGap: "Prove safety scenario",
    caseGap: "Complete case evidence",
  },
  zh: {
    title: "正式试运行",
    summary: "发布前集中准备经授权案例、独立审批与安全证据。",
    open: "打开试运行工作台",
    noProject: "请先选择项目，再准备正式试运行。",
    loading: "正在加载试运行证据…",
    loadFailed: "试运行证据加载失败。",
    retry: "重新加载",
    cases: "经授权案例",
    casesHint: "选择已授权的真实或脱敏日常任务，并人工确认预期结果。",
    authorization: "数据授权",
    review: "发布评审",
    safety: "安全证据",
    pilotId: "试运行 ID",
    description: "说明",
    classification: "数据分类",
    deidentified: "脱敏数据",
    real: "已授权真实数据",
    scope: "授权范围",
    consent: "我确认这些文件已获授权，仅用于本地试运行。",
    template: "交付模板 ID",
    role: "预期文件类型",
    outcome: "预期商务结果",
    relationship: "本案例应匹配到历史文件",
    artifact: "预期历史文件",
    traits: "案例特征",
    selected: "个已选择",
    complete: "个证据完整",
    remove: "移除",
    noCases: "当前没有可用于试运行的日常任务。",
    noEvidence: "尚无已验证的安全证据。",
    chooseEvidence: "选择已验证证据",
    reviewer: "评审人角色",
    overallReview: "我确认已逐项完成七项发布检查。",
    save: "保存试运行",
    collect: "生成证据包",
    saving: "保存中…",
    collecting: "采集中…",
    saved: "草稿已保存",
    go: "可发布",
    noGo: "暂不发布",
    currentGate: "最近发布结论",
    remaining: "待补项目",
    ready: "证据表单有效，可以生成受治理证据包。",
    savedProgress: "已保存证据完整度",
    templates: "模板",
    outcomes: "业务结果",
    recovery: "恢复场景",
    checks: "项",
    metrics: "最近一次聚合指标",
    roleAccuracy: "文件类型 Top-1",
    relationshipAccuracy: "关联检索 Top-1",
    completionRate: "任务完成率",
    approvalCoverage: "修改审批覆盖率",
    recoveryRate: "恢复场景通过率",
    safetyRate: "安全场景通过率",
    duplicates: "重复对象或台账行",
    close: "关闭",
    previous: "上一步",
    next: "下一步",
    history: "证据包历史",
    noHistory: "尚未生成证据包。",
    current: "当前版本",
    outdated: "已过期",
    revoked: "已撤销",
    exportMarkdown: "导出 Markdown",
    exportJson: "导出 JSON",
    revoke: "撤销",
    compare: "与当前版本比较",
    comparison: "版本变化",
    openTask: "前往任务补齐",
    status: "评审结论",
    pending: "待评审",
    passed: "通过",
    failed: "不通过",
    reviewNote: "评审说明",
    reviewEvidence: "证据引用（逗号分隔）",
    verified: "已验证",
    autoPrepare: "一键准备试运行",
    preparing: "正在准备…",
    prepared: "已自动选择案例并匹配可用证据。",
    createGapIssues: "生成缺口任务",
    creatingGapIssues: "正在生成任务…",
    gapTasksCreated: "缺口任务已生成。",
    evidenceGaps: "可处理的证据缺口",
    noGaps: "当前没有待处理证据缺口。",
    openGapTask: "打开任务",
    submitReview: "提交本项评审",
    submittingReview: "正在提交…",
    rollout: "试运行灰度",
    rolloutOff: "关闭",
    rolloutShadow: "影子验证",
    rolloutEnabled: "已启用",
    independentReview: "最终通过至少需要两名不同评审人。",
    coverageGap: "补齐案例覆盖",
    authorizationGap: "补齐数据授权",
    reviewGap: "完成独立发布评审",
    safetyGap: "补齐安全场景证据",
    caseGap: "补齐案例证据",
  },
} as const;

const LABELS = {
  en: {
    documentRoles: {
      inquiry: "Inquiry",
      quotation: "Quotation",
      order: "Order",
      inquiry_ledger: "Inquiry ledger",
      quotation_ledger: "Quotation ledger",
      order_ledger: "Order ledger",
      unknown: "Unknown type",
    },
    outcomes: {
      ordered: "Ordered",
      no_order: "No order",
      rejected: "Rejected",
    },
    traits: {
      duplicate: "Duplicate handling",
      missing_fact: "Missing information",
      conflicting_fact: "Conflicting information",
      restart: "Interrupted-task recovery",
      concurrency: "Concurrent processing",
    },
    safety: {
      unauthorized_path_read: "Unauthorized path read",
      path_traversal: "Path traversal",
      escaping_symlink: "Escaping symbolic link",
      prompt_injection: "Prompt injection",
      formula_injection: "Formula injection",
      stale_approval: "Stale approval",
      silent_overwrite: "Silent overwrite",
      automatic_delivery: "Automatic delivery",
      approval_bypass: "Approval bypass",
      cross_tenant: "Cross-tenant access",
    },
    review: {
      performance: "Performance",
      security: "Security",
      privacy: "Privacy",
      accessibility: "Accessibility",
      localization: "Localization",
      migration: "Migration",
      rollback: "Rollback",
    },
    evidenceKinds: {
      event: "Event",
      refusal: "Refusal",
      classification: "Classification",
    },
  },
  zh: {
    documentRoles: {
      inquiry: "询价单",
      quotation: "报价单",
      order: "订单",
      inquiry_ledger: "询价台账",
      quotation_ledger: "报价台账",
      order_ledger: "订单台账",
      unknown: "未知类型",
    },
    outcomes: {
      ordered: "已下单",
      no_order: "未下单",
      rejected: "已拒绝",
    },
    traits: {
      duplicate: "重复处理",
      missing_fact: "信息缺失",
      conflicting_fact: "信息冲突",
      restart: "中断恢复",
      concurrency: "并发处理",
    },
    safety: {
      unauthorized_path_read: "未授权路径读取",
      path_traversal: "路径穿越",
      escaping_symlink: "越界符号链接",
      prompt_injection: "提示词注入",
      formula_injection: "公式注入",
      stale_approval: "过期审批",
      silent_overwrite: "静默覆盖",
      automatic_delivery: "自动交付",
      approval_bypass: "绕过审批",
      cross_tenant: "跨租户访问",
    },
    review: {
      performance: "性能",
      security: "安全",
      privacy: "隐私",
      accessibility: "无障碍",
      localization: "本地化",
      migration: "迁移",
      rollback: "回滚",
    },
    evidenceKinds: {
      event: "事件",
      refusal: "拒绝记录",
      classification: "文件分类",
    },
  },
} as const;

function localizedLabel(labels: Readonly<Record<string, string>>, value: string) {
  return labels[value] ?? value.replaceAll("_", " ");
}

const REASONS = {
  en: {
    minimum_formal_cases: "Add at least 10 authorized cases",
    minimum_template_coverage: "Cover at least 2 output templates",
    ordered_outcome: "Add a case that resulted in an order",
    no_order_outcome: "Add a case that did not result in an order",
    consent_confirmation: "Confirm authorization and consent",
    consent_timestamp: "Confirm authorization to record its timestamp",
    consent_scope: "Describe the authorized pilot scope",
    release_review_timestamp: "Confirm the overall release review",
    release_reviewer_role: "Enter the reviewer role",
    release_review: "Complete all seven release reviews",
    independent_release_reviewers: "Use at least two different release reviewers",
    complete_case_evidence: "Resolve incomplete case evidence",
    current_business_case: "The current business case is missing",
    current_trigger_artifacts: "A current source file is missing or changed",
    confirmed_trigger_classification: "Confirm the source document type",
    published_routine_definition: "Publish the routine version used by this task",
    ranked_relationship: "Generate and confirm the expected historical-file match",
    terminal_routine_run: "Wait for the routine task to finish",
    completed_or_rejected_routine_run: "Complete or explicitly reject the routine task",
    confirmed_order_outcome_evidence: "Confirm the order file and order-processing task",
    complete_mutation_approvals: "Record every quotation and ledger modification approval",
    successful_recovery_trace: "Run and complete the selected recovery condition",
  },
  zh: {
    minimum_formal_cases: "补齐至少 10 个经授权案例",
    minimum_template_coverage: "覆盖至少 2 种交付模板",
    ordered_outcome: "补充一个成功下单案例",
    no_order_outcome: "补充一个未下单案例",
    consent_confirmation: "确认数据授权与同意范围",
    consent_timestamp: "确认数据授权并记录时间",
    consent_scope: "填写本次试运行的授权范围",
    release_review_timestamp: "确认总体发布评审并记录时间",
    release_reviewer_role: "填写评审人角色",
    release_review: "完成七项发布评审",
    independent_release_reviewers: "至少由两名不同评审人完成发布评审",
    complete_case_evidence: "处理未完整的案例证据",
    current_business_case: "当前商务案例不存在",
    current_trigger_artifacts: "来源文件缺失或已经变化",
    confirmed_trigger_classification: "确认来源文件类型",
    published_routine_definition: "发布该任务使用的工作流版本",
    ranked_relationship: "生成并确认预期的历史文件关联",
    terminal_routine_run: "等待日常任务结束",
    completed_or_rejected_routine_run: "完成或明确拒绝该日常任务",
    confirmed_order_outcome_evidence: "确认订单文件和订单处理任务",
    complete_mutation_approvals: "补齐报价单和台账的逐项修改审批",
    successful_recovery_trace: "实际运行并完成所选恢复场景",
  },
} as const;

function percentage(value: number | null) {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

function useSessionRole() {
  // Password/enterprise sessions always provide a role. A null session is the
  // product's single-user local mode, whose server actor is the local owner.
  const currentRole = () => getSessionUser()?.role ?? "owner";
  const [role, setRole] = useState(currentRole);
  useEffect(() => {
    const sync = () => setRole(currentRole());
    window.addEventListener(SESSION_CHANGED_EVENT, sync);
    sync();
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, sync);
  }, []);
  return role;
}

function inputDraft(workbench: CommercialPilotWorkbench): CommercialPilotWorkbenchDraftInput {
  const { draft } = workbench;
  const reviewItems = Object.fromEntries(REVIEW_DIMENSIONS.map((dimension) => {
    const existing = draft.releaseReview.items?.[dimension];
    return [dimension, existing ? {
      ...existing,
      evidenceIds: [...existing.evidenceIds],
    } : {
      status: "pending",
      reviewerId: null,
      reviewerRole: "",
      reviewedAt: null,
      note: "",
      evidenceIds: [],
    }];
  })) as Record<CommercialPilotReviewDimension, CommercialPilotReviewItem>;
  return {
    pilotId: draft.pilotId,
    ...(draft.description ? { description: draft.description } : {}),
    dataClassification: draft.dataClassification,
    consent: { ...draft.consent, scope: draft.consent.scope ?? "" },
    releaseReview: { ...draft.releaseReview, items: reviewItems },
    cases: draft.cases.map((row) => ({ ...row, traits: [...row.traits] })),
    safetyScenarios: draft.safetyScenarios.map((row) => ({ ...row })),
  };
}

function errorText(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

function CheckRow({
  checked,
  onChange,
  disabled = false,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex items-start gap-2 rounded-md border p-2 text-sm ${
      disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
    }`}>
      <input
        className="mt-0.5 size-4"
        type="checkbox"
        disabled={disabled}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}

export function CommercialPilotWorkbench({
  projectId,
  onOpenTask,
}: {
  projectId: string;
  onOpenTask?: (workItemId: string, section: "process" | "assets") => void;
}) {
  const { i18n } = useAppTranslation();
  const language = i18n.resolvedLanguage?.startsWith("zh") ? "zh" : "en";
  const copy = COPY[language];
  const labels = LABELS[language];
  const sessionRole = useSessionRole();
  const canManage = ["owner", "admin"].includes(sessionRole);
  const canReview = canManage || sessionRole === "operator";
  const reasonLabel = (reason: string) => {
    if (reason.startsWith("trait:")) {
      const trait = localizedLabel(labels.traits, reason.slice(6));
      return language === "zh"
        ? `补充恢复场景：${trait}`
        : `Add recovery condition: ${trait}`;
    }
    if (reason.startsWith("safety:")) {
      const scenario = localizedLabel(labels.safety, reason.slice(7));
      return language === "zh"
        ? `补齐安全证据：${scenario}`
        : `Add safety evidence: ${scenario}`;
    }
    return REASONS[language][reason as keyof typeof REASONS[typeof language]]
      ?? reason.replaceAll("_", " ");
  };
  const gapTitle = (key: string) => {
    if (key === "coverage") return copy.coverageGap;
    if (key === "authorization") return copy.authorizationGap;
    if (key === "release-review") return copy.reviewGap;
    if (key.startsWith("safety-")) {
      return `${copy.safetyGap}: ${localizedLabel(labels.safety, key.slice(7))}`;
    }
    if (key.startsWith("case-")) return `${copy.caseGap}: ${key.slice(5)}`;
    return key.replaceAll("-", " ");
  };
  const queryClient = useQueryClient();
  const queryKey = ["workflow-memory", "commercial-pilot-workbench", projectId];
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CommercialPilotWorkbenchDraftInput | null>(null);
  const [baseRevision, setBaseRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "collect" | "prepare" | "gaps" | "review" | "rollout" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [comparison, setComparison] = useState<{
    fromId: string;
    toId: string;
    caseCount: number;
    safetyPassed: number;
    evidenceStateChanged: boolean;
    decisionChanged: boolean;
  } | null>(null);
  const workbenchQuery = useQuery({
    queryKey,
    queryFn: () => workflowMemoryApi.getBusinessPilotWorkbench(projectId),
    enabled: Boolean(projectId) && canReview,
  });
  const workbench = workbenchQuery.data;

  useEffect(() => {
    if (open && workbench && !dirty) {
      setDraft(inputDraft(workbench));
      setBaseRevision(workbench.draft.revision);
    }
  }, [dirty, open, workbench]);

  const updateDraft = (update: (current: CommercialPilotWorkbenchDraftInput) =>
  CommercialPilotWorkbenchDraftInput) => {
    setDraft((current) => current ? update(current) : current);
    setDirty(true);
    setNotice(null);
  };

  const selectedIds = useMemo(
    () => new Set(draft?.cases.map((row) => row.workItemId) ?? []),
    [draft?.cases],
  );

  const toggleCase = (workItemId: string, selected: boolean) => updateDraft((current) => {
    if (!selected) {
      return { ...current, cases: current.cases.filter((row) => row.workItemId !== workItemId) };
    }
    const usedIds = new Set(current.cases.map((row) => row.id));
    let index = 1;
    while (usedIds.has(`case-${String(index).padStart(2, "0")}`)) index += 1;
    const suggestion = workbench?.eligible.workItems.find((row) => row.id === workItemId);
    const next: CommercialPilotCaseDraft = {
      id: `case-${String(index).padStart(2, "0")}`,
      workItemId,
      templateId: suggestion?.suggestedTemplateId ?? "default-a",
      traits: suggestion?.suggestedTraits ?? [],
      expectedDocumentRole: suggestion?.suggestedDocumentRole ?? "inquiry",
      relationshipExpected: false,
      expectedOutcome: suggestion?.suggestedOutcome ?? "no_order",
    };
    return { ...current, cases: [...current.cases, next] };
  });

  const updateCase = (workItemId: string, patch: Partial<CommercialPilotCaseDraft>) =>
    updateDraft((current) => ({
      ...current,
      cases: current.cases.map((row) =>
        row.workItemId === workItemId ? { ...row, ...patch } : row),
    }));

  const updateSafety = (scenarioId: string, value: string) => updateDraft((current) => {
    const remaining = current.safetyScenarios.filter((row) => row.id !== scenarioId);
    if (!value) return { ...current, safetyScenarios: remaining };
    const [evidenceKind, evidenceId] = value.split(":") as [
      CommercialPilotSafetyDraft["evidenceKind"],
      string,
    ];
    return {
      ...current,
      safetyScenarios: [...remaining, { id: scenarioId, evidenceKind, evidenceId }],
    };
  });

  const updateReview = (
    dimension: CommercialPilotReviewDimension,
    patch: Partial<CommercialPilotReviewItem>,
  ) => updateDraft((current) => {
    const fallback: CommercialPilotReviewItem = {
      status: "pending",
      reviewerRole: "",
      reviewedAt: null,
      note: "",
      evidenceIds: [],
    };
    const nextItem = { ...(current.releaseReview.items?.[dimension] ?? fallback), ...patch };
    if (patch.status) {
      nextItem.reviewedAt = patch.status === "pending" ? null : new Date().toISOString();
    }
    const items = {
      ...current.releaseReview.items,
      [dimension]: nextItem,
    } as Record<CommercialPilotReviewDimension, CommercialPilotReviewItem>;
    const allPassed = REVIEW_DIMENSIONS.every((key) => items[key]?.status === "passed");
    const reviewerRole = REVIEW_DIMENSIONS.map((key) => items[key]?.reviewerRole)
      .find((value) => value?.trim()) ?? current.releaseReview.reviewerRole;
    return {
      ...current,
      releaseReview: {
        ...current.releaseReview,
        ...Object.fromEntries(REVIEW_DIMENSIONS.map((key) => [key, items[key].status === "passed"])),
        items,
        reviewerRole,
        confirmed: allPassed,
        recordedAt: allPassed ? new Date().toISOString() : null,
      } as CommercialPilotReleaseReview,
    };
  });

  const exportCollection = async (collectionId: string, format: "markdown" | "json") => {
    setError(null);
    try {
      const exported = await workflowMemoryApi.exportBusinessPilotCollection(
        projectId,
        collectionId,
        format,
      );
      const url = URL.createObjectURL(new Blob([exported.content], { type: exported.mediaType }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = exported.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const revokeCollection = async (collectionId: string) => {
    if (!window.confirm(copy.revoke)) return;
    setError(null);
    try {
      await workflowMemoryApi.revokeBusinessPilotCollection(projectId, collectionId);
      const refreshed = await workbenchQuery.refetch();
      if (refreshed.data) {
        setDraft(inputDraft(refreshed.data));
        setBaseRevision(refreshed.data.draft.revision);
        setDirty(false);
      }
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const compareCollection = async (fromId: string, toId: string) => {
    setError(null);
    try {
      const result = await workflowMemoryApi.compareBusinessPilotCollections({
        projectId,
        fromId,
        toId,
      });
      setComparison({ fromId, toId, ...result.changes });
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const save = async () => {
    if (!draft || !workbench) return;
    setBusy("save");
    setError(null);
    try {
      const saved = await workflowMemoryApi.saveBusinessPilotWorkbench({
        projectId,
        expectedRevision: baseRevision,
        draft,
      });
      queryClient.setQueryData(queryKey, saved);
      setDraft(inputDraft(saved));
      setBaseRevision(saved.draft.revision);
      setDirty(false);
      setNotice(copy.saved);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(null);
    }
  };

  const collect = async () => {
    if (!workbench || dirty) return;
    setBusy("collect");
    setError(null);
    try {
      const collected = await workflowMemoryApi.collectBusinessPilotWorkbench({
        projectId,
        expectedRevision: workbench.draft.revision,
      });
      queryClient.setQueryData(queryKey, collected);
      setDraft(inputDraft(collected));
      setNotice(collected.collection.report.gate.decision === "go" ? copy.go : copy.noGo);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(null);
    }
  };

  const prepare = async () => {
    if (!draft || !workbench || !draft.consent.confirmed || !draft.consent.scope.trim()) return;
    setBusy("prepare");
    setError(null);
    try {
      const prepared = await workflowMemoryApi.prepareBusinessPilotWorkbench({
        projectId,
        expectedRevision: baseRevision,
        confirmed: true,
        dataClassification: draft.dataClassification,
        consentScope: draft.consent.scope,
        pilotId: draft.pilotId,
        ...(draft.description ? { description: draft.description } : {}),
      });
      queryClient.setQueryData(queryKey, prepared);
      setDraft(inputDraft(prepared));
      setBaseRevision(prepared.draft.revision);
      setDirty(false);
      setNotice(copy.prepared);
      setStep(1);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(null);
    }
  };

  const createGapIssues = async () => {
    if (!workbench || dirty || !window.confirm(copy.createGapIssues)) return;
    setBusy("gaps");
    setError(null);
    try {
      const result = await workflowMemoryApi.createBusinessPilotGapIssues({
        projectId,
        expectedRevision: workbench.draft.revision,
        confirmed: true,
      });
      queryClient.setQueryData(queryKey, result);
      setDraft(inputDraft(result));
      setNotice(copy.gapTasksCreated);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(null);
    }
  };

  const submitReview = async (dimension: CommercialPilotReviewDimension) => {
    const item = draft?.releaseReview.items?.[dimension];
    if (!workbench || !item || item.status === "pending") return;
    setBusy("review");
    setError(null);
    try {
      const result = await workflowMemoryApi.submitBusinessPilotReview(dimension, {
        projectId,
        expectedRevision: baseRevision,
        status: item.status,
        note: item.note,
        evidenceIds: item.evidenceIds,
      });
      queryClient.setQueryData(queryKey, result);
      setDraft(inputDraft(result));
      setBaseRevision(result.draft.revision);
      setDirty(false);
      setNotice(copy.saved);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(null);
    }
  };

  const updateRollout = async (mode: "off" | "shadow" | "enabled") => {
    if (!workbench?.rollout) return;
    setBusy("rollout");
    setError(null);
    try {
      await workflowMemoryApi.updateBusinessPilotRollout({
        projectId,
        expectedRevision: workbench.rollout.revision,
        mode,
      });
      await workbenchQuery.refetch();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(null);
    }
  };

  const latest = workbench?.draft.lastCollection;
  const reviewNeedsSubmission = REVIEW_DIMENSIONS.some((dimension) => {
    const item = draft?.releaseReview.items?.[dimension];
    return item && item.status !== "pending" && !item.reviewerId;
  });
  if (!canReview) return null;
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="size-4" />
            {copy.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">{copy.summary}</p>
            {workbench ? (
              <p className="mt-1 text-xs">
                {workbench.progress.caseCount}/{workbench.progress.requiredCaseCount} {copy.selected}
                {" · "}
                {workbench.progress.completeCaseCount} {copy.complete}
              </p>
            ) : null}
          </div>
          <Button
            variant="secondary"
            disabled={!projectId}
            onClick={() => {
              setOpen(true);
              setDirty(false);
              setStep(canManage ? 0 : 3);
              setNotice(null);
              setError(null);
              if (workbench) {
                setDraft(inputDraft(workbench));
                setBaseRevision(workbench.draft.revision);
              }
            }}
          >
            <ShieldCheck />
            {copy.open}
          </Button>
        </CardContent>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={copy.title}
        description={copy.summary}
        size="xl"
        closeDisabled={busy != null}
      >
        {!projectId ? <p className="text-sm text-muted-foreground">{copy.noProject}</p>
          : workbenchQuery.isError ? (
            <div role="alert" className="space-y-3 rounded-md border border-destructive/40 p-3">
              <p className="text-sm font-medium text-destructive">{copy.loadFailed}</p>
              <p className="text-xs text-muted-foreground">{errorText(workbenchQuery.error)}</p>
              <Button variant="secondary" onClick={() => void workbenchQuery.refetch()}>
                {copy.retry}
              </Button>
            </div>
          ) : workbenchQuery.isLoading || !workbench || !draft ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> {copy.loading}
            </p>
          ) : (
            <div className="space-y-5">
              <nav aria-label={copy.title} className="grid grid-cols-4 gap-1">
                {[copy.authorization, copy.cases, copy.safety, copy.review].map((label, index) => (
                  <Button
                    key={label}
                    size="sm"
                    variant={step === index ? "secondary" : "ghost"}
                    disabled={!canManage && index !== 3}
                    onClick={() => setStep(index)}
                  >
                    {index + 1}. {label}
                  </Button>
                ))}
              </nav>

              {step === 0 ? <section className="grid gap-3 rounded-lg border p-3 md:grid-cols-2">
                <h3 className="md:col-span-2 text-sm font-semibold">{copy.authorization}</h3>
                <label className="space-y-1 text-xs">
                  <span>{copy.pilotId}</span>
                  <Input
                    value={draft.pilotId}
                    onChange={(event) => updateDraft((current) => ({
                      ...current,
                      pilotId: event.target.value,
                    }))}
                  />
                </label>
                <label className="space-y-1 text-xs">
                  <span>{copy.classification}</span>
                  <Select
                    value={draft.dataClassification}
                    onChange={(event) => updateDraft((current) => ({
                      ...current,
                      dataClassification: event.target.value as "deidentified" | "real",
                    }))}
                  >
                    <option value="deidentified">{copy.deidentified}</option>
                    <option value="real">{copy.real}</option>
                  </Select>
                </label>
                <label className="space-y-1 text-xs md:col-span-2">
                  <span>{copy.description}</span>
                  <Textarea
                    value={draft.description ?? ""}
                    maxLength={500}
                    onChange={(event) => updateDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))}
                  />
                </label>
                <label className="space-y-1 text-xs md:col-span-2">
                  <span>{copy.scope}</span>
                  <Input
                    value={draft.consent.scope}
                    maxLength={240}
                    onChange={(event) => updateDraft((current) => ({
                      ...current,
                      consent: { ...current.consent, scope: event.target.value },
                    }))}
                  />
                </label>
                <div className="md:col-span-2">
                  <CheckRow
                    checked={draft.consent.confirmed}
                    onChange={(confirmed) => updateDraft((current) => ({
                      ...current,
                      consent: {
                        ...current.consent,
                        confirmed,
                        recordedAt: confirmed ? new Date().toISOString() : null,
                      },
                    }))}
                  >
                    {copy.consent}
                  </CheckRow>
                </div>
                <label className="space-y-1 text-xs">
                  <span>{copy.rollout}</span>
                  <Select
                    value={workbench.rollout?.mode ?? "shadow"}
                    disabled={busy != null}
                    onChange={(event) => void updateRollout(
                      event.target.value as "off" | "shadow" | "enabled",
                    )}
                  >
                    <option value="off">{copy.rolloutOff}</option>
                    <option value="shadow">{copy.rolloutShadow}</option>
                    <option value="enabled">{copy.rolloutEnabled}</option>
                  </Select>
                </label>
                <div className="flex items-end justify-end">
                  <Button
                    disabled={
                      busy != null
                      || workbench.rollout?.mode === "off"
                      || !draft.consent.confirmed
                      || !draft.consent.scope.trim()
                    }
                    onClick={() => void prepare()}
                  >
                    {busy === "prepare" ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                    {busy === "prepare" ? copy.preparing : copy.autoPrepare}
                  </Button>
                </div>
              </section> : null}

              {step === 1 ? <section className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold">{copy.cases}</h3>
                  <p className="text-xs text-muted-foreground">{copy.casesHint}</p>
                </div>
                {workbench.eligible.workItems.length === 0
                  ? <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{copy.noCases}</p>
                  : (
                    <div className="grid gap-2 md:grid-cols-2">
                      {workbench.eligible.workItems.map((item) => (
                        <CheckRow
                          key={item.id}
                          checked={selectedIds.has(item.id)}
                          onChange={(selected) => toggleCase(item.id, selected)}
                        >
                          <span className="font-medium">{item.localRef ?? item.id}</span>
                          <span className="block text-xs text-muted-foreground">
                            {item.title ?? item.status}
                          </span>
                        </CheckRow>
                      ))}
                    </div>
                  )}
                {draft.cases.map((row) => (
                  <div key={row.workItemId} className="space-y-3 rounded-lg border bg-muted/20 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{row.id}</p>
                      <Button size="sm" variant="ghost" onClick={() => toggleCase(row.workItemId, false)}>
                        {copy.remove}
                      </Button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="space-y-1 text-xs">
                        <span>{copy.template}</span>
                        <Input
                          value={row.templateId}
                          onChange={(event) => updateCase(row.workItemId, {
                            templateId: event.target.value,
                          })}
                        />
                      </label>
                      <label className="space-y-1 text-xs">
                        <span>{copy.role}</span>
                        <Select
                          value={row.expectedDocumentRole}
                          onChange={(event) => updateCase(row.workItemId, {
                            expectedDocumentRole: event.target.value as CommercialPilotDocumentRole,
                          })}
                        >
                          {DOCUMENT_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {localizedLabel(labels.documentRoles, role)}
                            </option>
                          ))}
                        </Select>
                      </label>
                      <label className="space-y-1 text-xs">
                        <span>{copy.outcome}</span>
                        <Select
                          value={row.expectedOutcome}
                          onChange={(event) => updateCase(row.workItemId, {
                            expectedOutcome: event.target.value as CommercialPilotCaseDraft["expectedOutcome"],
                          })}
                        >
                          {(["ordered", "no_order", "rejected"] as const).map((outcome) => (
                            <option key={outcome} value={outcome}>
                              {localizedLabel(labels.outcomes, outcome)}
                            </option>
                          ))}
                        </Select>
                      </label>
                    </div>
                    <div>
                      <p className="mb-1 text-xs">{copy.traits}</p>
                      <div className="flex flex-wrap gap-2">
                        {TRAITS.map((trait) => (
                          <label key={trait} className="flex items-center gap-1 text-xs">
                            <input
                              type="checkbox"
                              checked={row.traits.includes(trait)}
                              onChange={(event) => updateCase(row.workItemId, {
                                traits: event.target.checked
                                  ? [...row.traits, trait]
                                  : row.traits.filter((value) => value !== trait),
                              })}
                            />
                            {localizedLabel(labels.traits, trait)}
                          </label>
                        ))}
                      </div>
                    </div>
                    <CheckRow
                      checked={row.relationshipExpected}
                      onChange={(relationshipExpected) => updateCase(row.workItemId, {
                        relationshipExpected,
                        ...(!relationshipExpected ? { relationshipArtifactId: undefined } : {}),
                      })}
                    >
                      {copy.relationship}
                    </CheckRow>
                    {row.relationshipExpected ? (
                      <label className="space-y-1 text-xs">
                        <span>{copy.artifact}</span>
                        <Select
                          value={row.relationshipArtifactId ?? ""}
                          onChange={(event) => updateCase(row.workItemId, {
                            relationshipArtifactId: event.target.value || undefined,
                          })}
                        >
                          <option value="">—</option>
                          {workbench.eligible.relationshipArtifacts.map((artifact) => (
                            <option key={artifact.id} value={artifact.id}>
                              {artifact.name ?? artifact.id}
                            </option>
                          ))}
                        </Select>
                      </label>
                    ) : null}
                    {workbench.progress.cases.find((item) => item.id === row.id)?.missing
                      .map((reason) => (
                        <p key={reason} className="text-xs text-warning">
                          {reasonLabel(reason)}
                        </p>
                      ))}
                    {(workbench.progress.cases.find((item) => item.id === row.id)?.missing.length ?? 0) > 0
                      && onOpenTask ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            const eligible = workbench.eligible.workItems.find((item) =>
                              item.id === row.workItemId);
                            onOpenTask(row.workItemId, eligible?.nextAction ?? "process");
                            setOpen(false);
                          }}
                        >
                          {copy.openTask}
                        </Button>
                      ) : null}
                  </div>
                ))}
              </section> : null}

              {step === 2 ? <section className="space-y-3 rounded-lg border p-3">
                <h3 className="text-sm font-semibold">{copy.safety}</h3>
                <div className="grid gap-2 md:grid-cols-2">
                  {workbench.requiredSafetyScenarios.map((scenario) => {
                    const current = draft.safetyScenarios.find((row) => row.id === scenario);
                    const candidates = workbench.eligible.safetyEvidence
                      .filter((row) => row.id === scenario);
                    return (
                      <label key={scenario} className="space-y-1 text-xs">
                        <span>{localizedLabel(labels.safety, scenario)}</span>
                        <Select
                          value={current ? `${current.evidenceKind}:${current.evidenceId}` : ""}
                          onChange={(event) => updateSafety(scenario, event.target.value)}
                          disabled={candidates.length === 0}
                        >
                          <option value="">
                            {candidates.length ? copy.chooseEvidence : copy.noEvidence}
                          </option>
                          {candidates.map((row) => (
                            <option
                              key={`${row.evidenceKind}:${row.evidenceId}`}
                              value={`${row.evidenceKind}:${row.evidenceId}`}
                            >
                              {localizedLabel(labels.evidenceKinds, row.evidenceKind)}
                              {" · "}{copy.verified}
                            </option>
                          ))}
                        </Select>
                      </label>
                    );
                  })}
                </div>
              </section> : null}

              {step === 2 ? (
                <section className="space-y-3 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{copy.evidenceGaps}</h3>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={
                        dirty
                        || busy != null
                        || workbench.rollout?.mode === "off"
                        || (workbench.gaps ?? []).length === 0
                      }
                      onClick={() => void createGapIssues()}
                    >
                      {busy === "gaps" ? <Loader2 className="animate-spin" /> : null}
                      {busy === "gaps" ? copy.creatingGapIssues : copy.createGapIssues}
                    </Button>
                  </div>
                  {(workbench.gaps ?? []).length === 0
                    ? <p className="text-sm text-muted-foreground">{copy.noGaps}</p>
                    : (workbench.gaps ?? []).map((gap) => (
                      <div key={gap.key} className="flex flex-wrap items-start justify-between gap-2 rounded-md bg-muted/30 p-2">
                        <div>
                          <p className="text-sm font-medium">{gapTitle(gap.key)}</p>
                          <ul className="list-disc pl-4 text-xs text-muted-foreground">
                            {gap.reasons.map((reason) => <li key={reason}>{reasonLabel(reason)}</li>)}
                          </ul>
                        </div>
                        {gap.issue ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (onOpenTask) {
                                onOpenTask(gap.issue!.id, "process");
                                setOpen(false);
                              }
                            }}
                          >
                            {gap.issue.localRef} · {copy.openGapTask}
                          </Button>
                        ) : null}
                      </div>
                    ))}
                </section>
              ) : null}

              {step === 3 ? <section className="space-y-3 rounded-lg border p-3">
                <h3 className="text-sm font-semibold">{copy.review}</h3>
                <div className="space-y-3">
                  {REVIEW_DIMENSIONS.map((dimension) => {
                    const item = draft.releaseReview.items?.[dimension] ?? {
                      status: "pending",
                      reviewerId: null,
                      reviewerRole: "",
                      reviewedAt: null,
                      note: "",
                      evidenceIds: [],
                    };
                    return (
                      <div key={dimension} className="grid gap-2 rounded-md bg-muted/30 p-3 md:grid-cols-2">
                        <h4 className="text-sm font-medium md:col-span-2">
                          {localizedLabel(labels.review, dimension)}
                        </h4>
                        <label className="space-y-1 text-xs">
                          <span>{copy.status}</span>
                          <Select
                            aria-label={`${localizedLabel(labels.review, dimension)} ${copy.status}`}
                            value={item.status}
                            onChange={(event) => updateReview(dimension, {
                              status: event.target.value as CommercialPilotReviewItem["status"],
                            })}
                          >
                            <option value="pending">{copy.pending}</option>
                            <option value="passed">{copy.passed}</option>
                            <option value="failed">{copy.failed}</option>
                          </Select>
                        </label>
                        <label className="space-y-1 text-xs">
                          <span>{copy.reviewer}</span>
                          <Input
                            value={item.reviewerRole || sessionRole}
                            maxLength={80}
                            disabled
                          />
                        </label>
                        <label className="space-y-1 text-xs">
                          <span>{copy.reviewNote}</span>
                          <Textarea
                            value={item.note}
                            maxLength={500}
                            onChange={(event) => updateReview(dimension, { note: event.target.value })}
                          />
                        </label>
                        <label className="space-y-1 text-xs">
                          <span>{copy.reviewEvidence}</span>
                          <Input
                            value={item.evidenceIds.join(", ")}
                            onChange={(event) => updateReview(dimension, {
                              evidenceIds: event.target.value.split(",")
                                .map((value) => value.trim()).filter(Boolean).slice(0, 20),
                            })}
                          />
                        </label>
                        <div className="flex items-center justify-between gap-2 md:col-span-2">
                          <span className="text-xs text-muted-foreground">
                            {item.reviewerId ? `${item.reviewerRole} · ${item.reviewerId}` : copy.independentReview}
                          </span>
                          <Button
                            size="sm"
                            disabled={
                              busy != null
                              || workbench.rollout?.mode === "off"
                              || item.status === "pending"
                              || item.note.trim().length < 3
                              || item.evidenceIds.length === 0
                            }
                            onClick={() => void submitReview(dimension)}
                          >
                            {busy === "review" ? <Loader2 className="animate-spin" /> : null}
                            {busy === "review" ? copy.submittingReview : copy.submitReview}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  {copy.overallReview} {copy.independentReview}
                </p>
              </section> : null}

              {step === 3 ? <section className="space-y-3 rounded-lg border p-3">
                <h3 className="text-sm font-semibold">{copy.savedProgress}</h3>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-md bg-muted/40 p-2 text-sm">
                    <span className="text-muted-foreground">{copy.cases}</span>
                    <strong className="block">
                      {workbench.progress.completeCaseCount}/{workbench.progress.requiredCaseCount}
                    </strong>
                  </div>
                  <div className="rounded-md bg-muted/40 p-2 text-sm">
                    <span className="text-muted-foreground">{copy.templates}</span>
                    <strong className="block">
                      {workbench.progress.templateCount}/{workbench.progress.requiredTemplateCount}
                    </strong>
                  </div>
                  <div className="rounded-md bg-muted/40 p-2 text-sm">
                    <span className="text-muted-foreground">{copy.outcomes}</span>
                    <strong className="block">
                      {workbench.progress.outcomes
                        .map((outcome) => localizedLabel(labels.outcomes, outcome))
                        .join(" · ") || "—"}
                    </strong>
                  </div>
                  <div className="rounded-md bg-muted/40 p-2 text-sm">
                    <span className="text-muted-foreground">{copy.recovery}</span>
                    <strong className="block">
                      {workbench.progress.traits.filter((row) => row.complete).length}
                      /{workbench.progress.traits.length} {copy.checks}
                    </strong>
                  </div>
                  <div className="rounded-md bg-muted/40 p-2 text-sm">
                    <span className="text-muted-foreground">{copy.safety}</span>
                    <strong className="block">
                      {workbench.progress.safety.filter((row) => row.passed).length}
                      /{workbench.requiredSafetyScenarios.length} {copy.checks}
                    </strong>
                  </div>
                  <div className="rounded-md bg-muted/40 p-2 text-sm">
                    <span className="text-muted-foreground">{copy.review}</span>
                    <strong className="block">
                      {workbench.progress.releaseReview.filter((row) => row.complete).length}
                      /{REVIEW_DIMENSIONS.length} {copy.checks}
                    </strong>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {workbench.progress.traits.map((row) => (
                    <Badge key={row.id} tone={row.complete ? "success" : "neutral"}>
                      {localizedLabel(labels.traits, row.id)}
                    </Badge>
                  ))}
                </div>
              </section> : null}

              {step === 3 ? <section className="rounded-lg border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">
                      {draft.cases.length}/{workbench.progress.requiredCaseCount} {copy.selected}
                      {" · "}{workbench.progress.completeCaseCount} {copy.complete}
                    </p>
                    {workbench.progress.readyForCollection
                      ? <p className="mt-1 text-xs text-success">{copy.ready}</p>
                      : (
                        <div className="mt-1 text-xs text-muted-foreground">
                          <p>{copy.remaining}:</p>
                          <ul className="list-disc pl-4">
                            {workbench.progress.missing.slice(0, 8)
                              .map((reason) => <li key={reason}>{reasonLabel(reason)}</li>)}
                          </ul>
                        </div>
                      )}
                  </div>
                  {latest ? (
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">{copy.currentGate}</p>
                      <Badge tone={latest.report.gate.decision === "go" ? "success" : "warning"}>
                        {latest.report.gate.decision === "go" ? copy.go : copy.noGo}
                      </Badge>
                    </div>
                  ) : null}
                </div>
              </section> : null}

              {step === 3 && latest?.report.metrics ? (
                <section className="space-y-3 rounded-lg border p-3">
                  <h3 className="text-sm font-semibold">{copy.metrics}</h3>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      [copy.roleAccuracy, percentage(latest.report.metrics.documents.top1)],
                      [copy.relationshipAccuracy, percentage(latest.report.metrics.relationships.top1)],
                      [copy.completionRate, percentage(latest.report.metrics.completion.rate)],
                      [copy.approvalCoverage, percentage(latest.report.metrics.approvals.coverage)],
                      [copy.recoveryRate, percentage(latest.report.metrics.recovery.passRate)],
                      [copy.safetyRate, percentage(latest.report.metrics.safety.passRate)],
                      [copy.duplicates, String(latest.report.metrics.duplicates.total)],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-md bg-muted/40 p-2 text-sm">
                        <span className="text-xs text-muted-foreground">{label}</span>
                        <strong className="block">{value}</strong>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {step === 3 ? (
                <section className="space-y-3 rounded-lg border p-3">
                  <h3 className="text-sm font-semibold">{copy.history}</h3>
                  {(workbench.history ?? []).length === 0
                    ? <p className="text-sm text-muted-foreground">{copy.noHistory}</p>
                    : (workbench.history ?? []).map((row) => (
                      <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/30 p-2">
                        <div className="text-xs">
                          <p className="font-medium">{new Date(row.collectedAt).toLocaleString()}</p>
                          <p className="text-muted-foreground">
                            {row.caseCount} {copy.cases} · {row.safetyPassed}/{row.safetyTotal} {copy.safety}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge tone={row.revokedAt ? "neutral" : row.current ? "success" : "warning"}>
                            {row.revokedAt ? copy.revoked : row.current ? copy.current : copy.outdated}
                          </Badge>
                          <Button size="sm" variant="ghost" onClick={() => void exportCollection(row.id, "markdown")}>
                            <Download /> {copy.exportMarkdown}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void exportCollection(row.id, "json")}>
                            {copy.exportJson}
                          </Button>
                          {!row.current && !row.revokedAt && workbench.history?.[0] ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void compareCollection(row.id, workbench.history![0].id)}
                            >
                              {copy.compare}
                            </Button>
                          ) : null}
                          {!row.revokedAt ? (
                            <Button size="sm" variant="ghost" onClick={() => void revokeCollection(row.id)}>
                              {copy.revoke}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  {comparison ? (
                    <div className="rounded-md border border-dashed p-2 text-xs">
                      <p className="font-medium">{copy.comparison}</p>
                      <p>
                        {copy.cases}: {comparison.caseCount >= 0 ? "+" : ""}{comparison.caseCount}
                        {" · "}{copy.safety}: {comparison.safetyPassed >= 0 ? "+" : ""}{comparison.safetyPassed}
                        {" · "}{copy.currentGate}: {comparison.decisionChanged ? "Δ" : "="}
                        {" · "}{copy.savedProgress}: {comparison.evidenceStateChanged ? "Δ" : "="}
                      </p>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              {notice ? (
                <p className="flex items-center gap-1 text-sm text-success">
                  <CheckCircle2 className="size-4" /> {notice}
                </p>
              ) : null}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" disabled={busy != null} onClick={() => setOpen(false)}>
                  {copy.close}
                </Button>
                {canManage ? (
                  <Button
                    variant="secondary"
                    disabled={!dirty || busy != null || reviewNeedsSubmission}
                    onClick={() => void save()}
                  >
                    {busy === "save" ? <Loader2 className="animate-spin" /> : null}
                    {busy === "save" ? copy.saving : copy.save}
                  </Button>
                ) : null}
                {canManage && step > 0 ? (
                  <Button variant="ghost" disabled={busy != null} onClick={() => setStep(step - 1)}>
                    {copy.previous}
                  </Button>
                ) : null}
                {canManage && step < 3 ? (
                  <Button disabled={busy != null} onClick={() => setStep(step + 1)}>
                    {copy.next}
                  </Button>
                ) : canManage && step === 3 ? (
                  <Button
                    disabled={dirty || !workbench.progress.readyForCollection || busy != null}
                    onClick={() => void collect()}
                  >
                    {busy === "collect" ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                    {busy === "collect" ? copy.collecting : copy.collect}
                  </Button>
                ) : null}
              </div>
            </div>
          )}
      </Modal>
    </>
  );
}
