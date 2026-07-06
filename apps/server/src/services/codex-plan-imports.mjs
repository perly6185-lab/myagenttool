import { isGovernedCodexPlanAgent } from "./codex-agent.mjs";

const MAX_CODEX_CHANGE_PLANS = 1000;
const MAX_STEPS_PER_PLAN = 100;

export function createCodexPlanImportService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon = () => {},
}) {
  function recordCodexChangePlan({ invocation, result, agent }) {
    if (!isGovernedCodexPlanAgent(agent) || !isCodexPlanResult(result)) {
      return [];
    }
    const allSteps = normalizeSteps(result.output.steps);
    const droppedStepCount = Math.max(0, allSteps.length - MAX_STEPS_PER_PLAN);
    const steps = allSteps.slice(0, MAX_STEPS_PER_PLAN);
    const record = {
      id: nextId("cpl_demo"),
      source: "codex",
      planInvocationId: invocation.id,
      invocationId: invocation.id,
      projectId: invocation.projectId ?? invocation.options?.metadata?.projectId ?? null,
      worktreeId: invocation.worktreeId ?? invocation.options?.metadata?.worktreeId ?? null,
      requestedBy: invocation.requestedBy ?? null,
      agentId: invocation.agentId ?? null,
      planAgentName: agent?.name ?? null,
      tool: "codex.plan.change",
      mode: String(result.output.mode ?? "change-plan"),
      severityFloor: stringOrNull(result.output.severityFloor),
      goal: stringOrNull(result.output.goal ?? invocation.options?.metadata?.goal),
      constraints: stringOrNull(result.output.constraints ?? invocation.options?.metadata?.constraints),
      summary: stringOrNull(result.output.summary ?? result.summary),
      steps,
      openQuestions: normalizeStringList(result.output.openQuestions),
      verification: normalizeStringList(result.output.verification),
      authoritative: false,
      droppedStepCount,
      raw: {
        summary: result.output.summary ?? null,
        steps: result.output.steps ?? [],
        openQuestions: result.output.openQuestions ?? [],
        verification: result.output.verification ?? [],
      },
      createdAt: now(),
    };
    state.codexChangePlans.unshift(record);
    state.codexChangePlans = state.codexChangePlans.slice(0, MAX_CODEX_CHANGE_PLANS);
    appendEvent({
      invocationId: invocation.id,
      type: "codex_change_plan_recorded",
      level: "info",
      message: "Imported Codex change plan.",
      data: {
        codexChangePlanId: record.id,
        tool: "codex.plan.change",
        authoritative: false,
        droppedStepCount,
      },
    });
    persistStateSoon();
    return [record];
  }

  return { recordCodexChangePlan };
}

function isCodexPlanResult(result) {
  return result?.output?.source === "codex"
    && result.output.tool === "codex.plan.change"
    && !result.output.error;
}

function normalizeSteps(value) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      title: stringOrNull(item.title),
      rationale: stringOrNull(item.rationale),
      files: normalizeStringList(item.files).slice(0, 25),
      risk: enumValue(item.risk, "medium", ["low", "medium", "high"]),
    }))
    .filter((item) => item.title);
}

function normalizeStringList(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, 50);
}

function enumValue(value, fallback, allowed) {
  const text = String(value ?? fallback).trim();
  return allowed.includes(text) ? text : fallback;
}

function stringOrNull(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}
