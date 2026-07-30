import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileSearch,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  workflowMemoryApi,
  type InquiryIntakeInspection,
  type WorkflowIntakeObservation,
} from "@/features/workflow-memory/workflow-memory-api";
import { RealCaseIntakeDialog } from "@/features/workflow-memory/real-case-intake-dialog";
import { ApiError, type BusinessFieldProposal, type WorkflowSource } from "@/lib/api-client";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

const FIELD_LABELS = {
  customer: { en: "Customer", zh: "客户" },
  product: { en: "Product or service", zh: "产品或服务" },
  quantity: { en: "Quantity", zh: "数量" },
  unit_price: { en: "Unit price", zh: "单价" },
  currency: { en: "Currency", zh: "币种" },
  tax_rate: { en: "Tax rate", zh: "税率" },
  delivery_terms: { en: "Delivery terms", zh: "交付条款" },
  amount: { en: "Amount", zh: "金额" },
  document_date: { en: "Document date", zh: "单据日期" },
  inquiry_number: { en: "Inquiry number", zh: "询价编号" },
  quotation_number: { en: "Quotation number", zh: "报价编号" },
  order_number: { en: "Order number", zh: "订单编号" },
} as const;

const COPY = {
  en: {
    title: "New inquiry intake",
    hint: "Check this folder for stable new inquiry files. Nothing is turned into a task until you confirm it.",
    check: "Check for new inquiries",
    checking: "Checking files…",
    baseline: "Run the first folder scan before checking for new inquiries.",
    textAccess: "This feature needs “Read supported text files” access.",
    empty: "No new inquiry files are waiting.",
    review: "Review inquiry",
    reviewTitle: "Confirm the new inquiry",
    reviewDescription: "Check the detected facts and choose the routine. Confirming creates one local task.",
    detectedType: "Detected type",
    inquiry: "Inquiry",
    routine: "Routine",
    sourceFile: "Source file",
    evidence: "Values are proposed from this local file. Edit anything that is incorrect.",
    confirm: "Confirm and create inquiry task",
    cancel: "Cancel",
    waiting: "Still being written",
    waitingHint: "The file will be checked again when it stops changing.",
    ready: "Ready to review",
    duplicate: "Duplicate",
    duplicateHint: "The same content is already known; no second task will be created.",
    needsReview: "Needs attention",
    identityConflict: "This inquiry number already belongs to different source evidence. Review it manually.",
    textRequired: "Text access is required before this file can be reviewed.",
    blocked: "Cannot process",
    triggered: "Task created",
    openTask: "Open task",
    createdWith: "Created with",
    supportingFiles: "Supporting files",
    missingInquiryNumber: "Add an inquiry number before creating the task.",
    noRoutine: "Publish an inquiry routine before processing new files.",
    needsOcr: "This file has no readable text layer yet. Run OCR or choose another primary inquiry.",
    genericError: "The inquiry could not be processed.",
  },
  zh: {
    title: "新询价接收",
    hint: "检查目录中已写完的新询价文件。只有经你确认后，才会生成任务。",
    check: "检查新询价",
    checking: "正在检查文件…",
    baseline: "请先完成一次目录扫描，再检查新询价。",
    textAccess: "此功能需要“读取支持的文本文件”权限。",
    empty: "当前没有待处理的新询价。",
    review: "查看询价",
    reviewTitle: "确认新询价",
    reviewDescription: "核对识别结果并选择工作流。确认后只会创建一个本地任务。",
    detectedType: "识别类型",
    inquiry: "询价单",
    routine: "工作流",
    sourceFile: "来源文件",
    evidence: "以下信息来自该本地文件；识别不准确时可直接修改。",
    confirm: "确认并创建询价任务",
    cancel: "取消",
    waiting: "文件仍在写入",
    waitingHint: "文件停止变化后会再次检查。",
    ready: "可以确认",
    duplicate: "重复文件",
    duplicateHint: "相同内容已处理，不会重复创建任务。",
    needsReview: "需要处理",
    identityConflict: "该询价编号已对应另一份来源材料，请人工核对。",
    textRequired: "需先允许读取文本，才能检查该文件。",
    blocked: "暂时无法处理",
    triggered: "任务已创建",
    openTask: "打开任务",
    createdWith: "使用工作流",
    supportingFiles: "参考资料",
    missingInquiryNumber: "请补充询价编号后再创建任务。",
    noRoutine: "请先发布一个询价工作流。",
    needsOcr: "该文件目前没有可读取的文字层。请先运行 OCR，或选择其他资料作为主询价。",
    genericError: "询价处理失败。",
  },
} as const;

type IntakeCopy = { [Key in keyof typeof COPY.en]: string };

function newRequestKey(observationId: string) {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `inquiry-intake:${observationId}:${suffix}`;
}

