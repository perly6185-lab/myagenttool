import { createHash } from "node:crypto";
import { teamOf } from "../runtime/auth.mjs";
import {
  defaultRiskTags,
  normalizeEconomicModel,
  normalizeRiskLevel,
  normalizeRiskTags,
  normalizeStringArray,
} from "./agents.mjs";
import { CCUSAGE_VERSION } from "./ccusage-agent.mjs";
import { capLifecycleAuditRecords } from "./retention.mjs";

const allowedLifecycleActions = ["install", "update", "uninstall"];
const allowedRecipeSources = ["local_file", "workspace_catalog", "private_catalog", "generated_artifact", "manual_entry"];
const allowedSignatureStatuses = ["unsigned", "signed_verified", "signed_unverified", "signature_missing", "not_required"];
const allowedDeploymentModes = ["local_developer", "self_hosted", "saas", "private_deployment"];
const allowedAuditSubjects = ["invocation", "lifecycle", "quota", "usage", "ledger", "policy", "audit", "catalog", "bundle", "transcript"];
const allowedCatalogChannels = ["stable", "beta", "dev"];
const allowedCatalogVisibility = ["private", "team", "workspace"];
const lifecycleCommandAllowlist = new Set([
  "demo_agent_version",
  "demo_agent_update",
  "demo_agent_health",
  "demo_agent_rollback",
  "npm_global_install_pinned",
  "npm_global_uninstall_package",
  "ccusage_version",
  "ccusage_report_probe",
]);
const lifecycleRecipeCommandAllowlistByAction = {
  install: new Set(["npm_global_install_pinned"]),
  update: new Set(["demo_agent_update", "npm_global_install_pinned"]),
  uninstall: new Set(["npm_global_uninstall_package"]),
};

