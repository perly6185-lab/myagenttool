import {
  defaultRiskTags,
  normalizeEconomicModel,
  normalizeRiskLevel,
  normalizeRiskTags,
  normalizeUnknownCostPolicy,
} from "../agents.mjs";
import { normalizeRetentionDays } from "./helpers.mjs";

export function createIntegrationGovernanceRuntime({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon = () => {},
}) {
  function updateIntegrationRetentionSettings(body = {}) {
    state.retentionSettings = {
      ...state.retentionSettings,
      logsDays: normalizeRetentionDays(body.logsDays, state.retentionSettings.logsDays),
      promptsDays: normalizeRetentionDays(body.promptsDays, state.retentionSettings.promptsDays),
      responsesDays: normalizeRetentionDays(body.responsesDays, state.retentionSettings.responsesDays),
      artifactsDays: normalizeRetentionDays(body.artifactsDays, state.retentionSettings.artifactsDays),
      updatedAt: now(),
    };
    appendEvent({
      invocationId: null,
      type: "integration_reviewed",
      level: "info",
      message: "Integration data retention settings updated.",
      data: state.retentionSettings,
    });
    persistStateSoon();
    return state.retentionSettings;
  }

  function buildIntegrationGovernance(body, payload) {
    const targetType = payload.adapterConfig?.type ?? body.targetType ?? "cli";
    const command = payload.adapterConfig?.command ?? body.command ?? body.adapter?.command;
    return {
      riskLevel: normalizeRiskLevel(body.riskLevel, targetType === "cli" ? "high" : "medium"),
      riskTags: normalizeRiskTags(body.riskTags, defaultRiskTags(targetType, command)),
      economics: {
        model: normalizeEconomicModel(body.economicModel ?? body.economics?.model, "unknown"),
        costOwner: String(body.costOwner ?? body.economics?.costOwner ?? "usr_local"),
        currency: String(body.currency ?? body.economics?.currency ?? "USD"),
        unknownCostPolicy: normalizeUnknownCostPolicy(body.unknownCostPolicy ?? body.economics?.unknownCostPolicy, "warn"),
      },
      quota: {
        decision: "record_only",
        limit: Number(body.quotaLimit ?? 0),
        period: String(body.quotaPeriod ?? "unset"),
        enforcement: "placeholder",
      },
      retention: { ...state.retentionSettings },
      platformAgentAdvisoryOnly: true,
    };
  }

  function recordQuotaDecision(artifact, action) {
    const record = {
      id: nextId("qtd_demo"),
      artifactId: artifact.id,
      action,
      decision: "record_only",
      reason: "M2 records quota decisions without enterprise policy enforcement.",
      createdAt: now(),
    };
    state.quotaDecisionRecords.unshift(record);
    state.quotaDecisionRecords = state.quotaDecisionRecords.slice(0, 100);
    appendEvent({
      invocationId: null,
      type: "quota_checked",
      level: "info",
      message: "Quota decision recorded for integration artifact.",
      data: record,
    });
    persistStateSoon();
    return record;
  }

  return {
    buildIntegrationGovernance,
    recordQuotaDecision,
    updateIntegrationRetentionSettings,
  };
}
