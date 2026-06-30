import {
  defaultRiskTags,
  normalizeEconomicModel,
  normalizeRiskLevel,
  normalizeRiskTags,
  normalizeStringArray,
} from "./agents.mjs";

const allowedLifecycleActions = ["install", "update", "uninstall"];
const allowedRecipeSources = ["local_file", "workspace_catalog", "private_catalog", "generated_artifact", "manual_entry"];
const allowedSignatureStatuses = ["unsigned", "signed_verified", "signed_unverified", "signature_missing", "not_required"];
const allowedDeploymentModes = ["local_developer", "self_hosted", "saas", "private_deployment"];
const allowedAuditSubjects = ["invocation", "lifecycle", "quota", "usage", "ledger", "policy", "audit"];

export function createM3Service({
  state,
  now,
  nextId,
  appendEvent,
  findAgent,
}) {
  function createLifecycleRecipe(body = {}) {
    const action = normalizeLifecycleAction(body.action);
    const agent = body.agentId ? findAgent(String(body.agentId)) : null;
    const source = normalizeRecipeSource(body.source);
    const supportedPlatforms = normalizeSupportedPlatforms(body.supportedPlatforms);
    const riskLevel = normalizeRiskLevel(body.riskLevel, action === "uninstall" ? "high" : "medium");
    const riskTags = normalizeRiskTags(body.riskTags, defaultRiskTags("cli", body.expectedBinary));
    const rollback = normalizeRollback(body.rollback, action);
    const uninstall = normalizeUninstallPolicy(body.uninstall, action, agent);
    const validationErrors = validateLifecycleRecipe({
      action,
      agent,
      source,
      supportedPlatforms,
      rollback,
      uninstall,
      body,
    });
    if (validationErrors.length) {
      throw new Error(validationErrors.join(" "));
    }
    const createdAt = now();
    const recipe = {
      id: nextId("lcr_demo"),
      agentId: agent?.id ?? (body.agentId ? String(body.agentId) : null),
      requestedBy: "usr_local",
      action,
      reviewState: normalizeReviewState(body.reviewState, "draft"),
      queueState: "not_queued",
      name: String(body.name ?? `${titleCase(action)} recipe`).trim(),
      description: String(body.description ?? `Reviewable ${action} lifecycle recipe.`).trim(),
      source,
      supportedPlatforms,
      requiredPermissions: normalizeStringArray(body.requiredPermissions),
      riskLevel,
      riskTags,
      expectedTarget: {
        binary: stringOrNull(body.expectedBinary ?? body.expectedTarget?.binary),
        endpoint: stringOrNull(body.expectedEndpoint ?? body.expectedTarget?.endpoint),
        mcpConfig: stringOrNull(body.expectedMcpConfig ?? body.expectedTarget?.mcpConfig),
      },
      recipeCommand: normalizeRecipeCommand(body.recipeCommand ?? body.command, action),
      healthCheck: normalizeHealthCheck(body.healthCheck),
      rollback,
      uninstall,
      summary: lifecycleRecipeSummary({ action, source, riskLevel, rollback, uninstall }),
      payload: normalizePlainObject(body.payload),
      createdAt,
      updatedAt: createdAt,
    };
    state.lifecycleRecipes.unshift(recipe);
    state.lifecycleRecipes = state.lifecycleRecipes.slice(0, 100);
    appendEvent({
      invocationId: null,
      type: "lifecycle_requested",
      level: "info",
      message: `${recipe.name} created as a reviewable lifecycle recipe. No command was executed.`,
      data: { recipeId: recipe.id, action: recipe.action, reviewState: recipe.reviewState },
    });
    return recipe;
  }

  function findLifecycleRecipe(id) {
    return state.lifecycleRecipes.find((item) => item.id === id);
  }

  function transitionLifecycleRecipe(recipe, action) {
    const nextState = {
      review: "needs_review",
      approve: "approved",
      reject: "rejected",
      archive: "archived",
    }[action];
    if (!nextState) {
      throw new Error(`Unsupported lifecycle recipe transition: ${action}`);
    }
    recipe.reviewState = nextState;
    recipe.updatedAt = now();
    appendEvent({
      invocationId: null,
      type: "lifecycle_requested",
      level: nextState === "rejected" ? "warn" : "info",
      message: `${recipe.name} moved to ${nextState}. No lifecycle command was executed.`,
      data: { recipeId: recipe.id, reviewState: recipe.reviewState },
    });
    return recipe;
  }

  function evaluateLifecyclePolicy(recipe) {
    if (!recipe) {
      throw new Error("Lifecycle recipe is required.");
    }
    const checks = [];
    const agent = recipe.agentId ? findAgent(recipe.agentId) : null;
    addCheck(checks, "review_state", recipe.reviewState === "approved", `Recipe review state is ${recipe.reviewState}.`);
    addCheck(checks, "source_metadata", Boolean(recipe.source?.type && recipe.source?.author && recipe.source?.version), "Recipe source metadata is present.");
    addCheck(checks, "signature_status", recipe.source.signatureStatus === "signed_verified" || recipe.source.signatureStatus === "not_required", `Signature status is ${recipe.source.signatureStatus}.`, true);
    addCheck(checks, "platform", recipe.supportedPlatforms.includes(state.device.platform), `Device platform is ${state.device.platform}.`);
    addCheck(checks, "rollback", recipe.action !== "update" || recipe.rollback.available || recipe.rollback.strategy === "manual", recipe.rollback.summary, true);
    if (recipe.action === "uninstall") {
      addCheck(checks, "bridge_managed_uninstall", Boolean(agent && agent.lifecycle?.managedBy === "bridge" && recipe.uninstall.bridgeManagedOnly), recipe.uninstall.summary);
      addCheck(checks, "extra_confirmation", !recipe.uninstall.deletesUnderlyingSoftware || recipe.uninstall.requiresExtraConfirmation, "Underlying software deletion requires extra confirmation.");
    }
    const failed = checks.filter((item) => item.status === "failed");
    const warnings = checks.filter((item) => item.status === "warning");
    const decision = failed.length
      ? "blocked"
      : recipe.riskLevel === "high" || recipe.riskLevel === "critical" || recipe.action === "uninstall" || warnings.length
        ? "requires_local_approval"
        : "allowed";
    const record = {
      id: nextId("pdr_demo"),
      recipeId: recipe.id,
      agentId: recipe.agentId,
      action: recipe.action,
      decision,
      reason: failed.length
        ? failed.map((item) => item.summary).join(" ")
        : decision === "requires_local_approval"
          ? "Lifecycle action requires explicit local approval before queueing."
          : "Lifecycle recipe passed first-batch policy checks.",
      checks,
      createdAt: now(),
    };
    state.lifecyclePolicyDecisions.unshift(record);
    state.lifecyclePolicyDecisions = state.lifecyclePolicyDecisions.slice(0, 100);
    appendEvent({
      invocationId: null,
      type: "policy_decision_recorded",
      level: decision === "blocked" ? "warn" : "info",
      message: `Lifecycle policy decision: ${decision}.`,
      data: { policyDecisionId: record.id, recipeId: recipe.id, decision },
    });
    if (decision === "blocked") {
      recipe.queueState = "blocked";
      recipe.updatedAt = now();
    }
    return record;
  }

  function requestLifecycleLocalApproval(recipe) {
    const policy = latestLifecyclePolicy(recipe.id) ?? evaluateLifecyclePolicy(recipe);
    if (policy.decision === "blocked") {
      throw new Error(policy.reason);
    }
    if (recipe.reviewState !== "approved") {
      throw new Error("Recipe must be approved before local approval is requested.");
    }
    const createdAt = now();
    const approval = {
      id: nextId("apr_demo"),
      recipeId: recipe.id,
      agentId: recipe.agentId,
      deviceId: recipe.agentId ? agentDeviceId(findAgent(recipe.agentId)) : state.device.id,
      requestedBy: "usr_local",
      status: "pending",
      riskLevel: recipe.riskLevel,
      riskTags: recipe.riskTags,
      summary: recipe.summary,
      createdAt,
      decidedAt: null,
      decidedBy: null,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
    state.lifecycleLocalApprovals.unshift(approval);
    state.lifecycleLocalApprovals = state.lifecycleLocalApprovals.slice(0, 100);
    recipe.queueState = "local_approval_required";
    recipe.updatedAt = now();
    appendEvent({
      invocationId: null,
      type: "local_approval_requested",
      level: "info",
      message: `${recipe.name} requires local approval before lifecycle queueing.`,
      data: { approvalId: approval.id, recipeId: recipe.id },
    });
    return approval;
  }

  function decideLifecycleLocalApproval(approval, decision) {
    if (!approval) {
      throw new Error("Lifecycle approval request not found.");
    }
    if (!["approve", "deny"].includes(decision)) {
      throw new Error(`Unsupported lifecycle approval decision: ${decision}`);
    }
    approval.status = decision === "approve" ? "approved" : "denied";
    approval.decidedAt = now();
    approval.decidedBy = "usr_local";
    const recipe = findLifecycleRecipe(approval.recipeId);
    if (recipe && approval.status === "denied") {
      recipe.queueState = "blocked";
      recipe.updatedAt = now();
    }
    appendEvent({
      invocationId: null,
      type: decision === "approve" ? "local_approval_granted" : "local_approval_denied",
      level: decision === "approve" ? "info" : "warn",
      message: `Lifecycle local approval ${approval.status}.`,
      data: { approvalId: approval.id, recipeId: approval.recipeId },
    });
    return approval;
  }

  function findLifecycleLocalApproval(id) {
    return state.lifecycleLocalApprovals.find((item) => item.id === id);
  }

  function queueLifecycleAction(recipe) {
    if (!recipe) {
      throw new Error("Lifecycle recipe is required.");
    }
    if (recipe.reviewState !== "approved") {
      throw new Error("Recipe must be approved before queueing.");
    }
    const policy = latestLifecyclePolicy(recipe.id) ?? evaluateLifecyclePolicy(recipe);
    if (policy.decision === "blocked") {
      recipe.queueState = "blocked";
      throw new Error(policy.reason);
    }
    const approval = state.lifecycleLocalApprovals.find((item) => item.recipeId === recipe.id && item.status === "approved");
    if ((policy.decision === "requires_local_approval" || recipe.action === "uninstall") && !approval) {
      requestLifecycleLocalApproval(recipe);
      throw new Error("Lifecycle action requires approved local approval before queueing.");
    }
    const createdAt = now();
    const queued = {
      id: nextId("lco_demo"),
      recipeId: recipe.id,
      agentId: recipe.agentId,
      deviceId: recipe.agentId ? agentDeviceId(findAgent(recipe.agentId)) : state.device.id,
      requestedBy: "usr_local",
      action: recipe.action,
      status: "queued",
      executionEnabled: false,
      command: null,
      summary: `${recipe.name} is queued as audited evidence only. Lifecycle execution is not enabled in this PR batch.`,
      createdAt,
    };
    state.lifecycleQueuedActions.unshift(queued);
    state.lifecycleQueuedActions = state.lifecycleQueuedActions.slice(0, 100);
    state.lifecycleAuditRecords.unshift({
      id: queued.id,
      agentId: queued.agentId ?? "agt_lifecycle_pending",
      deviceId: queued.deviceId ?? undefined,
      requestedBy: queued.requestedBy,
      operation: recipe.action,
      status: "queued",
      reason: "Lifecycle review gates completed; execution remains disabled in the first PR batch.",
      message: queued.summary,
      createdAt,
      completedAt: null,
    });
    state.lifecycleAuditRecords = state.lifecycleAuditRecords.slice(0, 100);
    recipe.queueState = "queued";
    recipe.updatedAt = now();
    appendEvent({
      invocationId: null,
      type: "lifecycle_requested",
      level: "info",
      message: queued.summary,
      data: { queuedActionId: queued.id, recipeId: recipe.id, executionEnabled: false },
    });
    return queued;
  }

  function nextBridgeLifecycleAction() {
    return state.lifecycleQueuedActions.find((item) => item.status === "queued") ?? null;
  }

  function markLifecycleActionObserved(lifecycleAction) {
    if (!lifecycleAction || lifecycleAction.status !== "queued") {
      return lifecycleAction;
    }
    lifecycleAction.status = "observed";
    const recipe = findLifecycleRecipe(lifecycleAction.recipeId);
    if (recipe) {
      recipe.queueState = "observed";
      recipe.updatedAt = now();
    }
    appendEvent({
      invocationId: null,
      type: "lifecycle_requested",
      level: "info",
      message: "Desktop Bridge observed lifecycle action evidence. Execution remains disabled.",
      data: { queuedActionId: lifecycleAction.id, recipeId: lifecycleAction.recipeId, executionEnabled: false },
    });
    return lifecycleAction;
  }

  function createQuotaPolicy(body = {}) {
    const createdAt = now();
    const policy = {
      id: nextId("qtp_demo"),
      name: String(body.name ?? "Platform-managed AI quota").trim(),
      status: ["enabled", "disabled"].includes(body.status) ? body.status : "enabled",
      providerMode: normalizeProviderMode(body.providerMode, "platform_managed"),
      dimensions: normalizeQuotaDimensions(body.dimensions),
      subjectType: ["user", "team", "agent"].includes(body.subjectType) ? body.subjectType : "user",
      subjectId: String(body.subjectId ?? "usr_local"),
      provider: String(body.provider ?? "openai"),
      model: String(body.model ?? "default"),
      limit: Math.max(0, Number(body.limit ?? 10)),
      used: Math.max(0, Number(body.used ?? 0)),
      window: ["daily", "monthly", "custom"].includes(body.window) ? body.window : "monthly",
      currency: String(body.currency ?? "USD"),
      costOwner: String(body.costOwner ?? "usr_local"),
      teamId: body.teamId ? String(body.teamId) : null,
      createdAt,
      updatedAt: createdAt,
    };
    state.quotaPolicies.unshift(policy);
    state.quotaPolicies = state.quotaPolicies.slice(0, 100);
    return policy;
  }

  function recordAiUsage(body = {}) {
    const providerMode = normalizeProviderMode(body.providerMode, "platform_managed");
    const provider = String(body.provider ?? "openai");
    const model = String(body.model ?? "default");
    const policy = findQuotaPolicy({ provider, model, providerMode, subjectId: String(body.userId ?? "usr_local") });
    const quotaDecision = decideQuota({
      body,
      policy,
      provider,
      model,
      providerMode,
    });
    state.quotaDecisionRecords.unshift(quotaDecision);
    state.quotaDecisionRecords = state.quotaDecisionRecords.slice(0, 200);
    appendEvent({
      invocationId: body.invocationId ?? null,
      type: "quota_checked",
      level: quotaDecision.decision === "allowed" ? "info" : "warn",
      message: `AI quota decision: ${quotaDecision.decision}.`,
      data: quotaDecision,
    });
    if (providerMode === "platform_managed" && quotaDecision.decision !== "allowed") {
      return {
        quotaDecision,
        usageRecord: null,
        ledgerEntries: [],
        blocked: true,
      };
    }
    const createdAt = now();
    const estimatedCost = String(body.estimatedCost ?? "unknown");
    const usageRecord = {
      id: nextId("aiu_demo"),
      userId: String(body.userId ?? "usr_local"),
      teamId: body.teamId ? String(body.teamId) : policy?.teamId ?? null,
      agentId: body.agentId ? String(body.agentId) : null,
      invocationId: body.invocationId ? String(body.invocationId) : null,
      deviceId: body.deviceId ? String(body.deviceId) : null,
      quotaDecisionId: quotaDecision.id,
      provider,
      model,
      providerMode,
      inputTokens: Math.max(0, Number(body.inputTokens ?? 0)),
      outputTokens: Math.max(0, Number(body.outputTokens ?? 0)),
      cachedTokens: Math.max(0, Number(body.cachedTokens ?? 0)),
      reasoningTokens: Math.max(0, Number(body.reasoningTokens ?? 0)),
      requestCount: Math.max(1, Number(body.requestCount ?? 1)),
      latencyMs: body.latencyMs === undefined ? null : Math.max(0, Number(body.latencyMs)),
      estimatedCost,
      ledgerEntryIds: [],
      status: "succeeded",
      errorCode: null,
      createdAt,
    };
    const ledgerEntry = createLedgerEntryForUsage({ usageRecord, policy, body, createdAt });
    usageRecord.ledgerEntryIds.push(ledgerEntry.id);
    quotaDecision.createdUsageRecordId = usageRecord.id;
    quotaDecision.createdLedgerEntryIds = [ledgerEntry.id];
    if (policy && quotaDecision.decision === "allowed") {
      policy.used += usageRecord.requestCount;
      policy.updatedAt = now();
    }
    state.aiUsageRecords.unshift(usageRecord);
    state.aiUsageRecords = state.aiUsageRecords.slice(0, 200);
    appendEvent({
      invocationId: usageRecord.invocationId,
      type: "ai_usage_recorded",
      level: "info",
      message: `AI usage recorded for ${provider}/${model}.`,
      data: { usageRecordId: usageRecord.id, quotaDecisionId: quotaDecision.id, ledgerEntryIds: usageRecord.ledgerEntryIds },
    });
    return {
      quotaDecision,
      usageRecord,
      ledgerEntries: [ledgerEntry],
      blocked: false,
    };
  }

  function chargebackExport() {
    return {
      generatedAt: now(),
      rows: state.ledgerEntries.map((entry) => ({
        ledgerEntryId: entry.id,
        userId: entry.userId,
        teamId: entry.teamId,
        agentId: entry.agentId,
        invocationId: entry.invocationId,
        provider: entry.provider,
        model: state.aiUsageRecords.find((record) => record.ledgerEntryIds.includes(entry.id))?.model ?? null,
        costOwner: entry.costOwner,
        amount: entry.amount,
        currency: entry.currency,
        billable: entry.billable,
        status: entry.status,
        createdAt: entry.createdAt,
      })),
    };
  }

  function updatePrivateDeploymentConfig(body = {}) {
    const existing = state.privateDeploymentConfig;
    const updatedAt = now();
    const mode = allowedDeploymentModes.includes(body.mode) ? body.mode : existing.mode;
    const config = {
      id: existing.id,
      mode,
      ownerTeamId: body.ownerTeamId === undefined ? existing.ownerTeamId : stringOrNull(body.ownerTeamId),
      auditExportEnabled: Boolean(body.auditExportEnabled ?? existing.auditExportEnabled),
      immutableAuditOption: ["disabled", "configured", "required"].includes(body.immutableAuditOption) ? body.immutableAuditOption : existing.immutableAuditOption,
      capabilities: {
        ...existing.capabilities,
        ...normalizeBooleanObject(body.capabilities),
      },
      auditSinks: Array.isArray(body.auditSinks) ? body.auditSinks.map(normalizeAuditSink) : existing.auditSinks,
      alertSinks: Array.isArray(body.alertSinks) ? body.alertSinks.map(normalizeAlertSink) : existing.alertSinks,
      entitlementPolicy: {
        canBlockPaidFeatures: Boolean(body.entitlementPolicy?.canBlockPaidFeatures ?? existing.entitlementPolicy.canBlockPaidFeatures),
        canBlockNewPlatformManagedAi: Boolean(body.entitlementPolicy?.canBlockNewPlatformManagedAi ?? existing.entitlementPolicy.canBlockNewPlatformManagedAi),
        canBlockDataExport: false,
        canDeleteUserData: false,
        canRemoveLocalSoftware: false,
        canPreventDeviceUnlink: false,
      },
      createdAt: existing.createdAt,
      updatedAt,
    };
    state.privateDeploymentConfig = config;
    appendEvent({
      invocationId: null,
      type: "billing_recorded",
      level: "info",
      message: "Private deployment export configuration updated.",
      data: { deploymentConfigId: config.id, mode: config.mode },
    });
    return config;
  }

  function createAuditExportRequest(body = {}) {
    const subjects = normalizeAuditSubjects(body.subjects);
    const sinkId = stringOrNull(body.sinkId);
    const validation = validateAuditExport({ subjects, sinkId });
    const request = {
      id: nextId("aex_demo"),
      requestedBy: "usr_local",
      mode: state.privateDeploymentConfig.mode,
      subjects,
      status: validation.ok ? "validated" : "blocked",
      dryRun: body.dryRun !== false,
      sinkId,
      recordCounts: auditExportRecordCounts(subjects),
      validation,
      createdAt: now(),
    };
    state.auditExportRequests.unshift(request);
    state.auditExportRequests = state.auditExportRequests.slice(0, 100);
    appendEvent({
      invocationId: null,
      type: "billing_recorded",
      level: validation.ok ? "info" : "warn",
      message: validation.ok ? "Audit export dry-run validated." : "Audit export dry-run blocked by configuration findings.",
      data: { auditExportId: request.id, status: request.status, dryRun: request.dryRun },
    });
    return request;
  }

  return {
    chargebackExport,
    createAuditExportRequest,
    createLifecycleRecipe,
    createQuotaPolicy,
    decideLifecycleLocalApproval,
    evaluateLifecyclePolicy,
    findLifecycleLocalApproval,
    findLifecycleRecipe,
    markLifecycleActionObserved,
    nextBridgeLifecycleAction,
    queueLifecycleAction,
    recordAiUsage,
    requestLifecycleLocalApproval,
    transitionLifecycleRecipe,
    updatePrivateDeploymentConfig,
  };

  function latestLifecyclePolicy(recipeId) {
    return state.lifecyclePolicyDecisions.find((item) => item.recipeId === recipeId);
  }

  function findQuotaPolicy({ provider, model, providerMode, subjectId }) {
    return state.quotaPolicies.find((item) => item.status === "enabled"
      && item.providerMode === providerMode
      && item.provider === provider
      && item.model === model
      && item.subjectId === subjectId) ?? null;
  }

  function decideQuota({ body, policy, provider, model, providerMode }) {
    const createdAt = now();
    const base = {
      id: nextId("qtd_demo"),
      policyId: policy?.id ?? null,
      subjectType: policy?.subjectType ?? "user",
      subjectId: policy?.subjectId ?? String(body.userId ?? "usr_local"),
      resourceType: "ai_model",
      resourceId: `${provider}/${model}`,
      providerMode,
      estimatedCost: body.estimatedCost === undefined ? null : String(body.estimatedCost),
      createdUsageRecordId: null,
      createdLedgerEntryIds: [],
      enforce: providerMode === "platform_managed",
      createdAt,
    };
    if (providerMode === "disabled") {
      return { ...base, decision: "blocked_provider_disabled", reason: "Provider mode is disabled." };
    }
    if (providerMode !== "platform_managed") {
      return { ...base, decision: "allowed", reason: "Provider mode is attributable but not SaaS-billable by default." };
    }
    if (body.credentialState === "missing") {
      return { ...base, decision: "blocked_missing_credential", reason: "Platform-managed provider credential is missing." };
    }
    if (!policy) {
      return { ...base, decision: "blocked_quota_exceeded", reason: "No enabled quota policy matched this platform-managed AI request." };
    }
    if (Array.isArray(body.allowedModels) && !body.allowedModels.map(String).includes(model)) {
      return { ...base, decision: "blocked_model_not_allowed", reason: "Requested model is not allowed by policy." };
    }
    const requestCount = Math.max(1, Number(body.requestCount ?? 1));
    if (policy.used + requestCount > policy.limit) {
      return { ...base, decision: "blocked_quota_exceeded", reason: "Quota policy limit would be exceeded." };
    }
    return { ...base, decision: "allowed", reason: "Quota policy allowed the platform-managed AI request." };
  }

  function createLedgerEntryForUsage({ usageRecord, policy, body, createdAt }) {
    const entry = {
      id: nextId("led_demo"),
      workspaceId: String(body.teamId ?? policy?.teamId ?? "team_local"),
      userId: usageRecord.userId,
      teamId: usageRecord.teamId,
      agentId: usageRecord.agentId,
      invocationId: usageRecord.invocationId,
      deviceId: usageRecord.deviceId,
      sourceType: "ai_usage",
      sourceRecordId: usageRecord.id,
      entryType: "chargeback",
      economicModel: normalizeEconomicModel(body.economicModel, usageRecord.providerMode === "platform_managed" ? "platform_billed" : "unknown"),
      meterName: "per_request",
      quantity: usageRecord.requestCount,
      unitPrice: String(body.unitPrice ?? "unknown"),
      currency: String(body.currency ?? policy?.currency ?? "USD"),
      amount: String(body.estimatedCost ?? "unknown"),
      amountDirection: usageRecord.providerMode === "platform_managed" ? "internal" : "informational",
      costOwner: String(body.costOwner ?? policy?.costOwner ?? "unknown"),
      revenueOwner: body.revenueOwner ? String(body.revenueOwner) : null,
      budgetPoolId: body.budgetPoolId ? String(body.budgetPoolId) : null,
      counterparty: usageRecord.provider,
      provider: usageRecord.provider,
      billable: usageRecord.providerMode === "platform_managed",
      status: "estimated",
      createdAt,
      finalizedAt: null,
    };
    state.ledgerEntries.unshift(entry);
    state.ledgerEntries = state.ledgerEntries.slice(0, 200);
    appendEvent({
      invocationId: usageRecord.invocationId,
      type: "ledger_entry_recorded",
      level: "info",
      message: `Ledger entry recorded for ${usageRecord.provider}/${usageRecord.model}.`,
      data: { ledgerEntryId: entry.id, usageRecordId: usageRecord.id },
    });
    return entry;
  }

  function validateAuditExport({ subjects, sinkId }) {
    const findings = [];
    const config = state.privateDeploymentConfig;
    if (!config.auditExportEnabled) {
      findings.push({ severity: "error", code: "audit_export_disabled", message: "Audit export is disabled for this deployment." });
    }
    if (config.mode !== "private_deployment" && config.mode !== "self_hosted") {
      findings.push({ severity: "warn", code: "non_private_mode", message: "Audit export shape is available, but deployment mode is not private or self-hosted." });
    }
    if (!subjects.length) {
      findings.push({ severity: "error", code: "subjects_required", message: "At least one audit export subject is required." });
    }
    if (sinkId) {
      const sink = config.auditSinks.find((item) => item.id === sinkId);
      if (!sink) {
        findings.push({ severity: "error", code: "sink_not_found", message: "Requested audit sink is not configured." });
      } else if (!sink.enabled) {
        findings.push({ severity: "error", code: "sink_disabled", message: "Requested audit sink is disabled." });
      } else if (sink.externalDeliveryEnabled) {
        findings.push({ severity: "warn", code: "external_delivery_not_executed", message: "External audit delivery is configured but not executed by this dry run." });
      }
    }
    if (config.immutableAuditOption === "required" && !config.auditSinks.some((item) => item.immutable && item.enabled)) {
      findings.push({ severity: "error", code: "immutable_sink_required", message: "Immutable audit is required but no enabled immutable sink is configured." });
    }
    return {
      ok: !findings.some((item) => item.severity === "error"),
      findings,
    };
  }

  function auditExportRecordCounts(subjects) {
    const counts = {
      invocation: state.invocations.length,
      lifecycle: state.lifecycleAuditRecords.length + state.lifecycleRecipes.length,
      quota: state.quotaDecisionRecords.length,
      usage: state.aiUsageRecords.length,
      ledger: state.ledgerEntries.length,
      policy: state.policyDecisionRecords.length + state.lifecyclePolicyDecisions.length,
      audit: state.auditSummaries.length,
    };
    return Object.fromEntries(subjects.map((subject) => [subject, counts[subject] ?? 0]));
  }
}

function validateLifecycleRecipe({ action, agent, source, supportedPlatforms, rollback, uninstall, body }) {
  const errors = [];
  if (!allowedLifecycleActions.includes(action)) {
    errors.push("Unsupported lifecycle action.");
  }
  if (!source.author || !source.version || !source.type) {
    errors.push("Lifecycle recipe source, author, and version are required.");
  }
  if (!allowedRecipeSources.includes(source.type)) {
    errors.push("Unsupported lifecycle recipe source.");
  }
  if (!supportedPlatforms.length) {
    errors.push("At least one supported platform is required.");
  }
  if (action === "update" && rollback.strategy === "unknown") {
    errors.push("Update recipes must describe rollback availability or manual fallback.");
  }
  if (action === "uninstall") {
    if (!uninstall.bridgeManagedOnly && !uninstall.manualAgentRegistryOnly) {
      errors.push("Uninstall recipes must default to bridge-managed software or registry-only removal.");
    }
    if (uninstall.deletesUnderlyingSoftware && !uninstall.requiresExtraConfirmation) {
      errors.push("Uninstall recipes that delete underlying software require extra confirmation.");
    }
    if (agent && agent.lifecycle?.managedBy !== "bridge" && uninstall.deletesUnderlyingSoftware) {
      errors.push("Deleting underlying software is blocked for non bridge-managed agents.");
    }
  }
  if (body.execute === true || body.run === true) {
    errors.push("Lifecycle recipe creation cannot execute commands.");
  }
  return errors;
}

function normalizeLifecycleAction(value) {
  const normalized = String(value ?? "").trim();
  if (!allowedLifecycleActions.includes(normalized)) {
    throw new Error(`Unsupported lifecycle action: ${normalized || "missing"}.`);
  }
  return normalized;
}

function normalizeRecipeSource(source = {}) {
  const raw = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const signatureStatus = String(raw.signatureStatus ?? "unsigned");
  return {
    type: allowedRecipeSources.includes(raw.type) ? raw.type : "manual_entry",
    uri: String(raw.uri ?? "manual://lifecycle-recipe"),
    author: String(raw.author ?? "").trim(),
    version: String(raw.version ?? "").trim(),
    checksum: stringOrNull(raw.checksum),
    signatureStatus: allowedSignatureStatuses.includes(signatureStatus) ? signatureStatus : "unsigned",
    compatibilityRange: String(raw.compatibilityRange ?? ">=0.0.0"),
  };
}

function normalizeSupportedPlatforms(value) {
  const supported = normalizeStringArray(value).filter((item) => ["macos", "windows", "linux"].includes(item));
  return supported.length ? supported : ["macos", "windows", "linux"];
}

function normalizeRollback(value = {}, action) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const strategy = ["previous_version", "restore_config", "manual", "not_supported", "unknown"].includes(raw.strategy)
    ? raw.strategy
    : action === "install" ? "not_supported" : "unknown";
  const available = Boolean(raw.available ?? (
    strategy === "previous_version"
    || strategy === "restore_config"
    || strategy === "manual"
  ));
  return {
    available,
    strategy,
    previousVersion: stringOrNull(raw.previousVersion),
    summary: String(raw.summary ?? (available ? "Rollback metadata is available." : "Rollback is not available or unknown.")),
  };
}

