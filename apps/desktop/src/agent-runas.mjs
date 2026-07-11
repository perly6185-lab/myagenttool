// B1b Tier 2 — run the coding agent as a dedicated low-privilege user.
//
// The desktop bridge normally spawns the coding agent as the bridge user, with
// full FS access as that user (cwd = worktree confines nothing — threats T2/T4).
// This module holds the pure, testable pieces that let the operator opt real CLI
// coding agents into running as a separate low-priv account via `sudo -n -u <user>`:
// a different user that cannot read the bridge user's secret files (~/.ssh, ~/.aws,
// other repos) or write outside the worktree. Default OFF; behaviour is unchanged
// until MYAGENTTOOL_BRIDGE_RUN_AS_USER is set.
//
// AUTH note: under `sudo -u`, HOME becomes the runner's home, so the agent
// authenticates from the runner's login state — see AUTORUN_SANDBOX_TIER2 (the
// auth path is validated in a soak, together, given the claude-login sensitivity).

// A conservative username shape (macOS service accounts include a leading `_`).
const USERNAME_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;

/** The opt-in runner username, or null when unset / blank / malformed (→ OFF). */
export function runAsUser(env = process.env) {
  const raw = String(env.MYAGENTTOOL_BRIDGE_RUN_AS_USER ?? "").trim();
  return raw && USERNAME_RE.test(raw) ? raw : null;
}

/** Is run-as-user opt-in enabled? Default OFF. */
export function runAsUserEnabled(env = process.env) {
  return runAsUser(env) != null;
}

/**
 * Should THIS adapter's spawn run as the low-priv user? Only real CLI coding
 * agents, only on a POSIX host (sudo), only when the operator set a valid user.
 * demo-agent and non-CLI adapters are always left as-is.
 */
export function shouldRunAsUser(adapter, { user = null, platform = process.platform } = {}) {
  if (!user) return false;
  if (platform === "win32") return false; // sudo -u is POSIX; win32 falls back unchanged
  if (!adapter || adapter.type !== "cli" || adapter.command === "demo-agent") return false;
  return true;
}

/**
 * Wrap a spawn plan to run its command as `user` via NON-interactive sudo.
 * `sudo -n` never prompts: a missing sudoers entry fails loudly, never hangs.
 * The `--` stops sudo option parsing so the agent's own flags pass through intact.
 * cwd is preserved; sudo switches the user + resets the target env — the auth/env
 * details are refined in the soak. Returns the plan unchanged when `user` is null.
 */
export function runAsSpawnPlan(spawnPlan, { user } = {}) {
  if (!user || !spawnPlan?.command) return spawnPlan;
  return {
    ...spawnPlan,
    command: "sudo",
    args: ["-n", "-u", user, "--", spawnPlan.command, ...(spawnPlan.args ?? [])],
    runAsUser: user, // marker for the execution preview + logs
  };
}

/**
 * Argv for the non-interactive preflight probe: `sudo -n -u <user> -- /usr/bin/true`.
 * Run ONCE before wrapping real spawns — if this fails, sudoers isn't configured and
 * every wrapped agent would die with a cryptic sudo error. Absolute `/usr/bin/true`
 * avoids depending on sudo's secure_path. Pure.
 */
export function runAsPreflightPlan(user) {
  return { command: "sudo", args: ["-n", "-u", String(user ?? ""), "--", "/usr/bin/true"] };
}

/**
 * Interpret a preflight probe result into { ok, reason }. Pure + total:
 * exit 0 → confinement is available; a non-zero exit or a spawn `error` (e.g. no
 * sudo binary) → NOT ok, with the first stderr line (or the error) as the reason so
 * the operator sees a warning instead of a silent false confinement.
 */
export function interpretPreflightResult({ code = null, stderr = "", error = null } = {}) {
  if (error) return { ok: false, reason: (error instanceof Error ? error.message : String(error)).slice(0, 200) };
  if (code === 0) return { ok: true };
  const firstLine = String(stderr ?? "").trim().split("\n")[0].slice(0, 200);
  return { ok: false, reason: firstLine || `sudo preflight exited ${code}` };
}
