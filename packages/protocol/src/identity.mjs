export const enterpriseIdentityProviders = ["wecom", "feishu", "dingtalk"];
export const identityEntryModes = ["local", "password", "enterprise"];
export const identityChallengeStates = [
  "pending",
  "authorized",
  "consumed",
  "expired",
  "rejected",
  "cancelled",
  "failed",
];

export function isEnterpriseIdentityProvider(value) {
  return enterpriseIdentityProviders.includes(value);
}

export function isIdentityChallengeState(value) {
  return identityChallengeStates.includes(value);
}

export function normalizeExternalIdentity(value) {
  if (!value || typeof value !== "object" || !isEnterpriseIdentityProvider(value.provider)) return null;
  const issuer = String(value.issuer ?? "").trim();
  const subjectExternalId = String(value.subjectExternalId ?? "").trim();
  const authenticatedAt = String(value.authenticatedAt ?? "");
  if (
    !issuer
    || issuer.length > 2_048
    || !subjectExternalId
    || subjectExternalId.length > 256
    || !Number.isFinite(Date.parse(authenticatedAt))
  ) return null;
  const rawTenantClaims = Array.isArray(value.tenantClaims) ? value.tenantClaims : [];
  if (rawTenantClaims.length > 32) return null;
  const tenantClaims = [...new Set(
    rawTenantClaims.map((claim) => String(claim).trim()).filter(Boolean),
  )];
  if (tenantClaims.some((claim) => claim.length > 256)) return null;
  if (value.displayName && String(value.displayName).length > 200) return null;
  if (value.assurance && String(value.assurance).length > 80) return null;
  // Deliberately ignore role/team/user fields: an adapter proves external
  // identity; only the server membership resolver assigns authorization.
  return {
    provider: value.provider,
    issuer,
    subjectExternalId,
    tenantClaims,
    ...(value.displayName ? { displayName: String(value.displayName) } : {}),
    ...(value.assurance ? { assurance: String(value.assurance) } : {}),
    authenticatedAt: new Date(authenticatedAt).toISOString(),
  };
}