function normalizeUninstallPolicy(value = {}, action, agent) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const bridgeManaged = agent?.lifecycle?.managedBy === "bridge";
  const deletesUnderlyingSoftware = Boolean(raw.deletesUnderlyingSoftware ?? false);
  const bridgeManagedOnly = Boolean(raw.bridgeManagedOnly ?? action === "uninstall");
  const manualAgentRegistryOnly = Boolean(raw.manualAgentRegistryOnly ?? (action === "uninstall" && !bridgeManaged));
  return {
    bridgeManagedOnly,
    deletesUnderlyingSoftware,
    requiresExtraConfirmation: Boolean(raw.requiresExtraConfirmation ?? deletesUnderlyingSoftware),
    manualAgentRegistryOnly,
    summary: String(raw.summary ?? (manualAgentRegistryOnly
      ? "Manual agents default to registry-only removal."
      : "Uninstall is constrained to bridge-managed agents by default.")),
  };
}

function normalizeRecipeCommand(value, action) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const executable = String(raw.executable ?? raw.command ?? "").trim();
  if (!executable) {
    return null;
  }
  return {
    summary: String(raw.summary ?? `${titleCase(action)} command descriptor.`),
    commandId: String(raw.commandId ?? `${action}_${executable}`),
    executable,
    args: normalizeStringArray(raw.args),
    shell: false,
    packageManager: stringOrNull(raw.packageManager),
  };
}

