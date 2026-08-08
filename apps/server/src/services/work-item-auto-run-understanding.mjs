import { buildWorkItemUnderstandingContext } from "./work-item-understanding-context.mjs";

const RECOVERABLE_PHASES = new Set(["understanding", "planning"]);

export function createWorkItemAutoRunUnderstandingService({
  state,
  getWorkItem,
  prepareExecutionContract,
  decideReservedAutoRun,
  attachAutoRunExecutionPlan,
  failAutoRunUnderstanding,
  deferAutoRunUnderstanding,
  startAutoRun,
  searchProjectContent,
  schedule = (callback) => setImmediate(() => void callback()),
} = {}) {
  const processing = new Set();
  const scheduled = new Set();

  function actorFor(autoRun, workItem = null) {
    return {
      userId: autoRun.requestedBy ?? "usr_local",
      teamId: autoRun.teamId ?? workItem?.ownerTeamId ?? "team_local",
      role: "operator",
    };
  }

  function hasExecutionBinding(autoRun) {
    const workItemId = autoRun?.localIssueId ?? autoRun?.executionChainId ?? null;
    const workItem = (state.workItems ?? []).find((item) => item.id === workItemId) ?? null;
    return Boolean(workItem && (workItem.executionBindings ?? []).some((binding) =>
      binding.kind === "auto_run" && binding.targetId === autoRun.id));
  }

  function recoverable(autoRun) {
    return Boolean(
      autoRun
      && autoRun.link?.type === "local_issue"
      && !autoRun.invocationId
      && hasExecutionBinding(autoRun)
      && ["materializing", "waiting_capacity"].includes(autoRun.status)
      && RECOVERABLE_PHASES.has(autoRun.phase ?? "understanding"),
    );
  }

  async function processRun(autoRunId) {
    const id = String(autoRunId ?? "");
    if (!id) return { ok: false, reason: "auto_run_id_required" };
    if (processing.has(id)) return { ok: true, replayed: true, reason: "already_processing" };
    const autoRun = (state.autoRuns ?? []).find((item) => item.id === id) ?? null;
    if (!autoRun) return { ok: false, reason: "auto_run_not_found" };
    if (!recoverable(autoRun)) return { ok: true, replayed: true, autoRun };
    processing.add(id);
    try {
      const initialActor = actorFor(autoRun);
      const detail = getWorkItem({ workItemId: autoRun.localIssueId ?? autoRun.executionChainId }, initialActor);
      if (!detail.ok) throw new Error(detail.body?.error ?? "work_item_not_found");
      let workItem = detail.body.workItem;
      const actor = actorFor(autoRun, workItem);
      const understandingContext = buildWorkItemUnderstandingContext({
        state,
        workItem,
        searchProjectContent,
      });
      await decideReservedAutoRun(id, {
        projectContext: understandingContext.context,
        contextSummary: understandingContext.summary,
      });
      let contractDraft = null;
      const contractDefined = (workItem.acceptanceCriteria ?? []).length > 0
        && (workItem.verificationSop ?? []).length > 0
        && Boolean(workItem.executionContractConfirmedAt);
      if (!contractDefined && autoRun.executionPlan?.status !== "needs_input") {
        const decisionDraft = (autoRun.decision?.acceptanceCriteria ?? []).length
          || (autoRun.decision?.verificationSop ?? []).length
          ? {
              taskUnderstanding: autoRun.decision?.taskUnderstanding ?? "",
              acceptanceCriteria: autoRun.decision?.acceptanceCriteria ?? [],
              verificationSop: autoRun.decision?.verificationSop ?? [],
              risks: autoRun.decision?.risks ?? [],
              suggestedRoute: autoRun.decision?.path ?? null,
              evidence: {
                generator: "decision_agent",
                modelVersion: autoRun.decision?.evidence?.modelVersion ?? null,
                policyVersion: autoRun.decision?.evidence?.policyVersion ?? null,
                inputDigest: autoRun.decision?.evidence?.inputDigest ?? null,
                confidence: autoRun.decision?.confidence ?? null,
              },
            }
          : null;
        const prepared = prepareExecutionContract({
          workItemId: workItem.id,
          expectedRevision: workItem.revision,
          confirm: autoRun.decision?.path !== "clarify",
          draftOverride: decisionDraft,
        }, actor);
        if (!prepared.ok) throw new Error(prepared.body?.error ?? "work_item_execution_contract_assistance_failed");
        workItem = prepared.body.workItem;
        contractDraft = prepared.body.draft ?? null;
      }

      const frozen = autoRun.executionContract && autoRun.executionPlan?.status === "ready"
        ? { autoRun, executionPlan: autoRun.executionPlan, executionContract: autoRun.executionContract, replayed: true }
        : attachAutoRunExecutionPlan(autoRun.id, {
          acceptanceCriteria: workItem.acceptanceCriteria,
          verificationSop: workItem.verificationSop,
          suggestedRoute: contractDraft?.suggestedRoute ?? autoRun.decision?.path ?? null,
          taskUnderstanding: contractDraft?.taskUnderstanding ?? autoRun.decision?.taskUnderstanding ?? "",
          contextSummary: autoRun.understandingContext ?? understandingContext.summary,
          risks: contractDraft?.risks ?? autoRun.executionPlan?.risks ?? [],
          evidence: contractDraft?.evidence ?? autoRun.executionPlan?.evidence ?? null,
          confirmedBy: ["assisted", "agent_assisted"].includes(workItem.executionContractSource) ? "ai_policy" : "user",
          confirmedAt: workItem.executionContractConfirmedAt,
        });
      if (autoRun.decision?.path === "clarify") {
        return { ok: true, waitingForInput: true, autoRun: frozen.autoRun };
      }

      const issueBody = [
        workItem.body,
        `Acceptance criteria (frozen for this run):\n${workItem.acceptanceCriteria.map((value) => `- ${value}`).join("\n")}`,
        `Owner verification SOP (frozen for this run):\n${workItem.verificationSop.map((value, index) => `${index + 1}. ${value}`).join("\n")}`,
      ].filter(Boolean).join("\n\n");
      const result = await startAutoRun({
        projectId: workItem.projectId,
        link: autoRun.link,
        localIssueId: workItem.id,
        name: autoRun.launchContext?.name,
        baseBranch: autoRun.launchContext?.baseBranch,
        agentId: autoRun.agentId,
        actor,
        issueBody,
        executionChainId: autoRun.executionChainId ?? workItem.id,
        taskMaterialWorkItemId: autoRun.launchContext?.taskMaterialWorkItemId ?? workItem.id,
        terminalId: autoRun.terminalId ?? workItem.terminalId,
        autonomyProfile: autoRun.autonomyProfile,
        existingAutoRunId: autoRun.id,
        executionPlan: frozen.executionPlan,
      });
      return { ok: true, ...result };
    } catch (error) {
      if (String(error?.message ?? error).startsWith("At capacity:")) {
        deferAutoRunUnderstanding?.(id, error);
        return { ok: true, waitingCapacity: true, autoRun };
      }
      failAutoRunUnderstanding(id, error);
      return { ok: false, reason: error instanceof Error ? error.message : String(error), autoRun };
    } finally {
      processing.delete(id);
    }
  }

  function enqueue(autoRunId) {
    const id = String(autoRunId ?? "");
    if (!id || scheduled.has(id) || processing.has(id)) return false;
    scheduled.add(id);
    schedule(async () => {
      scheduled.delete(id);
      await processRun(id);
    });
    return true;
  }

  async function reconcile() {
    const candidates = (state.autoRuns ?? []).filter(recoverable);
    const results = [];
    for (const autoRun of candidates) results.push(await processRun(autoRun.id));
    return {
      checked: candidates.length,
      resumed: results.filter((result) => result.ok && !result.replayed).length,
      failed: results.filter((result) => !result.ok).length,
      results,
    };
  }

  return { enqueue, processRun, reconcile };
}
