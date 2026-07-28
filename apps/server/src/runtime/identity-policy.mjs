import { enterpriseIdentityProviders } from "@myagenttool/protocol/identity";

const PROVIDER_LABELS = {
  wecom: "企业微信",
  feishu: "飞书",
  dingtalk: "钉钉",
};

/**
 * Authentication posture derived from deployment configuration.
 *
 * Local mode stays frictionless only while the global auth gate is off. Once
 * auth is required it must be opted into with MYAGENT_LOCAL_MODE=1; otherwise
 * an empty login request cannot acquire the seeded owner's authority.
 */
export function identityPolicyFromEnv(env = process.env) {
  const requireAuth = env.MYAGENT_REQUIRE_AUTH === "1";
  const localMode =
    env.MYAGENT_LOCAL_MODE === "1" ||
    (!requireAuth && env.MYAGENT_LOCAL_MODE !== "0");
  const passwordMode = env.MYAGENT_PASSWORD_AUTH !== "0";
  const legacyLocalLogin = env.MYAGENT_LEGACY_LOCAL_LOGIN === "1";
  const legacyBearerIssue = env.MYAGENT_LEGACY_BEARER_AUTH === "1";
  const legacyBearerRead = env.MYAGENT_LEGACY_BEARER_AUTH !== "0";
  const secureCookies =
    env.MYAGENT_SECURE_COOKIES === "1" ||
    (env.MYAGENT_SECURE_COOKIES !== "0" && env.NODE_ENV === "production");

  // Configuration alone does not make an adapter available. Provider routes
  // pass their actually registered adapter names into publicIdentityOptions.
  const configuredProviders = String(env.MYAGENT_IDENTITY_PROVIDERS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => enterpriseIdentityProviders.includes(value))
    .filter((provider) =>
      env[`MYAGENT_IDENTITY_${provider.toUpperCase()}_ENABLED`] !== "0");

  return {
    requireAuth,
    localMode,
    passwordMode,
    legacyLocalLogin,
    legacyBearerIssue,
    legacyBearerRead,
    secureCookies,
    // A migration server that still issues browser bearer tokens is never an
    // enterprise-identity rollout target.
    configuredProviders: legacyBearerIssue ? [] : [...new Set(configuredProviders)],
  };
}

export function publicIdentityOptions(policy, availableProviders = []) {
  const available = new Set(availableProviders);
  return {
    protocolVersion: 1,
    localMode: Boolean(policy.localMode),
    passwordMode: Boolean(policy.passwordMode),
    providers: policy.configuredProviders
      .filter((provider) => available.has(provider))
      .map((provider) => ({
        provider,
        label: PROVIDER_LABELS[provider],
        authorization: "redirect",
      })),
  };
}