function normalizeHealthCheck(value = {}) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const type = ["cli", "http", "manual"].includes(raw.type) ? raw.type : "manual";
  return {
    type,
    summary: String(raw.summary ?? "Health check must pass before lifecycle completion."),
    command: normalizeRecipeCommand(raw.command, "health_check"),
    url: stringOrNull(raw.url),
    timeoutSeconds: Math.max(1, Number(raw.timeoutSeconds ?? 30)),
  };
}

function lifecycleRecipeSummary({ action, source, riskLevel, rollback, uninstall }) {
  return {
    action: `Review ${action} lifecycle recipe before any local execution.`,
    source: `Source ${source.type} by ${source.author || "unknown author"}; signature ${source.signatureStatus}.`,
    risk: `Risk is ${riskLevel}; local policy gates decide approval before queueing.`,
    rollback: rollback.summary,
    localApproval: action === "uninstall" || riskLevel === "high" || riskLevel === "critical"
      ? "Local approval is required before queueing."
      : "Local approval may be skipped only when policy allows.",
    dataImpact: uninstall.manualAgentRegistryOnly
      ? "Registry-only removal is allowed for manually registered agents."
      : "Lifecycle evidence, logs, and audit records are retained by policy.",
  };
}

function normalizeReviewState(value, fallback) {
  const normalized = String(value ?? fallback).trim();
  return ["draft", "needs_review", "approved", "rejected", "archived"].includes(normalized) ? normalized : fallback;
}

