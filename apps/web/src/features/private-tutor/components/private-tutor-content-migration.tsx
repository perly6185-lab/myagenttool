import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  applyPrivateTutorContentMigration,
  confirmPrivateTutorContentMigration,
  createPrivateTutorContentMigrationPreview,
  listPrivateTutorContentMigrationCandidates,
  rollbackPrivateTutorContentMigration,
  updatePrivateTutorContentMigrationMapping,
  type PrivateTutorContentMigrationApplication,
  type PrivateTutorContentMigrationCandidate,
  type PrivateTutorContentMigrationPreview,
} from "@/features/private-tutor/private-tutor-api";

const relationLabels = { unchanged: "未变化", renamed: "仅改名", changed: "内容变化", split: "已拆分", merged: "已合并", removed: "已移除" } as const;
const decisionLabels = { transfer: "继承掌握证据", provisional: "仅保留线索，重新评估", archive: "归档，不迁移" } as const;

export function PrivateTutorContentMigration() {
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [candidates, setCandidates] = useState<PrivateTutorContentMigrationCandidate[]>([]);
  const [sourceKey, setSourceKey] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const [preview, setPreview] = useState<PrivateTutorContentMigrationPreview | null>(null);
  const [application, setApplication] = useState<PrivateTutorContentMigrationApplication | null>(null);
  const [historyAck, setHistoryAck] = useState(false);
  const [riskAck, setRiskAck] = useState(false);
  const [mappingDirty, setMappingDirty] = useState(false);
  const [targetKnowledgeOptions, setTargetKnowledgeOptions] = useState<Array<[string, string]>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!expanded || loaded) return undefined;
    let current = true;
    void listPrivateTutorContentMigrationCandidates().then((rows) => {
      if (!current) return;
      setCandidates(rows);
      setLoaded(true);
      const source = rows.find((row) => row.hasLearningState);
      const target = rows.find((row) => keyFor(row) !== (source ? keyFor(source) : ""));
      setSourceKey(source ? keyFor(source) : "");
      setTargetKey(target ? keyFor(target) : "");
    }).catch(() => current && setError("无法加载可迁移的内容版本。"));
    return () => { current = false; };
  }, [expanded, loaded]);

  const source = candidates.find((row) => keyFor(row) === sourceKey);
  const target = candidates.find((row) => keyFor(row) === targetKey);

  function acceptPreview(next: PrivateTutorContentMigrationPreview) {
    setPreview(next);
    setTargetKnowledgeOptions(knowledgeOptionsFor(next));
    setMappingDirty(false);
  }

  function resetMigration() {
    setPreview(null);
    setApplication(null);
    setTargetKnowledgeOptions([]);
    setMappingDirty(false);
    setHistoryAck(false);
    setRiskAck(false);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : "迁移操作失败，请重试。"); } finally { setBusy(false); }
  }

  function updateLocalMapping(sourceKnowledgeId: string, patch: { targetKnowledgeIds?: string[]; decision?: "transfer" | "provisional" | "archive" }) {
    setPreview((current) => current ? { ...current, mappings: current.mappings.map((row) => row.sourceKnowledgeId === sourceKnowledgeId ? { ...row, ...patch } : row) } : current);
    setMappingDirty(true);
  }

  return (
    <div className="mt-5 rounded-xl border border-sky-200 bg-sky-50/30 p-4 dark:border-sky-900 dark:bg-sky-950/20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">课程版本</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">只有升级或更换同一课程版本时才需要，日常学习可以忽略。</p>
        </div>
        <Button size="sm" variant="secondary" aria-expanded={expanded} aria-controls="private-tutor-version-migration" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "收起高级选项" : "更换课程版本（高级）"}
        </Button>
      </div>
      {expanded ? <div id="private-tutor-version-migration" className="mt-4 border-t border-sky-200 pt-4 dark:border-sky-900">
        <p className="text-sm font-semibold">先预览版本变化</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">比较知识点和学习记录的影响。应用后仍需手动启用新版本，历史记录不会被改写。</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium">来源版本
            <select aria-label="迁移来源版本" value={sourceKey} onChange={(event) => { setSourceKey(event.target.value); resetMigration(); }} className="mt-1 h-10 w-full rounded-lg border bg-card px-2 text-sm font-normal">
              <option value="">请选择</option>
              {candidates.filter((row) => row.hasLearningState).map((row) => <option key={keyFor(row)} value={keyFor(row)}>{row.packageName} · v{row.packageVersion} · {row.evidenceCount} 条证据</option>)}
            </select>
          </label>
          <label className="text-xs font-medium">目标版本
            <select aria-label="迁移目标版本" value={targetKey} onChange={(event) => { setTargetKey(event.target.value); resetMigration(); }} className="mt-1 h-10 w-full rounded-lg border bg-card px-2 text-sm font-normal">
              <option value="">请选择</option>
              {candidates.filter((row) => keyFor(row) !== sourceKey).map((row) => <option key={keyFor(row)} value={keyFor(row)}>{row.packageName} · v{row.packageVersion}</option>)}
            </select>
          </label>
        </div>
        <Button className="mt-3" size="sm" disabled={busy || !source || !target} onClick={() => void run(async () => {
          const result = await createPrivateTutorContentMigrationPreview({ sourcePackageId: source!.packageId, sourcePackageVersion: source!.packageVersion, targetPackageId: target!.packageId, targetPackageVersion: target!.packageVersion, idempotencyKey: crypto.randomUUID() });
          acceptPreview(result); setApplication(null); setHistoryAck(false); setRiskAck(false);
        })}>生成迁移预览</Button>
        {error ? <p role="alert" className="mt-3 text-xs text-rose-600">{error}</p> : null}

        {preview ? (
          <div className="mt-4 grid gap-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Impact value={preview.impact.transferableKnowledgeCount} label="安全继承" />
            <Impact value={preview.impact.provisionalKnowledgeCount} label="需要重评" />
            <Impact value={preview.impact.archivedKnowledgeCount} label="归档" />
            <Impact value={preview.impact.addedKnowledgeCount} label="新增" />
          </div>
          {preview.impact.affectedActivePlanCount || preview.impact.affectedOpenSessionCount ? <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">来源版本仍有 {preview.impact.affectedActivePlanCount} 个活动计划、{preview.impact.affectedOpenSessionCount} 个未结束会话；它们会留在原版本。</p> : null}
          <div className="max-h-80 space-y-2 overflow-auto pr-1">
            {preview.mappings.map((row) => (
              <div key={row.sourceKnowledgeId} className="rounded-lg border bg-card p-3">
                <div className="flex justify-between gap-2"><span className="text-sm font-medium">{row.sourceName}</span><span className="text-[11px] text-muted-foreground">{relationLabels[row.relation]} · {row.sourceEvidenceCount} 条证据</span></div>
                <label className="mt-2 block text-xs">目标知识点（可多选）
                  <select multiple aria-label={`${row.sourceName}的目标知识点`} value={row.targetKnowledgeIds} disabled={preview.status !== "draft"} onChange={(event) => updateLocalMapping(row.sourceKnowledgeId, { targetKnowledgeIds: [...event.currentTarget.selectedOptions].map((option) => option.value) })} className="mt-1 min-h-20 w-full rounded border bg-card p-2">
                    {targetKnowledgeOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                  </select>
                </label>
                <select aria-label={`${row.sourceName}的迁移决策`} value={row.decision} disabled={preview.status !== "draft"} onChange={(event) => updateLocalMapping(row.sourceKnowledgeId, { decision: event.target.value as typeof row.decision })} className="mt-2 h-9 w-full rounded border bg-card px-2 text-xs">
                  {Object.entries(decisionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
            ))}
          </div>
          {preview.status === "draft" ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(async () => acceptPreview(await updatePrivateTutorContentMigrationMapping(preview.id, { expectedRevision: preview.revision, mappings: preview.mappings.map(({ sourceKnowledgeId, targetKnowledgeIds, decision }) => ({ sourceKnowledgeId, targetKnowledgeIds, decision })) })))}>保存映射并重新计算</Button> : null}
          {preview.status === "draft" ? (
            <div className="space-y-2 text-xs">
              {mappingDirty ? <p className="text-amber-700 dark:text-amber-300">映射有未保存修改，请先保存并重新计算影响。</p> : null}
              <label className="flex gap-2"><input type="checkbox" checked={historyAck} onChange={(event) => setHistoryAck(event.target.checked)} />我理解原版本作答、评分和学习记录会完整保留。</label>
              {preview.impact.requiresExplicitConfirmation ? <label className="flex gap-2"><input type="checkbox" checked={riskAck} onChange={(event) => setRiskAck(event.target.checked)} />我已复核内容变化、拆分、合并或归档项。</label> : null}
              <Button size="sm" disabled={busy || mappingDirty || !historyAck || (preview.impact.requiresExplicitConfirmation && !riskAck)} onClick={() => void run(async () => acceptPreview(await confirmPrivateTutorContentMigration(preview.id, { expectedRevision: preview.revision, previewFingerprint: preview.previewFingerprint, acknowledgeHistoricalPreservation: historyAck, acknowledgeRiskyMappings: riskAck })))}>确认这份预览</Button>
            </div>
          ) : null}
          {preview.status === "confirmed" ? <Button size="sm" disabled={busy} onClick={() => void run(async () => {
            const result = await applyPrivateTutorContentMigration(preview.id, preview.previewFingerprint, crypto.randomUUID());
            setApplication(result);
            setPreview((current) => current ? { ...current, status: "applied", applicationId: result.id } : current);
          })}>应用迁移（不切换版本）</Button> : null}
          </div>
        ) : null}

        {application ? <div className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs dark:border-emerald-900 dark:bg-emerald-950/30"><p className="font-semibold">{application.status === "applied" ? "迁移已应用，目标版本等待你手动启用" : "迁移已回滚"}</p><p className="mt-1 text-muted-foreground">历史改写：{application.rollbackReceipt.sourceFactsRewritten} 条；继承 {application.transferredKnowledgeCount} 项，待重评 {application.provisionalKnowledgeCount} 项。</p>{application.status === "applied" ? <Button className="mt-2" size="sm" variant="secondary" disabled={busy} onClick={() => void run(async () => {
          const result = await rollbackPrivateTutorContentMigration(application.id);
          setApplication(result);
          setPreview((current) => current ? { ...current, status: "rolled_back" } : current);
        })}>回滚这次迁移</Button> : null}</div> : null}
      </div> : null}
    </div>
  );
}

function keyFor(row: Pick<PrivateTutorContentMigrationCandidate, "packageId" | "packageVersion">) { return `${row.packageId}@${row.packageVersion}`; }
function knowledgeOptionsFor(preview: PrivateTutorContentMigrationPreview) {
  const values = new Map<string, string>();
  for (const row of preview.mappings) row.targetKnowledgeIds.forEach((id, index) => values.set(id, row.targetNames[index] ?? id));
  for (const row of preview.targetAdditions) values.set(row.knowledgeId, row.name);
  return [...values.entries()];
}
function Impact({ value, label }: { value: number; label: string }) { return <div className="rounded-lg bg-card p-2 text-center"><p className="text-lg font-bold">{value}</p><p className="text-[11px] text-muted-foreground">{label}</p></div>; }
