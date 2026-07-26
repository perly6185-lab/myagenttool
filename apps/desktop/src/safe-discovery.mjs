import { isAbsolute, normalize } from "node:path";

function requiredAbsolutePath(value, name) {
  const path = typeof value === "string" ? value.trim() : "";
  if (!path || !isAbsolute(path)) {
    throw new TypeError(`${name} must be an absolute path.`);
  }
  return normalize(path);
}

function gitConfigCount(env) {
  const raw = env.GIT_CONFIG_COUNT;
  if (raw === undefined || raw === "") {
    return 0;
  }
  if (!/^\d+$/.test(String(raw))) {
    throw new TypeError("GIT_CONFIG_COUNT must be a non-negative integer.");
  }
  const count = Number(raw);
  if (!Number.isSafeInteger(count) || count > 1_024) {
    throw new TypeError("GIT_CONFIG_COUNT is outside the supported range.");
  }
  return count;
}

/**
 * Trust only the governed worktree for the spawned process and its children.
 *
 * Environment-scoped Git config avoids mutating the user's global safe.directory
 * list while allowing managed worktrees owned by the host account to be used by
 * the restricted execution account.
 */
export function withGitSafeDirectoryEnv(env, { root } = {}) {
  const source = env && typeof env === "object" ? env : {};
  const count = gitConfigCount(source);
  return {
    ...source,
    GIT_CONFIG_COUNT: String(count + 1),
    [`GIT_CONFIG_KEY_${count}`]: "safe.directory",
    [`GIT_CONFIG_VALUE_${count}`]: requiredAbsolutePath(root, "root"),
  };
}

/**
 * Return a child-process environment with repository-discovery boundaries.
 *
 * The caller owns root selection; this helper refuses ambiguous relative paths
 * and leaves the supplied environment object untouched.
 */
export function withSafeDiscoveryEnv(env, { root, configPath } = {}) {
  const source = env && typeof env === "object" ? env : {};
  return {
    ...source,
    RIPGREP_CONFIG_PATH: requiredAbsolutePath(configPath, "configPath"),
    MYAGENTTOOL_DISCOVERY_ROOT: requiredAbsolutePath(root, "root"),
  };
}