function addCheck(checks, name, passed, summary, warningOnly = false) {
  checks.push({
    name,
    status: passed ? "passed" : warningOnly ? "warning" : "failed",
    summary,
  });
}

function agentDeviceId(agent) {
  return agent?.location?.type === "local_device" ? agent.location.deviceId : null;
}

function normalizeProviderMode(value, fallback) {
  const normalized = String(value ?? fallback).trim();
  return ["byok", "platform_managed", "local_model", "disabled"].includes(normalized) ? normalized : fallback;
}

function normalizeQuotaDimensions(value) {
  const dimensions = normalizeStringArray(value).filter((item) => ["user", "team", "provider", "model", "agent", "time_window"].includes(item));
  return dimensions.length ? dimensions : ["user", "provider", "model", "time_window"];
}

function normalizeBooleanObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, Boolean(item)]));
}

function normalizeAuditSink(value = {}) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const type = ["local_file", "object_storage", "siem", "webhook", "immutable_store", "disabled"].includes(raw.type) ? raw.type : "disabled";
  return {
    id: String(raw.id ?? `sink_${type}`),
    type,
    enabled: Boolean(raw.enabled ?? type !== "disabled"),
    displayName: String(raw.displayName ?? titleCase(type.replaceAll("_", " "))),
    destinationRef: stringOrNull(raw.destinationRef),
    immutable: Boolean(raw.immutable ?? type === "immutable_store"),
    externalDeliveryEnabled: Boolean(raw.externalDeliveryEnabled ?? false),
    retentionDays: raw.retentionDays === null || raw.retentionDays === undefined ? null : Math.max(1, Number(raw.retentionDays)),
    metadata: normalizePlainObject(raw.metadata),
  };
}

function normalizeAlertSink(value = {}) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const type = ["email", "webhook", "siem", "local_log", "disabled"].includes(raw.type) ? raw.type : "disabled";
  const severityThreshold = ["info", "warn", "error", "critical"].includes(raw.severityThreshold) ? raw.severityThreshold : "warn";
  return {
    id: String(raw.id ?? `alert_${type}`),
    type,
    enabled: Boolean(raw.enabled ?? type !== "disabled"),
    destinationRef: stringOrNull(raw.destinationRef),
    severityThreshold,
    externalDeliveryEnabled: Boolean(raw.externalDeliveryEnabled ?? false),
  };
}

function normalizeAuditSubjects(value) {
  const subjects = normalizeStringArray(value).filter((item) => allowedAuditSubjects.includes(item));
  return subjects.length ? subjects : ["invocation", "lifecycle", "quota", "usage", "ledger", "policy", "audit"];
}

function normalizePlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringOrNull(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function titleCase(value) {
  return String(value ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/\w\S*/g, (word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`);
}
