/*
 * Child-process environment for the application-wrapper runner.
 *
 * officecli auto-spawns a per-file `__resident-serve__` process (even a read
 * triggers one), after which a write's disk save is DEFERRED 2–10 s unless
 * OFFICECLI_RESIDENT_FLUSH=each is set. The governed write path must be durable on
 * disk before the invocation reports success — otherwise a `promote` (a git op on
 * the worktree) immediately after can capture stale content. So force a synchronous
 * flush for every officecli invocation. It is a no-op for reads (nothing to flush)
 * and never applied to other wrappers (git/ccusage), which are byte-identical.
 */

// Matches the officecli binary whether invoked bare (on PATH) or by absolute path,
// on POSIX or Windows.
const OFFICECLI_COMMAND = /(?:^|[/\\])officecli(?:\.exe)?$/i;

export function resolveWrapperChildEnv(command, baseEnv = process.env) {
  const env = { ...baseEnv };
  if (OFFICECLI_COMMAND.test(String(command ?? ""))) {
    env.OFFICECLI_RESIDENT_FLUSH = "each";
  }
  return env;
}