export function createM3Service({
  state,
  now,
  nextId,
  appendEvent,
  findAgent,
  persistStateSoon = () => {},
  dispatchAlert = () => {},
  store,
}) {
  // #968: run a lifecycle-action transition as one durable unit of work — commit
  // synchronously through the Store when wired, else fall back to the debounce so
  // behavior is unchanged where no store is injected (many hermetic m3 tests).
  let afterCommitQueue = null;
  const runTx = (fn) => {
    const parentQueue = afterCommitQueue;
    const queue = parentQueue ?? [];
    afterCommitQueue = queue;
    try {
      const result = typeof store?.transaction === "function" ? store.transaction(fn) : fn();
      if (!parentQueue && typeof store?.transaction !== "function") persistStateSoon();
      if (!parentQueue) {
        afterCommitQueue = null;
        for (const callback of queue) {
          try { callback(); } catch { /* committed state must not be reported as rolled back */ }
        }
      }
      return result;
    } catch (error) {
      if (!parentQueue) queue.length = 0;
      throw error;
    } finally {
      afterCommitQueue = parentQueue;
    }
  };
  runTx.afterCommit = (callback) => {
    if (typeof callback !== "function") return;
    if (afterCommitQueue) afterCommitQueue.push(callback);
    else callback();
  };
  function createPrivateCatalogEntry(body = {}) {
    const createdAt = now();
    const entry = {
      id: nextId("cat_demo"),
      packageName: normalizePackageName(body.packageName ?? body.name ?? "demo-agent"),
      displayName: String(body.displayName ?? body.name ?? "Demo Agent").trim(),
      description: String(body.description ?? "Private catalog entry for reviewed agent distribution.").trim(),
      ownerTeamId: stringOrNull(body.ownerTeamId),
      visibility: allowedCatalogVisibility.includes(body.visibility) ? body.visibility : "private",
      channel: allowedCatalogChannels.includes(body.channel) ? body.channel : "stable",
      version: String(body.version ?? "0.0.0"),
      agentId: body.agentId ? String(body.agentId) : null,
      recipeIds: normalizeStringArray(body.recipeIds),
      bundleIds: normalizeStringArray(body.bundleIds),
      status: ["draft", "published", "archived"].includes(body.status) ? body.status : "draft",
      createdAt,
      updatedAt: createdAt,
    };
    runTx(() => {
      state.privateCatalogEntries.unshift(entry);
      state.privateCatalogEntries = state.privateCatalogEntries.slice(0, 100);
      appendEvent({
        invocationId: null,
        type: "lifecycle_requested",
        level: "info",
        message: `Private catalog entry ${entry.packageName}@${entry.version} created.`,
        data: { catalogEntryId: entry.id, packageName: entry.packageName, version: entry.version },
      });
    });
    return entry;
  }

  function createSignedBundleManifest(body = {}) {
    const createdAt = now();
    const signatureStatus = normalizeSignatureStatus(body.signatureStatus);
    const manifest = {
      id: nextId("bun_demo"),
      catalogEntryId: stringOrNull(body.catalogEntryId),
      artifactId: stringOrNull(body.artifactId),
      packageName: normalizePackageName(body.packageName ?? "demo-agent"),
      version: String(body.version ?? "0.0.0"),
      channel: allowedCatalogChannels.includes(body.channel) ? body.channel : "stable",
      sourceUri: String(body.sourceUri ?? "bundle://manual"),
      checksum: stringOrNull(body.checksum),
      signatureStatus,
      provenance: {
        builder: stringOrNull(body.provenance?.builder ?? body.builder),
        sourceCommit: stringOrNull(body.provenance?.sourceCommit ?? body.sourceCommit),
        generatedByAi: Boolean(body.provenance?.generatedByAi ?? body.generatedByAi ?? false),
      },
      policy: signedBundlePolicy(signatureStatus, body),
      createdAt,
      updatedAt: createdAt,
    };
    runTx(() => {
      state.signedBundleManifests.unshift(manifest);
      state.signedBundleManifests = state.signedBundleManifests.slice(0, 100);
      linkBundleToCatalog(manifest.catalogEntryId, manifest.id);
      appendEvent({
        invocationId: null,
        type: "policy_decision_recorded",
        level: manifest.policy.decision === "blocked" ? "warn" : "info",
        message: `Signed bundle policy: ${manifest.policy.decision}.`,
        data: { bundleId: manifest.id, signatureStatus: manifest.signatureStatus, decision: manifest.policy.decision },
      });
    });
    return manifest;
  }

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
      catalogEntryId: stringOrNull(body.catalogEntryId),
      bundleId: stringOrNull(body.bundleId),
      requestedBy: body.requestedBy ?? "usr_local",
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
    runTx(() => {
      state.lifecycleRecipes.unshift(recipe);
      state.lifecycleRecipes = state.lifecycleRecipes.slice(0, 100);
      linkRecipeToCatalog(recipe.catalogEntryId, recipe.id);
      appendEvent({
        invocationId: null,
        type: "lifecycle_requested",
        level: "info",
        message: `${recipe.name} created as a reviewable lifecycle recipe. No command was executed.`,
        data: { recipeId: recipe.id, action: recipe.action, reviewState: recipe.reviewState },
      });
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
    return runTx(() => {
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
    });
  }

  function evaluateLifecyclePolicy(recipe) {
    if (!recipe) {
      throw new Error("Lifecycle recipe is required.");
    }
    const checks = [];
    const agent = recipe.agentId ? findAgent(recipe.agentId) : null;
    addCheck(checks, "review_state", recipe.reviewState === "approved", `Recipe review state is ${recipe.reviewState}.`);
    addCheck(checks, "source_metadata", Boolean(recipe.source?.type && recipe.source?.author && recipe.source?.version), "Recipe source metadata is present.");
    const bundle = findSignedBundleManifest(recipe.bundleId);
    const signatureStatus = bundle?.signatureStatus ?? recipe.source.signatureStatus;
    const signaturePolicy = bundle?.policy ?? signedBundlePolicy(signatureStatus, {});
    addCheck(checks, "signature_status", signaturePolicy.decision !== "blocked", `Signature status is ${signatureStatus}: ${signaturePolicy.reason}.`, signaturePolicy.decision === "requires_local_approval");
    if (recipe.source.type === "private_catalog") {
      addCheck(checks, "private_catalog_entry", Boolean(recipe.catalogEntryId && findPrivateCatalogEntry(recipe.catalogEntryId)), "Private catalog source must reference an existing catalog entry.");
    }
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
    runTx(() => {
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
    });
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
      requestedBy: recipe.requestedBy ?? "usr_local",
      status: "pending",
      riskLevel: recipe.riskLevel,
      riskTags: recipe.riskTags,
      summary: recipe.summary,
      createdAt,
      decidedAt: null,
      decidedBy: null,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
    runTx(() => {
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
    });
    return approval;
  }

  function decideLifecycleLocalApproval(approval, decision, actor = null) {
    if (!approval) {
      throw new Error("Lifecycle approval request not found.");
    }
    if (!["approve", "deny"].includes(decision)) {
      throw new Error(`Unsupported lifecycle approval decision: ${decision}`);
    }
    // #1151: a settled approval is immutable — without this, a second operator's
    // click silently CLOBBERED status/decidedBy/decidedAt (an approved recipe
    // could flip to denied with no trace). Idempotent return; the route tells
    // the second operator who decided and when.
    if (approval.status !== "pending") {
      return approval;
    }
    return runTx(() => {
      approval.status = decision === "approve" ? "approved" : "denied";
      approval.decidedAt = now();
      approval.decidedBy = actor?.userId ?? "usr_local";
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
    });
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
      recipe.updatedAt = now();
      persistStateSoon();
      throw new Error(policy.reason);
    }
    const approval = state.lifecycleLocalApprovals.find((item) => item.recipeId === recipe.id && item.status === "approved");
    if ((policy.decision === "requires_local_approval" || recipe.action === "uninstall") && !approval) {
      requestLifecycleLocalApproval(recipe);
      throw new Error("Lifecycle action requires approved local approval before queueing.");
    }
    return runTx(() => {
    const createdAt = now();
    const command = buildExecutableLifecycleCommand(recipe);
    const executionEnabled = Boolean(command);
    const queued = {
      id: nextId("lco_demo"),
      recipeId: recipe.id,
      agentId: recipe.agentId,
      deviceId: recipe.agentId ? agentDeviceId(findAgent(recipe.agentId)) : state.device.id,
      requestedBy: recipe.requestedBy ?? "usr_local",
      action: recipe.action,
      status: "queued",
      executionEnabled,
      command,
      summary: executionEnabled
        ? `${recipe.name} is queued for allowlisted Desktop Bridge lifecycle execution.`
        : `${recipe.name} is queued as audit evidence only because no allowlisted lifecycle command is available.`,
      result: null,
      createdAt,
      startedAt: null,
      completedAt: null,
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
      reason: executionEnabled
        ? "Lifecycle review gates completed; allowlisted Desktop Bridge execution is available."
        : "Lifecycle review gates completed; no allowlisted Desktop Bridge execution is available.",
      message: queued.summary,
      createdAt,
      completedAt: null,
    });
    capLifecycleAuditRecords(state);
    recipe.queueState = "queued";
    recipe.updatedAt = now();
    appendEvent({
      invocationId: null,
      type: "lifecycle_requested",
      level: "info",
      message: queued.summary,
      data: { queuedActionId: queued.id, recipeId: recipe.id, executionEnabled },
    });
    return queued;
    });
  }

  function nextBridgeLifecycleAction() {
    return state.lifecycleQueuedActions.find(
      (item) =>
        item.status === "queued" &&
        item.executionEnabled === true &&
        item.deviceId === state.device.id,
    ) ?? null;
  }

  function markLifecycleActionStarted(lifecycleAction) {
    if (!lifecycleAction || lifecycleAction.status !== "queued") {
      return lifecycleAction;
    }
    return runTx(() => {
    if (!lifecycleAction.executionEnabled || !isExecutableLifecycleActionCommand(lifecycleAction.command, lifecycleAction.action)) {
      const completedAt = now();
      lifecycleAction.status = "observed";
      lifecycleAction.result = {
        status: "failed",
        summary: "Lifecycle action was observed but not executed because the command is not allowlisted.",
        exitCode: null,
        stdout: "",
        stderr: "",
        durationMs: null,
        healthStatus: "unknown",
        rollbackAvailable: Boolean(findLifecycleRecipe(lifecycleAction.recipeId)?.rollback?.available),
      };
      lifecycleAction.completedAt = completedAt;
      const recipe = findLifecycleRecipe(lifecycleAction.recipeId);
      if (recipe) {
        recipe.queueState = "observed";
        recipe.updatedAt = completedAt;
      }
      const auditRecord = findLifecycleAuditRecord(lifecycleAction.id);
      if (auditRecord) {
        auditRecord.status = "failed";
        auditRecord.message = lifecycleAction.result.summary;
        auditRecord.completedAt = completedAt;
        auditRecord.result = lifecycleAction.result;
        auditRecord.rollback = recipe?.rollback ?? null;
      }
      appendEvent({
        invocationId: null,
        type: "lifecycle_failed",
        level: "warn",
        message: lifecycleAction.result.summary,
        data: { queuedActionId: lifecycleAction.id, recipeId: lifecycleAction.recipeId, executionEnabled: false },
      });
      return lifecycleAction;
    }
    lifecycleAction.status = "running";
    lifecycleAction.startedAt = now();
    const recipe = findLifecycleRecipe(lifecycleAction.recipeId);
    if (recipe) {
      recipe.queueState = "running";
      recipe.updatedAt = now();
    }
    const auditRecord = findLifecycleAuditRecord(lifecycleAction.id);
    if (auditRecord) {
      auditRecord.status = "running";
      auditRecord.message = "Desktop Bridge is executing an allowlisted lifecycle command.";
    }
    appendEvent({
      invocationId: null,
      type: "lifecycle_started",
      level: "info",
      message: "Desktop Bridge started allowlisted lifecycle execution.",
      data: { queuedActionId: lifecycleAction.id, recipeId: lifecycleAction.recipeId, commandId: lifecycleAction.command.commandId },
    });
    return lifecycleAction;
    });
  }

  function completeLifecycleAction(lifecycleAction, body = {}) {
    if (!lifecycleAction) {
      throw new Error("Lifecycle action not found.");
    }
    if (lifecycleAction.status !== "running") {
      throw new Error(`Lifecycle action is not completable from ${lifecycleAction.status}.`);
    }
    return runTx(() => {
    const status = normalizeLifecycleResultStatus(body.status);
    const recipe = findLifecycleRecipe(lifecycleAction.recipeId);
    const completedAt = now();
    lifecycleAction.status = status;
    lifecycleAction.completedAt = completedAt;
    lifecycleAction.result = {
      status,
      summary: String(body.summary ?? (status === "succeeded" ? "Lifecycle action completed." : "Lifecycle action failed.")),
      exitCode: normalizeNullableNumber(body.exitCode),
      stdout: truncateLog(body.stdout),
      stderr: truncateLog(body.stderr),
      durationMs: normalizeNullableNumber(body.durationMs, { min: 0 }),
      healthStatus: normalizeHealthStatus(body.healthStatus),
      rollbackAvailable: Boolean(body.rollbackAvailable ?? recipe?.rollback?.available),
      // Structured refusal evidence when the bridge declines local execution
      // (e.g. a non-allowlisted lifecycle command), so a decline is auditable in
      // the action record rather than only a prose summary.
      policyDecision: body.policyDecision === "local_execution_refused" ? "local_execution_refused" : null,
      refusal: normalizeLifecycleRefusal(body.refusal),
    };
    if (recipe) {
      recipe.queueState = status;
      recipe.updatedAt = completedAt;
    }
    const auditRecord = findLifecycleAuditRecord(lifecycleAction.id);
    if (auditRecord) {
      auditRecord.status = status;
      auditRecord.message = lifecycleAction.result.summary;
      auditRecord.completedAt = completedAt;
      auditRecord.result = lifecycleAction.result;
      auditRecord.rollback = recipe?.rollback ?? null;
    }
    const rollbackRequest = state.lifecycleRollbackRequests.find((item) => item.queuedActionId === lifecycleAction.id);
    if (rollbackRequest) {
      rollbackRequest.status = status;
      rollbackRequest.updatedAt = completedAt;
    }
    appendEvent({
      invocationId: null,
      type: status === "succeeded" ? "lifecycle_completed" : "lifecycle_failed",
      level: status === "succeeded" ? "info" : "warn",
      message: lifecycleAction.result.summary,
      data: {
        queuedActionId: lifecycleAction.id,
        recipeId: lifecycleAction.recipeId,
        status,
        exitCode: lifecycleAction.result.exitCode,
        rollbackAvailable: lifecycleAction.result.rollbackAvailable,
      },
    });
    if (status === "failed" && lifecycleAction.result.rollbackAvailable) {
      createRollbackRequest(lifecycleAction, recipe);
    }
    return lifecycleAction;
    });
  }

  function createRollbackRequest(failedAction, recipe = findLifecycleRecipe(failedAction?.recipeId)) {
    if (!failedAction || !recipe?.rollback?.available) {
      throw new Error("Rollback is not available for this lifecycle action.");
    }
    const existing = state.lifecycleRollbackRequests.find((item) => item.failedActionId === failedAction.id);
    if (existing) {
      return existing;
    }
    const createdAt = now();
    const rollback = {
      id: nextId("lco_demo"),
      recipeId: recipe.id,
      failedActionId: failedAction.id,
      agentId: recipe.agentId,
      requestedBy: recipe?.requestedBy ?? "usr_local",
      status: "available",
      strategy: recipe.rollback.strategy,
      command: buildRollbackLifecycleCommand(recipe),
      summary: `Rollback available for ${recipe.name}: ${recipe.rollback.summary}`,
      queuedActionId: null,
      createdAt,
      updatedAt: createdAt,
    };
    runTx(() => {
      state.lifecycleRollbackRequests.unshift(rollback);
      state.lifecycleRollbackRequests = state.lifecycleRollbackRequests.slice(0, 100);
      appendEvent({
        invocationId: null,
        type: "lifecycle_failed",
        level: "warn",
        message: rollback.summary,
        data: { rollbackRequestId: rollback.id, failedActionId: failedAction.id, recipeId: recipe.id },
      });
    });
    return rollback;
  }

  function queueRollbackAction(rollback, { actor = null } = {}) {
    if (!rollback) {
      throw new Error("Rollback request not found.");
    }
    if (rollback.status !== "available" && rollback.status !== "failed") {
      throw new Error(`Rollback request is not queueable from ${rollback.status}.`);
    }
    const createdAt = now();
    const executionEnabled = Boolean(rollback.command);
    const queued = {
      id: nextId("lco_demo"),
      recipeId: rollback.recipeId,
      rollbackForActionId: rollback.failedActionId,
      agentId: rollback.agentId,
      deviceId: rollback.agentId ? agentDeviceId(findAgent(rollback.agentId)) : state.device.id,
      requestedBy: rollback.requestedBy ?? "usr_local",
      action: "rollback",
      status: "queued",
      executionEnabled,
      command: rollback.command,
      summary: executionEnabled
        ? rollback.summary
        : `${rollback.summary} Manual rollback is required because no allowlisted rollback command is available.`,
      result: null,
      createdAt,
      startedAt: null,
      completedAt: null,
    };
    runTx(() => {
      state.lifecycleQueuedActions.unshift(queued);
      state.lifecycleQueuedActions = state.lifecycleQueuedActions.slice(0, 100);
      state.lifecycleAuditRecords.unshift({
        id: queued.id,
        agentId: queued.agentId ?? "agt_lifecycle_pending",
        deviceId: queued.deviceId ?? undefined,
        requestedBy: queued.requestedBy,
        operation: "rollback",
        status: "queued",
        reason: "Rollback requested for failed lifecycle action.",
        message: queued.summary,
        createdAt,
        completedAt: null,
      });
      capLifecycleAuditRecords(state);
      rollback.status = "queued";
      rollback.queuedActionId = queued.id;
      // #1151: record WHO queued it — `requestedBy` is who asked for the rollback,
      // not who pulled the trigger.
      rollback.queuedBy = actor?.userId ?? "usr_local";
      rollback.updatedAt = createdAt;
      appendEvent({
        invocationId: null,
        type: "lifecycle_requested",
        level: "info",
        message: queued.summary,
        data: { rollbackRequestId: rollback.id, queuedActionId: queued.id, executionEnabled },
      });
    });
    return queued;
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
      // What `limit`/`used` count (#856). "requests" (default) keeps the legacy
      // request-counter semantics; the others meter real consumption so a policy
      // can cap tokens or USD — and apply to BYOK runs, not just platform-managed.
      meter: ["requests", "input_tokens", "total_tokens", "usd"].includes(body.meter) ? body.meter : "requests",
      enforcement: ["block", "warn"].includes(body.enforcement) ? body.enforcement : "block",
      window: ["daily", "monthly", "custom"].includes(body.window) ? body.window : "monthly",
      currency: String(body.currency ?? "USD"),
      costOwner: String(body.costOwner ?? "usr_local"),
      teamId: body.teamId ? String(body.teamId) : null,
      createdAt,
      updatedAt: createdAt,
    };
    runTx(() => {
      state.quotaPolicies.unshift(policy);
      state.quotaPolicies = state.quotaPolicies.slice(0, 100);
    });
    return policy;
  }

  // What a policy's meter counts for one completed usage record (#856).
  function meterQuantity(usage, meter) {
    if (meter === "input_tokens") return Math.max(0, Number(usage.inputTokens ?? 0));
    if (meter === "total_tokens") {
      return Math.max(0, Number(usage.inputTokens ?? 0)) + Math.max(0, Number(usage.outputTokens ?? 0));
    }
    if (meter === "usd") {
      const usd = Number(usage.estimatedCost);
      return Number.isFinite(usd) && usd > 0 ? usd : 0;
    }
    return Math.max(1, Number(usage.requestCount ?? 1)); // "requests"
  }

  // Enabled policies governing a subject (a per-user/team cap). A policy's
  // provider is matched when it pins one; a wildcard/"default" provider matches all.
  function policiesForSubject(subjectId, provider) {
    return state.quotaPolicies.filter((policy) =>
      policy.status === "enabled"
      && String(policy.subjectId) === String(subjectId)
      && (!provider || ["", "default", "any", "*", String(provider)].includes(String(policy.provider))));
  }

  // Accrue a completed usage record against its subject's metered policies —
  // this is what makes token/USD quotas track REAL consumption from BYOK runs.
  function accrueUsageQuota(usage) {
    if (!usage) return;
    const metered = policiesForSubject(usage.userId, usage.provider).filter((policy) => policy.meter !== "requests");
    if (metered.length === 0) return;
    runTx(() => {
      for (const policy of metered) {
        policy.used += meterQuantity(usage, policy.meter);
        policy.updatedAt = now();
      }
    });
  }

  // Pre-flight: is this subject already over a metered window allowance? Applies
  // to ANY run (including BYOK), unlike decideQuota which only gates platform_managed.
  function checkUsageQuota({ subjectId, provider } = {}) {
    if (!subjectId) return { allowed: true, blocked: false, policy: null };
    const over = policiesForSubject(subjectId, provider)
      .filter((policy) => policy.meter !== "requests" && policy.limit > 0 && policy.used >= policy.limit);
    if (over.length === 0) return { allowed: true, blocked: false, policy: null };
    const blocking = over.find((policy) => policy.enforcement === "block");
    const policy = blocking ?? over[0];
    const blocked = Boolean(blocking);
    appendEvent({
      invocationId: null,
      type: "quota_checked",
      level: blocked ? "warn" : "info",
      message: `Usage quota ${blocked ? "blocked" : "warning"}: ${policy.meter} used ${policy.used}/${policy.limit}.`,
      data: { policyId: policy.id, meter: policy.meter, used: policy.used, limit: policy.limit, enforcement: policy.enforcement },
    });
    return { allowed: !blocked, blocked, warnOnly: !blocked, policy };
  }

  function recordAiUsage(body = {}) {
    return runTx(() => {
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
      // This path's token counts are asserted by the caller, not measured; the
      // rounds-summed path (recordInvocationRoundUsage) is the authoritative one.
      derivedFrom: "client_reported",
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
      policy.used += meterQuantity(usageRecord, policy.meter);
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
    });
  }

  // Sum an invocation's per-round telemetry (state.invocationRounds, #808) into
  // one authoritative AIUsageRecord — real measured tokens instead of the
  // client-asserted defaults the /api/m3/ai-usage route falls back to. Called at
  // completion. Does NOT create its own ledger entry: cost is already attributed
  // by recordInvocationLedgerEntry from the run's aggregate; we link that entry.
  // Cost-anomaly detection (#857): flag a run whose cost is unusually high, in
  // absolute terms or as a spike vs the subject's recent runs, and fire a
  // cost_anomaly alert through the existing dispatcher. Thresholds are config.
  function detectCostAnomaly(usage) {
    const cost = Number(usage?.estimatedCost);
    if (!Number.isFinite(cost) || cost <= 0) return null;
    const absolute = Number(process.env.COST_ANOMALY_USD_PER_RUN ?? 5);
    const ratio = Number(process.env.COST_ANOMALY_RATIO ?? 4);
    const floor = Number(process.env.COST_ANOMALY_MIN_USD ?? 0.5);
    const prior = state.aiUsageRecords
      .filter((record) => record.id !== usage.id && record.userId === usage.userId)
      .map((record) => Number(record.estimatedCost))
      .filter((value) => Number.isFinite(value) && value > 0)
      .slice(0, 20);
    const avg = prior.length ? prior.reduce((total, value) => total + value, 0) / prior.length : 0;
    const overAbsolute = cost >= absolute;
    const overSpike = avg >= floor && cost >= ratio * avg;
    if (!overAbsolute && !overSpike) return null;
    const reason = overAbsolute ? "absolute_threshold" : "spike_vs_recent";
    const message = `Cost anomaly: $${roundUsd(cost)} on one run (${reason}).`;
    const data = {
      kind: "cost_anomaly",
      reason,
      costUsd: roundUsd(cost),
      subjectId: usage.userId,
      agentId: usage.agentId ?? null,
      invocationId: usage.invocationId ?? null,
      recentAvgUsd: roundUsd(avg),
      thresholdUsd: roundUsd(overAbsolute ? absolute : ratio * avg),
    };
    appendEvent({ invocationId: usage.invocationId ?? null, type: "alert_triggered", level: "warn", message, data });
    // Alerting must never break or slow a run.
    try { void dispatchAlert({ kind: "cost_anomaly", severity: "high", message, data }); } catch { /* best-effort */ }
    return data;
  }

  function recordInvocationRoundUsage({ invocation, ledgerEntryIds = [] } = {}) {
    if (!invocation) return null;
    const rounds = state.invocationRounds?.filter((round) => round.invocationId === invocation.id) ?? [];
    if (rounds.length === 0) return null;

    const sum = (key) => rounds.reduce((total, round) => total + Math.max(0, Number(round[key] ?? 0)), 0);
    // Summed WALL-CLOCK across the rounds (each round's durationMs is the gap
    // between turn boundaries, so this includes tool/IO time, not pure model
    // latency). It is the run's observable duration, which is what the field is
    // used for here — not a model-latency SLA.
    const durations = rounds.map((round) => round.durationMs).filter((value) => Number.isFinite(value));
    const latencyMs = durations.length ? durations.reduce((total, value) => total + value, 0) : null;
    // Prefer a round that actually named its model over an "unknown" placeholder.
    const named = rounds.find((round) => round.model && round.model !== "unknown") ?? rounds[0];
    const createdAt = now();

    // Real cost from measured tokens × the matched model rate (#851). Stays
    // "unknown" for an unpriced model — never a fabricated $0.
    const pricing = priceEvidenceForTokens({
      model: named.model,
      inputTokens: sum("inputTokens"),
      cachedInputTokens: sum("cachedTokens"),
      outputTokens: sum("outputTokens"),
    }, invocation.createdAt ?? createdAt);

    const metadata = invocation.input?.metadata ?? {};
    const projectId = metadata.projectId ?? invocation.projectId ?? state.currentProjectId ?? null;
    const project = projectId ? (state.projects ?? []).find((item) => item.id === projectId) ?? null : null;
    const autoRunId = metadata.autoRunId ?? null;
    const executionChainId = metadata.executionChainId
      ?? (state.autoRuns ?? []).find((run) => run.id === autoRunId)?.executionChainId
      ?? null;
    const localIssueId = autoRunId
      ? (state.workItems ?? []).find((item) => (item.executionBindings ?? []).some((binding) => binding.kind === "auto_run" && binding.targetId === autoRunId))?.id ?? null
      : metadata.localIssueId ?? null;
    const budgetPoolId = (state.budgets ?? []).find((budget) => budget.projectId === projectId)?.id
      ?? (state.budgets ?? []).find((budget) => budget.teamId === (metadata.teamId ?? (project ? teamOf(project) : null)))?.id
      ?? null;
    const usageRecord = {
      id: nextId("aiu_demo"),
      userId: String(invocation.requestedBy ?? "usr_local"),
      teamId: metadata.teamId ?? (project ? teamOf(project) : null),
      agentId: invocation.agentId ?? null,
      invocationId: invocation.id,
      autoRunId,
      localIssueId,
      executionChainId: executionChainId ?? localIssueId,
      projectId,
      budgetPoolId,
      deviceId: invocation.delivery?.deviceId ?? null,
      quotaDecisionId: null,
      provider: named.provider ?? "unknown",
      model: named.model ?? "unknown",
      // Rounds only exist for bridge-run CLI agents (Claude/Codex on the user's
      // machine, using their own credentials) — that is BYOK by definition.
      providerMode: "byok",
      inputTokens: sum("inputTokens"),
      outputTokens: sum("outputTokens"),
      cachedTokens: sum("cachedTokens"),
      reasoningTokens: sum("reasoningTokens"),
      requestCount: rounds.length,
      latencyMs,
      roundCount: rounds.length,
      derivedFrom: "rounds",
      estimatedCost: pricing.amountUsd > 0 ? String(roundUsd(pricing.amountUsd)) : "unknown",
      pricingVersion: pricing.price?.pricingVersion ?? null,
      pricingModelPriceId: pricing.price?.id ?? null,
      pricingCurrency: pricing.price?.currency ?? null,
      pricingMethod: pricing.price ? "token_estimate" : "unknown",
      pricingEffectiveFrom: pricing.price?.effectiveFrom ?? null,
      pricingRates: pricing.price ? priceRateEvidence(pricing.price) : null,
      ledgerEntryIds: [...ledgerEntryIds],
      status: mapInvocationUsageStatus(invocation.status),
      errorCode: null,
      createdAt,
    };
    runTx(() => {
      state.aiUsageRecords.unshift(usageRecord);
      state.aiUsageRecords = state.aiUsageRecords.slice(0, 200);
      for (const round of rounds) round.usageRecordId = usageRecord.id;
      // Charge this real BYOK usage against the subject's metered quota windows.
      accrueUsageQuota(usageRecord);
      detectCostAnomaly(usageRecord);
      appendEvent({
        invocationId: invocation.id,
        type: "ai_usage_recorded",
        level: "info",
        message: `AI usage summed from ${rounds.length} round(s) for ${usageRecord.provider}/${usageRecord.model}.`,
        data: {
          usageRecordId: usageRecord.id,
          derivedFrom: "rounds",
          roundCount: rounds.length,
          inputTokens: usageRecord.inputTokens,
          outputTokens: usageRecord.outputTokens,
          projectId: usageRecord.projectId,
          teamId: usageRecord.teamId,
          autoRunId: usageRecord.autoRunId,
          pricingVersion: usageRecord.pricingVersion,
          pricingModelPriceId: usageRecord.pricingModelPriceId,
        },
      });
    });
    return usageRecord;
  }

  function mapInvocationUsageStatus(status) {
    if (status === "succeeded") return "succeeded";
    if (status === "cancelled") return "cancelled";
    return "failed";
  }

  function enforcePlatformAiQuota(body = {}) {
    const result = recordAiUsage({
      ...body,
      providerMode: "platform_managed",
      requestCount: body.requestCount ?? 1,
      estimatedCost: body.estimatedCost ?? "0",
    });
    return {
      allowed: !result.blocked,
      ...result,
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
        autoRunId: entry.autoRunId ?? null,
        projectId: entry.projectId ?? null,
        provider: entry.provider,
        model: state.aiUsageRecords.find((record) => record.ledgerEntryIds.includes(entry.id))?.model ?? null,
        costOwner: entry.costOwner,
        amount: entry.amount,
        currency: entry.currency,
        billable: entry.billable,
        status: entry.status,
        quotaDecision: state.quotaDecisionRecords.find((decision) => decision.createdLedgerEntryIds?.includes(entry.id))?.decision ?? null,
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
    runTx(() => {
      state.privateDeploymentConfig = config;
      appendEvent({
        invocationId: null,
        type: "billing_recorded",
        level: "info",
        message: "Private deployment export configuration updated.",
        data: { deploymentConfigId: config.id, mode: config.mode },
      });
    });
    return config;
  }

  function createAuditExportRequest(body = {}) {
    const subjects = normalizeAuditSubjects(body.subjects);
    const sinkId = stringOrNull(body.sinkId);
    const validation = validateAuditExport({ subjects, sinkId });
    const dryRun = body.dryRun !== false;
    const createdAt = now();
    const request = {
      id: nextId("aex_demo"),
      requestedBy: body.requestedBy ?? "usr_local",
      mode: state.privateDeploymentConfig.mode,
      subjects,
      status: validation.ok ? dryRun ? "validated" : "exported" : "blocked",
      dryRun,
      sinkId,
      recordCounts: auditExportRecordCounts(subjects),
      manifest: null,
      validation,
      createdAt,
      exportedAt: null,
    };
    if (validation.ok && !dryRun) {
      request.manifest = createAuditExportManifest(request);
      request.exportedAt = request.manifest.generatedAt;
    }
    runTx(() => {
      state.auditExportRequests.unshift(request);
      state.auditExportRequests = state.auditExportRequests.slice(0, 100);
      appendEvent({
        invocationId: null,
        type: "billing_recorded",
        level: validation.ok ? "info" : "warn",
        message: validation.ok
          ? dryRun ? "Audit export dry-run validated." : "Audit export manifest generated."
          : "Audit export blocked by configuration findings.",
        data: { auditExportId: request.id, status: request.status, dryRun: request.dryRun },
      });
    });
    return request;
  }

  return {
    chargebackExport,
    createAuditExportRequest,
    createPrivateCatalogEntry,
    createSignedBundleManifest,
    createLifecycleRecipe,
    createQuotaPolicy,
    checkUsageQuota,
    decideLifecycleLocalApproval,
    evaluateLifecyclePolicy,
    enforcePlatformAiQuota,
    budgetStatusFor,
    budgetStatuses,
    teamBudgetStatuses,
    teamBudgetStatusFor,
    budgetGateForProject,
    reserveBudget,
    releaseBudgetReservation,
    releaseReservationsForAutoRun,
    releaseReservationsForInvocation,
    reconcileBudgetReservations,
    findLifecycleLocalApproval,
    completeLifecycleAction,
    findLifecycleRollbackRequest,
    findLifecycleRecipe,
    findPrivateCatalogEntry,
    ledgerSummary,
    markLifecycleActionStarted,
    nextBridgeLifecycleAction,
    queueLifecycleAction,
    queueRollbackAction,
    recordAiUsage,
    recordInvocationLedgerEntry,
    recordInvocationRoundUsage,
    requestLifecycleLocalApproval,
    transitionLifecycleRecipe,
    updatePrivateDeploymentConfig,
    upsertBudget,
  };

  // Turn an agent-reported run cost (e.g. Claude's total_cost_usd, surfaced by
  // the bridge on the completion payload) into a finalized ledger entry, so it
  // shows in the economics view and counts toward the project's budget. Only
  // fires when the agent actually reported a USD amount — CLI agents that report
  // no cost stay "unknown" and create nothing.
  function recordInvocationLedgerEntry({ invocation, cost, agent }) {
    if (!cost) return null;
    const amountUsd = Number(cost.amountUsd);
    const reported = Number.isFinite(amountUsd) && amountUsd > 0;
    const inputTokens = Math.max(0, Number(cost.inputTokens ?? 0));
    const outputTokens = Math.max(0, Number(cost.outputTokens ?? 0));
    const hasTokens = inputTokens > 0 || outputTokens > 0;
    // When the agent reported no billed USD, estimate from token usage × configured
    // rates (e.g. codex, API-billed). Falls back to an unmetered entry when there is
    // no rate, so a token-bearing run stays visible in economics either way.
    const pricing = reported ? { amountUsd: 0, price: null } : priceEvidenceForTokens(cost, invocation.createdAt ?? now());
    const hasEstimate = pricing.amountUsd > 0;
    if (!reported && !hasEstimate && !(Boolean(cost.billable) && hasTokens)) return null;
    const finalUsd = reported ? roundUsd(amountUsd) : hasEstimate ? roundUsd(pricing.amountUsd) : null;
    const source = reported ? "reported" : hasEstimate ? "estimated" : "unknown";
    const meta = invocation.input?.metadata ?? {};
    const projectId = meta.projectId ?? invocation.projectId ?? state.currentProjectId ?? state.projects[0]?.id ?? null;
    // #969: stamp the OWNING TEAM on the ledger row (was hardcoded null). An
    // explicit owner column lets the read-model scope by team directly — robust to
    // the owning project row being dropped on restore, and the future durable store
    // indexes on it. Derived from the row's project; null when there is no project.
    const ledgerProject = projectId ? state.projects.find((project) => project.id === projectId) : null;
    const ledgerTeamId = ledgerProject ? teamOf(ledgerProject) : null;
    const autoRunId = meta.autoRunId ?? null;
    const localIssueId = autoRunId
      ? (state.workItems ?? []).find((item) => (item.executionBindings ?? []).some((binding) => binding.kind === "auto_run" && binding.targetId === autoRunId))?.id ?? null
      : meta.localIssueId ?? null;
    const executionChainId = meta.executionChainId
      ?? (state.autoRuns ?? []).find((run) => run.id === autoRunId)?.executionChainId
      ?? localIssueId;
    const attributedBudgetPoolId = agent?.economics?.budgetPoolId
      ?? (state.budgets ?? []).find((budget) => budget.projectId === projectId)?.id
      ?? (state.budgets ?? []).find((budget) => budget.teamId === ledgerTeamId)?.id
      ?? null;
    const createdAt = now();
    const model = String(cost.model ?? "unknown");
    const entry = {
      id: nextId("led_demo"),
      workspaceId: agent?.economics?.budgetPoolId ?? "team_local",
      userId: invocation?.requestedBy ?? agent?.economics?.costOwner ?? "usr_local",
      teamId: ledgerTeamId,
      agentId: invocation.agentId ?? null,
      agentName: agent?.name ?? null,
      invocationId: invocation.id,
      deviceId: agent?.location?.deviceId ?? null,
      sourceType: "agent_invocation",
      sourceRecordId: invocation.id,
      entryType: "cost",
      economicModel: agent?.economics?.model ?? "external_metered",
      meterName: reported ? "reported_usd" : hasEstimate ? "estimated_usd" : "token_usage",
      quantity: 1,
      unitPrice: finalUsd != null ? String(finalUsd) : "0",
      currency: String(cost.currency ?? "USD"),
      amount: finalUsd != null ? String(finalUsd) : "0",
      amountUsd: finalUsd,
      amountText: finalUsd == null ? "unmetered" : undefined,
      amountSource: source,
      inputTokens,
      cachedInputTokens: Math.max(0, Number(cost.cachedInputTokens ?? 0)),
      outputTokens,
      reasoningOutputTokens: Math.max(0, Number(cost.reasoningOutputTokens ?? 0)),
      amountDirection: cost.billable ? "payable" : "informational",
      costOwner: agent?.economics?.costOwner ?? invocation?.requestedBy ?? "usr_local",
      revenueOwner: null,
      budgetPoolId: attributedBudgetPoolId,
      projectId,
      // Per-run cost attribution (agent_run_cost_total). The develop/repair/retry
      // invocations of an auto-run all carry autoRunId in their input metadata;
      // stamping it here lets ledgerSummary roll a run's whole cost up in one line
      // without re-deriving it from telemetry. Null for manual/non-auto-run spend.
      autoRunId,
      localIssueId,
      executionChainId,
      // Explicit model dimension for the byModel rollup, independent of
      // `counterparty` (whose meaning differs across ledger paths).
      model,
      counterparty: model,
      provider: model,
      pricingVersion: pricing.price?.pricingVersion ?? null,
      pricingModelPriceId: pricing.price?.id ?? null,
      pricingMethod: reported ? "reported" : hasEstimate ? "token_estimate" : "unknown",
      pricingEffectiveFrom: pricing.price?.effectiveFrom ?? null,
      pricingRates: pricing.price ? priceRateEvidence(pricing.price) : null,
      billable: Boolean(cost.billable),
      status: hasEstimate ? "estimated" : "finalized",
      createdAt,
      finalizedAt: hasEstimate ? null : createdAt,
    };
    runTx(() => {
      state.ledgerEntries.unshift(entry);
      capLedgerEntries(state);
      appendEvent({
        invocationId: invocation.id,
        type: "ledger_entry_recorded",
        level: "info",
        message: reported
          ? `Recorded ${entry.currency} ${entry.amountUsd} reported cost for ${model}.`
          : hasEstimate
            ? `Recorded estimated ${entry.currency} ${entry.amountUsd} for ${model} (${inputTokens}+${outputTokens} tokens).`
            : `Recorded unmetered token usage (${inputTokens}+${outputTokens} tokens) for ${model}.`,
        data: {
          ledgerEntryId: entry.id,
          amountUsd: entry.amountUsd,
          amountSource: source,
          inputTokens,
          outputTokens,
          projectId,
          teamId: entry.teamId,
          autoRunId: entry.autoRunId,
        },
      });
    });
    return entry;
  }

  function latestLifecyclePolicy(recipeId) {
    return state.lifecyclePolicyDecisions.find((item) => item.recipeId === recipeId);
  }

  function findLifecycleAuditRecord(id) {
    return state.lifecycleAuditRecords.find((item) => item.id === id) ?? null;
  }

  function findPrivateCatalogEntry(id) {
    return state.privateCatalogEntries.find((item) => item.id === id) ?? null;
  }

  function findSignedBundleManifest(id) {
    return state.signedBundleManifests.find((item) => item.id === id) ?? null;
  }

  function findLifecycleRollbackRequest(id) {
    return state.lifecycleRollbackRequests.find((item) => item.id === id) ?? null;
  }

  function linkRecipeToCatalog(catalogEntryId, recipeId) {
    const entry = catalogEntryId ? findPrivateCatalogEntry(catalogEntryId) : null;
    if (entry && !entry.recipeIds.includes(recipeId)) {
      entry.recipeIds.unshift(recipeId);
      entry.updatedAt = now();
    }
  }

  function linkBundleToCatalog(catalogEntryId, bundleId) {
    const entry = catalogEntryId ? findPrivateCatalogEntry(catalogEntryId) : null;
    if (entry && !entry.bundleIds.includes(bundleId)) {
      entry.bundleIds.unshift(bundleId);
      entry.updatedAt = now();
    }
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
      projectId: body.projectId ? String(body.projectId) : state.currentProjectId ?? state.projects[0]?.id ?? null,
      // Stamp the real model (not the provider) so byModel rolls up by model, not
      // by "anthropic"/"openai". counterparty stays the provider for chargeback.
      model: usageRecord.model,
      counterparty: usageRecord.provider,
      provider: usageRecord.provider,
      billable: usageRecord.providerMode === "platform_managed",
      status: "estimated",
      createdAt,
      finalizedAt: null,
    };
    state.ledgerEntries.unshift(entry);
    capLedgerEntries(state);
    appendEvent({
      invocationId: usageRecord.invocationId,
      type: "ledger_entry_recorded",
      level: "info",
      message: `Ledger entry recorded for ${usageRecord.provider}/${usageRecord.model}.`,
      data: { ledgerEntryId: entry.id, usageRecordId: usageRecord.id },
    });
    return entry;
  }

  function upsertBudget(body = {}) {
    const projectId = String(body.projectId ?? "").trim();
    const teamId = String(body.teamId ?? "").trim();
    if (Boolean(projectId) === Boolean(teamId)) {
      throw new Error("A budget needs exactly one of projectId or teamId.");
    }
    const limitUsd = Number(body.limitUsd);
    if (!Number.isFinite(limitUsd) || limitUsd < 0) {
      throw new Error("Budget limitUsd must be a non-negative number.");
    }
    const nowValue = now();

    // Team pool: caps the summed spend of every project the team owns.
    if (teamId) {
      const team = (state.teams ?? []).find((item) => item.id === teamId);
      if (!team) {
        throw new Error("A known teamId is required.");
      }
      const existing = state.budgets.find((item) => item.teamId === teamId);
      const budget = existing ?? { id: nextId("bud_demo"), teamId, createdAt: nowValue };
      return runTx(() => {
        budget.teamName = team.name;
        budget.limitUsd = Number(limitUsd.toFixed(2));
        budget.policy = normalizeBudgetPolicy(body.policy);
        budget.currency = "USD";
        budget.updatedAt = nowValue;
        if (!existing) {
          state.budgets.unshift(budget);
        }
        state.budgets = state.budgets.slice(0, 200);
        appendEvent({
          invocationId: null,
          type: "billing_recorded",
          level: "info",
          message: `Team budget updated for ${team.name}.`,
          data: { budgetId: budget.id, teamId, policy: budget.policy },
        });
        return budget;
      });
    }

    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("A known projectId is required.");
    }
    const existing = state.budgets.find((item) => item.projectId === projectId);
    const budget = existing ?? {
      id: nextId("bud_demo"),
      projectId,
      createdAt: nowValue,
    };
    return runTx(() => {
      budget.projectName = project.name;
      budget.limitUsd = Number(limitUsd.toFixed(2));
      budget.policy = normalizeBudgetPolicy(body.policy);
      budget.currency = "USD";
      budget.updatedAt = nowValue;
      if (!existing) {
        state.budgets.unshift(budget);
      }
      state.budgets = state.budgets.slice(0, 200);
      appendEvent({
        invocationId: null,
        type: "billing_recorded",
        level: "info",
        message: `Budget updated for ${project.name}.`,
        data: { budgetId: budget.id, projectId, policy: budget.policy },
      });
      return budget;
    });
  }

  function budgetStatusFor(projectId) {
    const project = state.projects.find((item) => item.id === projectId);
    const budget = state.budgets.find((item) => item.projectId === projectId);
    const spend = ledgerSpendForProject(projectId);
    const limitUsd = budget ? Number(budget.limitUsd) : null;
    const remainingUsd = budget && limitUsd !== null ? roundUsd(limitUsd - spend.spentUsd) : null;
    // #890: in-flight holds for runs admitted-but-not-yet-billed. `spentUsd`/`over`
    // keep their finalized-display meaning; `admissionUsd`/`admissionOver` add the
    // holds so a concurrent admission sees runs already in flight (the TOCTOU fix).
    const reservedUsd = activeReservedForProject(projectId);
    const admissionUsd = roundUsd(spend.spentUsd + reservedUsd);
    return {
      projectId,
      projectName: project?.name,
      exists: Boolean(budget),
      budgetId: budget?.id,
      limitUsd,
      policy: budget?.policy ?? "warn",
      currency: budget?.currency ?? "USD",
      spentUsd: spend.spentUsd,
      finalizedUsd: spend.finalizedUsd,
      estimatedUsd: spend.estimatedUsd,
      reservedUsd,
      admissionUsd,
      remainingUsd,
      over: budget ? spend.spentUsd > limitUsd : false,
      admissionOver: budget ? admissionUsd > limitUsd : false,
    };
  }

  function budgetStatuses() {
    return state.projects.map((project) => budgetStatusFor(project.id));
  }

  // Team-level cost allocation: roll per-project ledger spend up to the owning
  // team, so a team sees its total across all its projects. Team budget *limits*
  // (a pool cap + over) are a follow-up; this is the attribution.
  function teamBudgetStatuses() {
    const rollup = new Map();
    for (const project of state.projects ?? []) {
      const teamId = teamOf(project);
      const spend = ledgerSpendForProject(project.id);
      const acc = rollup.get(teamId) ?? {
        teamId,
        teamName: (state.teams ?? []).find((t) => t.id === teamId)?.name ?? teamId,
        projectCount: 0,
        finalizedUsd: 0,
        estimatedUsd: 0,
        spentUsd: 0,
      };
      acc.projectCount += 1;
      acc.finalizedUsd = roundUsd(acc.finalizedUsd + spend.finalizedUsd);
      acc.estimatedUsd = roundUsd(acc.estimatedUsd + spend.estimatedUsd);
      acc.spentUsd = roundUsd(acc.spentUsd + spend.spentUsd);
      rollup.set(teamId, acc);
    }
    // Join the team budget pool (a budgets row with teamId instead of
    // projectId) so each team row carries its limit/remaining/over.
    return [...rollup.values()].map((row) => {
      const pool = (state.budgets ?? []).find((item) => item.teamId === row.teamId);
      const limitUsd = pool ? Number(pool.limitUsd) : null;
      const reservedUsd = activeReservedForTeam(row.teamId);
      const admissionUsd = roundUsd(row.spentUsd + reservedUsd);
      return {
        ...row,
        exists: Boolean(pool),
        budgetId: pool?.id,
        limitUsd,
        policy: pool?.policy ?? "warn",
        currency: pool?.currency ?? "USD",
        reservedUsd,
        admissionUsd,
        remainingUsd: pool && limitUsd !== null ? roundUsd(limitUsd - admissionUsd) : null,
        over: pool ? row.spentUsd > limitUsd : false,
        admissionOver: pool ? admissionUsd > limitUsd : false,
      };
    });
  }

  function teamBudgetStatusFor(teamId) {
    return teamBudgetStatuses().find((row) => row.teamId === teamId) ?? null;
  }

  // The enforcement gate the UI copy promises ("Over budget — new runs are
  // blocked"): a new run for a project is blocked when the project budget OR
  // its owning team's pool is over the limit with policy "block". Warn /
  // allow_overage budgets never block.
  function budgetGateForProject(projectId) {
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) return { blocked: false };
    const projectStatus = budgetStatusFor(project.id);
    if (projectStatus.exists && projectStatus.over && projectStatus.policy === "block") {
      return {
        blocked: true,
        reason: `Project budget exceeded (${projectStatus.spentUsd} of ${projectStatus.limitUsd} USD) with a block policy.`,
      };
    }
    const teamStatus = teamBudgetStatusFor(teamOf(project));
    if (teamStatus?.exists && teamStatus.over && teamStatus.policy === "block") {
      return {
        blocked: true,
        reason: `Team budget exceeded (${teamStatus.spentUsd} of ${teamStatus.limitUsd} USD) with a block policy.`,
      };
    }
    return { blocked: false };
  }

  // ── Budget reservations (#890) ──────────────────────────────────────────────
  // A reservation is a synchronous HOLD placed at admission, before a run has
  // spent anything, so two runs starting near the limit see each other. Node is
  // single-threaded, so a read-then-write done in ONE synchronous tick (no await
  // between) is atomic — reserveBudget is that tick. The hold is released when the
  // run settles (its real ledger spend then carries the cost). Without this, the
  // budget check reads only finalized spend, so N concurrent runs all pass then
  // all spend (the TOCTOU the check-then-await window opened).
  function reservationProjectId(reservation) {
    return reservation?.projectId ?? null;
  }

  function activeReservedForProject(projectId) {
    let total = 0;
    for (const reservation of state.budgetReservations ?? []) {
      if (reservation?.status === "active" && reservationProjectId(reservation) === projectId) {
        total = roundUsd(total + (Number(reservation.amountUsd) || 0));
      }
    }
    return total;
  }

  function activeReservedForTeam(teamId) {
    const teamProjectIds = new Set(
      (state.projects ?? []).filter((project) => teamOf(project) === teamId).map((project) => project.id),
    );
    let total = 0;
    for (const reservation of state.budgetReservations ?? []) {
      if (reservation?.status === "active" && teamProjectIds.has(reservationProjectId(reservation))) {
        total = roundUsd(total + (Number(reservation.amountUsd) || 0));
      }
    }
    return total;
  }

  // Keep the collection bounded: all active holds + a recent tail of settled ones
  // for evidence. Active holds are never dropped (they gate admission).
  function capBudgetReservations(limitSettled = 200) {
    const rows = state.budgetReservations ?? [];
    const active = rows.filter((r) => r?.status === "active");
    const settled = rows.filter((r) => r?.status !== "active").slice(0, limitSettled);
    state.budgetReservations = [...active, ...settled];
  }

  /**
   * Atomically reserve `amountUsd` against a project's (and its team pool's) hard
   * block budget. Returns `{ok:true, reservationId}` after writing the hold, or
   * `{ok:false, reason}` WITHOUT writing when the hold would push finalized spend +
   * existing holds over a block limit. A non-positive amount, or a project/team
   * with no block budget, always succeeds (accounting-only) — this never invents a
   * refusal a plain over-budget check wouldn't also raise. Synchronous by design.
   */
  function reserveBudget({ projectId, amountUsd = 0, invocationId = null, autoRunId = null, teamId = null } = {}) {
    const reserveUsd = roundUsd(Math.max(0, Number(amountUsd) || 0));
    if (reserveUsd > 0 && projectId) {
      const status = budgetStatusFor(projectId);
      if (status.exists && status.policy === "block" && status.limitUsd != null) {
        const wouldBe = roundUsd(status.spentUsd + status.reservedUsd + reserveUsd);
        if (wouldBe > status.limitUsd) {
          return {
            ok: false,
            reason: `Project budget would be exceeded ($${wouldBe} of $${status.limitUsd} including in-flight runs).`,
          };
        }
      }
      const project = (state.projects ?? []).find((item) => item.id === projectId);
      const team = teamId ?? (project ? teamOf(project) : null);
      const teamStatus = team ? teamBudgetStatusFor(team) : null;
      if (teamStatus?.exists && teamStatus.policy === "block" && teamStatus.limitUsd != null) {
        const wouldBe = roundUsd(teamStatus.spentUsd + activeReservedForTeam(team) + reserveUsd);
        if (wouldBe > teamStatus.limitUsd) {
          return {
            ok: false,
            reason: `Team budget would be exceeded ($${wouldBe} of $${teamStatus.limitUsd} including in-flight runs).`,
          };
        }
      }
    }
    const project = (state.projects ?? []).find((item) => item.id === projectId);
    const reservation = {
      id: nextId("bres"),
      projectId: projectId ?? null,
      teamId: teamId ?? (project ? teamOf(project) : null),
      amountUsd: reserveUsd,
      invocationId,
      autoRunId,
      status: "active",
      createdAt: now(),
      settledAt: null,
      outcome: null,
    };
    runTx(() => {
      (state.budgetReservations ??= []).unshift(reservation);
      capBudgetReservations();
      appendEvent({
        invocationId,
        type: "budget_reserved",
        level: "info",
        message: `Reserved $${reserveUsd} for ${projectId ?? "unscoped"} (auto-run ${autoRunId ?? "n/a"}).`,
        data: { reservationId: reservation.id, projectId, autoRunId, amountUsd: reserveUsd },
      });
    });
    return { ok: true, reservationId: reservation.id, amountUsd: reserveUsd };
  }

  function releaseBudgetReservation(reservationId, { outcome = "released" } = {}) {
    const reservation = (state.budgetReservations ?? []).find((item) => item.id === reservationId);
    if (!reservation || reservation.status !== "active") return false; // idempotent
    return runTx(() => {
      reservation.status = "settled";
      reservation.outcome = outcome;
      reservation.settledAt = now();
      appendEvent({
        invocationId: reservation.invocationId,
        type: "budget_reservation_released",
        level: "info",
        message: `Released reservation ${reservation.id} (${outcome}).`,
        data: { reservationId: reservation.id, projectId: reservation.projectId, autoRunId: reservation.autoRunId, outcome },
      });
      return true;
    });
  }

  function releaseReservationsForAutoRun(autoRunId, { outcome = "released" } = {}) {
    if (!autoRunId) return 0;
    let released = 0;
    for (const reservation of [...(state.budgetReservations ?? [])]) {
      if (reservation.autoRunId === autoRunId && reservation.status === "active") {
        if (releaseBudgetReservation(reservation.id, { outcome })) released += 1;
      }
    }
    return released;
  }

  // Release a plain (non-auto-run) invocation's hold when it reaches a terminal
  // state — the manual/API accept path reserves against the invocation id.
  function releaseReservationsForInvocation(invocationId, { outcome = "released" } = {}) {
    if (!invocationId) return 0;
    let released = 0;
    for (const reservation of [...(state.budgetReservations ?? [])]) {
      if (reservation.invocationId === invocationId && !reservation.autoRunId && reservation.status === "active") {
        if (releaseBudgetReservation(reservation.id, { outcome })) released += 1;
      }
    }
    return released;
  }

  // Boot/sweep reconcile: release any active hold whose owner is already settled or
  // gone (a crash between reserve and settle would otherwise leak a hold that
  // blocks the budget forever). An auto-run hold is judged by `isSettled(autoRunId)`;
  // a plain-invocation hold by `isInvocationTerminal(invocationId)`; a hold with no
  // owner link at all can't be tracked, so it is reclaimed. Both predicates are
  // injected by the caller that owns those lifecycles.
  function reconcileBudgetReservations({ isSettled, isInvocationTerminal } = {}) {
    let released = 0;
    for (const reservation of [...(state.budgetReservations ?? [])]) {
      if (reservation.status !== "active") continue;
      let orphaned;
      if (reservation.autoRunId) {
        orphaned = typeof isSettled === "function" && isSettled(reservation.autoRunId);
      } else if (reservation.invocationId) {
        orphaned = typeof isInvocationTerminal === "function" && isInvocationTerminal(reservation.invocationId);
      } else {
        orphaned = true; // no owner link → untrackable, reclaim
      }
      if (orphaned) {
        if (releaseBudgetReservation(reservation.id, { outcome: "reconciled" })) released += 1;
      }
    }
    return released;
  }

  function ledgerSpendForProject(projectId) {
    const spend = {
      finalizedUsd: 0,
      estimatedUsd: 0,
      spentUsd: 0,
    };
    for (const entry of state.ledgerEntries ?? []) {
      const entryProjectId = entry.projectId ?? state.currentProjectId ?? state.projects[0]?.id ?? null;
      if (entryProjectId !== projectId || ["voided", "cancelled"].includes(entry.status)) {
        continue;
      }
      const amount = ledgerEntryAmount(entry);
      const source = ledgerAmountSource(entry, amount);
      if (source === "unknown") continue;
      if (source === "estimated") {
        spend.estimatedUsd = roundUsd(spend.estimatedUsd + amount);
      } else {
        spend.finalizedUsd = roundUsd(spend.finalizedUsd + amount);
      }
    }
    spend.spentUsd = roundUsd(spend.finalizedUsd + spend.estimatedUsd);
    return spend;
  }

  function ledgerSummary(includeEntry) {
    // Optional per-entry filter so a tenancy-scoped read model can roll up only
    // the entries the viewer may see. Default (no filter) is the platform-wide
    // rollup used by the admin/unscoped path. Without this, buildPublicState
    // surfaced a GLOBAL totalCostUsd + byProject (with foreign project names) to
    // every scoped team — a cross-tenant economics leak (#891).
    const entries = (state.ledgerEntries ?? []).filter(
      typeof includeEntry === "function" ? includeEntry : () => true,
    );
    const summary = {
      currency: "USD",
      totalCostUsd: 0,
      finalizedUsd: 0,
      estimatedUsd: 0,
      entryCount: entries.length,
      knownEntries: 0,
      estimatedEntries: 0,
      unknownEntries: 0,
      voidedEntries: 0,
      billableEntries: 0,
      byCostOwner: [],
      byProject: [],
      byAgent: [],
      byModel: [],
      byAutoRun: [],
    };
    const owners = new Map();
    const projects = new Map();
    const agents = new Map();
    const models = new Map();
    const autoRuns = new Map();
    for (const entry of entries) {
      if (["voided", "cancelled"].includes(entry.status)) {
        // Count it, then skip it for ALL spend — a voided/cancelled entry is not
        // real spend and must not inflate totalCostUsd or any rollup (byModel /
        // byAutoRun / byAgent / byProject / byCostOwner). Mirrors
        // ledgerSpendForProject, which already skips these.
        summary.voidedEntries += 1;
        continue;
      }
      if (entry.billable) summary.billableEntries += 1;
      const amount = ledgerEntryAmount(entry);
      const source = ledgerAmountSource(entry, amount);
      if (source === "unknown") {
        summary.unknownEntries += 1;
      } else if (source === "estimated") {
        summary.estimatedEntries += 1;
        summary.estimatedUsd = roundUsd(summary.estimatedUsd + amount);
        summary.totalCostUsd = roundUsd(summary.totalCostUsd + amount);
      } else {
        summary.knownEntries += 1;
        summary.finalizedUsd = roundUsd(summary.finalizedUsd + amount);
        summary.totalCostUsd = roundUsd(summary.totalCostUsd + amount);
      }
      addRollup(owners, entry.costOwner ?? "unknown", amount, source, { costOwner: entry.costOwner ?? "unknown" });
      const projectId = entry.projectId ?? state.currentProjectId ?? state.projects[0]?.id ?? "unknown";
      const project = state.projects.find((item) => item.id === projectId);
      addRollup(projects, projectId, amount, source, { projectId, projectName: project?.name });
      const agentId = entry.agentId ?? "unknown";
      const agent = findAgent(agentId);
      addRollup(agents, agentId, amount, source, { agentId, agentName: agent?.name, provider: entry.provider });
      // cost_by_model: key on the explicit `model` field (falling back to the
      // legacy counterparty for pre-fix entries), NOT the provider — so an
      // AI-usage row whose counterparty is "anthropic"/"openai" still buckets by
      // its actual model rather than polluting the model dimension.
      const modelKey = entry.model ?? entry.counterparty ?? entry.provider ?? "unknown";
      addRollup(models, modelKey, amount, source, { model: modelKey, provider: entry.provider });
      // agent_run_cost_total: sum a single auto-run's whole spend. Only entries
      // stamped with an autoRunId participate — manual/unrelated spend is not
      // conflated into a "none" bucket.
      if (entry.autoRunId) {
        addRollup(autoRuns, entry.autoRunId, amount, source, { autoRunId: entry.autoRunId });
      }
    }
    summary.byCostOwner = [...owners.values()].sort((a, b) => b.entries - a.entries);
    summary.byProject = [...projects.values()].sort((a, b) => b.entries - a.entries);
    summary.byAgent = [...agents.values()].sort((a, b) => b.entries - a.entries);
    summary.byModel = [...models.values()].sort((a, b) => b.entries - a.entries);
    // Sorted by total cost desc — "which runs cost the most" is the useful view.
    summary.byAutoRun = [...autoRuns.values()].sort(
      (a, b) => b.knownCostUsd + b.estimatedCostUsd - (a.knownCostUsd + a.estimatedCostUsd),
    );
    return summary;
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
      policy: policyAuditRecords().length,
      audit: state.auditSummaries.length,
      catalog: state.privateCatalogEntries.length,
      bundle: state.signedBundleManifests.length,
      // #1085: run transcripts are exportable evidence (skeleton + hashes
      // survive retention; payload only while unreaped).
      transcript: (state.runTranscripts ?? []).length,
    };
    return Object.fromEntries(subjects.map((subject) => [subject, counts[subject] ?? 0]));
  }

  function createAuditExportManifest(request) {
    const recordRefs = auditExportRecordRefs(request.subjects);
    const sink = request.sinkId ? state.privateDeploymentConfig.auditSinks.find((item) => item.id === request.sinkId) : null;
    return {
      id: `manifest_${request.id}`,
      requestId: request.id,
      generatedAt: now(),
      immutable: Boolean(sink?.immutable || state.privateDeploymentConfig.immutableAuditOption !== "disabled"),
      sinkId: request.sinkId,
      subjects: request.subjects,
      recordRefs,
      // A REAL content digest over what the manifest attests to: the subjects +
      // the exact record refs, each ref carrying a sha256 of its record's content.
      // A verifier recomputes it from the manifest and detects tamper of either the
      // attested SET (a record added/removed) or a record's CONTENT (a field
      // altered) — closing the M3 "checksum is synthetic" residual with genuine
      // content-tamper evidence.
      checksum: computeAuditExportChecksum(request.subjects, recordRefs),
      delivery: {
        externalDeliveryEnabled: Boolean(sink?.externalDeliveryEnabled),
        destinationRef: sink?.destinationRef ?? null,
      },
    };
  }

  function auditExportRecordRefs(subjects) {
    const refs = [];
    const pushRefs = (subject, records) => {
      if (!subjects.includes(subject)) {
        return;
      }
      for (const record of records) {
        const id = record.id ?? record.invocationId ?? record.ledgerEntryId ?? record.policyDecisionId ?? record.traceId;
        if (id) {
          // Each ref carries a sha256 of the record's canonical content (a Merkle
          // leaf), so the manifest checksum is content-tamper-evident: altering an
          // attested record's fields — not only adding/removing a record — changes
          // the leaf and therefore the top checksum.
          const contentHash = createHash("sha256").update(stableStringifyForDigest(record)).digest("hex");
          refs.push({ subject, id: String(id), contentHash });
        }
      }
    };
    pushRefs("invocation", state.invocations);
    pushRefs("lifecycle", [...state.lifecycleAuditRecords, ...state.lifecycleRecipes, ...state.lifecycleRollbackRequests]);
    pushRefs("quota", state.quotaDecisionRecords);
    pushRefs("usage", [...state.aiUsageRecords, ...(state.importedUsageEstimates ?? [])]);
    pushRefs("ledger", state.ledgerEntries);
    pushRefs("policy", policyAuditRecords());
    pushRefs("audit", state.auditSummaries);
    pushRefs("catalog", state.privateCatalogEntries);
    pushRefs("bundle", state.signedBundleManifests);
    pushRefs("transcript", state.runTranscripts ?? []);
    return refs;
  }

  function policyAuditRecords() {
    return [
      ...state.policyDecisionRecords,
      ...state.lifecyclePolicyDecisions,
      ...state.approvalRequests,
      ...state.codexApprovalBrokerRequests,
    ];
  }
}

