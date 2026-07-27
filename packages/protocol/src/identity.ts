import type { IsoDateTime } from "./common.js";

/** Enterprise identity providers allowed by ADR 0021. */
export declare const enterpriseIdentityProviders: readonly ["wecom", "feishu", "dingtalk"];
export type EnterpriseIdentityProvider = (typeof enterpriseIdentityProviders)[number];

/** Entry modes are explicit; a server must never silently change one into another. */
export declare const identityEntryModes: readonly ["local", "password", "enterprise"];
export type IdentityEntryMode = (typeof identityEntryModes)[number];

/** Closed one-time challenge state machine. */
export declare const identityChallengeStates: readonly [
  "pending",
  "authorized",
  "consumed",
  "expired",
  "rejected",
  "cancelled",
  "failed",
];
export type IdentityChallengeState = (typeof identityChallengeStates)[number];

export interface IdentityProviderCapability {
  provider: EnterpriseIdentityProvider;
  label: string;
  authorization: "redirect" | "device_code";
}

export interface IdentityOptions {
  protocolVersion: 1;
  localMode: boolean;
  passwordMode: boolean;
  providers: IdentityProviderCapability[];
}

export interface IdentityChallengeView {
  id: `idc_${string}`;
  provider: EnterpriseIdentityProvider;
  state: IdentityChallengeState;
  createdAt: IsoDateTime;
  expiresAt: IsoDateTime;
}

/** Provider adapter output before local membership resolution. No local role is allowed here. */
export interface ExternalIdentity {
  provider: EnterpriseIdentityProvider;
  issuer: string;
  subjectExternalId: string;
  tenantClaims: string[];
  displayName?: string;
  assurance?: string;
  authenticatedAt: IsoDateTime;
}

export interface TenantCandidate {
  tenantExternalId: string;
  displayName: string;
  membershipExternalId: string;
  verified: boolean;
}

export interface MembershipResolution {
  userId: string;
  teamId: string;
  role: "owner" | "admin" | "operator" | "viewer";
  membershipId: string;
}

/** Security profile consumed by the provider-neutral callback core. */
export interface IdentityProviderSecurityProfile {
  provider: EnterpriseIdentityProvider;
  issuer: string;
  redirectUri: string;
  authorizationOrigins: string[];
  pkce: "S256";
  nonceRequired: boolean;
  tenantClaimRequired: boolean;
}

/** Values created by the core and passed server-side to an adapter. */
export interface IdentityProviderAuthorizationContext {
  state: string;
  nonce: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  redirectUri: string;
  expiresAt: IsoDateTime;
}

/** Browser/provider callback input. Secrets must never be logged or persisted raw. */
export interface IdentityProviderCallback {
  state: string;
  code: string;
  issuer: string;
  redirectUri: string;
}

export declare function isEnterpriseIdentityProvider(value: unknown): value is EnterpriseIdentityProvider;
export declare function isIdentityChallengeState(value: unknown): value is IdentityChallengeState;
export declare function normalizeExternalIdentity(value: unknown): ExternalIdentity | null;
