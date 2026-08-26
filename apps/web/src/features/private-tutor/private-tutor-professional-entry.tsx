import { useEffect, useState } from "react";
import { Check, Clock3, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  createPrivateTutorPilot,
  createPrivateTutorQuestionRevision,
  disablePrivateTutorQuestionRevision,
  evaluatePrivateTutorReleaseGate,
  getPrivateTutorPilot,
  getPrivateTutorPilotOperations,
  getPrivateTutorReleaseReadiness,
  listPrivateTutorQuestionRevisions,
  pausePrivateTutorPilot,
  publishPrivateTutorQuestionRevision,
  resumePrivateTutorPilot,
  reviewPrivateTutorQuestionRevision,
  rollbackPrivateTutorQuestion,
  submitPrivateTutorQuestionRevision,
  updatePrivateTutorPilotIncident,
  type PrivateTutorPilotCohort,
  type PrivateTutorPilotIncident,
  type PrivateTutorPilotMetrics,
  type PrivateTutorQuestionRevision,
  type PrivateTutorReleaseReadiness,
} from "@/features/private-tutor/private-tutor-api";

export function ProfessionalTutorEntry() {
  return (
    <div className="mx-auto min-h-full max-w-5xl p-3 sm:p-6">
      <div className="mb-5 rounded-3xl bg-slate-900 p-6 text-white shadow-sm sm:p-8">
        <span className="grid size-12 place-items-center rounded-2xl bg-white/10"><ShieldCheck className="size-7" /></span>
        <p className="mt-5 text-sm font-medium text-emerald-300">质量与安全空间</p>
        <h1 className="mt-1 text-2xl font-bold">我的私教上线控制</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">这里仅处理数学内容、语音、视觉、数据隔离和儿童安全门禁。孩子档案、家庭周报和学生学习入口不会出现在这个专业空间。</p>
      </div>
      <QuestionContentPanel />
      <ReleaseControlPanel />
    </div>
  );
}