function statusFor(observation: WorkflowIntakeObservation, copy: IntakeCopy) {
  if (["observing", "waiting_stable"].includes(observation.state)) {
    return { label: copy.waiting, tone: "warning" as const, detail: copy.waitingHint };
  }
  if (observation.state === "duplicate") {
    return { label: copy.duplicate, tone: "neutral" as const, detail: copy.duplicateHint };
  }
  if (observation.state === "triggered") {
    return { label: copy.triggered, tone: "success" as const, detail: null };
  }
  if (observation.state === "ready") {
    return { label: copy.ready, tone: "success" as const, detail: null };
  }
  if (observation.reason === "workflow_intake_business_identity_conflict") {
    return { label: copy.needsReview, tone: "warning" as const, detail: copy.identityConflict };
  }
  if (observation.reason === "workflow_intake_text_access_required") {
    return { label: copy.needsReview, tone: "warning" as const, detail: copy.textRequired };
  }
  return { label: copy.blocked, tone: "warning" as const, detail: observation.reason };
}

export function InquiryIntakePanel({
  source,
  onOpenTask,
}: {
  source: WorkflowSource;
  onOpenTask: (workItemId: string) => void;
}) {
  const { i18n } = useAppTranslation();
  const language = i18n.resolvedLanguage?.startsWith("zh") ? "zh" : "en";
  const copy = COPY[language];
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<"scan" | "inspect" | "accept" | null>(null);
  const [inspection, setInspection] = useState<InquiryIntakeInspection | null>(null);
  const [routineDefinitionId, setRoutineDefinitionId] = useState("");
  const [fieldDrafts, setFieldDrafts] = useState<Record<string, string>>({});
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [supportingObservationIds, setSupportingObservationIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const observationsQuery = useQuery({
    queryKey: ["workflow-memory", "intake-observations", source.id],
    queryFn: () => workflowMemoryApi.listWorkflowIntakeObservations(source.id),
    enabled: Boolean(source.id),
  });
  const observations = observationsQuery.data?.observations ?? [];

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["workflow-memory", "intake-observations", source.id] }),
    queryClient.invalidateQueries({ queryKey: ["workflow-memory", "sources"] }),
  ]);

  const errorText = (caught: unknown) => {
    if (!(caught instanceof ApiError)) return caught instanceof Error ? caught.message : copy.genericError;
    if (caught.code === "workflow_intake_baseline_required") return copy.baseline;
    if (caught.code === "workflow_intake_text_access_required") return copy.textAccess;
    if (caught.code === "workflow_intake_business_identity_required") return copy.missingInquiryNumber;
    if (caught.code === "workflow_intake_routine_not_available") return copy.noRoutine;
    if (caught.code === "workflow_business_analysis_needs_ocr"
      || caught.code === "workflow_business_analysis_content_unavailable") return copy.needsOcr;
    if (caught.code === "workflow_intake_business_identity_conflict") return copy.identityConflict;
    return caught.message || copy.genericError;
  };

  const check = async () => {
    setPending("scan");
    setError(null);
    try {
      const first = await workflowMemoryApi.scanWorkflowIncrementalIntake(source.id);
      if (first.intake.waitingStable > 0) {
        await new Promise((resolve) => globalThis.setTimeout(resolve, 2_100));
        await workflowMemoryApi.scanWorkflowIncrementalIntake(source.id);
      }
      await refresh();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPending(null);
    }
  };

  const inspect = async (
    observation: WorkflowIntakeObservation,
    supportingIds: string[] = [],
  ) => {
    setPending("inspect");
    setError(null);
    try {
      const result = await workflowMemoryApi.inspectWorkflowInquiryIntake(observation.id, supportingIds);
      if (result.state === "triggered") {
        await refresh();
        return;
      }
      setInspection(result);
      setSupportingObservationIds(supportingIds);
      setRoutineDefinitionId(result.routines[0]?.id ?? "");
      setFieldDrafts(Object.fromEntries(result.classification.fieldProposals.map((field) => [
        field.key,
        String(field.normalizedValue ?? field.value ?? ""),
      ])));
      setIdempotencyKey(newRequestKey(observation.id));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPending(null);
    }
  };

  const accept = async () => {
    if (!inspection || !routineDefinitionId) return;
    setPending("accept");
    setError(null);
    try {
      const original = new Map<string, string>(inspection.classification.fieldProposals.map((field) => [
        field.key,
        String(field.normalizedValue ?? field.value ?? ""),
      ]));
      const fieldCorrections = Object.fromEntries(Object.entries(fieldDrafts)
        .filter(([key, value]) => value.trim() && value.trim() !== original.get(key))
        .map(([key, value]) => [key, value.trim()])) as Partial<Record<BusinessFieldProposal["key"], string>>;
      await workflowMemoryApi.acceptWorkflowInquiryIntake(inspection.observation.id, {
        expectedRevision: inspection.observation.revision,
        idempotencyKey,
        routineDefinitionId,
        confirmed: true,
        fieldCorrections,
        supportingObservationIds,
      });
      setInspection(null);
      setSupportingObservationIds([]);
      await refresh();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPending(null);
    }
  };

  return (
    <Card>
      <CardHeader className="gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-base">{copy.title}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{copy.hint}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <RealCaseIntakeDialog
            source={source}
            onPrepared={async (primaryId, supportingIds) => {
              const observation = (await workflowMemoryApi.listWorkflowIntakeObservations(source.id))
                .observations.find((row) => row.id === primaryId);
              if (!observation) throw new Error(copy.genericError);
              await inspect(observation, supportingIds);
            }}
          />
          <Button
            size="sm"
            disabled={pending !== null || source.state !== "active" || source.readMode !== "supported_text"}
            onClick={() => void check()}
          >
            {pending === "scan" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {pending === "scan" ? copy.checking : copy.check}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {source.readMode !== "supported_text" ? (
          <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            {copy.textAccess}
          </p>
        ) : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div aria-live="polite" className="space-y-2">
          {!observationsQuery.isLoading && observations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{copy.empty}</p>
          ) : observations.map((observation) => {
            const status = statusFor(observation, copy);
            return (
              <div
                key={observation.id}
                className="grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {observation.state === "triggered"
                      ? <CheckCircle2 className="size-4 text-success" />
                      : ["observing", "waiting_stable"].includes(observation.state)
                        ? <Clock3 className="size-4 text-warning" />
                        : <FileSearch className="size-4 text-muted-foreground" />}
                    <p className="truncate text-sm font-medium">{observation.name}</p>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                  <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                    {observation.relativePath}
                  </p>
                  {status.detail ? <p className="mt-1 text-xs text-muted-foreground">{status.detail}</p> : null}
                  {observation.receipt ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {observation.receipt.businessKey} · {copy.createdWith} v{observation.receipt.routineVersion}
                    </p>
                  ) : null}
                </div>
                {observation.state === "ready" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending !== null}
                    onClick={() => void inspect(observation)}
                  >
                    {pending === "inspect" ? <Loader2 className="animate-spin" /> : <FileSearch />}
                    {copy.review}
                  </Button>
                ) : observation.state === "triggered" && observation.receipt?.workItemId ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onOpenTask(observation.receipt!.workItemId)}
                  >
                    {copy.openTask}
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      </CardContent>

      <Modal
        open={Boolean(inspection)}
        onClose={() => {
          setInspection(null);
          setSupportingObservationIds([]);
        }}
        title={copy.reviewTitle}
        description={copy.reviewDescription}
        closeDisabled={pending === "accept"}
        size="lg"
      >
        {inspection ? (
          <div className="space-y-4">
            <dl className="grid gap-2 rounded-md bg-muted/50 p-3 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
              <dt className="text-muted-foreground">{copy.sourceFile}</dt>
              <dd className="break-all font-mono text-xs">{inspection.observation.relativePath}</dd>
              <dt className="text-muted-foreground">{copy.detectedType}</dt>
              <dd>{copy.inquiry}</dd>
            </dl>
            <p className="text-xs text-muted-foreground">{copy.evidence}</p>
            {(inspection.observation.supportingObservations ?? []).length ? (
              <div className="rounded-md border p-3">
                <p className="text-xs font-medium">{copy.supportingFiles}</p>
                <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                  {(inspection.observation.supportingObservations ?? []).map((item) => (
                    <li key={item.id}>{item.name} · {item.extractionState}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              {inspection.classification.fieldProposals.map((field) => (
                <label key={field.key} className="block min-w-0 space-y-1 text-xs font-medium">
                  <span>{FIELD_LABELS[field.key]?.[language] ?? field.key}</span>
                  <Input
                    id={`inquiry-intake-${field.key}`}
                    value={fieldDrafts[field.key] ?? ""}
                    onChange={(event) => setFieldDrafts((current) => ({
                      ...current,
                      [field.key]: event.target.value,
                    }))}
                  />
                </label>
              ))}
              {!inspection.classification.fieldProposals.some((field) => field.key === "inquiry_number") ? (
                <label className="block min-w-0 space-y-1 text-xs font-medium">
                  <span>{FIELD_LABELS.inquiry_number[language]}</span>
                  <Input
                    id="inquiry-intake-inquiry_number"
                    value={fieldDrafts.inquiry_number ?? ""}
                    onChange={(event) => setFieldDrafts((current) => ({
                      ...current,
                      inquiry_number: event.target.value,
                    }))}
                  />
                </label>
              ) : null}
            </div>
            <label className="block space-y-1 text-sm font-medium">
              <span>{copy.routine}</span>
              <Select
                value={routineDefinitionId}
                onChange={(event) => setRoutineDefinitionId(event.target.value)}
              >
                {inspection.routines.map((routine) => (
                  <option key={routine.id} value={routine.id}>
                    {routine.name} · v{routine.version}
                  </option>
                ))}
              </Select>
            </label>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" disabled={pending === "accept"} onClick={() => setInspection(null)}>
                {copy.cancel}
              </Button>
              <Button
                disabled={pending === "accept" || !routineDefinitionId || !fieldDrafts.inquiry_number?.trim()}
                onClick={() => void accept()}
              >
                {pending === "accept" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                {copy.confirm}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </Card>
  );
}
