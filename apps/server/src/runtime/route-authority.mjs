export const PROFESSIONAL_CAPABILITY = Object.freeze({
  MANAGE: "manage",
  OPERATE: "operate",
});

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MANAGER_ROLES = new Set(["owner", "admin"]);
const OPERATOR_ROLES = new Set(["owner", "admin", "operator"]);

const manageRules = [
  /^\/api\/agent-skills(?:\/[^/]+)?$/,
  /^\/api\/agents(?:\/probe|\/[^/]+\/(?:enable|disable|health-check))?$/,
  /^\/api\/device(?:\/(?:unlink|relink))?$/,
  /^\/api\/(?:runtimes|applications)\/install\/(?:plan|runs(?:\/[^/]+\/cancel)?)$/,
  /^\/api\/applications\/(?:quick-register|register)$/,
  /^\/api\/applications\/[^/]+\/(?:auto-recovery|health-probe|probe|repair|online|offline|archive|refresh)$/,
  /^\/api\/applications\/[^/]+\/orchestrations\/generate$/,
  /^\/api\/discovery$/,
  /^\/api\/discovery\/[^/]+\/candidates\/[^/]+\/register$/,
  /^\/api\/integration-artifacts(?:\/[^/]+\/(?:generate|approve|reject|archive|review|probe|register))?$/,
  /^\/api\/integration-retention$/,
  /^\/api\/integration-builder\/draft$/,
  /^\/api\/channels$/,
  /^\/api\/channels\/[^/]+\/(?:allowlist|task-project|approval-policy|notification-policy|enable|disable)$/,
  /^\/api\/channels\/[^/]+\/identities(?:\/[^/]+)?$/,
  /^\/api\/budgets$/,
  /^\/api\/automations$/,
  /^\/api\/automations\/[^/]+$/,
  /^\/api\/auto-run-settings$/,
  /^\/api\/report-schedule$/,
  /^\/api\/capability-resolutions$/,
  /^\/api\/teams$/,
  /^\/api\/teams\/[^/]+\/alert-webhook$/,
  /^\/api\/users$/,
  /^\/api\/observability\/delete$/,
  /^\/api\/mail\/task-policies$/,
  /^\/api\/hosts(?:\/[^/]+(?:\/(?:observe-fingerprint|confirm-fingerprint|verify))?)?$/,
  /^\/api\/hosts\/[^/]+\/file-scopes(?:\/[^/]+)?$/,
  /^\/api\/hosts\/[^/]+\/tls-activation-profiles$/,
  /^\/api\/sites\/[^/]+\/deployment-target(?:\/verify)?$/,
  /^\/api\/sites\/[^/]+\/domain-tls-binding(?:\/deployment)?$/,
  /^\/api\/site-pilot\/campaigns(?:\/[^/]+(?:\/invitations)?)?$/,
];

const operateRules = [
  /^\/api\/hosts\/[^/]+\/assistant\/plan$/,
  /^\/api\/hosts\/[^/]+\/diagnostics$/,
  /^\/api\/host-file-scopes\/[^/]+\/transfers(?:\/(?:upload|download))?$/,
  /^\/api\/sites\/[^/]+\/domain-tls-binding\/(?:verify-dns|issue-staging|deploy-staging)$/,
  /^\/api\/approvals\/grants$/,
  /^\/api\/approvals\/[^/]+\/(?:approve|deny)$/,
  /^\/api\/pending-decisions\/[^/]+\/(?:claim|release)$/,
  /^\/api\/invocations$/,
  /^\/api\/invocations\/[^/]+\/(?:cancel|troubleshoot)$/,
  /^\/api\/compare-runs$/,
  /^\/api\/compare-runs\/[^/]+\/(?:prefer|promote)$/,
  /^\/api\/local-schedule\/(?:apply|rollover|urgent)$/,
  /^\/api\/capabilities\/[^/]+\/invocations$/,
  /^\/api\/tools\/[^/]+\/invocations$/,
  /^\/api\/claude-apply\/authorizations\/[^/]+\/rollback$/,
  /^\/api\/channels\/[^/]+\/deliveries\/[^/]+\/retry$/,
  /^\/api\/channel-tasks\/[^/]+\/(?:route|dismiss|retry|reroute|takeover|wechat-draft-reconciliation)$/,
  /^\/api\/automations\/[^/]+\/run$/,
  /^\/api\/report-schedule\/post-now$/,
  /^\/api\/applications\/[^/]+\/orchestrations\/[^/]+\/run$/,
  /^\/api\/applications\/[^/]+\/orchestrations\/[^/]+\/runs\/[^/]+\/recovery\/actions$/,
  /^\/api\/mail\/task-policies\/evaluate$/,
];

/**
 * Professional settings use two distinct authorities: configuration/governance
 * is owner/admin-only, while day-to-day execution also admits operators. Reads
 * and ordinary-user workflow mutations remain outside this policy.
 */
export function requiredProfessionalCapability(method, pathname) {
  const normalizedMethod = String(method ?? "").toUpperCase();
  if (!MUTATING_METHODS.has(normalizedMethod)) return null;

  const normalizedPath = String(pathname ?? "");
  // More-specific operational actions must win over their parent management
  // resource, e.g. POST /api/automations/:id/run.
  if (operateRules.some((rule) => rule.test(normalizedPath))) {
    return PROFESSIONAL_CAPABILITY.OPERATE;
  }
  if (manageRules.some((rule) => rule.test(normalizedPath))) {
    return PROFESSIONAL_CAPABILITY.MANAGE;
  }
  return null;
}

export function roleAllowsProfessionalCapability(role, capability) {
  if (!capability) return true;
  if (capability === PROFESSIONAL_CAPABILITY.MANAGE) return MANAGER_ROLES.has(role);
  if (capability === PROFESSIONAL_CAPABILITY.OPERATE) return OPERATOR_ROLES.has(role);
  return false;
}

export function authorizeProfessionalRequest(actor, method, pathname) {
  const capability = requiredProfessionalCapability(method, pathname);
  return {
    allowed: roleAllowsProfessionalCapability(actor?.role, capability),
    capability,
  };
}

export function professionalRoleForbiddenBody(capability) {
  const managerOnly = capability === PROFESSIONAL_CAPABILITY.MANAGE;
  return {
    error: "role_forbidden",
    requiredCapability: capability,
    message: managerOnly
      ? "This action requires an owner or administrator."
      : "This action requires an owner, administrator, or operator.",
  };
}