function QuestionContentPanel() {
  const [revisions, setRevisions] = useState<PrivateTutorQuestionRevision[]>([]);
  const [selectedRevisionId, setSelectedRevisionId] = useState("");
  const [questionId, setQuestionId] = useState("demo-balance-001");
  const [context, setContext] = useState<PrivateTutorQuestionRevision["context"]>("practice");
  const [knowledgeId, setKnowledgeId] = useState<PrivateTutorQuestionRevision["knowledgeId"]>("balance");
  const [kind, setKind] = useState<PrivateTutorQuestionRevision["kind"]>("numeric");
  const [difficulty, setDifficulty] = useState("2");
  const [prompt, setPrompt] = useState("");
  const [expectedAnswer, setExpectedAnswer] = useState("");
  const [choiceOptions, setChoiceOptions] = useState("a|选项 A\nb|选项 B");
  const [expectedChoice, setExpectedChoice] = useState("a");
  const [actionNote, setActionNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const selected = revisions.find((row) => row.id === selectedRevisionId) ?? null;

  async function refresh(preferredId?: string) {
    const items = await listPrivateTutorQuestionRevisions();
    setRevisions(items);
    setSelectedRevisionId((value) => preferredId || (items.some((row) => row.id === value) ? value : items[0]?.id ?? ""));
  }

  useEffect(() => {
    let current = true;
    setBusy(true);
    void listPrivateTutorQuestionRevisions()
      .then((items) => {
        if (!current) return;
        setRevisions(items);
        setSelectedRevisionId(items[0]?.id ?? "");
      })
      .catch((error) => current && setMessage(error instanceof Error ? error.message : "题目版本暂时无法读取。"))
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, []);

  async function createRevision() {
    if (!questionId.trim() || !prompt.trim() || (kind === "numeric" ? !expectedAnswer.trim() : !expectedChoice.trim())) {
      setMessage("请补齐题目标识、题干和答案。");
      return;
    }
    const options = kind === "choice"
      ? choiceOptions.split("\n").map((line) => {
        const [id, ...labels] = line.split("|");
        return { id: id.trim(), label: labels.join("|").trim() };
      }).filter((row) => row.id && row.label)
      : undefined;
    setBusy(true);
    setMessage("");
    try {
      const revision = await createPrivateTutorQuestionRevision({
        questionId: questionId.trim(), context, knowledgeId, difficulty: Number(difficulty), kind, prompt: prompt.trim(),
        ...(kind === "numeric" ? { expectedAnswer: expectedAnswer.trim(), allowVariableAssignment: true } : { options, expectedChoice: expectedChoice.trim() }),
      });
      await refresh(revision.id);
      setPrompt("");
      setExpectedAnswer("");
      setMessage(`已创建 ${revision.questionId} v${revision.version} 草稿，正文已锁定。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "题目修订创建失败。");
    } finally {
      setBusy(false);
    }
  }

  async function runAction(action: "submit" | "approve" | "reject" | "publish" | "disable" | "rollback") {
    if (!selected) return;
    if (["approve", "reject", "disable", "rollback"].includes(action) && !actionNote.trim()) {
      setMessage("这项操作必须填写审核证据或原因。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      if (action === "submit") await submitPrivateTutorQuestionRevision(selected.id);
      if (action === "approve") await reviewPrivateTutorQuestionRevision(selected.id, "approved", actionNote.trim());
      if (action === "reject") await reviewPrivateTutorQuestionRevision(selected.id, "rejected", actionNote.trim());
      if (action === "publish") await publishPrivateTutorQuestionRevision(selected.id);
      if (action === "disable") await disablePrivateTutorQuestionRevision(selected.id, actionNote.trim());
      if (action === "rollback") await rollbackPrivateTutorQuestion(selected.questionId, selected.id, actionNote.trim());
      await refresh(selected.id);
      setActionNote("");
      setMessage({ submit: "已提交双人审核。", approve: "独立审核已记录。", reject: "已驳回；请创建新修订，原正文不会被覆盖。", publish: "版本已发布并成为当前教学版本。", disable: "版本已紧急停用。", rollback: "已显式回滚到该历史版本。" }[action]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "题目状态更新失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-5 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/40">
      <div><p className="text-xs font-medium text-slate-500">课程内容</p><h2 className="mt-1 font-semibold">版本化题目后台</h2><p className="mt-1 text-xs text-muted-foreground">修订正文不可覆盖；两位非作者独立审核后才能发布。未发布或已停用版本不会进入学生流程。</p></div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm font-medium">创建新修订</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium">题目标识<input aria-label="题目标识" value={questionId} onChange={(event) => setQuestionId(event.target.value)} className="mt-1 h-9 w-full rounded-md border bg-card px-2 text-sm" /></label>
            <label className="text-xs font-medium">难度<select aria-label="题目难度" value={difficulty} onChange={(event) => setDifficulty(event.target.value)} className="mt-1 h-9 w-full rounded-md border bg-card px-2 text-sm">{[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="text-xs font-medium">使用场景<select aria-label="使用场景" value={context} onChange={(event) => setContext(event.target.value as typeof context)} className="mt-1 h-9 w-full rounded-md border bg-card px-2 text-sm"><option value="diagnostic">摸底</option><option value="practice">日常练习</option><option value="tutoring">教学旅程</option><option value="review">错题复习</option></select></label>
            <label className="text-xs font-medium">知识点<select aria-label="知识点" value={knowledgeId} onChange={(event) => setKnowledgeId(event.target.value as typeof knowledgeId)} className="mt-1 h-9 w-full rounded-md border bg-card px-2 text-sm"><option value="integer">有理数</option><option value="equation-meaning">方程含义</option><option value="balance">等式平衡</option><option value="word-problem">应用题</option></select></label>
            <label className="text-xs font-medium sm:col-span-2">题型<select aria-label="题型" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} className="mt-1 h-9 w-full rounded-md border bg-card px-2 text-sm"><option value="numeric">数值题</option><option value="choice">选择题</option></select></label>
            <label className="text-xs font-medium sm:col-span-2">题干<textarea aria-label="题干" value={prompt} onChange={(event) => setPrompt(event.target.value.slice(0, 500))} className="mt-1 min-h-16 w-full rounded-md border bg-card p-2 text-sm" /></label>
            {kind === "numeric" ? <label className="text-xs font-medium sm:col-span-2">标准答案<input aria-label="标准答案" value={expectedAnswer} onChange={(event) => setExpectedAnswer(event.target.value)} className="mt-1 h-9 w-full rounded-md border bg-card px-2 text-sm" /></label> : <><label className="text-xs font-medium sm:col-span-2">选项（每行“键|文字”）<textarea aria-label="选择题选项" value={choiceOptions} onChange={(event) => setChoiceOptions(event.target.value)} className="mt-1 min-h-16 w-full rounded-md border bg-card p-2 text-sm" /></label><label className="text-xs font-medium sm:col-span-2">正确选项键<input aria-label="正确选项键" value={expectedChoice} onChange={(event) => setExpectedChoice(event.target.value)} className="mt-1 h-9 w-full rounded-md border bg-card px-2 text-sm" /></label></>}
          </div>
          <Button className="mt-3" disabled={busy} onClick={() => void createRevision()}>创建不可变草稿</Button>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <label className="text-sm font-medium">选择题目版本<select aria-label="选择题目版本" value={selectedRevisionId} onChange={(event) => setSelectedRevisionId(event.target.value)} className="mt-2 h-10 w-full rounded-lg border bg-card px-3 text-sm">{revisions.map((revision) => <option key={revision.id} value={revision.id}>{revision.questionId} v{revision.version} · {contentStatusLabel(revision.status)}</option>)}</select></label>
          {selected ? <div className="mt-3 rounded-lg bg-muted/50 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{selected.prompt}</span><span className={cn("rounded-full px-2 py-1 text-xs", selected.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700")}>{contentStatusLabel(selected.status)}</span></div><p className="mt-2 text-xs text-muted-foreground">审核 {selected.approvals}/{selected.requiredApprovals} · 校验 {selected.contentChecksum.slice(0, 12)}</p></div> : <p className="mt-3 text-sm text-muted-foreground">{busy ? "正在读取题库…" : "暂无题目版本。"}</p>}
          {selected && ["in_review", "published", "superseded"].includes(selected.status) ? <textarea aria-label="审核证据或操作原因" value={actionNote} onChange={(event) => setActionNote(event.target.value.slice(0, 500))} placeholder="填写审核证据或操作原因" className="mt-3 min-h-16 w-full rounded-lg border bg-card p-2 text-sm" /> : null}
          {selected ? <div className="mt-3 flex flex-wrap gap-2">{selected.status === "draft" ? <Button disabled={busy} onClick={() => void runAction("submit")}>提交审核</Button> : null}{selected.status === "in_review" ? <><Button variant="secondary" disabled={busy} onClick={() => void runAction("reject")}>驳回</Button><Button disabled={busy} onClick={() => void runAction("approve")}>记录独立通过</Button></> : null}{selected.status === "approved" ? <Button disabled={busy} onClick={() => void runAction("publish")}>发布版本</Button> : null}{selected.status === "published" ? <Button variant="secondary" disabled={busy} onClick={() => void runAction("disable")}>紧急停用</Button> : null}{selected.status === "superseded" ? <Button disabled={busy} onClick={() => void runAction("rollback")}>回滚到此版本</Button> : null}</div> : null}
        </div>
      </div>
      {message ? <p role="status" className="mt-3 rounded-lg bg-muted p-3 text-sm">{message}</p> : null}
    </div>
  );
}

function contentStatusLabel(status: PrivateTutorQuestionRevision["status"]) {
  return { draft: "草稿", in_review: "审核中", approved: "待发布", rejected: "已驳回", published: "当前发布", superseded: "历史版本", disabled: "已停用" }[status];
}

function ReleaseControlPanel() {
  const [readiness, setReadiness] = useState<PrivateTutorReleaseReadiness | null>(null);
  const [cohorts, setCohorts] = useState<PrivateTutorPilotCohort[]>([]);
  const [pilotMetrics, setPilotMetrics] = useState<PrivateTutorPilotMetrics[]>([]);
  const [pilotIncidents, setPilotIncidents] = useState<PrivateTutorPilotIncident[]>([]);
  const [selectedGateId, setSelectedGateId] = useState("");
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [evidence, setEvidence] = useState("");
  const [artifactName, setArtifactName] = useState("");
  const [artifactChecksum, setArtifactChecksum] = useState("");
  const [executedAt, setExecutedAt] = useState(() => localDateTimeValue(new Date()));
  const [participantTarget, setParticipantTarget] = useState("50");
  const [responseOwner, setResponseOwner] = useState("");
  const [operationReason, setOperationReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let current = true;
    setBusy(true);
    void Promise.all([getPrivateTutorReleaseReadiness(), getPrivateTutorPilot(), getPrivateTutorPilotOperations()])
      .then(([release, pilot, operations]) => {
        if (!current) return;
        setReadiness(release);
        setCohorts(pilot.cohorts);
        setPilotMetrics(operations.metrics);
        setPilotIncidents(operations.incidents);
        const nextGate = release.gates.find((gate) => gate.status !== "passed") ?? release.gates[0];
        setSelectedGateId(nextGate?.id ?? "");
        setSelectedTargetId(nextGate?.targets.find((target) => target.status !== "passed")?.id ?? nextGate?.targets[0]?.id ?? "");
      })
      .catch((error) => current && setMessage(error instanceof Error ? error.message : "上线门禁暂时无法读取。"))
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, []);

  async function submitEvaluation(status: "passed" | "failed") {
    const gate = readiness?.gates.find((item) => item.id === selectedGateId);
    const evidenceTarget = gate?.targets.find((item) => item.id === selectedTargetId);
    if (!gate || !evidenceTarget || !evidence.trim() || !artifactName.trim() || !/^[a-fA-F0-9]{64}$/.test(artifactChecksum.trim()) || !executedAt) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await evaluatePrivateTutorReleaseGate({
        gateId: selectedGateId,
        targetId: evidenceTarget.id,
        status,
        evidence: evidence.trim(),
        evidenceType: evidenceTarget.evidenceType,
        environment: evidenceTarget.environment,
        artifactName: artifactName.trim(),
        artifactChecksumSha256: artifactChecksum.trim().toLowerCase(),
        executedAt: new Date(executedAt).toISOString(),
      });
      setReadiness(result.readiness);
      setEvidence("");
      setArtifactName("");
      setArtifactChecksum("");
      setExecutedAt(localDateTimeValue(new Date()));
      const nextGate = result.readiness.gates.find((item) => item.status !== "passed") ?? result.readiness.gates.find((item) => item.id === selectedGateId);
      setSelectedGateId(nextGate?.id ?? selectedGateId);
      setSelectedTargetId(nextGate?.targets.find((target) => target.status !== "passed")?.id ?? nextGate?.targets[0]?.id ?? selectedTargetId);
      setMessage(status === "passed" ? "证据已绑定当前构建和覆盖目标。" : "已阻断上线，请修复后重新评审。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "评审证据暂时没有保存。");
    } finally {
      setBusy(false);
    }
  }

  async function startPilot() {
    const target = Number(participantTarget);
    if (!Number.isInteger(target) || target < 30 || target > 100 || !responseOwner.trim()) {
      setMessage("试点人数需为 30–100，并指定异常响应负责人。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const cohort = await createPrivateTutorPilot({ participantTarget: target, responseOwner: responseOwner.trim() });
      setCohorts((items) => [cohort, ...items]);
      const operations = await getPrivateTutorPilotOperations();
      setPilotMetrics(operations.metrics);
      setPilotIncidents(operations.incidents);
      setMessage("7 天受控试点已创建。家长仍可随时退出并申请删除数据。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "受控试点暂时无法创建。");
    } finally {
      setBusy(false);
    }
  }

  async function togglePilotPause(cohort: PrivateTutorPilotCohort) {
    if (operationReason.trim().length < 5) {
      setMessage("暂停或恢复需要填写至少 5 个字的操作原因。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const updated = cohort.status === "paused"
        ? await resumePrivateTutorPilot(cohort.id, operationReason.trim())
        : await pausePrivateTutorPilot(cohort.id, operationReason.trim());
      setCohorts((items) => items.map((item) => item.id === updated.id ? updated : item));
      setOperationReason("");
      setMessage(updated.status === "paused" ? "试点已暂停，已入组孩子的新学习写入已锁定。" : "安全复核完成，试点已恢复。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "试点状态暂时无法更新。");
    } finally {
      setBusy(false);
    }
  }

  async function resolvePilotIncident(incident: PrivateTutorPilotIncident) {
    if (operationReason.trim().length < 5) {
      setMessage("处理异常需要填写至少 5 个字的处置结论。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const updated = await updatePrivateTutorPilotIncident(incident.id, { action: "resolve", resolution: operationReason.trim() });
      setPilotIncidents((items) => items.map((item) => item.id === updated.id ? updated : item));
      setOperationReason("");
      setMessage("异常已解决并保留处置记录。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "异常状态暂时无法更新。");
    } finally {
      setBusy(false);
    }
  }

  const activeCohort = cohorts.find((cohort) => ["active", "paused"].includes(cohort.status)) ?? null;
  const activeMetrics = activeCohort ? pilotMetrics.find((metrics) => metrics.cohortId === activeCohort.id) ?? null : null;
  const selectedGate = readiness?.gates.find((gate) => gate.id === selectedGateId) ?? null;
  const selectedTarget = selectedGate?.targets.find((target) => target.id === selectedTargetId) ?? selectedGate?.targets[0] ?? null;
  const evidenceComplete = Boolean(evidence.trim() && artifactName.trim() && !/[\\/]/.test(artifactName) && /^[a-fA-F0-9]{64}$/.test(artifactChecksum.trim()) && executedAt && selectedTarget);
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-medium text-slate-500">运营与安全</p><h2 className="mt-1 font-semibold">受控上线门禁</h2><p className="mt-1 text-xs text-muted-foreground">每项证据都绑定当前构建、目标环境、执行时间与附件指纹；过期或矩阵缺项会自动阻断。</p></div>
        <span className={cn("rounded-full px-3 py-1 text-xs font-medium", readiness?.ready ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900")}>{readiness?.ready ? "可创建受控试点" : "尚未满足上线条件"}</span>
      </div>
      {readiness ? (
        <>
          <p className="mt-3 break-all rounded-lg bg-muted px-3 py-2 font-mono text-[11px] text-muted-foreground">证据合同 v{readiness.evidenceContractVersion} · 构建 {readiness.buildId} · 范围 {readiness.scopeChecksum.slice(0, 12)}</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {readiness.gates.map((gate) => (
              <button key={gate.id} type="button" onClick={() => { setSelectedGateId(gate.id); setSelectedTargetId(gate.targets.find((target) => target.status !== "passed")?.id ?? gate.targets[0]?.id ?? ""); }} className={cn("rounded-xl border p-3 text-left", selectedGateId === gate.id ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950" : "bg-card")}>
                <span className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{gate.label}</span>{gate.status === "passed" ? <Check className="size-4 text-emerald-600" /> : gate.status === "failed" ? <span className="text-xs font-medium text-rose-600">未通过</span> : gate.status === "expired" ? <span className="text-xs font-medium text-amber-700">证据过期</span> : <Clock3 className="size-4 text-amber-600" />}</span>
                <span className="mt-1 block text-xs text-muted-foreground">覆盖目标 {gate.completedTargets}/{gate.targets.length}{gate.doubleReview ? ` · 双人复核 ${gate.passedReviewers}/2` : ""}</span>
                {gate.latestEvidence ? <span className="mt-2 line-clamp-2 block text-xs text-muted-foreground">{gate.latestEvidence}</span> : null}
              </button>
            ))}
          </div>
          <div className="mt-4 rounded-xl border bg-card p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium">覆盖目标<select aria-label="证据覆盖目标" value={selectedTarget?.id ?? ""} onChange={(event) => setSelectedTargetId(event.target.value)} className="mt-2 h-10 w-full rounded-lg border bg-card px-3 text-sm">{selectedGate?.targets.map((target) => <option key={target.id} value={target.id}>{target.label} · {releaseTargetStatus(target.status)}</option>)}</select></label>
              <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground"><p className="font-medium text-foreground">要求：{selectedTarget ? releaseEvidenceType(selectedTarget.evidenceType) : "请选择目标"}</p>{selectedTarget ? <p className="mt-1">{releaseEnvironment(selectedTarget.environment)} · 有效 {selectedGate?.evidenceValidityDays} 天{selectedTarget.requiredReviewers > 1 ? ` · ${selectedTarget.requiredReviewers} 位独立审核人` : ""}</p> : null}</div>
            </div>
            <label className="text-sm font-medium" htmlFor="release-evidence">当前门禁的审计证据</label>
            <textarea id="release-evidence" value={evidence} onChange={(event) => setEvidence(event.target.value.slice(0, 500))} placeholder="填写测试报告、评审记录或演练结论" className="mt-2 min-h-20 w-full rounded-lg border bg-card p-3 text-sm" />
            <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium">附件名称<input aria-label="证据附件名称" value={artifactName} onChange={(event) => setArtifactName(event.target.value.slice(0, 120))} placeholder="例如 playwright-report.zip" className="mt-1 h-10 w-full rounded-lg border bg-card px-3 text-sm" /></label><label className="text-xs font-medium">执行时间<input aria-label="证据执行时间" type="datetime-local" value={executedAt} onChange={(event) => setExecutedAt(event.target.value)} className="mt-1 h-10 w-full rounded-lg border bg-card px-3 text-sm" /></label></div>
            <label className="mt-3 block text-xs font-medium">附件 SHA-256<input aria-label="证据附件 SHA-256" value={artifactChecksum} onChange={(event) => setArtifactChecksum(event.target.value.replace(/[^a-fA-F0-9]/g, "").slice(0, 64))} placeholder="64 位十六进制校验和" className="mt-1 h-10 w-full rounded-lg border bg-card px-3 font-mono text-xs" /></label>
            <p className="mt-2 text-xs text-muted-foreground">只保存附件名称与校验和，不上传报告正文；审核人身份由当前登录账号绑定。</p>
            <div className="mt-3 flex flex-wrap justify-end gap-2"><Button variant="secondary" disabled={busy || !evidenceComplete} onClick={() => void submitEvaluation("failed")}>记录未通过</Button><Button disabled={busy || !evidenceComplete} onClick={() => void submitEvaluation("passed")}>记录通过</Button></div>
          </div>
          <div className="mt-4 rounded-xl border bg-card p-4">
            <p className="text-sm font-medium">7 天受控试点</p>
            {activeCohort ? <div className={cn("mt-2 rounded-lg p-3 text-sm", activeCohort.status === "paused" ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100" : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-100")}><p>{activeCohort.status === "paused" ? "试点已暂停" : "试点进行中"}：目标 {activeCohort.participantTarget} 人，响应负责人 {activeCohort.responseOwner}。家长可随时退出并申请删除。</p><div className="mt-3 flex flex-wrap gap-2"><input aria-label="试点操作原因" value={operationReason} onChange={(event) => setOperationReason(event.target.value.slice(0, 500))} placeholder={activeCohort.status === "paused" ? "填写安全复核和恢复原因" : "填写暂停原因"} className="h-9 min-w-64 flex-1 rounded-md border bg-card px-2 text-foreground" /><Button variant="secondary" disabled={busy || operationReason.trim().length < 5} onClick={() => void togglePilotPause(activeCohort)}>{activeCohort.status === "paused" ? "恢复试点" : "暂停试点"}</Button></div></div> : <div className="mt-3 grid gap-3 sm:grid-cols-[0.6fr_1fr_auto]"><label className="text-xs font-medium">目标人数<input type="number" min={30} max={100} value={participantTarget} onChange={(event) => setParticipantTarget(event.target.value)} className="mt-1 h-10 w-full rounded-lg border bg-card px-3 text-sm" /></label><label className="text-xs font-medium">异常响应负责人<input value={responseOwner} onChange={(event) => setResponseOwner(event.target.value.slice(0, 120))} placeholder="姓名或值班角色" className="mt-1 h-10 w-full rounded-lg border bg-card px-3 text-sm" /></label><Button className="self-end" disabled={busy || !readiness.ready} onClick={() => void startPilot()}>创建受控试点</Button></div>}
            {!readiness.ready ? <p className="mt-2 text-xs text-muted-foreground">{readiness.rule}</p> : null}
            {activeMetrics ? <div className="mt-3 grid gap-2 sm:grid-cols-4"><Metric label="已同意" value={`${activeMetrics.enrollment.consented}`} /><Metric label="主动退出" value={`${activeMetrics.enrollment.withdrawn}`} /><Metric label="愿意再来" value={`${activeMetrics.experience.childWillingToReturn.yes}`} /><Metric label="未解决异常" value={`${activeMetrics.safety.open}`} /></div> : null}
            {pilotIncidents.filter((incident) => incident.status !== "resolved").length ? <div className="mt-3 grid gap-2"><p className="text-xs font-medium">待处理异常</p>{pilotIncidents.filter((incident) => incident.status !== "resolved").map((incident) => <div key={incident.id} className="rounded-lg border bg-card p-3 text-foreground"><p className="text-sm font-medium">{incident.severity === "critical" ? "重大" : incident.severity === "high" ? "严重" : "一般"} · {incident.category}</p><p className="mt-1 text-xs text-muted-foreground">{incident.summary}</p><Button className="mt-2" size="sm" variant="secondary" disabled={busy || operationReason.trim().length < 5} onClick={() => void resolvePilotIncident(incident)}>按上方结论标记解决</Button></div>)}</div> : null}
          </div>
        </>
      ) : <p className="mt-4 text-sm text-muted-foreground">正在读取上线门禁…</p>}
      {message ? <p role="status" className="mt-3 rounded-lg bg-muted p-3 text-sm">{message}</p> : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border bg-card p-3"><span className="block text-[11px] text-muted-foreground">{label}</span><span className="mt-1 block text-lg font-semibold">{value}</span></div>;
}

function localDateTimeValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function releaseTargetStatus(status: "passed" | "failed" | "expired" | "not_evaluated") {
  return status === "passed" ? "已通过" : status === "failed" ? "未通过" : status === "expired" ? "已过期" : "待补证据";
}

function releaseEvidenceType(type: string) {
  return ({ automated_test: "自动化测试", manual_review: "人工评审", device_test: "真机测试", incident_drill: "事故演练", operations_drill: "运营演练" } as Record<string, string>)[type] ?? type;
}

function releaseEnvironment(environment: { deviceClass: string; operatingSystem: string; browserEngine: string; networkProfile: string }) {
  const labels: Record<string, string> = { server: "服务端", desktop: "桌面", tablet: "平板", mobile: "手机", windows: "Windows", macos: "macOS", linux: "Linux", ios: "iOS", android: "Android", chromium: "Chromium", firefox: "Firefox", webkit: "WebKit", stable: "稳定网络", constrained: "受限网络", offline_recovery: "离线恢复", not_applicable: "不适用" };
  const values = [environment.deviceClass, environment.operatingSystem, environment.browserEngine, environment.networkProfile];
  if (values.every((value) => value === "not_applicable")) return "不限定设备环境";
  return values.filter((value) => value !== "not_applicable").map((value) => labels[value] ?? value).join(" / ");
}
