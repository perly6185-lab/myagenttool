import { useMemo, useState } from "react";
import { AlertTriangle, FilePlus2, Loader2, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  workflowMemoryApi,
  type WorkflowIntakeObservation,
} from "@/features/workflow-memory/workflow-memory-api";
import type { WorkflowSource } from "@/lib/api-client";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

type PickedCase = {
  selectionId: string;
  files: Array<{
    name: string;
    extension: string;
    size: number;
    readiness: "ready" | "inspect" | "needs_ocr";
  }>;
};

type StagedCase = {
  primaryRelativePath: string;
  supportingRelativePaths: string[];
  supportingFileRoles: Record<string, SupportingRole>;
};

export type SupportingRole = "reference" | "historical_output";

const COPY = {
  en: {
    add: "Add real case",
    title: "Add one real business case",
    description: "Choose related files or paste text. Select one primary inquiry, then identify references and historical outputs.",
    choose: "Choose files",
    chooseAgain: "Choose again",
    paste: "Or paste inquiry text",
    pastePlaceholder: "Paste an email or message containing the inquiry…",
    caseName: "Case label",
    caseNamePlaceholder: "e.g. RFQ 2026-101",
    primary: "Primary inquiry",
    reference: "Reference",
    historicalOutput: "Historical output",
    ready: "Ready",
    inspect: "Check PDF text",
    needsOcr: "Needs OCR",
    authorization: "Data handling",
    authorized: "Authorized real data",
    deidentified: "De-identified data",
    confirm: "I confirm I may use these files in this local workflow.",
    stage: "Add and review",
    staging: "Adding case…",
    retryReview: "Retry review",
    cancel: "Cancel",
    desktopOnly: "Adding local files is available in the desktop app.",
    selectPrimary: "Choose one primary inquiry that can be read as text.",
    empty: "Choose at least one file or paste some text.",
    genericError: "The case could not be added.",
    textItem: "Pasted text",
  },
  zh: {
    add: "添加真实案例",
    title: "添加一个真实业务案例",
    description: "选择相关文件或粘贴文字。指定一份主询价，再标记其余资料是参考文件还是历史交付物。",
    choose: "选择文件",
    chooseAgain: "重新选择",
    paste: "或者粘贴询价文字",
    pastePlaceholder: "粘贴邮件、聊天消息或其他询价文字……",
    caseName: "案例名称",
    caseNamePlaceholder: "例如：RFQ 2026-101",
    primary: "主询价",
    reference: "参考资料",
    historicalOutput: "历史交付物",
    ready: "可以处理",
    inspect: "需检查 PDF 文字",
    needsOcr: "需要 OCR",
    authorization: "资料类型",
    authorized: "已授权真实资料",
    deidentified: "已脱敏资料",
    confirm: "我确认有权将这些资料用于本地工作流。",
    stage: "添加并检查",
    staging: "正在添加案例……",
    retryReview: "重试检查",
    cancel: "取消",
    desktopOnly: "添加本地文件需要使用桌面应用。",
    selectPrimary: "请选择一份能够读取文字的资料作为主询价。",
    empty: "请至少选择一个文件或粘贴一段文字。",
    genericError: "无法添加该案例。",
    textItem: "粘贴的文字",
  },
} as const;