// A real sha256 digest of what an audit-export manifest attests to: the subjects
// and the exact record refs (each ref carrying its content hash). Subjects are
// canonicalized (deduped + sorted) so the digest is invariant to the request's
// subject order; refs carry a per-record contentHash so the digest is
// content-tamper-evident, not merely reference-set-tamper-evident. Deterministic,
// so a verifier recomputes it from the manifest's own fields. Pure + exported for
// direct testing.
export function computeAuditExportChecksum(subjects, recordRefs) {
  const canonicalSubjects = Array.isArray(subjects) ? [...new Set(subjects.map(String))].sort() : [];
  const refs = Array.isArray(recordRefs) ? recordRefs : [];
  const canonical = JSON.stringify({ subjects: canonicalSubjects, recordRefs: refs });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

// Stable, key-sorted stringify so a record's content hash is invariant to key
// insertion order (a verifier re-reading the live record must reproduce the same
// leaf). Recurses through arrays/objects; primitives fall through to JSON.
function stableStringifyForDigest(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringifyForDigest).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringifyForDigest(value[key])}`).join(",")}}`;
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
  const signatureStatus = normalizeSignatureStatus(raw.signatureStatus);
  return {
    type: allowedRecipeSources.includes(raw.type) ? raw.type : "manual_entry",
    uri: String(raw.uri ?? "manual://lifecycle-recipe"),
    author: String(raw.author ?? "").trim(),
    version: String(raw.version ?? "").trim(),
    checksum: stringOrNull(raw.checksum),
    signatureStatus,
    compatibilityRange: String(raw.compatibilityRange ?? ">=0.0.0"),
  };
}

