/**
 * #1250: the cancel/timeout pollers run detached from the main runInvocation
 * await chain. When the child closes and the main flow posts the terminal
 * /api/bridge/complete, a poller event still in flight lands AFTER the run went
 * terminal and the server answers with `bridge_invocation_not_active` (or
 * `invocation_not_found`). That is an expected, benign late arrival — not a bug
 * to crash on. This predicate lets the pollers swallow exactly those responses
 * (and nothing else) instead of leaking to the process-level unhandledRejection
 * backstop.
 */
export function isInactiveInvocationError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /bridge_invocation_not_active|invocation_not_found/.test(message);
}
