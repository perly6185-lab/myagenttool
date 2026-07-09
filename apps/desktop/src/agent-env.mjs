// B1b Tier 1 — execution-sandbox env minimization for coding agents.
//
// The desktop bridge normally spawns the coding agent with the bridge process's
// full environment inherited (policy `inherit_safe`), so a develop run has the
// bridge user's secrets in its env (threat T1). This module holds the pure,
// testable pieces that let the operator opt those agents into a minimized env:
// a curated non-secret base (the same allowlist MCP children get) plus only the
// operator-declared env. Coding agents authenticate via the LOCAL login state
// (macOS keychain / ~/.claude / ~/.codex, reached through HOME) rather than env
// secrets, so stripping the inherited env does not break their auth.

import { SAFE_MCP_ENV_KEYS } from "./mcp-client.mjs";

/** Is the B1b Tier 1 opt-in enabled? Default OFF — behaviour is unchanged until set. */
export function minimizeAgentEnvEnabled(env = process.env) {
  const raw = String(env.MYAGENTTOOL_BRIDGE_MINIMIZE_AGENT_ENV ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * Should this adapter's spawn be forced onto the minimized env?
 * Only real CLI coding agents, only when the operator opted in, and never when
 * the adapter already declares an explicit/stricter policy (respected as-is).
 * demo-agent and non-CLI adapters are always left untouched.
 */
export function shouldMinimizeAgentEnv(adapter, { enabled = false } = {}) {
  if (!adapter || adapter.type !== "cli" || adapter.command === "demo-agent") return false;
  if (adapter.environmentPolicy === "none" || adapter.environmentPolicy === "explicit_only" || adapter.environmentPolicy === "agent_minimal") {
    return false;
  }
  return Boolean(enabled);
}

/**
 * The curated minimal env: the non-secret allowlist keys present in `sourceEnv`,
 * plus operator-declared `explicitEnv` (which wins on a key collision). Bridge
 * secrets that are not on the allowlist and not operator-declared are dropped.
 */
export function agentMinimalBaseEnv(sourceEnv = process.env, explicitEnv = {}) {
  const minimal = {};
  for (const key of SAFE_MCP_ENV_KEYS) {
    if (sourceEnv[key] !== undefined) minimal[key] = sourceEnv[key];
  }
  return { ...minimal, ...explicitEnv };
}