function normalizeSignatureStatus(value) {
  const signatureStatus = String(value ?? "unsigned");
  return allowedSignatureStatuses.includes(signatureStatus) ? signatureStatus : "unsigned";
}

function signedBundlePolicy(signatureStatus, body = {}) {
  if (signatureStatus === "signed_verified" || signatureStatus === "not_required") {
    return { decision: "allowed", reason: "Bundle signature policy passed." };
  }
  if (signatureStatus === "signature_missing" && body.blockMissingSignature === true) {
    return { decision: "blocked", reason: "Bundle signature is missing and policy requires a signature." };
  }
  if (signatureStatus === "signed_unverified") {
    return { decision: "blocked", reason: "Bundle signature could not be verified." };
  }
  return { decision: "requires_local_approval", reason: `Bundle signature status is ${signatureStatus}.` };
}

function normalizePackageName(value) {
  return String(value ?? "demo-agent")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "demo-agent";
}

function normalizeSupportedPlatforms(value) {
  const supported = normalizeStringArray(value).filter((item) => ["macos", "windows", "linux"].includes(item));
  return supported.length ? supported : ["macos", "windows", "linux"];
}

function normalizeBudgetPolicy(value) {
  const policy = String(value ?? "warn").trim();
  return ["warn", "block", "allow_overage"].includes(policy) ? policy : "warn";
}

