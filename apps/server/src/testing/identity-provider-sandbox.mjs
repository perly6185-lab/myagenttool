import crypto from "node:crypto";

import { isEnterpriseIdentityProvider } from "@myagenttool/protocol/identity";
import { pkceS256 } from "../services/identity-provider-core.mjs";

function synthetic(prefix, bytes = 18) {
  return `${prefix}_${crypto.randomBytes(bytes).toString("base64url")}`;
}

/**
 * In-process OAuth/OIDC sandbox for the shared conformance suite.
 *
 * It has no network access, client secret, production tenant, or personal data.
 * Authorization codes are synthetic, short-lived, PKCE-bound, and single-use.
 */
export function createIdentityProviderSandbox({
  provider,
  issuer,
  authorizationEndpoint,
  now = () => new Date().toISOString(),
  exchangeDelayMs = 0,
} = {}) {
  if (!isEnterpriseIdentityProvider(provider)) throw new Error("sandbox provider is invalid");
  const endpoint = new URL(authorizationEndpoint);
  if (endpoint.protocol !== "https:") throw new Error("sandbox authorization endpoint must use HTTPS");

  const authorizations = new Map();
  const codes = new Map();

  async function beginAuthorization(context) {
    authorizations.set(context.state, {
      ...context,
      createdAt: now(),
    });
    const url = new URL(endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", "sandbox-public-client");
    url.searchParams.set("redirect_uri", context.redirectUri);
    url.searchParams.set("state", context.state);
    url.searchParams.set("nonce", context.nonce);
    url.searchParams.set("code_challenge", context.codeChallenge);
    url.searchParams.set("code_challenge_method", context.codeChallengeMethod);
    return {
      authorizationUri: url.toString(),
      expiresAt: context.expiresAt,
    };
  }

  function issueCallback({
    state,
    subjectExternalId = "subject_synthetic_001",
    tenantClaims = ["tenant_synthetic_001"],
    callbackIssuer = issuer,
    tokenIssuer = issuer,
    identityIssuer = issuer,
    nonce = null,
    authenticatedAt = now(),
    expiresInMs = 60_000,
  } = {}) {
    const authorization = authorizations.get(state);
    if (!authorization) throw new Error("sandbox authorization state not found");
    const code = synthetic("sandbox_code");
    codes.set(code, {
      code,
      used: false,
      expiresAt: new Date(Date.parse(now()) + expiresInMs).toISOString(),
      codeChallenge: authorization.codeChallenge,
      redirectUri: authorization.redirectUri,
      issuer: tokenIssuer,
      nonce: nonce ?? authorization.nonce,
      externalIdentity: {
        provider,
        issuer: identityIssuer,
        subjectExternalId,
        tenantClaims,
        displayName: "Synthetic Member",
        assurance: "sandbox",
        authenticatedAt,
      },
    });
    return {
      state,
      code,
      issuer: callbackIssuer,
      redirectUri: authorization.redirectUri,
    };
  }

  async function exchangeCode({ code, codeVerifier, redirectUri, signal }) {
    if (exchangeDelayMs > 0) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, exchangeDelayMs);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("sandbox_exchange_aborted"));
        }, { once: true });
      });
    }
    const record = codes.get(code);
    if (
      !record
      || record.used
      || Date.parse(record.expiresAt) <= Date.parse(now())
      || record.redirectUri !== redirectUri
      || record.codeChallenge !== pkceS256(codeVerifier)
    ) {
      throw new Error("sandbox_exchange_rejected");
    }
    record.used = true;
    return {
      issuer: record.issuer,
      nonce: record.nonce,
      externalIdentity: { ...record.externalIdentity },
      // Deliberate poison pill: the core must ignore adapter token material.
      accessToken: synthetic("sandbox_access_token"),
      refreshToken: synthetic("sandbox_refresh_token"),
    };
  }

  function inspectAuthorization(state) {
    const value = authorizations.get(state);
    return value ? { ...value } : null;
  }

  return {
    beginAuthorization,
    exchangeCode,
    issueCallback,
    inspectAuthorization,
  };
}