function requestId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function RealCaseIntakeDialog({
  source,
  onPrepared,
}: {
  source: WorkflowSource;
  onPrepared: (
    primaryObservationId: string,
    supporting: Array<{ observationId: string; role: SupportingRole }>,
  ) => Promise<void>;
}) {
  const { i18n } = useAppTranslation();
  const copy = COPY[i18n.resolvedLanguage?.startsWith("zh") ? "zh" : "en"];
  const bridge = window.myagenttoolDesktop;
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<PickedCase | null>(null);
  const [pastedText, setPastedText] = useState("");
  const [primaryKey, setPrimaryKey] = useState("");
  const [supportingRoles, setSupportingRoles] = useState<Record<string, SupportingRole>>({});
  const [caseName, setCaseName] = useState("");
  const [authorizationMode, setAuthorizationMode] = useState<"authorized" | "deidentified">("deidentified");
  const [confirmed, setConfirmed] = useState(false);
  const [stagedCase, setStagedCase] = useState<StagedCase | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = useMemo(() => [
    ...(selection?.files.map((file, index) => ({ ...file, key: `file:${index}` })) ?? []),
    ...(pastedText.trim() ? [{
      key: "text",
      name: copy.textItem,
      extension: "txt",
      size: new TextEncoder().encode(pastedText).length,
      readiness: "ready" as const,
    }] : []),
  ], [copy.textItem, pastedText, selection]);

  const reset = () => {
    setSelection(null);
    setPastedText("");
    setPrimaryKey("");
    setSupportingRoles({});
    setCaseName("");
    setAuthorizationMode("deidentified");
    setConfirmed(false);
    setStagedCase(null);
    setError(null);
  };

  const chooseFiles = async () => {
    if (!bridge?.pickWorkflowCaseFiles) return;
    setError(null);
    try {
      const result = await bridge.pickWorkflowCaseFiles();
      if (!result) return;
      setSelection(result);
      const firstReadable = result.files.findIndex((file) => file.readiness !== "needs_ocr");
      if (result.files.length) setPrimaryKey(`file:${firstReadable >= 0 ? firstReadable : 0}`);
      setSupportingRoles(Object.fromEntries(result.files.map((file, index) => [
        `file:${index}`,
        file.extension === "xlsx" && /(?:汇总|台账|结果|交付|output|summary|ledger)/i.test(file.name)
          ? "historical_output"
          : "reference",
      ])));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.genericError);
    }
  };

  const addCase = async () => {
    if (!bridge?.stageWorkflowCase) return;
    if (!items.length) {
      setError(copy.empty);
      return;
    }
    const primary = items.find((item) => item.key === primaryKey);
    if (!primary) {
      setError(copy.selectPrimary);
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (source.scanRevision < 1) await workflowMemoryApi.scanWorkflowSource(source.id);
      const staged = stagedCase ?? await bridge.stageWorkflowCase({
        requestId: requestId(),
        sourceId: source.id,
        ...(selection ? { selectionId: selection.selectionId } : {}),
        ...(pastedText.trim() ? { pastedText } : {}),
        primaryKey,
        caseName: caseName.trim() || undefined,
        authorizationMode,
        supportingRoles: Object.fromEntries(items
          .filter((item) => item.key !== primaryKey)
          .map((item) => [item.key, supportingRoles[item.key] ?? "reference"])),
        confirmed: true,
      });
      setStagedCase(staged);
      const first = await workflowMemoryApi.scanWorkflowIncrementalIntake(source.id);
      let observed = first.observations;
      if (first.intake.waitingStable > 0) {
        await new Promise((resolve) => globalThis.setTimeout(resolve, 2_100));
        observed = (await workflowMemoryApi.scanWorkflowIncrementalIntake(source.id)).observations;
      }
      const byPath = new Map<string, WorkflowIntakeObservation>(
        observed.map((observation) => [observation.relativePath, observation]),
      );
      const primaryObservation = byPath.get(staged.primaryRelativePath);
      const supporting = staged.supportingRelativePaths
        .map((path) => byPath.get(path))
        .filter((observation): observation is WorkflowIntakeObservation =>
          Boolean(observation && ["ready", "needs_review"].includes(observation.state)));
      if (!primaryObservation || !["ready", "needs_review"].includes(primaryObservation.state)) {
        throw new Error(primaryObservation?.reason || copy.genericError);
      }
      await onPrepared(primaryObservation.id, supporting.map((observation) => ({
        observationId: observation.id,
        role: staged.supportingFileRoles?.[observation.relativePath] ?? "reference",
      })));
      setOpen(false);
      reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.genericError);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        disabled={!bridge?.stageWorkflowCase || source.state !== "active" || source.readMode !== "supported_text"}
        title={!bridge?.stageWorkflowCase ? copy.desktopOnly : undefined}
        onClick={() => setOpen(true)}
      >
        <FilePlus2 />
        {copy.add}
      </Button>
      <Modal
        open={open}
        onClose={() => {
          if (pending) return;
          setOpen(false);
          reset();
        }}
        title={copy.title}
        description={copy.description}
        closeDisabled={pending}
        size="lg"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={pending || Boolean(stagedCase)}
              onClick={() => void chooseFiles()}
            >
              <FilePlus2 />
              {selection ? copy.chooseAgain : copy.choose}
            </Button>
            {!bridge?.pickWorkflowCaseFiles ? (
              <span className="text-xs text-warning">{copy.desktopOnly}</span>
            ) : null}
          </div>

          <label className="block space-y-1 text-sm font-medium">
            <span>{copy.paste}</span>
            <Textarea
              value={pastedText}
              maxLength={96 * 1024}
              placeholder={copy.pastePlaceholder}
              disabled={pending || Boolean(stagedCase)}
              onChange={(event) => {
                setPastedText(event.target.value);
                if (!primaryKey && event.target.value.trim()) setPrimaryKey("text");
              }}
            />
          </label>

          {items.length ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{copy.primary}</legend>
              {items.map((item) => (
                <div
                  key={item.key}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border p-3"
                >
                  <input
                    type="radio"
                    name="primary-case-file"
                    value={item.key}
                    checked={primaryKey === item.key}
                    disabled={pending || Boolean(stagedCase)}
                    aria-label={`${copy.primary}: ${item.name}`}
                    onChange={() => setPrimaryKey(item.key)}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{item.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {primaryKey === item.key
                        ? copy.primary
                        : supportingRoles[item.key] === "historical_output"
                          ? copy.historicalOutput
                          : copy.reference}
                      {" · "}{item.extension.toUpperCase()}
                    </span>
                  </span>
                  <div className="flex items-center gap-2">
                    {primaryKey !== item.key ? (
                      <Select
                        aria-label={`${item.name} role`}
                        value={supportingRoles[item.key] ?? "reference"}
                        disabled={pending || Boolean(stagedCase)}
                        onChange={(event) => setSupportingRoles((current) => ({
                          ...current,
                          [item.key]: event.target.value as SupportingRole,
                        }))}
                      >
                        <option value="reference">{copy.reference}</option>
                        <option value="historical_output">{copy.historicalOutput}</option>
                      </Select>
                    ) : null}
                    <Badge tone={item.readiness === "ready" ? "success" : "warning"}>
                      {item.readiness === "ready"
                        ? copy.ready
                        : item.readiness === "inspect"
                          ? copy.inspect
                          : copy.needsOcr}
                    </Badge>
                  </div>
                </div>
              ))}
            </fieldset>
          ) : null}

          <label className="block space-y-1 text-sm font-medium">
            <span>{copy.caseName}</span>
            <Input
              value={caseName}
              maxLength={60}
              placeholder={copy.caseNamePlaceholder}
              disabled={pending || Boolean(stagedCase)}
              onChange={(event) => setCaseName(event.target.value)}
            />
          </label>
          <label className="block space-y-1 text-sm font-medium">
            <span>{copy.authorization}</span>
            <Select
              value={authorizationMode}
              disabled={pending || Boolean(stagedCase)}
              onChange={(event) => setAuthorizationMode(event.target.value as "authorized" | "deidentified")}
            >
              <option value="deidentified">{copy.deidentified}</option>
              <option value="authorized">{copy.authorized}</option>
            </Select>
          </label>
          <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={confirmed}
              disabled={pending || Boolean(stagedCase)}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <ShieldCheck className="size-4 shrink-0 text-success" />
            <span>{copy.confirm}</span>
          </label>
          {error ? (
            <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              {copy.cancel}
            </Button>
            <Button
              disabled={pending || !confirmed || !items.length || !primaryKey}
              onClick={() => void addCase()}
            >
              {pending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
              {pending ? copy.staging : stagedCase ? copy.retryReview : copy.stage}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