// Bound the ledger for display, but NEVER drop a spend-bearing entry: budget
// spend (budgetStatusFor/ledgerSpendForProject) re-sums this live array, so
// trimming a finalized cost would silently under-count spend and wrongly clear
// an over-budget project. Keep all real-cost entries + the newest `cap`
// informational/unknown ones (the array is newest-first).
export function capLedgerEntries(state, cap = 200) {
  const isSpend = (e) =>
    Number(e.amountUsd ?? e.amount) > 0 && !["voided", "cancelled"].includes(e.status);
  let others = 0;
  state.ledgerEntries = state.ledgerEntries.filter((e) => {
    if (isSpend(e)) return true;
    others += 1;
    return others <= cap;
  });
}

function ledgerEntryAmount(entry) {
  const amount = Number(entry.amountUsd ?? entry.amount);
  return Number.isFinite(amount) && amount > 0 ? roundUsd(amount) : 0;
}

// Per-million-token USD rates used to ESTIMATE cost for agents that report token
// usage but no billed amount (Epic #851). Rates are DATA, not code: entries are
// matched by the longest model-prefix, and an unmatched model stays `unknown`
// rather than being priced by a guess. Defaults are provider list prices as of
// 2026-07; override any of them via <PREFIX>_{INPUT,CACHED_INPUT,OUTPUT}_USD_PER_MTOK
// env (e.g. CLAUDE_OPUS_INPUT_USD_PER_MTOK, CODEX_OUTPUT_USD_PER_MTOK). The
// resulting ledger entry is marked amountSource "estimated" (never "reported").
const PRICE_UPDATED_AT = "2026-07-01T00:00:00.000Z";

