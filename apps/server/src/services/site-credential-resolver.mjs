const ENV_PREFIX = "MYAGENTTOOL_CREDENTIAL_";

export function credentialEnvironmentKey(reference) {
  const value = String(reference ?? "").trim();
  const withoutScheme = value.replace(/^(?:credential|secretref):\/\//, "");
  return `${ENV_PREFIX}${withoutScheme.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase()}`;
}

/**
 * Resolves opaque credential references without ever copying secret material
 * into site state. Each environment value is a small JSON object, for example:
 * MYAGENTTOOL_CREDENTIAL_CLOUDFLARE_MAIN={"accountId":"...","apiToken":"..."}
 */
export function createEnvironmentCredentialResolver({ env = process.env } = {}) {
  return async function resolveCredential(reference) {
    if (!reference) return { ok: false, error: "site_deployment_credential_missing" };
    const key = credentialEnvironmentKey(reference);
    const encoded = env[key];
    if (!encoded) return { ok: false, error: "site_deployment_credential_unavailable", environmentKey: key };
    try {
      const credential = JSON.parse(encoded);
      if (!credential || typeof credential !== "object" || Array.isArray(credential)) throw new Error("invalid_shape");
      return { ok: true, credential };
    } catch {
      return { ok: false, error: "site_deployment_credential_invalid", environmentKey: key };
    }
  };
}
