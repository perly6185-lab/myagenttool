import { createEnvironmentCredentialResolver } from "./site-credential-resolver.mjs";

const ALIYUN_REFERENCE = /^credential:\/\/aliyun\/[A-Za-z0-9._~-]{1,80}$/;
const ALIDNS_REFERENCE = /^credential:\/\/alidns\/[A-Za-z0-9._~-]{1,80}$/;
const CLOUDFLARE_REFERENCE = /^credential:\/\/cloudflare\/[A-Za-z0-9._~-]{1,80}$/;
const SSH_REFERENCE = /^credential:\/\/ssh\/[A-Za-z0-9._~-]{1,80}$/;

function normalizeAliCloudCredential(credential) {
  const accessKeyId = String(credential?.accessKeyId ?? "").trim();
  const accessKeySecret = String(credential?.accessKeySecret ?? "").trim();
  const securityToken = String(credential?.securityToken ?? credential?.stsToken ?? "").trim() || undefined;
  if (!/^[A-Za-z0-9]{8,128}$/.test(accessKeyId) || !accessKeySecret || accessKeySecret.length > 4096 || (securityToken && securityToken.length > 8192)) return null;
  return { accessKeyId, accessKeySecret, ...(securityToken ? { securityToken } : {}) };
}

function normalizeCredential(reference, provider, credential) {
  const normalizedReference = String(reference ?? "").trim();
  if (provider === "aliyun_oss_cdn" && ALIYUN_REFERENCE.test(normalizedReference)) {
    const normalizedCredential = normalizeAliCloudCredential(credential);
    return normalizedCredential ? { reference: normalizedReference, credential: normalizedCredential } : null;
  }
  if (provider === "alidns_acme" && ALIDNS_REFERENCE.test(normalizedReference)) {
    const normalizedCredential = normalizeAliCloudCredential(credential);
    return normalizedCredential ? { reference: normalizedReference, credential: normalizedCredential } : null;
  }
  if (provider === "cloudflare_pages" && CLOUDFLARE_REFERENCE.test(normalizedReference)) {
    const accountId = String(credential?.accountId ?? "").trim();
    const apiToken = String(credential?.apiToken ?? "").trim();
    if (!/^[a-f0-9]{32}$/i.test(accountId) || !apiToken || apiToken.length > 4096) return null;
    return { reference: normalizedReference, credential: { accountId, apiToken } };
  }
  if (provider === "ssh" && SSH_REFERENCE.test(normalizedReference)) {
    const authMethod = String(credential?.authMethod ?? "").trim();
    if (authMethod === "private_key_ref" || authMethod === "managed_identity") {
      const privateKey = String(credential?.privateKey ?? "");
      const passphrase = String(credential?.passphrase ?? "") || undefined;
      if (!privateKey || privateKey.length > 65_536 || !/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(privateKey) || (passphrase && passphrase.length > 4096)) return null;
      return { reference: normalizedReference, credential: { authMethod, privateKey, ...(passphrase ? { passphrase } : {}) } };
    }
    if (authMethod === "password_ref") {
      const password = String(credential?.password ?? "");
      if (!password || password.length > 4096) return null;
      return { reference: normalizedReference, credential: { authMethod, password } };
    }
    return null;
  }
  return null;
}

/**
 * Process-local secret handoff for the desktop shell. The encrypted source of
 * truth remains in Electron safeStorage; this map is deliberately excluded
 * from application state, snapshots, logs, and HTTP read models.
 */
export function createSiteCredentialVault({ environmentResolver = createEnvironmentCredentialResolver() } = {}) {
  const credentials = new Map();

  function provision({ reference, provider, credential } = {}) {
    const normalized = normalizeCredential(reference, provider, credential);
    if (!normalized) return { ok: false, error: "site_credential_invalid" };
    credentials.set(normalized.reference, normalized.credential);
    return { ok: true, reference: normalized.reference };
  }

  function revoke(reference) {
    const normalizedReference = String(reference ?? "").trim();
    if (!ALIYUN_REFERENCE.test(normalizedReference) && !ALIDNS_REFERENCE.test(normalizedReference) && !CLOUDFLARE_REFERENCE.test(normalizedReference) && !SSH_REFERENCE.test(normalizedReference)) return { ok: false, error: "site_credential_reference_invalid" };
    credentials.delete(normalizedReference);
    return { ok: true, reference: normalizedReference };
  }

  async function resolveCredential(reference) {
    const normalizedReference = String(reference ?? "").trim();
    const credential = credentials.get(normalizedReference);
    if (credential) return { ok: true, credential: { ...credential }, source: "desktop_session" };
    return environmentResolver(normalizedReference);
  }

  return { provision, revoke, resolveCredential };
}
