import { denyForeignProject } from "../runtime/auth.mjs";

export async function handleM3Routes({
  req,
  res,
  url,
  sendJson,
  readJson,
  state,
  actor,
  chargebackExport,
  createAuditExportRequest,
  createPrivateCatalogEntry,
  createSignedBundleManifest,
  createLifecycleRecipe,
  createQuotaPolicy,
  decideLifecycleLocalApproval,
  evaluateLifecyclePolicy,
  findLifecycleLocalApproval,
  findLifecycleRollbackRequest,
  findLifecycleRecipe,
  findPrivateCatalogEntry,
  queueLifecycleAction,
  queueRollbackAction,
  recordAiUsage,
  requestLifecycleLocalApproval,
  transitionLifecycleRecipe,
  updatePrivateDeploymentConfig,
}) {
  if (req.method === "GET" && url.pathname === "/api/m3") {
    sendJson(res, 200, {
      lifecycleRecipes: state.lifecycleRecipes,
      lifecyclePolicyDecisions: state.lifecyclePolicyDecisions,
      lifecycleLocalApprovals: state.lifecycleLocalApprovals,
      lifecycleQueuedActions: state.lifecycleQueuedActions,
      lifecycleRollbackRequests: state.lifecycleRollbackRequests,
      privateCatalogEntries: state.privateCatalogEntries,
      signedBundleManifests: state.signedBundleManifests,
      quotaPolicies: state.quotaPolicies,
      quotaDecisionRecords: state.quotaDecisionRecords,
      aiUsageRecords: state.aiUsageRecords,
      ledgerEntries: state.ledgerEntries,
      privateDeploymentConfig: state.privateDeploymentConfig,
      auditExportRequests: state.auditExportRequests,
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/m3/private-catalog") {
    const body = await readJson(req);
    const catalogEntry = createPrivateCatalogEntry(body);
    sendJson(res, 201, { catalogEntry });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/m3/private-catalog") {
    sendJson(res, 200, { catalogEntries: state.privateCatalogEntries });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/m3/signed-bundles") {
    const body = await readJson(req);
    const bundle = createSignedBundleManifest(body);
    sendJson(res, bundle.policy.decision === "blocked" ? 409 : 201, { bundle });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/m3/signed-bundles") {
    sendJson(res, 200, { bundles: state.signedBundleManifests });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/m3/lifecycle-recipes") {
    const body = await readJson(req);
    let recipe;
    try {
      recipe = createLifecycleRecipe({ ...body, requestedBy: body.requestedBy ?? actor?.userId });
    } catch (error) {
      sendJson(res, 400, {
        error: "invalid_lifecycle_recipe",
        message: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
    sendJson(res, 201, { recipe });
    return true;
  }

  const recipeActionMatch = url.pathname.match(/^\/api\/m3\/lifecycle-recipes\/([^/]+)\/(review|approve|reject|archive|policy|local-approval|queue)$/);
  if (req.method === "POST" && recipeActionMatch) {
    const recipe = findLifecycleRecipe(decodeURIComponent(recipeActionMatch[1]));
    if (!recipe) {
      sendJson(res, 404, { error: "lifecycle_recipe_not_found" });
      return true;
    }
    const action = recipeActionMatch[2];
    try {
      if (["review", "approve", "reject", "archive"].includes(action)) {
        sendJson(res, 200, { recipe: transitionLifecycleRecipe(recipe, action) });
        return true;
      }
      if (action === "policy") {
        sendJson(res, 201, { recipe, policyDecision: evaluateLifecyclePolicy(recipe) });
        return true;
      }
      if (action === "local-approval") {
        sendJson(res, 201, { recipe, approval: requestLifecycleLocalApproval(recipe) });
        return true;
      }
      if (action === "queue") {
        sendJson(res, 202, { recipe, queuedAction: queueLifecycleAction(recipe) });
        return true;
      }
    } catch (error) {
      sendJson(res, 409, {
        error: "lifecycle_gate_blocked",
        message: error instanceof Error ? error.message : String(error),
        recipe,
      });
      return true;
    }
  }

  const rollbackActionMatch = url.pathname.match(/^\/api\/m3\/lifecycle-rollbacks\/([^/]+)\/queue$/);
  if (req.method === "POST" && rollbackActionMatch) {
    const rollback = findLifecycleRollbackRequest(decodeURIComponent(rollbackActionMatch[1]));
    if (!rollback) {
      sendJson(res, 404, { error: "lifecycle_rollback_not_found" });
      return true;
    }
    try {
      sendJson(res, 202, { rollback, queuedAction: queueRollbackAction(rollback) });
      return true;
    } catch (error) {
      sendJson(res, 409, {
        error: "rollback_gate_blocked",
        message: error instanceof Error ? error.message : String(error),
        rollback,
      });
      return true;
    }
  }

  const lifecycleApprovalMatch = url.pathname.match(/^\/api\/m3\/lifecycle-approvals\/([^/]+)\/(approve|deny)$/);
  if (req.method === "POST" && lifecycleApprovalMatch) {
    const approval = findLifecycleLocalApproval(decodeURIComponent(lifecycleApprovalMatch[1]));
    if (!approval) {
      sendJson(res, 404, { error: "lifecycle_approval_not_found" });
      return true;
    }
    const updated = decideLifecycleLocalApproval(approval, lifecycleApprovalMatch[2], actor);
    sendJson(res, 200, { approval: updated, recipe: findLifecycleRecipe(updated.recipeId) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/m3/quota-policies") {
    const body = await readJson(req);
    const quotaPolicy = createQuotaPolicy({
      ...body,
      subjectId: body.subjectId ?? actor?.userId,
      costOwner: body.costOwner ?? actor?.userId,
    });
    sendJson(res, 201, { quotaPolicy });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/m3/ai-usage") {
    const body = await readJson(req);
    // ai-usage attributes cost to a project's ledger/budget, so you must own the
    // project you bill. Other M3 lifecycle objects (catalog/bundles/recipes/
    // quota/deployment/audit-export) are operator/org-level with no per-team
    // owner today — see TENANCY_ROUTE_MATRIX.md.
    if (denyForeignProject({ res, sendJson, state, actor, projectId: body.projectId })) {
      return true;
    }
    const result = recordAiUsage({
      ...body,
      userId: body.userId ?? actor?.userId,
      teamId: body.teamId ?? actor?.teamId,
    });
    sendJson(res, result.blocked ? 409 : 201, result);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/m3/chargeback-export") {
    sendJson(res, 200, chargebackExport());
    return true;
  }

  if (req.method === "PATCH" && url.pathname === "/api/m3/private-deployment") {
    const body = await readJson(req);
    const privateDeploymentConfig = updatePrivateDeploymentConfig(body);
    sendJson(res, 200, { privateDeploymentConfig });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/m3/audit-export") {
    const body = await readJson(req);
    const auditExportRequest = createAuditExportRequest({
      ...body,
      requestedBy: body.requestedBy ?? actor?.userId,
    });
    sendJson(res, auditExportRequest.status === "blocked" ? 409 : 201, { auditExportRequest });
    return true;
  }

  return false;
}
