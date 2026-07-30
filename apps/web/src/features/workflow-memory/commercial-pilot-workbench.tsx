import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardCheck, Loader2, ShieldCheck } from "lucide-react";

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
  },
  zh: {
    title: "正式试运行",
    summary: "发布前集中准备经授权案例、独立审批与安全证据。",
    open: "打开试运行工作台",
    noProject: "请先选择项目，再准备正式试运行。",
    loading: "正在加载试运行证据…",
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
  },
} as const;

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
  return {
    pilotId: draft.pilotId,
    ...(draft.description ? { description: draft.description } : {}),
    dataClassification: draft.dataClassification,
    consent: { ...draft.consent, scope: draft.consent.scope ?? "" },
    releaseReview: { ...draft.releaseReview },
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

export function CommercialPilotWorkbench({ projectId }: { projectId: string }) {
  const { i18n } = useAppTranslation();
  const language = i18n.resolvedLanguage?.startsWith("zh") ? "zh" : "en";
  const copy = COPY[language];
  const sessionRole = useSessionRole();
  const canManage = ["owner", "admin"].includes(sessionRole);
  const reasonLabel = (reason: string) => {
    if (reason.startsWith("trait:")) {
      return language === "zh"
        ? `补充恢复场景：${reason.slice(6)}`
        : `Add recovery condition: ${reason.slice(6)}`;
    }
    if (reason.startsWith("safety:")) {
      return language === "zh"
        ? `补齐安全证据：${reason.slice(7)}`
        : `Add safety evidence: ${reason.slice(7)}`;
    }
    return REASONS[language][reason as keyof typeof REASONS[typeof language]]
      ?? reason.replaceAll("_", " ");
  };
  const queryClient = useQueryClient();
  const queryKey = ["workflow-memory", "commercial-pilot-workbench", projectId];
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CommercialPilotWorkbenchDraftInput | null>(null);
  const [baseRevision, setBaseRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "collect" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const workbenchQuery = useQuery({
    queryKey,
    queryFn: () => workflowMemoryApi.getBusinessPilotWorkbench(projectId),
    enabled: Boolean(projectId) && canManage,
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
    const next: CommercialPilotCaseDraft = {
      id: `case-${String(index).padStart(2, "0")}`,
      workItemId,
      templateId: index % 2 ? "default-a" : "default-b",
      traits: [],
      expectedDocumentRole: "inquiry",
      relationshipExpected: false,
      expectedOutcome: index % 2 ? "no_order" : "ordered",
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

  const latest = workbench?.draft.lastCollection;
  if (!canManage) return null;
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
          : workbenchQuery.isLoading || !workbench || !draft ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> {copy.loading}
            </p>
          ) : (
            <div className="space-y-5">
              <section className="grid gap-3 rounded-lg border p-3 md:grid-cols-2">
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
              </section>

              <section className="space-y-3">
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
                          {DOCUMENT_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
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
                          <option value="ordered">ordered</option>
                          <option value="no_order">no_order</option>
                          <option value="rejected">rejected</option>
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
                            {trait}
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
                  </div>
                ))}
              </section>

              <section className="space-y-3 rounded-lg border p-3">
                <h3 className="text-sm font-semibold">{copy.safety}</h3>
                <div className="grid gap-2 md:grid-cols-2">
                  {workbench.requiredSafetyScenarios.map((scenario) => {
                    const current = draft.safetyScenarios.find((row) => row.id === scenario);
                    const candidates = workbench.eligible.safetyEvidence
                      .filter((row) => row.id === scenario);
                    return (
                      <label key={scenario} className="space-y-1 text-xs">
                        <span>{scenario}</span>
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
                              {row.evidenceKind} · {row.evidenceId}
                            </option>
                          ))}
                        </Select>
                      </label>
                    );
                  })}
                </div>
              </section>

              <section className="space-y-3 rounded-lg border p-3">
                <h3 className="text-sm font-semibold">{copy.review}</h3>
                <label className="block space-y-1 text-xs">
                  <span>{copy.reviewer}</span>
                  <Input
                    value={draft.releaseReview.reviewerRole}
                    maxLength={80}
                    onChange={(event) => updateDraft((current) => ({
                      ...current,
                      releaseReview: {
                        ...current.releaseReview,
                        reviewerRole: event.target.value,
                      },
                    }))}
                  />
                </label>
                <div className="grid gap-2 md:grid-cols-2">
                  {REVIEW_DIMENSIONS.map((dimension) => (
                    <CheckRow
                      key={dimension}
                      checked={draft.releaseReview[dimension]}
                      onChange={(checked) => updateDraft((current) => ({
                        ...current,
                        releaseReview: {
                          ...current.releaseReview,
                          [dimension]: checked,
                          ...(!checked ? { confirmed: false, recordedAt: null } : {}),
                        },
                      }))}
                    >
                      {dimension}
                    </CheckRow>
                  ))}
                </div>
                <CheckRow
                  checked={draft.releaseReview.confirmed}
                  disabled={REVIEW_DIMENSIONS.some((key) => !draft.releaseReview[key])}
                  onChange={(confirmed) => updateDraft((current) => ({
                    ...current,
                    releaseReview: {
                      ...current.releaseReview,
                      confirmed,
                      recordedAt: confirmed ? new Date().toISOString() : null,
                    } as CommercialPilotReleaseReview,
                  }))}
                >
                  {copy.overallReview}
                </CheckRow>
              </section>

              <section className="space-y-3 rounded-lg border p-3">
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
                      {workbench.progress.outcomes.join(" · ") || "—"}
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
                    <Badge key={row.id} tone={row.complete ? "success" : "neutral"}>{row.id}</Badge>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border bg-muted/20 p-3">
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
              </section>

              {latest?.report.metrics ? (
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
                <Button variant="secondary" disabled={!dirty || busy != null} onClick={() => void save()}>
                  {busy === "save" ? <Loader2 className="animate-spin" /> : null}
                  {busy === "save" ? copy.saving : copy.save}
                </Button>
                <Button
                  disabled={dirty || !workbench.progress.readyForCollection || busy != null}
                  onClick={() => void collect()}
                >
                  {busy === "collect" ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                  {busy === "collect" ? copy.collecting : copy.collect}
                </Button>
              </div>
            </div>
          )}
      </Modal>
    </>
  );
}
