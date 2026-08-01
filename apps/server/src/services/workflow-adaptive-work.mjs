import { createHash } from "node:crypto";

import { actorCanAccessProject } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

const POLICY_MODES = new Set(["observe", "assist", "execute"]);
const FEEDBACK_DECISIONS = new Set(["accepted", "rejected"]);
const AUTO_DOCUMENT_TYPES = new Set([
  "inquiry",
  "quotation",
  "order",
  "inquiry_ledger",
  "quotation_ledger",
  "order_ledger",
]);
const AUTO_CONFIDENCE_THRESHOLD = 0.9;
const AUTO_HISTORY_THRESHOLD = 3;
const RECONCILE_LIMIT = 10;
const MONITOR_MIN_INTERVAL_MINUTES = 1;
const MONITOR_MAX_INTERVAL_MINUTES = 1_440;
const MONITOR_SWEEP_LIMIT = 2;
const MONITOR_MAX_BACKOFF_MINUTES = 1_440;
const ACTIONS_BY_TYPE = Object.freeze({
  inquiry: ["核对询价信息", "生成报价单", "更新询价台账", "更新报价台账"],
  quotation: ["复核报价单", "更新报价台账", "跟进客户确认与下单"],
  order: ["核对订单信息", "创建订单处理任务", "更新订单台账"],
  inquiry_ledger: ["核对询价台账", "补齐缺失询价记录"],
  quotation_ledger: ["核对报价台账", "补齐缺失报价记录"],
  order_ledger: ["核对订单台账", "补齐缺失订单记录"],
  price_list: ["核对价格表版本", "将价格表作为报价参考资料"],
  customer_reference: ["核对客户资料", "将客户资料关联到后续商务任务"],
  other_reference: ["核对参考资料", "关联到对应商务任务"],
});
const DOCUMENT_TYPES = new Set(Object.keys(ACTIONS_BY_TYPE));
const LEARNING_MIN_EVIDENCE = 3;
const LEARNING_MIN_ACCEPTANCE_RATE = 0.8;
const EVALUATION_MIN_SAMPLES = 5;
const EVALUATION_MIN_COMPLETION_RATE = 0.8;
const EVALUATION_MIN_SHADOW_PREFERENCES = 3;

function text(value, maximum = 500) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maximum ? normalized : null;
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeArtifactView(artifact) {
  return artifact ? {
    id: artifact.id,
    name: artifact.name ?? null,
    family: artifact.family ?? "unknown",
    extension: artifact.extension ?? null,
  } : null;
}

