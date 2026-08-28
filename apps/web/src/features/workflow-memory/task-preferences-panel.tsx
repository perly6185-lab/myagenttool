import { useEffect, useState } from "react";
import { BrainCircuit, Loader2, PencilLine, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

export type TaskRoutingPreference = {
  id: string;
  projectId: string;
  workItemId: string;
  workItem: { id: string; localRef: string; title: string } | null;
  intentTerms: string[];
  rejectedOutput: string | null;
  selectedOutput: string;
  reason: string;
  createdAt: string;
  state?: "active" | "conflict";
  conflictingOutputs?: string[];
};

type PreferenceResolution = "keep_plan" | "prefer_actual";

export type TaskExecutionPreference = {
  id: string;
  projectId: string;
  workItemId: string;
  workItem: { id: string; localRef: string; title: string } | null;
  planActualDigest: string;
  intentTerms: string[];
  decisions: Array<{
    code: string;
    scope: string;
    correctionTarget: "template" | "result" | "materials" | "delivery" | "scope" | "verification" | null;
    resolution: PreferenceResolution;
    preferredValue: string;
    requiresConfirmation: boolean;
    options: Array<{ resolution: PreferenceResolution; preferredValue: string }>;
  }>;
  note: string;
  revision: number;
  editable: boolean;
  editUnavailableReason: string | null;
  updatedAt: string;
};

const TARGET_LABELS: Record<string, string> = {
  template: "结果类型",
  result: "结果文件",
  materials: "资料版本",
  delivery: "交付位置",
  scope: "读写范围",
  verification: "检查要求",
};

function preferenceValue(value: string) {
  return ({
    confirmed_snapshot: "已确认的资料版本",
    latest_at_start: "执行时的最新版",
    task: "留在任务中",
    channel: "发送到 Channel",
    read_only: "只读",
    write: "允许修改（仍需确认）",
    required: "必须完成检查",
  } as Record<string, string>)[value] ?? value;
}

function executionSummary(preference: TaskExecutionPreference) {
  return preference.decisions.map((decision) => {
    const target = TARGET_LABELS[decision.correctionTarget ?? ""] ?? "执行方式";
    const action = decision.resolution === "keep_plan" ? "仍按原计划" : "接受本次实际做法";
    return `${target}：${action}“${preferenceValue(decision.preferredValue)}”`;
  });
}

export function TaskPreferencesPanel({
  projects,
  routingPreferences,
  executionPreferences,
  loading,
  error,
  onRemoveRouting,
  onUpdateExecution,
  onRemoveExecution,
}: {
  projects: Array<{ id: string; name: string }>;
  routingPreferences: TaskRoutingPreference[];
  executionPreferences: TaskExecutionPreference[];
  loading: boolean;
  error: boolean;
  onRemoveRouting: (preference: TaskRoutingPreference) => Promise<void>;
  onUpdateExecution: (preference: TaskExecutionPreference, input: {
    decisions: Array<{ code: string; resolution: PreferenceResolution }>;
    note: string;
  }) => Promise<void>;
  onRemoveExecution: (preference: TaskExecutionPreference) => Promise<void>;
}) {
  const [routingToRemove, setRoutingToRemove] = useState<TaskRoutingPreference | null>(null);
  const [executionToRemove, setExecutionToRemove] = useState<TaskExecutionPreference | null>(null);
  const [executionToEdit, setExecutionToEdit] = useState<TaskExecutionPreference | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, PreferenceResolution>>({});
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const total = routingPreferences.length + executionPreferences.length;

  useEffect(() => {
    if (!executionToEdit) return;
    setResolutions(Object.fromEntries(executionToEdit.decisions.map((decision) => [decision.code, decision.resolution])));
    setNote(executionToEdit.note);
    setActionError(null);
  }, [executionToEdit]);

  const projectName = (projectId: string) => projects.find((project) => project.id === projectId)?.name ?? "当前项目";
  const closeModals = () => {
    if (pending) return;
    setRoutingToRemove(null);
    setExecutionToRemove(null);
    setExecutionToEdit(null);
    setActionError(null);
  };
  const removeRouting = async () => {
    if (!routingToRemove || pending) return;
    setPending(true);
    setActionError(null);
    try {
      await onRemoveRouting(routingToRemove);
      setRoutingToRemove(null);
    } catch {
      setActionError("暂时无法撤销，请刷新后重试。");
    } finally {
      setPending(false);
    }
  };
  const removeExecution = async () => {
    if (!executionToRemove || pending) return;
    setPending(true);
    setActionError(null);
    try {
      await onRemoveExecution(executionToRemove);
      setExecutionToRemove(null);
    } catch {
      setActionError("暂时无法撤销，请刷新后重试。");
    } finally {
      setPending(false);
    }
  };
  const updateExecution = async () => {
    if (!executionToEdit || pending) return;
    setPending(true);
    setActionError(null);
    try {
      await onUpdateExecution(executionToEdit, {
        decisions: executionToEdit.decisions.map((decision) => ({
          code: decision.code,
          resolution: resolutions[decision.code] ?? decision.resolution,
        })),
        note,
      });
      setExecutionToEdit(null);
    } catch {
      setActionError("这条偏好可能刚被修改，或执行依据已变化。请刷新后再试。");
    } finally {
      setPending(false);
    }
  };

  return (
    <section aria-labelledby="task-preferences-heading">
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <BrainCircuit className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <h2 id="task-preferences-heading" className="font-semibold">我的任务偏好</h2>
                <p className="mt-1 text-sm text-muted-foreground">查看系统从你的纠正中记住了什么。修改或撤销只影响以后相似任务，不改变历史记录。</p>
              </div>
            </div>
            <Badge tone="neutral">{total} 条</Badge>
          </div>

          {loading ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />正在读取…</p>
          ) : error ? (
            <p className="mt-4 text-sm text-destructive" role="alert">暂时无法读取任务偏好。</p>
          ) : total ? (
            <ul className="mt-4 divide-y rounded-lg border" aria-labelledby="task-preferences-heading">
              {executionPreferences.map((preference) => (
                <li key={`execution-${preference.id}`} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><Badge tone="neutral">执行纠正</Badge>{preference.editable ? <Badge tone="success">可修改</Badge> : <Badge tone="neutral">仅可撤销</Badge>}</div>
                    {executionSummary(preference).map((summary, index) => <p key={`${preference.id}-${index}`} className="mt-1 text-sm font-medium">{summary}</p>)}
                    {preference.note ? <p className="mt-1 text-xs text-muted-foreground">说明：{preference.note}</p> : null}
                    <p className="mt-1 text-xs text-muted-foreground">{projectName(preference.projectId)}{preference.workItem ? ` · 来自 ${preference.workItem.localRef} ${preference.workItem.title}` : ""}</p>
                    {!preference.editable ? <p className="mt-1 text-xs text-muted-foreground">原执行依据已不可用，不能安全改成另一个选择；仍可撤销这条偏好。</p> : null}
                  </div>
                  <div className="flex gap-2">
                    {preference.editable ? <Button size="sm" variant="ghost" onClick={() => setExecutionToEdit(preference)}><PencilLine />修改</Button> : null}
                    <Button size="sm" variant="ghost" onClick={() => { setActionError(null); setExecutionToRemove(preference); }}><Trash2 />撤销</Button>
                  </div>
                </li>
              ))}
              {routingPreferences.map((preference) => {
                const subject = preference.intentTerms.length ? `任务提到“${preference.intentTerms.join("、")}”时` : "遇到相似任务时";
                return (
                  <li key={`routing-${preference.id}`} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><Badge tone="neutral">结果选择</Badge>{preference.state === "conflict" ? <Badge tone="warning">下次先确认</Badge> : <Badge tone="success">正在使用</Badge>}</div>
                      <p className="mt-1 text-sm"><span className="font-medium">{subject}</span>，优先得到“{preference.selectedOutput}”{preference.rejectedOutput ? `，而不是“${preference.rejectedOutput}”` : "（由你确认）"}。</p>
                      <p className="mt-1 text-xs text-muted-foreground">{projectName(preference.projectId)}{preference.workItem ? ` · 来自 ${preference.workItem.localRef} ${preference.workItem.title}` : ""}</p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => { setActionError(null); setRoutingToRemove(preference); }}><Trash2 />撤销</Button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-4 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">还没有任务偏好。完成任务后，如果你纠正结果或执行方式，系统会把选择放在这里供你管理。</p>
          )}
        </CardContent>
      </Card>

      <Modal open={Boolean(executionToEdit)} onClose={closeModals} title="修改任务偏好" description="新的选择只用于以后相似任务，本次执行记录不会改变。" closeDisabled={pending} footer={<div className="flex justify-end gap-2"><Button variant="secondary" disabled={pending} onClick={closeModals}>取消</Button><Button disabled={pending} onClick={() => { void updateExecution(); }}>{pending ? <Loader2 className="animate-spin" /> : null}保存修改</Button></div>}>
        {executionToEdit ? <div className="space-y-3 text-sm">
          {executionToEdit.decisions.map((decision) => <label key={decision.code} className="grid gap-1.5"><span className="font-medium">{TARGET_LABELS[decision.correctionTarget ?? ""] ?? "执行方式"}</span><Select value={resolutions[decision.code] ?? decision.resolution} onChange={(event) => setResolutions((current) => ({ ...current, [decision.code]: event.target.value as PreferenceResolution }))}>{decision.options.map((option) => <option key={option.resolution} value={option.resolution}>{option.resolution === "keep_plan" ? "仍按原计划" : "接受本次实际做法"}：{preferenceValue(option.preferredValue)}</option>)}</Select></label>)}
          <label className="grid gap-1.5"><span className="font-medium">补充说明（可选）</span><Textarea maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
          {actionError ? <p className="text-destructive" role="alert">{actionError}</p> : null}
        </div> : null}
      </Modal>

      <Modal open={Boolean(routingToRemove || executionToRemove)} onClose={closeModals} title="撤销这条任务偏好？" description="撤销后，系统不再用它判断未来任务。已经创建或执行的任务不会改变。" closeDisabled={pending} footer={<div className="flex justify-end gap-2"><Button variant="secondary" disabled={pending} onClick={closeModals}>取消</Button><Button variant="destructive" disabled={pending} onClick={() => { void (routingToRemove ? removeRouting() : removeExecution()); }}>{pending ? <Loader2 className="animate-spin" /> : <Trash2 />}确认撤销</Button></div>}>
        <div className="space-y-3 text-sm">
          {routingToRemove ? <p>系统将不再优先得到“{routingToRemove.selectedOutput}”。</p> : null}
          {executionToRemove ? executionSummary(executionToRemove).map((summary, index) => <p key={`${executionToRemove.id}-${index}`}>{summary}</p>) : null}
          {actionError ? <p className="text-destructive" role="alert">{actionError}</p> : null}
        </div>
      </Modal>
    </section>
  );
}
