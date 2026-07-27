import crypto from "node:crypto";

import {
  isEnterpriseIdentityProvider,
  normalizeExternalIdentity,
} from "@myagenttool/protocol/identity";
import {
  CHALLENGE_TTL_MS,
  auditIdentity,
  authorizeIdentityChallenge,
  createIdentityChallenge,
  expireIdentityChallenge,
  hashIdentitySecret,
  rejectIdentityChallenge,
} from "./identity-security.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

const MAX_CODE_USES = 2_000;
const DEFAULT_EXCHANGE_TIMEOUT_MS = 5_000;
const GENERIC_CALLBACK_ERROR = "provider_callback_rejected";

function opaque(prefix, bytes = 32) {
  return `${prefix}_${crypto.randomBytes(bytes).toString("base64url")}`;
}

function instant(value) {
  return value instanceof Date ? value : new Date(value);
}

function safeEqualHash(left, right) {
  const actual = Buffer.from(hashIdentitySecret(left), "hex");
  const expected = Buffer.from(String(right ?? ""), "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function pkceS256(codeVerifier) {
  return crypto.createHash("sha256")
    .update(String(codeVerifier), "ascii")
    .digest("base64url");
}

function validHttpsUrl(value, { originOnly = false } = {}) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    if (parsed.hash) return null;
    if (originOnly && (parsed.pathname !== "/" || parsed.search)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function validateProfile(profile) {
  if (!profile || !isEnterpriseIdentityProvider(profile.provider)) return false;
  const issuer = validHttpsUrl(profile.issuer);
  if (!issuer || issuer.search) return false;
  if (!validHttpsUrl(profile.redirectUri)) return false;
  if (profile.pkce !== "S256") return false;
  if (!Array.isArray(profile.authorizationOrigins) || profile.authorizationOrigins.length === 0) {
    return false;
  }
  return profile.authorizationOrigins.every((origin) => {
    const parsed = validHttpsUrl(origin, { originOnly: true });
    return Boolean(parsed && parsed.origin === origin);
  });
}

function validateAuthorizationUri(value, profile, context) {
  const parsed = validHttpsUrl(value);
  if (!parsed || !profile.authorizationOrigins.includes(parsed.origin)) return false;
  const required = {
    state: context.state,
    redirect_uri: context.redirectUri,
    code_challenge: context.codeChallenge,
    code_challenge_method: "S256",
  };
  if (profile.nonceRequired) required.nonce = context.nonce;
  for (const [key, expected] of Object.entries(required)) {
    if (
      parsed.searchParams.getAll(key).length !== 1
      || parsed.searchParams.get(key) !== expected
    ) return false;
  }
  for (const forbidden of ["client_secret", "access_token", "refresh_token", "code_verifier"]) {
    if (parsed.searchParams.has(forbidden)) return false;
  }
  return true;
}

async function withTimeout(operation, timeoutMs) {
  let timer;
  const controller = new AbortController();
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("provider_timeout"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Provider-neutral authorization/callback core.
 *
 * Adapters receive transaction-specific state, nonce, and PKCE values, but may
 * return only external identity facts. Raw code verifiers remain process-memory
 * only; callback codes and state are persisted solely as SHA-256 hashes.
 */
export function createIdentityProviderCore({
  state,
  profiles = {},
  adapters = {},
  now = () => new Date().toISOString(),
  persistStateSoon = () => {},
  store,
  exchangeTimeoutMs = DEFAULT_EXCHANGE_TIMEOUT_MS,
  isProviderEnabled = () => true,
} = {}) {
  const transactionSecrets = new Map();
  const runTx = makeRunTx({ store, persistStateSoon });

  function configured(provider) {
    const profile = profiles[provider];
    const adapter = adapters[provider];
    return Boolean(
      isEnterpriseIdentityProvider(provider)
      && validateProfile(profile)
      && profile.provider === provider
      && adapter
      && typeof adapter.beginAuthorization === "function"
      && typeof adapter.exchangeCode === "function"
      && isProviderEnabled(provider),
    );
  }

  function availableProviders() {
    return Object.keys(profiles).filter(configured);
  }

  function reject(record, reasonCode, at, beforeReject = null) {
    if (record) {
      runTx(() => {
        beforeReject?.();
        rejectIdentityChallenge(state, {
          challengeId: record.id,
          reasonCode,
        }, at);
        runTx.afterCommit(() => transactionSecrets.delete(record.id));
      });
    }
    return { ok: false, error: GENERIC_CALLBACK_ERROR };
  }

  async function beginAuthorization({ provider, bindingSecret, deviceContext = null } = {}) {
    if (!configured(provider) || !bindingSecret) {
      return { ok: false, error: "identity_provider_unavailable" };
    }
    const profile = profiles[provider];
    const adapter = adapters[provider];
    const nowDate = instant(now());
    const expiresAt = new Date(nowDate.getTime() + CHALLENGE_TTL_MS).toISOString();
    const callbackState = opaque("ist");
    const nonce = opaque("idn");
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const context = {
      state: callbackState,
      nonce,
      codeChallenge: pkceS256(codeVerifier),
      codeChallengeMethod: "S256",
      redirectUri: profile.redirectUri,
      expiresAt,
    };

    let started;
    try {
      started = await withTimeout(
        (signal) => adapter.beginAuthorization({ ...context, signal }),
        exchangeTimeoutMs,
      );
    } catch {
      runTx(() => {
        auditIdentity(state, {
          id: opaque("ida", 12),
          type: "identity.provider.rejected",
          provider,
          outcome: "begin_failed",
          reasonCode: "provider_begin_failed",
          at: nowDate.toISOString(),
        });
      });
      return { ok: false, error: "identity_provider_unavailable" };
    }
    if (!validateAuthorizationUri(started?.authorizationUri, profile, context)) {
      runTx(() => {
        auditIdentity(state, {
          id: opaque("ida", 12),
          type: "identity.provider.rejected",
          provider,
          outcome: "begin_failed",
          reasonCode: "authorization_uri_rejected",
          at: nowDate.toISOString(),
        });
      });
      return { ok: false, error: "identity_provider_unavailable" };
    }

    return runTx(() => {
      const result = createIdentityChallenge(state, {
        provider,
        bindingSecret,
        authorizationUri: started.authorizationUri,
        deviceContext,
      }, nowDate);
      const record = state.identityChallenges.find((item) => item.id === result.challenge.id);
      const providerExpiry = Date.parse(started?.expiresAt);
      if (Number.isFinite(providerExpiry)) {
        record.expiresAt = new Date(Math.min(providerExpiry, Date.parse(expiresAt))).toISOString();
        result.challenge.expiresAt = record.expiresAt;
      }
      record.callbackStateHash = hashIdentitySecret(callbackState);
      record.nonceHash = hashIdentitySecret(nonce);
      record.pkceChallenge = context.codeChallenge;
      record.pkceMethod = "S256";
      record.issuer = profile.issuer;
      record.redirectUri = profile.redirectUri;
      runTx.afterCommit(() => transactionSecrets.set(record.id, { codeVerifier }));
      return { ok: true, ...result };
    });
  }

  async function consumeCallback({
    state: callbackState,
    code,
    issuer,
    redirectUri,
    bindingSecret,
  } = {}) {
    const nowDate = instant(now());
    const callbackStateText = String(callbackState ?? "");
    if (!/^ist_[A-Za-z0-9_-]{43}$/.test(callbackStateText)) {
      return { ok: false, error: GENERIC_CALLBACK_ERROR };
    }
    const stateHash = hashIdentitySecret(callbackStateText);
    const record = (state.identityChallenges ?? []).find((item) =>
      item.callbackStateHash === stateHash);
    if (!record || !configured(record.provider)) return reject(record, "callback_unavailable", nowDate);
    if (record.state !== "pending") return reject(record, "callback_replayed", nowDate);
    if (Date.parse(record.expiresAt) <= nowDate.getTime()) {
      runTx(() => {
        expireIdentityChallenge(state, record.id, nowDate);
        runTx.afterCommit(() => transactionSecrets.delete(record.id));
      });
      return { ok: false, error: GENERIC_CALLBACK_ERROR };
    }
    if (!safeEqualHash(callbackStateText, record.callbackStateHash)) {
      return reject(record, "state_mismatch", nowDate);
    }
    if (!safeEqualHash(bindingSecret, record.bindingHash)) {
      return reject(record, "binding_mismatch", nowDate);
    }
    if (String(issuer ?? "") !== record.issuer) {
      return reject(record, "issuer_mismatch", nowDate);
    }
    if (String(redirectUri ?? "") !== record.redirectUri) {
      return reject(record, "redirect_uri_mismatch", nowDate);
    }
    const callbackCode = String(code ?? "");
    if (!callbackCode || callbackCode.length > 2_048) {
      return reject(record, "invalid_code", nowDate);
    }
    const codeHash = hashIdentitySecret(callbackCode);
    let codeUse;
    const reserved = runTx(() => {
      state.identityProviderCodeUses ??= [];
      if (state.identityProviderCodeUses.some((item) => item.codeHash === codeHash)) {
        return false;
      }
      codeUse = {
        id: `ipc_${codeHash}`,
        codeHash,
        provider: record.provider,
        challengeId: record.id,
        usedAt: nowDate.toISOString(),
        outcome: "reserved",
      };
      state.identityProviderCodeUses.unshift(codeUse);
      state.identityProviderCodeUses = state.identityProviderCodeUses.slice(0, MAX_CODE_USES);
      return true;
    });
    if (!reserved) {
      return reject(record, "code_replayed", nowDate);
    }

    const secret = transactionSecrets.get(record.id);
    if (!secret?.codeVerifier) {
      return reject(record, "transaction_secret_unavailable", nowDate, () => {
        codeUse.outcome = "secret_unavailable";
      });
    }

    let exchanged;
    try {
      exchanged = await withTimeout((signal) => adapters[record.provider].exchangeCode({
        code: callbackCode,
        codeVerifier: secret.codeVerifier,
        redirectUri: record.redirectUri,
        signal,
      }), exchangeTimeoutMs);
    } catch {
      return reject(record, "code_exchange_rejected", nowDate, () => {
        codeUse.outcome = "exchange_rejected";
      });
    }

    const profile = profiles[record.provider];
    const externalIdentity = normalizeExternalIdentity(exchanged?.externalIdentity);
    if (
      String(exchanged?.issuer ?? "") !== record.issuer
      || String(exchanged?.issuer ?? "") !== profile.issuer
      || (profile.nonceRequired && !safeEqualHash(exchanged?.nonce, record.nonceHash))
      || !externalIdentity
      || externalIdentity.provider !== record.provider
      || externalIdentity.issuer !== record.issuer
      || (profile.tenantClaimRequired && externalIdentity.tenantClaims.length === 0)
    ) {
      return reject(record, "provider_claims_rejected", nowDate, () => {
        codeUse.outcome = "claims_rejected";
      });
    }

    return runTx(() => {
      const authorized = authorizeIdentityChallenge(state, {
        challengeId: record.id,
        bindingSecret,
        providerSubject: externalIdentity.subjectExternalId,
      }, nowDate);
      if (!authorized.ok) {
        return reject(record, "challenge_rejected", nowDate, () => {
          codeUse.outcome = "challenge_rejected";
        });
      }
      codeUse.outcome = "accepted";
      runTx.afterCommit(() => transactionSecrets.delete(record.id));
      return {
        ok: true,
        challenge: authorized.challenge,
        externalIdentity,
      };
    });
  }

  return {
    availableProviders,
    beginAuthorization,
    consumeCallback,
  };
}