export function createWorkflowAdaptiveWorkService({
  state,
  now = () => new Date().toISOString(),
  nextId = (prefix) => `${prefix}_${Date.now().toString(36)}`,
  appendEvent = () => {},
  persistStateSoon = () => {},
  store,
  createWorkItem,
  runIntakeCycle,
} = {}) {
  state.workflowAdaptivePolicies ??= [];
  state.workflowAdaptiveFeedback ??= [];
  state.workflowAdaptiveMonitors ??= [];
  state.workflowAdaptiveOutcomes ??= [];
  state.workflowAdaptiveLearningDrafts ??= [];
  state.workflowAdaptiveRules ??= [];
  state.workflowAdaptiveNotifications ??= [];
  const runTx = makeRunTx({ store, persistStateSoon });
  const recoveredAt = now();
  const interruptedMonitors = state.workflowAdaptiveMonitors.filter((monitor) =>
    monitor.state === "running");
  if (interruptedMonitors.length > 0) {
    runTx(() => {
      for (const monitor of interruptedMonitors) {
        monitor.state = "recoverable";
        monitor.nextRunAt = recoveredAt;
        monitor.updatedAt = recoveredAt;
      }
    });
  }
  const activeMonitorSources = new Set();
  const actorTeam = (actor) => actor?.teamId ?? "team_local";
  const actorUser = (actor) => actor?.userId ?? "user_local";
  const canUse = (actor) => actor?.role == null
    || ["owner", "admin", "operator"].includes(actor.role);
  const canManage = (actor) => actor?.role == null
    || ["owner", "admin"].includes(actor.role);
  const projectFor = (projectId, actor) => (state.projects ?? []).find((row) =>
    row.id === projectId && actorCanAccessProject(state, actor, row.id)) ?? null;

  function sourceFor(sourceId, projectId, actor) {
    if (!sourceId) return null;
    return (state.workflowSources ?? []).find((row) =>
      row.id === sourceId
      && row.projectId === projectId
      && row.ownerTeamId === actorTeam(actor)
      && row.state === "active") ?? null;
  }

  function scopedPolicyFor(projectId, sourceId, actor) {
    return state.workflowAdaptivePolicies.find((row) =>
      row.projectId === projectId
      && (row.sourceId ?? null) === (sourceId ?? null)
      && row.ownerTeamId === actorTeam(actor)) ?? null;
  }

  function policyView(projectId, sourceId, actor) {
    const scoped = scopedPolicyFor(projectId, sourceId, actor);
    const projectPolicy = sourceId ? scopedPolicyFor(projectId, null, actor) : null;
    const effective = scoped ?? projectPolicy;
    return {
      mode: effective?.mode ?? "observe",
      revision: scoped?.revision ?? 0,
      scope: sourceId ? (scoped ? "source" : "inherited") : "project",
      sourceId: sourceId ?? null,
      inheritedMode: sourceId && !scoped ? projectPolicy?.mode ?? "observe" : null,
      updatedAt: scoped?.updatedAt ?? effective?.updatedAt ?? null,
      updatedBy: scoped?.updatedBy ?? effective?.updatedBy ?? null,
      boundary: {
        localIssueOnly: true,
        externalDelivery: false,
        overwriteFiles: false,
      },
    };
  }

  function monitorFor(projectId, sourceId, actor) {
    return state.workflowAdaptiveMonitors.find((row) =>
      row.projectId === projectId
      && row.sourceId === sourceId
      && row.ownerTeamId === actorTeam(actor)) ?? null;
  }

  function monitorView(projectId, sourceId, actor) {
    const monitor = monitorFor(projectId, sourceId, actor);
    return monitor ? {
      id: monitor.id,
      sourceId: monitor.sourceId,
      enabled: monitor.enabled,
      intervalMinutes: monitor.intervalMinutes,
      revision: monitor.revision,
      state: monitor.state,
      nextRunAt: monitor.nextRunAt,
      lastRunAt: monitor.lastRunAt,
      lastSuccessAt: monitor.lastSuccessAt,
      lastError: monitor.lastError,
      consecutiveFailures: monitor.consecutiveFailures,
      updatedAt: monitor.updatedAt,
    } : {
      id: null,
      sourceId,
      enabled: false,
      intervalMinutes: 15,
      revision: 0,
      state: "disabled",
      nextRunAt: null,
      lastRunAt: null,
      lastSuccessAt: null,
      lastError: null,
      consecutiveFailures: 0,
      updatedAt: null,
    };
  }

  function latestClassification(artifact, projectId, actor) {
    return [...(state.businessDocumentClassifications ?? [])]
      .filter((row) => row.ownerTeamId === actorTeam(actor)
        && row.projectId === projectId
        && row.artifactId === artifact?.id
        && (!row.artifactFingerprint
          || !artifact?.fingerprint
          || row.artifactFingerprint === artifact.fingerprint))
      .sort((a, b) => Number(b.revision ?? 0) - Number(a.revision ?? 0))[0] ?? null;
  }

  function historicalBasis(classification, observation, actor) {
    if (!classification) return [];
    const artifacts = new Map((state.workflowArtifacts ?? []).map((row) => [row.id, row]));
    return [...(state.businessDocumentClassifications ?? [])]
      .filter((row) => row.ownerTeamId === actorTeam(actor)
        && row.projectId === observation.projectId
        && row.sourceId === observation.sourceId
        && row.artifactId !== observation.artifactId
        && row.documentType === classification.documentType
        && ["confirmed", "corrected"].includes(row.confirmationState))
      .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
      .slice(0, 3)
      .map((row) => ({
        classificationId: row.id,
        documentType: row.documentType,
        artifact: safeArtifactView(artifacts.get(row.artifactId)),
        confirmationState: row.confirmationState,
      }));
  }

  function activeRuleFor(projectId, sourceId, actor) {
    return [...state.workflowAdaptiveRules]
      .filter((row) => row.ownerTeamId === actorTeam(actor)
        && row.projectId === projectId
        && row.sourceId === sourceId
        && row.status === "active")
      .sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0))[0] ?? null;
  }

  function ruleDocumentConfig(rule, documentType) {
    return rule?.configuration?.documentTypes?.find((row) => row.documentType === documentType) ?? null;
  }

  function ruleDocumentMapping(rule, documentType) {
    return [...(rule?.configuration?.typeMappings ?? [])]
      .filter((row) => row.fromDocumentType === documentType
        && DOCUMENT_TYPES.has(row.toDocumentType))
      .sort((a, b) => Number(b.evidenceCount ?? 0) - Number(a.evidenceCount ?? 0))[0] ?? null;
  }

  function latestShadowDraft(projectId, sourceId, actor) {
    return [...state.workflowAdaptiveLearningDrafts]
      .filter((row) => row.ownerTeamId === actorTeam(actor)
        && row.projectId === projectId
        && row.sourceId === sourceId
        && row.status === "shadow")
      .sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0))[0] ?? null;
  }

  function shadowComparisonFor(suggestion, draft) {
    if (!suggestion || !draft) return null;
    const mapping = [...(draft.configuration?.typeMappings ?? [])]
      .filter((row) => row.fromDocumentType === suggestion.documentType)
      .sort((a, b) => Number(b.evidenceCount ?? 0) - Number(a.evidenceCount ?? 0))[0] ?? null;
    const candidateDocumentType = mapping?.toDocumentType ?? suggestion.documentType;
    const candidateConfig = draft.configuration?.documentTypes
      ?.find((row) => row.documentType === candidateDocumentType) ?? null;
    const baseline = {
      documentType: suggestion.documentType,
      actions: suggestion.actions,
      confidenceThreshold: suggestion.automation.confidenceThreshold,
    };
    const candidate = {
      documentType: candidateDocumentType,
      actions: candidateConfig?.actions ?? suggestion.actions,
      confidenceThreshold: Number(candidateConfig?.confidenceThreshold
        ?? suggestion.automation.confidenceThreshold),
    };
    const stored = (draft.shadowComparisons ?? []).find((row) =>
      row.suggestionId === suggestion.id) ?? null;
    return {
      id: `awsc_${digest(`${draft.id}:${suggestion.id}`).slice(0, 24)}`,
      draftId: draft.id,
      draftVersion: draft.version,
      suggestionId: suggestion.id,
      baseline,
      candidate,
      differences: {
        documentTypeChanged: baseline.documentType !== candidate.documentType,
        actionsChanged: JSON.stringify(baseline.actions) !== JSON.stringify(candidate.actions),
        thresholdChanged: baseline.confidenceThreshold !== candidate.confidenceThreshold,
      },
      preference: stored?.preference ?? null,
      evaluatedAt: stored?.evaluatedAt ?? null,
    };
  }

  function issueFor(suggestionId, actor) {
    const key = `adaptive-work:v1:${suggestionId}`;
    return (state.workItems ?? []).find((row) =>
      row.ownerTeamId === actorTeam(actor) && row.createIdempotencyKey === key) ?? null;
  }

  function feedbackFor(suggestionId, actor) {
    return [...state.workflowAdaptiveFeedback]
      .reverse()
      .find((row) => row.suggestionId === suggestionId
        && row.ownerTeamId === actorTeam(actor)) ?? null;
  }

  function outcomeFor(suggestionId, actor) {
    return state.workflowAdaptiveOutcomes.find((row) =>
      row.suggestionId === suggestionId
      && row.ownerTeamId === actorTeam(actor)) ?? null;
  }

  function outcomeView(outcome) {
    return outcome ? {
      id: outcome.id,
      suggestionId: outcome.suggestionId,
      workItemId: outcome.workItemId,
      status: outcome.status,
      workItemStatus: outcome.workItemStatus,
      completedAt: outcome.completedAt,
      outputAssets: outcome.outputAssets,
      verification: outcome.verification ?? [],
      updatedAt: outcome.updatedAt,
    } : null;
  }

  function suggestionsFor({ projectId, sourceId = null }, actor) {
    const artifacts = new Map((state.workflowArtifacts ?? []).map((row) => [row.id, row]));
    return (state.workflowIntakeObservations ?? [])
      .filter((row) => row.ownerTeamId === actorTeam(actor)
        && row.projectId === projectId
        && (!sourceId || row.sourceId === sourceId)
        && row.artifactId
        && ["ready", "needs_review"].includes(row.state))
      .map((observation) => {
        const artifact = artifacts.get(observation.artifactId);
        const classification = latestClassification(artifact, projectId, actor);
        const detectedDocumentType = classification?.documentType ?? "unknown";
        const activeRule = activeRuleFor(projectId, observation.sourceId, actor);
        const activeMapping = ruleDocumentMapping(activeRule, detectedDocumentType);
        const documentType = activeMapping?.toDocumentType ?? detectedDocumentType;
        const ruleConfig = ruleDocumentConfig(activeRule, documentType);
        const actions = ruleConfig?.actions
          ?? ACTIONS_BY_TYPE[documentType]
          ?? ["人工确认文件类型", "选择要创建的本地任务"];
        const current = classification
          && ["confirmed", "corrected"].includes(classification.confirmationState);
        const risky = (classification?.riskSignals ?? []).length > 0;
        const readiness = !classification
          ? "needs_analysis"
          : !current || risky
            ? "needs_confirmation"
            : "ready";
        const suggestionId = `aws_${digest([
          actorTeam(actor), projectId, observation.id, observation.artifactId,
          classification?.id ?? "unclassified", classification?.revision ?? 0,
        ].join(":")).slice(0, 24)}`;
        const history = historicalBasis(classification, observation, actor);
        const issue = issueFor(suggestionId, actor);
        const feedback = feedbackFor(suggestionId, actor);
        const outcome = outcomeFor(suggestionId, actor);
        const automationEligible = Boolean(
          classification
          && AUTO_DOCUMENT_TYPES.has(documentType)
          && Number(classification.confidence ?? 0)
            >= Number(ruleConfig?.confidenceThreshold ?? AUTO_CONFIDENCE_THRESHOLD)
          && !risky
          && history.length >= AUTO_HISTORY_THRESHOLD
          && !issue
          && feedback?.decision !== "rejected",
        );
        return {
          id: suggestionId,
          projectId,
          sourceId: observation.sourceId,
          observationId: observation.id,
          artifact: safeArtifactView(artifact),
          documentType,
          detectedDocumentType,
          confidence: Number(classification?.confidence ?? 0),
          confirmationState: classification?.confirmationState ?? null,
          readiness,
          reasons: [
            activeMapping ? "learned_type_mapping_applied"
              : classification ? "document_type_detected" : "classification_missing",
            current ? "classification_confirmed" : "classification_needs_confirmation",
            history.length ? "similar_history_found" : "similar_history_missing",
          ],
          riskSignals: (classification?.riskSignals ?? []).slice(0, 10),
          actions,
          learnedRule: activeRule ? {
            id: activeRule.id,
            version: activeRule.version,
            applied: Boolean(ruleConfig),
          } : null,
          history,
          automation: {
            eligible: automationEligible,
            confidenceThreshold: Number(ruleConfig?.confidenceThreshold ?? AUTO_CONFIDENCE_THRESHOLD),
            historyThreshold: AUTO_HISTORY_THRESHOLD,
            reasons: [
              ...(!AUTO_DOCUMENT_TYPES.has(documentType) ? ["document_type_not_auto_enabled"] : []),
              ...(Number(classification?.confidence ?? 0)
                < Number(ruleConfig?.confidenceThreshold ?? AUTO_CONFIDENCE_THRESHOLD)
                ? ["confidence_below_threshold"] : []),
              ...(risky ? ["risk_signals_present"] : []),
              ...(history.length < AUTO_HISTORY_THRESHOLD ? ["insufficient_confirmed_history"] : []),
              ...(feedback?.decision === "rejected" ? ["user_rejected_suggestion"] : []),
            ],
          },
          issue: issue ? {
            id: issue.id,
            localRef: issue.localRef,
            title: issue.title,
            status: issue.status,
          } : null,
          outcome: outcomeView(outcome),
          feedback: feedback ? {
            decision: feedback.decision,
            reason: feedback.reason,
            note: feedback.note,
            createdAt: feedback.createdAt,
          } : null,
        };
      })
      .sort((a, b) => a.issue === b.issue ? a.id.localeCompare(b.id) : a.issue ? 1 : -1)
      .slice(0, 50);
  }

  function resolveSuggestion(input, actor) {
    const projectId = text(input?.projectId, 100);
    const sourceId = text(input?.sourceId, 100);
    if (!projectId || !projectFor(projectId, actor)) return null;
    return suggestionsFor({ projectId, sourceId }, actor)
      .find((row) => row.id === input.suggestionId) ?? null;
  }

  function getWorkbench(input = {}, actor = null) {
    const projectId = text(input.projectId, 100);
    const sourceId = text(input.sourceId, 100);
    if (!projectId || !projectFor(projectId, actor)) {
      return { status: 404, body: { error: "adaptive_work_project_not_found" } };
    }
    if (sourceId && !sourceFor(sourceId, projectId, actor)) {
      return { status: 404, body: { error: "adaptive_work_source_not_found" } };
    }
    if (!canUse(actor)) return { status: 403, body: { error: "adaptive_work_forbidden" } };
    const shadowDraft = sourceId ? latestShadowDraft(projectId, sourceId, actor) : null;
    const suggestions = suggestionsFor({ projectId, sourceId }, actor)
      .map((row) => ({ ...row, shadow: shadowComparisonFor(row, shadowDraft) }));
    const accepted = suggestions.filter((row) => row.feedback?.decision === "accepted").length;
    const rejected = suggestions.filter((row) => row.feedback?.decision === "rejected").length;
    const completed = suggestions.filter((row) => row.outcome?.status === "completed").length;
    const tracked = suggestions.filter((row) => row.outcome).length;
    return {
      status: 200,
      body: {
        policy: policyView(projectId, sourceId, actor),
        monitor: sourceId ? monitorView(projectId, sourceId, actor) : null,
        suggestions,
        metrics: {
          total: suggestions.length,
          ready: suggestions.filter((row) => row.readiness === "ready").length,
          needsAttention: suggestions.filter((row) => row.readiness !== "ready").length,
          materialized: suggestions.filter((row) => row.issue).length,
          automationEligible: suggestions.filter((row) => row.automation.eligible).length,
          accepted,
          rejected,
          acceptanceRate: accepted + rejected ? accepted / (accepted + rejected) : null,
          tracked,
          completed,
          completionRate: tracked ? completed / tracked : null,
        },
        permissions: { canUse: canUse(actor), canManage: canManage(actor) },
      },
    };
  }

  function safeOutputAssets(workItem) {
    return (workItem?.outputAssets ?? []).slice(0, 100).map((asset) => ({
      id: text(asset?.id, 200),
      family: text(asset?.family, 80),
      name: text(asset?.name, 300),
      path: text(asset?.path, 1_000),
    })).filter((asset) => asset.id || asset.path || asset.name);
  }

  function outcomeStatus(workItem) {
    if (workItem?.status === "done") return "completed";
    if (workItem?.status === "blocked") return "blocked";
    if (workItem?.state === "closed") return "closed";
    return "active";
  }

  function upsertOutcome(suggestion, workItem, actor) {
    if (!suggestion || !workItem) return null;
    const timestamp = now();
    const current = outcomeFor(suggestion.id, actor);
    const values = {
      workItemId: workItem.id,
      localRef: workItem.localRef ?? null,
      documentType: suggestion.documentType,
      status: outcomeStatus(workItem),
      workItemStatus: workItem.status ?? null,
      completedAt: workItem.completedAt ?? (workItem.status === "done" ? timestamp : null),
      outputAssets: safeOutputAssets(workItem),
      verification: (workItem.verificationRecords ?? []).slice(0, 20).map((record) => ({
        id: record.id,
        kind: record.kind,
        status: record.status,
        summary: text(record.summary, 500),
        recordedAt: record.recordedAt,
      })),
      updatedAt: timestamp,
    };
    if (current) Object.assign(current, values);
    else state.workflowAdaptiveOutcomes.push({
      id: nextId("awo"),
      ownerTeamId: actorTeam(actor),
      projectId: suggestion.projectId,
      sourceId: suggestion.sourceId,
      suggestionId: suggestion.id,
      observationId: suggestion.observationId,
      artifactId: suggestion.artifact?.id ?? null,
      createdAt: timestamp,
      createdBy: actorUser(actor),
      ...values,
    });
    return current ?? state.workflowAdaptiveOutcomes.at(-1);
  }

  function syncOutcomes(input = {}, actor = null) {
    const projectId = text(input.projectId, 100);
    const sourceId = text(input.sourceId, 100);
    if (!projectId || !projectFor(projectId, actor)) {
      return { status: 404, body: { error: "adaptive_work_project_not_found" } };
    }
    if (sourceId && !sourceFor(sourceId, projectId, actor)) {
      return { status: 404, body: { error: "adaptive_work_source_not_found" } };
    }
    if (!canUse(actor)) return { status: 403, body: { error: "adaptive_work_forbidden" } };
    const suggestions = suggestionsFor({ projectId, sourceId }, actor);
    const suggestionsById = new Map(suggestions.map((row) => [row.id, row]));
    let created = 0;
    let updated = 0;
    runTx(() => {
      for (const workItem of (state.workItems ?? []).filter((row) =>
        row.ownerTeamId === actorTeam(actor)
        && row.projectId === projectId
        && String(row.createIdempotencyKey ?? "").startsWith("adaptive-work:v1:"))) {
        const suggestionId = String(workItem.createIdempotencyKey).slice("adaptive-work:v1:".length);
        const suggestion = suggestionsById.get(suggestionId);
        const current = outcomeFor(suggestionId, actor);
        if (!suggestion && !current) continue;
        const basis = suggestion ?? {
          id: current.suggestionId,
          projectId: current.projectId,
          sourceId: current.sourceId,
          observationId: current.observationId,
          documentType: current.documentType,
          artifact: { id: current.artifactId },
        };
        if (sourceId && basis.sourceId !== sourceId) continue;
        upsertOutcome(basis, workItem, actor);
        if (current) updated += 1;
        else created += 1;
      }
      appendEvent({
        invocationId: null,
        type: "workflow_adaptive_outcomes_synced",
        level: "info",
        message: "Adaptive Issue outcomes synchronized.",
        data: {
          projectId,
          sourceId: sourceId ?? null,
          created,
          updated,
          actorTeamId: actorTeam(actor),
          actorId: actorUser(actor),
        },
      });
    });
    return {
      status: 200,
      body: {
        created,
        updated,
        outcomes: state.workflowAdaptiveOutcomes
          .filter((row) => row.ownerTeamId === actorTeam(actor)
            && row.projectId === projectId
            && (!sourceId || row.sourceId === sourceId))
          .map(outcomeView),
      },
    };
  }

  function syncWorkItemOutcome(input = {}, actor = null) {
    const workItemId = text(input.workItemId, 100);
    const workItem = (state.workItems ?? []).find((row) =>
      row.id === workItemId && row.ownerTeamId === actorTeam(actor));
    if (!workItem || !actorCanAccessProject(state, actor, workItem.projectId)) {
      return { status: 404, body: { error: "adaptive_work_item_not_found" } };
    }
    const key = String(workItem.createIdempotencyKey ?? "");
    if (!key.startsWith("adaptive-work:v1:")) {
      return { status: 200, body: { tracked: false } };
    }
    const suggestionId = key.slice("adaptive-work:v1:".length);
    const current = outcomeFor(suggestionId, actor);
    const suggestion = suggestionsFor({ projectId: workItem.projectId }, actor)
      .find((row) => row.id === suggestionId);
    if (!suggestion && !current) return { status: 200, body: { tracked: false } };
    const basis = suggestion ?? {
      id: current.suggestionId,
      projectId: current.projectId,
      sourceId: current.sourceId,
      observationId: current.observationId,
      documentType: current.documentType,
      artifact: { id: current.artifactId },
    };
    let outcome;
    runTx(() => {
      outcome = upsertOutcome(basis, workItem, actor);
      appendEvent({
        invocationId: null,
        type: "workflow_adaptive_outcome_updated",
        level: "info",
        message: "An adaptive Issue outcome was updated immediately.",
        data: {
          projectId: workItem.projectId,
          sourceId: basis.sourceId,
          suggestionId,
          workItemId,
          status: outcome.status,
          actorId: actorUser(actor),
        },
      });
    });
    return { status: 200, body: { tracked: true, outcome: outcomeView(outcome) } };
  }

  function learningEvidence(projectId, sourceId, actor) {
    const latest = new Map();
    for (const row of state.workflowAdaptiveFeedback) {
      if (row.ownerTeamId === actorTeam(actor)
        && row.projectId === projectId
        && row.sourceId === sourceId) latest.set(row.suggestionId, row);
    }
    return [...latest.values()];
  }

  function learningView(projectId, sourceId, actor) {
    const evidence = learningEvidence(projectId, sourceId, actor);
    const accepted = evidence.filter((row) => row.decision === "accepted").length;
    return {
      readiness: {
        evidenceCount: evidence.length,
        accepted,
        rejected: evidence.length - accepted,
        draftRequired: LEARNING_MIN_EVIDENCE,
        evaluationRequired: EVALUATION_MIN_SAMPLES,
        canGenerate: evidence.length >= LEARNING_MIN_EVIDENCE,
        canEvaluate: evidence.length >= EVALUATION_MIN_SAMPLES,
      },
      drafts: state.workflowAdaptiveLearningDrafts
        .filter((row) => row.ownerTeamId === actorTeam(actor)
          && row.projectId === projectId
          && row.sourceId === sourceId)
        .sort((a, b) => Number(b.version) - Number(a.version)),
      rules: state.workflowAdaptiveRules
        .filter((row) => row.ownerTeamId === actorTeam(actor)
          && row.projectId === projectId
          && row.sourceId === sourceId)
        .sort((a, b) => Number(b.version) - Number(a.version)),
    };
  }

  function listLearning(input = {}, actor = null) {
    const projectId = text(input.projectId, 100);
    const sourceId = text(input.sourceId, 100);
    if (!projectId || !projectFor(projectId, actor)) {
      return { status: 404, body: { error: "adaptive_work_project_not_found" } };
    }
    if (!sourceId || !sourceFor(sourceId, projectId, actor)) {
      return { status: 404, body: { error: "adaptive_work_source_not_found" } };
    }
    if (!canUse(actor)) return { status: 403, body: { error: "adaptive_work_forbidden" } };
    return { status: 200, body: learningView(projectId, sourceId, actor) };
  }

  function generateLearningDraft(input = {}, actor = null) {
    const projectId = text(input.projectId, 100);
    const sourceId = text(input.sourceId, 100);
    if (!projectId || !projectFor(projectId, actor)) {
      return { status: 404, body: { error: "adaptive_work_project_not_found" } };
    }
    if (!canManage(actor)) return { status: 403, body: { error: "adaptive_work_learning_forbidden" } };
    if (!sourceId || !sourceFor(sourceId, projectId, actor)) {
      return { status: 404, body: { error: "adaptive_work_source_not_found" } };
    }
    const evidence = learningEvidence(projectId, sourceId, actor);
    if (evidence.length < LEARNING_MIN_EVIDENCE) {
      return {
        status: 409,
        body: {
          error: "adaptive_work_learning_evidence_insufficient",
          evidenceCount: evidence.length,
          required: LEARNING_MIN_EVIDENCE,
        },
      };
    }
    const accepted = evidence.filter((row) => row.decision === "accepted").length;
    const acceptanceRate = accepted / evidence.length;
    const grouped = new Map();
    const mappings = new Map();
    for (const row of evidence) {
      if (row.decision === "rejected"
        && !row.correctedDocumentType
        && !(row.correctedActions ?? []).length) continue;
      const documentType = DOCUMENT_TYPES.has(row.correctedDocumentType)
        ? row.correctedDocumentType
        : row.documentType;
      if (!DOCUMENT_TYPES.has(documentType)) continue;
      const current = grouped.get(documentType) ?? { documentType, evidenceCount: 0, actions: [] };
      current.evidenceCount += 1;
      for (const action of row.correctedActions?.length
        ? row.correctedActions
        : ACTIONS_BY_TYPE[documentType] ?? []) {
        if (!current.actions.includes(action)) current.actions.push(action);
      }
      grouped.set(documentType, current);
      if (row.correctionConfirmed
        && DOCUMENT_TYPES.has(row.documentType)
        && DOCUMENT_TYPES.has(row.correctedDocumentType)
        && row.documentType !== row.correctedDocumentType) {
        const key = `${row.documentType}:${row.correctedDocumentType}`;
        const mapping = mappings.get(key) ?? {
          fromDocumentType: row.documentType,
          toDocumentType: row.correctedDocumentType,
          evidenceCount: 0,
        };
        mapping.evidenceCount += 1;
        mappings.set(key, mapping);
      }
    }
    const version = Math.max(0, ...state.workflowAdaptiveLearningDrafts
      .filter((row) => row.ownerTeamId === actorTeam(actor)
        && row.projectId === projectId && row.sourceId === sourceId)
      .map((row) => Number(row.version ?? 0))) + 1;
    const timestamp = now();
    const draft = {
      id: nextId("awld"),
      ownerTeamId: actorTeam(actor),
      projectId,
      sourceId,
      version,
      revision: 1,
      status: "shadow",
      evidenceIds: evidence.map((row) => row.id),
      configuration: {
        documentTypes: [...grouped.values()].map((row) => ({
          ...row,
          actions: row.actions.slice(0, 10),
          confidenceThreshold: acceptanceRate >= 0.9 ? 0.9 : 0.95,
        })),
        typeMappings: [...mappings.values()],
      },
      shadowComparisons: [],
      evaluation: {
        evidenceCount: evidence.length,
        accepted,
        rejected: evidence.length - accepted,
        acceptanceRate,
        completionRate: null,
        representative: false,
        passed: false,
        reasons: ["shadow_evaluation_required"],
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorUser(actor),
      updatedBy: actorUser(actor),
    };
    runTx(() => {
      state.workflowAdaptiveLearningDrafts.push(draft);
      appendEvent({
        invocationId: null,
        type: "workflow_adaptive_learning_draft_created",
        level: "info",
        message: "A versioned adaptive learning draft was created.",
        data: { projectId, sourceId, draftId: draft.id, version, actorId: actorUser(actor) },
      });
    });
    return { status: 201, body: { draft } };
  }

  function sourceEvaluation(projectId, sourceId, actor, comparisons = []) {
    const feedback = learningEvidence(projectId, sourceId, actor);
    const accepted = feedback.filter((row) => row.decision === "accepted").length;
    const rejected = feedback.filter((row) => row.decision === "rejected").length;
    const outcomes = state.workflowAdaptiveOutcomes.filter((row) =>
      row.ownerTeamId === actorTeam(actor)
      && row.projectId === projectId
      && row.sourceId === sourceId);
    const completed = outcomes.filter((row) => row.status === "completed").length;
    const acceptanceRate = feedback.length ? accepted / feedback.length : null;
    const rejectionRate = feedback.length ? rejected / feedback.length : null;
    const completionRate = outcomes.length ? completed / outcomes.length : null;
    const representative = feedback.length >= EVALUATION_MIN_SAMPLES;
    const preferences = comparisons.map((row) => row.preference).filter(Boolean);
    const candidateWins = preferences.filter((row) => row.preferred === "candidate").length;
    const currentWins = preferences.filter((row) => row.preferred === "current").length;
    const neitherWins = preferences.filter((row) => row.preferred === "neither").length;
    const shadowRepresentative = preferences.length >= EVALUATION_MIN_SHADOW_PREFERENCES;
    const comparablePreferences = candidateWins + currentWins;
    const candidateWinRate = comparablePreferences ? candidateWins / comparablePreferences : null;
    const regressionRate = comparablePreferences ? currentWins / comparablePreferences : null;
    const candidatePreferred = shadowRepresentative
      && candidateWins > currentWins
      && candidateWins > neitherWins;
    const reasons = [
      ...(!representative ? ["insufficient_feedback_samples"] : []),
      ...(acceptanceRate != null && acceptanceRate < LEARNING_MIN_ACCEPTANCE_RATE
        ? ["acceptance_rate_below_gate"] : []),
      ...(outcomes.length >= EVALUATION_MIN_SAMPLES
        && completionRate < EVALUATION_MIN_COMPLETION_RATE
        ? ["completion_rate_below_gate"] : []),
      ...(!shadowRepresentative ? ["insufficient_shadow_preferences"] : []),
      ...(shadowRepresentative && candidateWins < currentWins
        ? ["shadow_candidate_regression"] : []),
      ...(shadowRepresentative && !candidatePreferred && candidateWins >= currentWins
        ? ["shadow_candidate_not_preferred"] : []),
    ];
    return {
      evaluatedAt: now(),
      evidenceCount: feedback.length,
      accepted,
      rejected,
      acceptanceRate,
      rejectionRate,
      trackedOutcomes: outcomes.length,
      completedOutcomes: completed,
      completionRate,
      representative,
      shadow: {
        comparisonCount: comparisons.length,
        preferenceCount: preferences.length,
        candidateWins,
        currentWins,
        neitherWins,
        candidateWinRate,
        regressionRate,
        representative: shadowRepresentative,
        required: EVALUATION_MIN_SHADOW_PREFERENCES,
      },
      passed: representative && shadowRepresentative && candidatePreferred && reasons.length === 0,
      reasons,
    };
  }

  function evaluateAndGovern(input = {}, actor = null) {
    const projectId = text(input.projectId, 100);
    const sourceId = text(input.sourceId, 100);
    if (!projectId || !projectFor(projectId, actor)) {
      return { status: 404, body: { error: "adaptive_work_project_not_found" } };
    }
    if (!sourceId || !sourceFor(sourceId, projectId, actor)) {
      return { status: 404, body: { error: "adaptive_work_source_not_found" } };
    }
    if (!canManage(actor)) return { status: 403, body: { error: "adaptive_work_learning_forbidden" } };
    const timestamp = now();
    const latestDraft = latestShadowDraft(projectId, sourceId, actor);
    const comparisons = latestDraft
      ? suggestionsFor({ projectId, sourceId }, actor).map((suggestion) => ({
        ...shadowComparisonFor(suggestion, latestDraft),
        evaluatedAt: timestamp,
      }))
      : [];
    const evaluation = sourceEvaluation(projectId, sourceId, actor, comparisons);
    let downgraded = false;
    let previousMode = null;
    runTx(() => {
      if (latestDraft) {
        latestDraft.shadowComparisons = comparisons.slice(0, 50);
        latestDraft.evaluation = evaluation;
        latestDraft.revision += 1;
        latestDraft.updatedAt = timestamp;
        latestDraft.updatedBy = actorUser(actor);
      }
      const policy = scopedPolicyFor(projectId, sourceId, actor);
      const acceptanceUnsafe = evaluation.representative
        && (evaluation.acceptanceRate < 0.7 || evaluation.rejectionRate > 0.2);
      const completionUnsafe = evaluation.trackedOutcomes >= EVALUATION_MIN_SAMPLES
        && evaluation.completionRate < EVALUATION_MIN_COMPLETION_RATE;
      if (policy?.mode === "execute" && (acceptanceUnsafe || completionUnsafe)) {
        previousMode = policy.mode;
        policy.mode = "assist";
        policy.revision += 1;
        policy.updatedAt = timestamp;
        policy.updatedBy = "system_evaluation_gate";
        downgraded = true;
        addMonitorNotification({ ownerTeamId: actorTeam(actor), projectId, sourceId },
          "automation_downgraded", "执行模式未通过评测门禁，已自动降级为辅助模式。", timestamp);
        appendEvent({
          invocationId: null,
          type: "workflow_adaptive_policy_auto_downgraded",
          level: "warning",
          message: "Execute policy was automatically downgraded after evaluation.",
          data: { projectId, sourceId, previousMode, nextMode: "assist", evaluation },
        });
      }
      appendEvent({
        invocationId: null,
        type: "workflow_adaptive_evaluation_completed",
        level: evaluation.passed ? "info" : "warning",
        message: "Adaptive workflow shadow evaluation completed.",
        data: { projectId, sourceId, passed: evaluation.passed, actorId: actorUser(actor) },
      });
    });
    return {
      status: 200,
      body: {
        evaluation,
        governance: {
          downgraded,
          previousMode,
          currentMode: policyView(projectId, sourceId, actor).mode,
        },
      },
    };
  }

  function recordShadowPreference(input = {}, actor = null) {
    if (!canUse(actor)) return { status: 403, body: { error: "adaptive_work_forbidden" } };
    const draftId = text(input.draftId, 100);
    const suggestionId = text(input.suggestionId, 100);
    const draft = state.workflowAdaptiveLearningDrafts.find((row) =>
      row.id === draftId
      && row.ownerTeamId === actorTeam(actor)
      && actorCanAccessProject(state, actor, row.projectId));
    if (!draft || draft.status !== "shadow") {
      return { status: 404, body: { error: "adaptive_work_learning_draft_not_found" } };
    }
    if (Number(input.expectedRevision) !== Number(draft.revision)) {
      return {
        status: 409,
        body: { error: "adaptive_work_learning_revision_conflict", currentRevision: draft.revision },
      };
    }
    if (input.confirmed !== true) {
      return { status: 400, body: { error: "adaptive_work_shadow_preference_confirmation_required" } };
    }
    if (!["current", "candidate", "neither"].includes(input.preferred)) {
      return { status: 400, body: { error: "adaptive_work_shadow_preference_invalid" } };
    }
    const reason = text(input.reason, 200);
    if (!reason) return { status: 400, body: { error: "adaptive_work_shadow_preference_invalid" } };
    const suggestion = suggestionsFor({
      projectId: draft.projectId,
      sourceId: draft.sourceId,
    }, actor).find((row) => row.id === suggestionId);
    if (!suggestion) return { status: 404, body: { error: "adaptive_work_suggestion_not_found" } };
    const comparison = shadowComparisonFor(suggestion, draft);
    if (!Object.values(comparison.differences).some(Boolean)) {
      return { status: 409, body: { error: "adaptive_work_shadow_no_difference" } };
    }
    const timestamp = now();
    comparison.preference = {
      preferred: input.preferred,
      reason,
      confirmed: true,
      decidedAt: timestamp,
      decidedBy: actorUser(actor),
    };
    comparison.evaluatedAt = timestamp;
    runTx(() => {
      const index = (draft.shadowComparisons ??= []).findIndex((row) =>
        row.suggestionId === suggestion.id);
      if (index >= 0) draft.shadowComparisons[index] = comparison;
      else draft.shadowComparisons.push(comparison);
      draft.shadowComparisons = draft.shadowComparisons.slice(-50);
      draft.revision += 1;
      draft.updatedAt = timestamp;
      draft.updatedBy = actorUser(actor);
      appendEvent({
        invocationId: null,
        type: "workflow_adaptive_shadow_preference_recorded",
        level: "info",
        message: "A human preference was recorded for a shadow rule comparison.",
        data: {
          projectId: draft.projectId,
          sourceId: draft.sourceId,
          draftId: draft.id,
          suggestionId: suggestion.id,
          preferred: input.preferred,
          actorId: actorUser(actor),
        },
      });
    });
    return { status: 201, body: { comparison, draftRevision: draft.revision } };
  }

  function listNotifications(input = {}, actor = null) {
    const projectId = text(input.projectId, 100);
    const sourceId = text(input.sourceId, 100);
    if (!projectId || !projectFor(projectId, actor)) {
      return { status: 404, body: { error: "adaptive_work_project_not_found" } };
    }
    if (sourceId && !sourceFor(sourceId, projectId, actor)) {
      return { status: 404, body: { error: "adaptive_work_source_not_found" } };
    }
    if (!canUse(actor)) return { status: 403, body: { error: "adaptive_work_forbidden" } };
    const notifications = state.workflowAdaptiveNotifications
      .filter((row) => row.ownerTeamId === actorTeam(actor)
        && row.projectId === projectId
        && (!sourceId || row.sourceId === sourceId))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 50);
    return {
      status: 200,
      body: {
        notifications,
        unread: notifications.filter((row) => row.state === "unread").length,
      },
    };
  }

  function previewLearningPublication(input = {}, actor = null) {
    if (!canManage(actor)) return { status: 403, body: { error: "adaptive_work_learning_forbidden" } };
    const draftId = text(input.draftId, 100);
    const draft = state.workflowAdaptiveLearningDrafts.find((row) =>
      row.id === draftId
      && row.ownerTeamId === actorTeam(actor)
      && actorCanAccessProject(state, actor, row.projectId));
    if (!draft || draft.status !== "shadow") {
      return { status: 404, body: { error: "adaptive_work_learning_draft_not_found" } };
    }
    const activeRule = activeRuleFor(draft.projectId, draft.sourceId, actor);
    const suggestions = suggestionsFor({ projectId: draft.projectId, sourceId: draft.sourceId }, actor);
    const comparisons = suggestions.map((suggestion) => shadowComparisonFor(suggestion, draft));
    const changedComparisons = comparisons.filter((comparison) =>
      Object.values(comparison.differences).some(Boolean));
    const currentTypes = new Map((activeRule?.configuration?.documentTypes ?? [])
      .map((row) => [row.documentType, row]));
    const changes = (draft.configuration?.documentTypes ?? []).map((candidate) => {
      const current = currentTypes.get(candidate.documentType);
      return {
        documentType: candidate.documentType,
        before: current ? {
          actions: current.actions,
          confidenceThreshold: current.confidenceThreshold,
        } : null,
        after: {
          actions: candidate.actions,
          confidenceThreshold: candidate.confidenceThreshold,
        },
        actionChanges: {
          added: candidate.actions.filter((action) => !current?.actions?.includes(action)),
          removed: (current?.actions ?? []).filter((action) => !candidate.actions.includes(action)),
        },
      };
    });
    const fingerprint = digest(JSON.stringify({
      draftId: draft.id,
      revision: draft.revision,
      evaluation: draft.evaluation,
      configuration: draft.configuration,
      activeRuleId: activeRule?.id ?? null,
    }));
    return {
      status: 200,
      body: {
        review: {
          draftId: draft.id,
          draftVersion: draft.version,
          draftRevision: draft.revision,
          fingerprint,
          gate: {
            passed: Boolean(draft.evaluation?.passed),
            reasons: draft.evaluation?.reasons ?? [],
            evaluation: draft.evaluation,
          },
          evidence: {
            count: draft.evidenceIds?.length ?? 0,
            ids: (draft.evidenceIds ?? []).slice(0, 100),
          },
          changes,
          typeMappings: draft.configuration?.typeMappings ?? [],
          impact: {
            observedSuggestions: suggestions.length,
            affectedSuggestions: changedComparisons.length,
            automationEligible: suggestions.filter((row) => row.automation.eligible).length,
            executeMode: policyView(draft.projectId, draft.sourceId, actor).mode === "execute",
          },
          rollback: activeRule ? {
            available: true,
            ruleId: activeRule.id,
            version: activeRule.version,
          } : { available: false, ruleId: null, version: null },
          boundary: {
            candidateAppliedBeforePublish: false,
            localIssueOnly: true,
            externalDelivery: false,
          },
        },
      },
    };
  }

  function readNotification(input = {}, actor = null) {
    if (!canUse(actor)) return { status: 403, body: { error: "adaptive_work_forbidden" } };
    const notificationId = text(input.notificationId, 100);
    const notification = state.workflowAdaptiveNotifications.find((row) =>
      row.id === notificationId
      && row.ownerTeamId === actorTeam(actor)
      && actorCanAccessProject(state, actor, row.projectId));
    if (!notification) return { status: 404, body: { error: "adaptive_work_notification_not_found" } };
    if (notification.state !== "read") {
      runTx(() => {
        notification.state = "read";
        notification.readAt = now();
        notification.readBy = actorUser(actor);
      });
    }
    return { status: 200, body: { notification } };
  }

  function publishLearningDraft(input = {}, actor = null) {
    if (!canManage(actor)) return { status: 403, body: { error: "adaptive_work_learning_forbidden" } };
    const draftId = text(input.draftId, 100);
    const draft = state.workflowAdaptiveLearningDrafts.find((row) =>
      row.id === draftId
      && row.ownerTeamId === actorTeam(actor)
      && actorCanAccessProject(state, actor, row.projectId));
    if (!draft) return { status: 404, body: { error: "adaptive_work_learning_draft_not_found" } };
    if (input.confirmed !== true) {
      return { status: 400, body: { error: "adaptive_work_learning_publish_confirmation_required" } };
    }
    if (Number(input.expectedRevision) !== Number(draft.revision)) {
      return { status: 409, body: { error: "adaptive_work_learning_revision_conflict", currentRevision: draft.revision } };
    }
    if (draft.status !== "shadow") {
      return { status: 409, body: { error: "adaptive_work_learning_draft_not_publishable" } };
    }
    if (!draft.evaluation?.passed) {
      return { status: 409, body: { error: "adaptive_work_learning_gate_failed", evaluation: draft.evaluation } };
    }
    const review = previewLearningPublication({ draftId: draft.id }, actor);
    if (review.status !== 200 || input.reviewFingerprint !== review.body.review.fingerprint) {
      return {
        status: 409,
        body: {
          error: "adaptive_work_learning_publication_review_required",
          currentRevision: draft.revision,
        },
      };
    }
    const timestamp = now();
    const previous = activeRuleFor(draft.projectId, draft.sourceId, actor);
    const version = Math.max(0, ...state.workflowAdaptiveRules
      .filter((row) => row.ownerTeamId === actorTeam(actor)
        && row.projectId === draft.projectId && row.sourceId === draft.sourceId)
      .map((row) => Number(row.version ?? 0))) + 1;
    const rule = {
      id: nextId("awr"),
      ownerTeamId: actorTeam(actor),
      projectId: draft.projectId,
      sourceId: draft.sourceId,
      draftId: draft.id,
      version,
      revision: 1,
      status: "active",
      previousRuleId: previous?.id ?? null,
      configuration: draft.configuration,
      evaluation: draft.evaluation,
      publishedAt: timestamp,
      publishedBy: actorUser(actor),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    runTx(() => {
      if (previous) {
        previous.status = "superseded";
        previous.revision += 1;
        previous.updatedAt = timestamp;
      }
      draft.status = "published";
      draft.revision += 1;
      draft.updatedAt = timestamp;
      draft.updatedBy = actorUser(actor);
      state.workflowAdaptiveRules.push(rule);
      addMonitorNotification({
        ownerTeamId: draft.ownerTeamId,
        projectId: draft.projectId,
        sourceId: draft.sourceId,
      }, "learning_rule_published", `学习规则 v${version} 已发布。`, timestamp);
      appendEvent({
        invocationId: null,
        type: "workflow_adaptive_learning_rule_published",
        level: "info",
        message: "A governed adaptive learning rule was published.",
        data: { projectId: draft.projectId, sourceId: draft.sourceId, ruleId: rule.id, version },
      });
    });
    return { status: 201, body: { rule, previousRuleId: previous?.id ?? null } };
  }

  function rollbackLearningRule(input = {}, actor = null) {
    if (!canManage(actor)) return { status: 403, body: { error: "adaptive_work_learning_forbidden" } };
    const ruleId = text(input.ruleId, 100);
    const current = state.workflowAdaptiveRules.find((row) =>
      row.id === ruleId
      && row.ownerTeamId === actorTeam(actor)
      && actorCanAccessProject(state, actor, row.projectId));
    if (!current) return { status: 404, body: { error: "adaptive_work_learning_rule_not_found" } };
    if (input.confirmed !== true) {
      return { status: 400, body: { error: "adaptive_work_learning_rollback_confirmation_required" } };
    }
    if (current.status !== "active" || Number(input.expectedRevision) !== Number(current.revision)) {
      return { status: 409, body: { error: "adaptive_work_learning_rule_revision_conflict", currentRevision: current.revision } };
    }
    const previous = state.workflowAdaptiveRules.find((row) =>
      row.id === current.previousRuleId
      && row.ownerTeamId === actorTeam(actor));
    if (!previous) return { status: 409, body: { error: "adaptive_work_learning_previous_rule_missing" } };
    const timestamp = now();
    runTx(() => {
      current.status = "rolled_back";
      current.revision += 1;
      current.updatedAt = timestamp;
      previous.status = "active";
      previous.revision += 1;
      previous.updatedAt = timestamp;
      addMonitorNotification({
        ownerTeamId: current.ownerTeamId,
        projectId: current.projectId,
        sourceId: current.sourceId,
      }, "learning_rule_rolled_back", `学习规则已回滚到 v${previous.version}。`, timestamp);
      appendEvent({
        invocationId: null,
        type: "workflow_adaptive_learning_rule_rolled_back",
        level: "warning",
        message: "An adaptive learning rule was rolled back.",
        data: { projectId: current.projectId, sourceId: current.sourceId, ruleId, restoredRuleId: previous.id },
      });
    });
    return { status: 200, body: { rolledBackRuleId: current.id, activeRule: previous } };
  }

  function updateMonitor(input = {}, actor = null) {
    const projectId = text(input.projectId, 100);
    const sourceId = text(input.sourceId, 100);
    if (!projectId || !projectFor(projectId, actor)) {
      return { status: 404, body: { error: "adaptive_work_project_not_found" } };
    }
    if (!canManage(actor)) return { status: 403, body: { error: "adaptive_work_monitor_forbidden" } };
    if (!sourceId || !sourceFor(sourceId, projectId, actor)) {
      return { status: 404, body: { error: "adaptive_work_source_not_found" } };
    }
    if (typeof input.enabled !== "boolean") {
      return { status: 400, body: { error: "adaptive_work_monitor_enabled_invalid" } };
    }
    if (input.enabled && input.confirmed !== true) {
      return { status: 400, body: { error: "adaptive_work_monitor_confirmation_required" } };
    }
    const intervalMinutes = Number(input.intervalMinutes ?? 15);
    if (!Number.isInteger(intervalMinutes)
      || intervalMinutes < MONITOR_MIN_INTERVAL_MINUTES
      || intervalMinutes > MONITOR_MAX_INTERVAL_MINUTES) {
      return { status: 400, body: { error: "adaptive_work_monitor_interval_invalid" } };
    }
    const current = monitorFor(projectId, sourceId, actor);
    if (Number(input.expectedRevision) !== Number(current?.revision ?? 0)) {
      return {
        status: 409,
        body: {
          error: "adaptive_work_monitor_revision_conflict",
          currentRevision: current?.revision ?? 0,
        },
      };
    }
    const timestamp = now();
    runTx(() => {
      if (current) Object.assign(current, {
        enabled: input.enabled,
        intervalMinutes,
        revision: current.revision + 1,
        state: input.enabled ? "scheduled" : "disabled",
        nextRunAt: input.enabled ? timestamp : null,
        lastError: input.enabled ? current.lastError : null,
        consecutiveFailures: input.enabled ? current.consecutiveFailures : 0,
        authorizedBy: actorUser(actor),
        updatedAt: timestamp,
        updatedBy: actorUser(actor),
      });
      else state.workflowAdaptiveMonitors.push({
        id: nextId("awm"),
        ownerTeamId: actorTeam(actor),
        projectId,
        sourceId,
        enabled: input.enabled,
        intervalMinutes,
        revision: 1,
        state: input.enabled ? "scheduled" : "disabled",
        nextRunAt: input.enabled ? timestamp : null,
        lastRunAt: null,
        lastSuccessAt: null,
        lastError: null,
        consecutiveFailures: 0,
        authorizedBy: actorUser(actor),
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: actorUser(actor),
        updatedBy: actorUser(actor),
      });
      appendEvent({
        invocationId: null,
        type: "workflow_adaptive_monitor_updated",
        level: "info",
        message: "Workflow directory monitor updated.",
        data: {
          projectId,
          sourceId,
          enabled: input.enabled,
          intervalMinutes,
          actorTeamId: actorTeam(actor),
          actorId: actorUser(actor),
        },
      });
    });
    return { status: 200, body: { monitor: monitorView(projectId, sourceId, actor) } };
  }

  function boundedMonitorError(error) {
    return text(String(error?.code ?? error?.message ?? "adaptive_work_monitor_failed"), 200)
      ?? "adaptive_work_monitor_failed";
  }

  function addMonitorNotification(monitor, kind, message, timestamp) {
    state.workflowAdaptiveNotifications.push({
      id: nextId("awn"),
      ownerTeamId: monitor.ownerTeamId,
      projectId: monitor.projectId,
      sourceId: monitor.sourceId,
      kind,
      message,
      state: "unread",
      createdAt: timestamp,
    });
    if (state.workflowAdaptiveNotifications.length > 5_000) {
      state.workflowAdaptiveNotifications.splice(0, state.workflowAdaptiveNotifications.length - 5_000);
    }
  }

  async function executeMonitor(monitor) {
    const activeKey = `${monitor.ownerTeamId}:${monitor.sourceId}`;
    if (activeMonitorSources.has(activeKey)) return { skipped: true, reason: "already_running" };
    activeMonitorSources.add(activeKey);
    const startedAt = now();
    const priorFailures = Number(monitor.consecutiveFailures ?? 0);
    runTx(() => {
      monitor.state = "running";
      monitor.lastRunAt = startedAt;
      monitor.updatedAt = startedAt;
    });
    try {
      if (typeof runIntakeCycle !== "function") throw new Error("adaptive_work_monitor_runner_unavailable");
      const actor = {
        userId: monitor.authorizedBy,
        teamId: monitor.ownerTeamId,
        role: "owner",
      };
      const result = await runIntakeCycle({
        projectId: monitor.projectId,
        sourceId: monitor.sourceId,
      }, actor);
      if (result?.status >= 400) {
        const error = new Error(result.body?.error ?? "adaptive_work_monitor_cycle_failed");
        error.code = result.body?.error;
        throw error;
      }
      evaluateAndGovern({ projectId: monitor.projectId, sourceId: monitor.sourceId }, actor);
      const completedAt = now();
      runTx(() => {
        monitor.state = "scheduled";
        monitor.lastSuccessAt = completedAt;
        monitor.lastError = null;
        monitor.consecutiveFailures = 0;
        monitor.nextRunAt = new Date(Date.parse(completedAt)
          + monitor.intervalMinutes * 60_000).toISOString();
        monitor.updatedAt = completedAt;
        if (priorFailures > 0) {
          addMonitorNotification(monitor, "monitor_recovered", "目录监控已恢复。", completedAt);
        }
        appendEvent({
          invocationId: null,
          type: "workflow_adaptive_monitor_succeeded",
          level: "info",
          message: "Workflow directory monitor completed.",
          data: { projectId: monitor.projectId, sourceId: monitor.sourceId },
        });
      });
      return { monitorId: monitor.id, status: "succeeded", result };
    } catch (error) {
      const failedAt = now();
      const failures = priorFailures + 1;
      const delayMinutes = Math.min(
        monitor.intervalMinutes * (2 ** Math.min(failures, 10)),
        MONITOR_MAX_BACKOFF_MINUTES,
      );
      runTx(() => {
        monitor.state = "backoff";
        monitor.lastError = boundedMonitorError(error);
        monitor.consecutiveFailures = failures;
        monitor.nextRunAt = new Date(Date.parse(failedAt) + delayMinutes * 60_000).toISOString();
        monitor.updatedAt = failedAt;
        if (failures === 1 || failures === 3) {
          addMonitorNotification(monitor, "monitor_failed", "目录监控运行失败，已自动退避重试。", failedAt);
        }
        appendEvent({
          invocationId: null,
          type: "workflow_adaptive_monitor_failed",
          level: "warning",
          message: "Workflow directory monitor failed and entered backoff.",
          data: {
            projectId: monitor.projectId,
            sourceId: monitor.sourceId,
            failures,
            error: monitor.lastError,
          },
        });
      });
      return { monitorId: monitor.id, status: "failed", error: monitor.lastError };
    } finally {
      activeMonitorSources.delete(activeKey);
    }
  }

  async function sweepMonitors() {
    const timestamp = now();
    const candidates = state.workflowAdaptiveMonitors
      .filter((row) => row.enabled
        && row.nextRunAt
        && Date.parse(row.nextRunAt) <= Date.parse(timestamp)
        && !activeMonitorSources.has(`${row.ownerTeamId}:${row.sourceId}`)
        && sourceFor(row.sourceId, row.projectId, {
          teamId: row.ownerTeamId,
          userId: row.authorizedBy,
          role: "owner",
        }))
      .sort((a, b) => String(a.nextRunAt).localeCompare(String(b.nextRunAt)));
    const due = candidates.slice(0, MONITOR_SWEEP_LIMIT);
    const results = await Promise.all(due.map((monitor) => executeMonitor(monitor)));
    return { attempted: due.length, results, capped: candidates.length > MONITOR_SWEEP_LIMIT };
  }

  async function runMonitorNow(input = {}, actor = null) {
    const projectId = text(input.projectId, 100);
    const sourceId = text(input.sourceId, 100);
    if (!projectId || !projectFor(projectId, actor)) {
      return { status: 404, body: { error: "adaptive_work_project_not_found" } };
    }
    if (!sourceId || !sourceFor(sourceId, projectId, actor)) {
      return { status: 404, body: { error: "adaptive_work_source_not_found" } };
    }
    if (!canUse(actor)) return { status: 403, body: { error: "adaptive_work_forbidden" } };
    const monitor = monitorFor(projectId, sourceId, actor);
    if (!monitor?.enabled) {
      return { status: 409, body: { error: "adaptive_work_monitor_disabled" } };
    }
    const activeKey = `${monitor.ownerTeamId}:${monitor.sourceId}`;
    if (activeMonitorSources.has(activeKey)) {
      return { status: 409, body: { error: "adaptive_work_monitor_already_running" } };
    }
    const result = await executeMonitor(monitor);
    return {
      status: result.status === "succeeded" ? 200 : 502,
      body: {
        result,
        monitor: monitorView(projectId, sourceId, actor),
        workbench: getWorkbench({ projectId, sourceId }, actor).body,
      },
    };
  }

  function updatePolicy(input = {}, actor = null) {
    const projectId = text(input.projectId, 100);
    const sourceId = text(input.sourceId, 100);
    if (!projectId || !projectFor(projectId, actor)) {
      return { status: 404, body: { error: "adaptive_work_project_not_found" } };
    }
    if (!canManage(actor)) return { status: 403, body: { error: "adaptive_work_policy_forbidden" } };
    if (sourceId && !sourceFor(sourceId, projectId, actor)) {
      return { status: 404, body: { error: "adaptive_work_source_not_found" } };
    }
    if (!POLICY_MODES.has(input.mode)) {
      return { status: 400, body: { error: "adaptive_work_policy_mode_invalid" } };
    }
    if (input.mode === "execute" && input.confirmed !== true) {
      return { status: 400, body: { error: "adaptive_work_execute_confirmation_required" } };
    }
    const current = scopedPolicyFor(projectId, sourceId, actor);
    if (Number(input.expectedRevision) !== Number(current?.revision ?? 0)) {
      return { status: 409, body: { error: "adaptive_work_policy_revision_conflict", currentRevision: current?.revision ?? 0 } };
    }
    const timestamp = now();
    runTx(() => {
      if (current) Object.assign(current, {
        mode: input.mode,
        revision: current.revision + 1,
        updatedAt: timestamp,
        updatedBy: actorUser(actor),
      });
      else state.workflowAdaptivePolicies.push({
        id: nextId("awp"),
        ownerTeamId: actorTeam(actor),
        projectId,
        sourceId: sourceId ?? null,
        mode: input.mode,
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: actorUser(actor),
        updatedBy: actorUser(actor),
      });
      appendEvent({
        invocationId: null,
        type: "workflow_adaptive_policy_updated",
        level: "info",
        message: "Workflow assistance policy updated.",
        data: {
          projectId,
          sourceId: sourceId ?? null,
          mode: input.mode,
          actorTeamId: actorTeam(actor),
          actorId: actorUser(actor),
        },
      });
    });
    return { status: 200, body: { policy: policyView(projectId, sourceId, actor) } };
  }

  function createIssueFromSuggestion(suggestion, actor, { automatic = false } = {}) {
    if (suggestion.issue) {
      return {
        status: 200,
        body: {
          workItem: suggestion.issue,
          replayed: true,
          workbench: getWorkbench({
            projectId: suggestion.projectId,
            sourceId: suggestion.sourceId,
          }, actor).body,
        },
      };
    }
    if (typeof createWorkItem !== "function") {
      return { status: 503, body: { error: "adaptive_work_issue_service_unavailable" } };
    }
    const created = createWorkItem({
      projectId: suggestion.projectId,
      idempotencyKey: `adaptive-work:v1:${suggestion.id}`,
      title: `${suggestion.actions[0]}：${suggestion.artifact?.name ?? suggestion.documentType}`,
      body: [
        "由岗位助手根据新文件和本地历史生成。",
        `创建方式：${automatic ? "执行策略自动创建" : "用户确认创建"}`,
        `识别类型：${suggestion.documentType}`,
        `来源文件：${suggestion.artifact?.name ?? "未命名文件"}`,
        "",
        "建议工作：",
        ...suggestion.actions.map((action) => `- ${action}`),
        "",
        "生成边界：仅创建本地 Issue；不会外发、覆盖或修改原文件。",
      ].join("\n"),
      type: "task",
      status: "ready",
      priority: "p1",
      labels: [
        "workflow-memory",
        "adaptive-work",
        automatic ? "adaptive-auto" : "adaptive-confirmed",
        `document-${suggestion.documentType}`,
      ],
      acceptanceCriteria: suggestion.actions,
    }, actor);
    if (created.status >= 400) return created;
    runTx(() => upsertOutcome(suggestion, created.body.workItem, actor));
    appendEvent({
      invocationId: null,
      type: automatic
        ? "workflow_adaptive_issue_auto_created"
        : "workflow_adaptive_issue_confirmed",
      level: "info",
      message: automatic
        ? "A low-risk local Issue was created by the execute policy."
        : "A workflow suggestion was confirmed as a local Issue.",
      data: {
        projectId: suggestion.projectId,
        sourceId: suggestion.sourceId,
        suggestionId: suggestion.id,
        workItemId: created.body.workItem.id,
        automatic,
        actorTeamId: actorTeam(actor),
        actorId: actorUser(actor),
      },
    });
    return {
      status: created.status,
      body: {
        workItem: created.body.workItem,
        replayed: Boolean(created.body.replayed),
        workbench: getWorkbench({ projectId: suggestion.projectId, sourceId: suggestion.sourceId }, actor).body,
      },
    };
  }

  function materialize(input = {}, actor = null) {
    if (!canUse(actor)) return { status: 403, body: { error: "adaptive_work_forbidden" } };
    if (input.confirmed !== true) {
      return { status: 400, body: { error: "adaptive_work_confirmation_required" } };
    }
    const suggestion = resolveSuggestion(input, actor);
    if (!suggestion) return { status: 404, body: { error: "adaptive_work_suggestion_not_found" } };
    const policy = policyView(suggestion.projectId, suggestion.sourceId, actor);
    if (policy.mode === "observe") {
      return { status: 409, body: { error: "adaptive_work_observe_mode" } };
    }
    if (suggestion.readiness !== "ready") {
      return { status: 409, body: { error: "adaptive_work_classification_confirmation_required" } };
    }
    return createIssueFromSuggestion(suggestion, actor);
  }

  function reconcile(input = {}, actor = null) {
    const projectId = text(input.projectId, 100);
    const sourceId = text(input.sourceId, 100);
    if (!projectId || !projectFor(projectId, actor)) {
      return { status: 404, body: { error: "adaptive_work_project_not_found" } };
    }
    if (!sourceId || !sourceFor(sourceId, projectId, actor)) {
      return { status: 404, body: { error: "adaptive_work_source_not_found" } };
    }
    if (!canUse(actor)) return { status: 403, body: { error: "adaptive_work_forbidden" } };
    const policy = policyView(projectId, sourceId, actor);
    const suggestions = suggestionsFor({ projectId, sourceId }, actor);
    const created = [];
    const failures = [];
    if (policy.mode === "execute") {
      for (const suggestion of suggestions
        .filter((row) => row.automation.eligible && !row.issue)
        .slice(0, RECONCILE_LIMIT)) {
        const result = createIssueFromSuggestion(suggestion, actor, { automatic: true });
        if (result.status < 400) {
          created.push({
            suggestionId: suggestion.id,
            workItemId: result.body.workItem.id,
            localRef: result.body.workItem.localRef,
            replayed: Boolean(result.body.replayed),
          });
        } else {
          failures.push({ suggestionId: suggestion.id, error: result.body?.error ?? "unknown" });
        }
      }
    }
    syncOutcomes({ projectId, sourceId }, actor);
    const workbench = getWorkbench({ projectId, sourceId }, actor).body;
    return {
      status: 200,
      body: {
        policy,
        mode: policy.mode,
        observed: suggestions.length,
        prepared: workbench.suggestions.filter((row) => !row.issue).length,
        autoCreated: created.length,
        created,
        failures,
        capped: policy.mode === "execute"
          && suggestions.filter((row) => row.automation.eligible && !row.issue).length > RECONCILE_LIMIT,
        workbench,
      },
    };
  }

  function recordFeedback(input = {}, actor = null) {
    if (!canUse(actor)) return { status: 403, body: { error: "adaptive_work_forbidden" } };
    const suggestion = resolveSuggestion(input, actor);
    if (!suggestion) return { status: 404, body: { error: "adaptive_work_suggestion_not_found" } };
    if (!FEEDBACK_DECISIONS.has(input.decision)) {
      return { status: 400, body: { error: "adaptive_work_feedback_invalid" } };
    }
    const reason = text(input.reason, 80);
    const note = input.note == null || input.note === "" ? null : text(input.note, 500);
    const correctedDocumentType = input.correctedDocumentType == null
      ? null
      : text(input.correctedDocumentType, 80);
    const correctedActionsInput = input.correctedActions == null
      ? []
      : Array.isArray(input.correctedActions) ? input.correctedActions : null;
    const correctedActions = correctedActionsInput
      ? [...new Set(correctedActionsInput.map((value) => text(value, 200)).filter(Boolean))].slice(0, 10)
      : [];
    if (!reason
      || (input.note != null && input.note !== "" && !note)
      || (input.correctedDocumentType != null && !correctedDocumentType)
      || (correctedDocumentType && !DOCUMENT_TYPES.has(correctedDocumentType))
      || !correctedActionsInput
      || correctedActions.length !== new Set(correctedActionsInput).size) {
      return { status: 400, body: { error: "adaptive_work_feedback_invalid" } };
    }
    const hasCorrection = Boolean(correctedDocumentType || correctedActions.length);
    const correctedActionsUnchanged = correctedActions.length === suggestion.actions.length
      && correctedActions.every((action, index) => action === suggestion.actions[index]);
    const correctionShapeInvalid = hasCorrection && (
      input.decision !== "rejected"
      || !["wrong_document_type", "missing_actions"].includes(reason)
      || (reason === "wrong_document_type" && !correctedDocumentType)
      || (reason === "wrong_document_type" && correctedDocumentType === suggestion.documentType)
      || (reason === "missing_actions" && correctedActions.length === 0)
      || (reason === "missing_actions" && correctedActionsUnchanged)
    );
    const requiredCorrectionMissing = input.decision === "rejected" && (
      (reason === "wrong_document_type"
        && (!correctedDocumentType || correctedDocumentType === suggestion.documentType))
      || (reason === "missing_actions"
        && (correctedActions.length === 0 || correctedActionsUnchanged))
    );
    if (correctionShapeInvalid || requiredCorrectionMissing) {
      return { status: 400, body: { error: "adaptive_work_feedback_correction_required" } };
    }
    if (hasCorrection && input.correctionConfirmed !== true) {
      return {
        status: 400,
        body: { error: "adaptive_work_feedback_correction_confirmation_required" },
      };
    }
    const timestamp = now();
    const feedback = {
      id: nextId("awf"),
      ownerTeamId: actorTeam(actor),
      projectId: suggestion.projectId,
      sourceId: suggestion.sourceId,
      suggestionId: suggestion.id,
      observationId: suggestion.observationId,
      documentType: suggestion.documentType,
      decision: input.decision,
      reason,
      note,
      correctedDocumentType,
      correctedActions,
      correctionConfirmed: hasCorrection,
      correction: hasCorrection ? {
        confirmed: true,
        before: {
          documentType: suggestion.documentType,
          actions: suggestion.actions,
        },
        after: {
          documentType: correctedDocumentType ?? suggestion.documentType,
          actions: correctedActions.length ? correctedActions : suggestion.actions,
        },
      } : null,
      policyMode: policyView(suggestion.projectId, suggestion.sourceId, actor).mode,
      createdAt: timestamp,
      createdBy: actorUser(actor),
    };
    runTx(() => {
      state.workflowAdaptiveFeedback.push(feedback);
      if (state.workflowAdaptiveFeedback.length > 10_000) {
        state.workflowAdaptiveFeedback.splice(0, state.workflowAdaptiveFeedback.length - 10_000);
      }
      appendEvent({
        invocationId: null,
        type: "workflow_adaptive_feedback_recorded",
        level: "info",
        message: "Workflow assistance feedback recorded.",
        data: {
          projectId: suggestion.projectId,
          sourceId: suggestion.sourceId,
          suggestionId: suggestion.id,
          decision: input.decision,
          reason,
          corrected: hasCorrection,
          actorTeamId: actorTeam(actor),
          actorId: actorUser(actor),
        },
      });
    });
    return {
      status: 201,
      body: {
        feedback,
        workbench: getWorkbench({ projectId: suggestion.projectId, sourceId: suggestion.sourceId }, actor).body,
      },
    };
  }

  return {
    getWorkbench,
    updatePolicy,
    updateMonitor,
    sweepMonitors,
    runMonitorNow,
    syncOutcomes,
    syncWorkItemOutcome,
    listLearning,
    generateLearningDraft,
    evaluateAndGovern,
    recordShadowPreference,
    listNotifications,
    readNotification,
    previewLearningPublication,
    publishLearningDraft,
    rollbackLearningRule,
    materialize,
    reconcile,
    recordFeedback,
  };
}