function modelPrice(provider, model, envPrefix, [input, cachedInput, output]) {
  const rate = (suffix, fallback) => {
    const variable = `${envPrefix}_${suffix}_USD_PER_MTOK`;
    const configured = process.env[variable];
    const value = Number(configured == null || configured === "" ? fallback : configured);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${variable} must be a finite non-negative number.`);
    }
    return String(value);
  };
  return {
    id: `prc_${provider}_${model}`,
    provider,
    model,
    currency: "USD",
    inputUsdPerMTok: rate("INPUT", input),
    cachedInputUsdPerMTok: rate("CACHED_INPUT", cachedInput),
    outputUsdPerMTok: rate("OUTPUT", output),
    // These providers already fold reasoning tokens into output, so it is not
    // billed again; the field exists for providers that meter it separately.
    reasoningOutputUsdPerMTok: "0",
    source: "default",
    effectiveFrom: PRICE_UPDATED_AT,
    effectiveTo: null,
    updatedAt: PRICE_UPDATED_AT,
  };
}

// Ordered most-specific-first only for readability; the matcher picks the
// longest matching prefix regardless of order.
const MODEL_PRICE_ROWS = [
  modelPrice("anthropic", "claude-opus", "CLAUDE_OPUS", [15, 1.5, 75]),
  modelPrice("anthropic", "claude-sonnet", "CLAUDE_SONNET", [3, 0.3, 15]),
  modelPrice("anthropic", "claude-haiku", "CLAUDE_HAIKU", [0.8, 0.08, 4]),
  modelPrice("openai", "gpt", "OPENAI_GPT", [2.5, 0.25, 10]),
  modelPrice("codex", "codex", "CODEX", [1.75, 0.175, 14]),
];
const PRICE_TABLE_VERSION = `2026-07-01.${createHash("sha256").update(JSON.stringify(MODEL_PRICE_ROWS.map(priceRateEvidence))).digest("hex").slice(0, 12)}`;
const MODEL_PRICES = MODEL_PRICE_ROWS.map((price) => ({ ...price, pricingVersion: PRICE_TABLE_VERSION }));

/** The current price table (read-only view). */
export function modelPrices() {
  return MODEL_PRICES.map((price) => ({ ...price }));
}

/** The most specific price whose `model` is a prefix of `model`, else null. */
export function priceForModel(model, at = new Date().toISOString()) {
  const key = String(model ?? "").toLowerCase();
  if (!key) return null;
  const timestamp = Date.parse(at);
  let best = null;
  for (const price of MODEL_PRICES) {
    const effectiveFrom = Date.parse(price.effectiveFrom);
    const effectiveTo = price.effectiveTo ? Date.parse(price.effectiveTo) : Number.POSITIVE_INFINITY;
    if (Number.isFinite(timestamp) && (timestamp < effectiveFrom || timestamp >= effectiveTo)) continue;
    if (key.startsWith(price.model) && (!best || price.model.length > best.model.length)) best = price;
  }
  return best;
}

// Estimate USD from reported token counts when the agent reported no billed amount.
// Cached input is priced at its own (cheaper) rate; output already includes any
// reasoning tokens, so reasoning is not billed again. Returns 0 when unpriceable.
export function estimateCostUsdFromTokens(cost) {
  return priceEvidenceForTokens(cost).amountUsd;
}

export function priceEvidenceForTokens(cost, at = new Date().toISOString()) {
  const price = priceForModel(cost?.model, at);
  if (!price) return { amountUsd: 0, price: null };
  const input = Math.max(0, Number(cost.inputTokens ?? 0));
  const cached = Math.min(input, Math.max(0, Number(cost.cachedInputTokens ?? 0)));
  const output = Math.max(0, Number(cost.outputTokens ?? 0));
  const usd = ((input - cached) * Number(price.inputUsdPerMTok)
    + cached * Number(price.cachedInputUsdPerMTok)
    + output * Number(price.outputUsdPerMTok)) / 1_000_000;
  return { amountUsd: Number.isFinite(usd) && usd > 0 ? usd : 0, price };
}

function priceRateEvidence(price) {
  return {
    inputUsdPerMTok: price.inputUsdPerMTok,
    cachedInputUsdPerMTok: price.cachedInputUsdPerMTok,
    outputUsdPerMTok: price.outputUsdPerMTok,
    reasoningOutputUsdPerMTok: price.reasoningOutputUsdPerMTok,
  };
}

function ledgerAmountSource(entry, amount = ledgerEntryAmount(entry)) {
  if (amount <= 0) return "unknown";
  if (entry.amountSource === "reported" || entry.status === "finalized") return "reported";
  if (entry.amountSource === "estimated" || entry.status === "estimated") return "estimated";
  return "reported";
}

function addRollup(map, key, amount, source, seed) {
  const item = map.get(key) ?? {
    ...seed,
    entries: 0,
    knownCostUsd: 0,
    estimatedCostUsd: 0,
    unknownEntries: 0,
  };
  item.entries += 1;
  if (source === "unknown") {
    item.unknownEntries += 1;
  } else if (source === "estimated") {
    item.estimatedCostUsd = roundUsd(item.estimatedCostUsd + amount);
  } else {
    item.knownCostUsd = roundUsd(item.knownCostUsd + amount);
  }
  map.set(key, item);
}

function roundUsd(value) {
  return Number(Number(value).toFixed(6));
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

function buildExecutableLifecycleCommand(recipe) {
  const command = recipe.recipeCommand ?? null;
  if (!isAllowlistedLifecycleCommandForAction(command, recipe.action, recipe)) {
    return null;
  }
  return canonicalLifecycleCommand(command.commandId);
}

function buildRollbackLifecycleCommand(recipe) {
  if (!recipe?.rollback?.available || recipe.rollback.strategy === "not_supported" || recipe.rollback.strategy === "unknown") {
    return null;
  }
  return canonicalLifecycleCommand("demo_agent_rollback");
}

function isAllowlistedLifecycleCommandForAction(command, action, recipe = null) {
  const commandId = String(command?.commandId ?? "");
  return isAllowlistedLifecycleCommand(command)
    && (lifecycleRecipeCommandAllowlistByAction[action]?.has(commandId) ?? false)
    && lifecycleCommandMatchesRecipe(command, action, recipe);
}

function isExecutableLifecycleActionCommand(command, action) {
  if (action === "rollback") {
    return isAllowlistedLifecycleCommand(command) && String(command.commandId ?? "") === "demo_agent_rollback";
  }
  return isAllowlistedLifecycleCommand(command)
    && (lifecycleRecipeCommandAllowlistByAction[action]?.has(String(command.commandId ?? "")) ?? false);
}

function isAllowlistedLifecycleCommand(command) {
  return Boolean(command)
    && lifecycleCommandAllowlist.has(String(command.commandId ?? ""))
    && command.shell === false
    && !command.packageManager;
}

function canonicalLifecycleCommand(commandId) {
  const commands = {
    demo_agent_version: {
      summary: "Run the bridge-managed demo agent version check.",
      commandId: "demo_agent_version",
      executable: "demo-agent",
      args: ["--version"],
      shell: false,
      packageManager: null,
    },
    demo_agent_update: {
      summary: "Run the bridge-managed demo agent update fixture.",
      commandId: "demo_agent_update",
      executable: "demo-agent",
      args: ["--self-check-update"],
      shell: false,
      packageManager: null,
    },
    demo_agent_health: {
      summary: "Run the bridge-managed demo agent health fixture.",
      commandId: "demo_agent_health",
      executable: "demo-agent",
      args: ["--self-check-health"],
      shell: false,
      packageManager: null,
    },
    demo_agent_rollback: {
      summary: "Run the bridge-managed demo agent rollback fixture.",
      commandId: "demo_agent_rollback",
      executable: "demo-agent",
      args: ["--self-check-rollback"],
      shell: false,
      packageManager: null,
    },
    npm_global_install_pinned: {
      summary: `Install pinned ccusage@${CCUSAGE_VERSION} through npm global install.`,
      commandId: "npm_global_install_pinned",
      executable: "npm",
      args: ["install", "-g", `ccusage@${CCUSAGE_VERSION}`],
      shell: false,
      packageManager: null,
    },
    npm_global_uninstall_package: {
      summary: "Uninstall the bridge-managed ccusage global npm package.",
      commandId: "npm_global_uninstall_package",
      executable: "npm",
      args: ["uninstall", "-g", "ccusage"],
      shell: false,
      packageManager: null,
    },
    ccusage_version: {
      summary: "Run ccusage version check.",
      commandId: "ccusage_version",
      executable: "ccusage",
      args: ["--version"],
      shell: false,
      packageManager: null,
    },
    ccusage_report_probe: {
      summary: "Run a minimal offline ccusage JSON report probe.",
      commandId: "ccusage_report_probe",
      executable: "ccusage",
      args: ["daily", "--json", "--offline"],
      shell: false,
      packageManager: null,
    },
  };
  return commands[String(commandId ?? "")] ?? null;
}

function lifecycleCommandMatchesRecipe(command, action, recipe) {
  const commandId = String(command?.commandId ?? "");
  if (commandId === "demo_agent_update") {
    return true;
  }
  if (commandId === "npm_global_install_pinned") {
    return ["install", "update"].includes(action)
      && isCcusageRecipe(recipe)
      && String(command?.executable ?? "") === "npm"
      && stringArrayEquals(command.args, ["install", "-g", `ccusage@${CCUSAGE_VERSION}`]);
  }
  if (commandId === "npm_global_uninstall_package") {
    return action === "uninstall"
      && isCcusageRecipe(recipe)
      && String(command?.executable ?? "") === "npm"
      && stringArrayEquals(command.args, ["uninstall", "-g", "ccusage"]);
  }
  return false;
}

function isCcusageRecipe(recipe) {
  return recipe?.expectedTarget?.binary === "ccusage"
    && recipe?.source?.version === CCUSAGE_VERSION
    && String(recipe?.source?.uri ?? "").includes(`ccusage@${CCUSAGE_VERSION}`);
}

function stringArrayEquals(left, right) {
  const a = normalizeStringArray(left);
  return a.length === right.length && a.every((item, index) => item === right[index]);
}

function normalizeLifecycleResultStatus(value) {
  const normalized = String(value ?? "").trim();
  return ["succeeded", "failed", "cancelled"].includes(normalized) ? normalized : "failed";
}

// Sanitize bridge-reported refusal evidence into a known shape — never store
// arbitrary client-supplied fields on the audit record.
function normalizeLifecycleRefusal(refusal) {
  if (!refusal || typeof refusal !== "object" || Array.isArray(refusal)) return null;
  return {
    gate: String(refusal.gate ?? "unknown"),
    commandId: refusal.commandId == null ? null : String(refusal.commandId),
    executable: refusal.executable == null ? null : String(refusal.executable),
    executionEnabled: Boolean(refusal.executionEnabled),
    reason: String(refusal.reason ?? ""),
  };
}

function normalizeHealthStatus(value) {
  const normalized = String(value ?? "").trim();
  return ["healthy", "unhealthy", "unknown"].includes(normalized) ? normalized : "unknown";
}

function normalizeNullableNumber(value, { min = null } = {}) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return min === null ? numeric : Math.max(min, numeric);
}

function truncateLog(value) {
  const text = String(value ?? "");
  return text.length <= 4000 ? text : `${text.slice(0, 3997)}...`;
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
