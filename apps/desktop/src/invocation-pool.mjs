/**
 * Bridge invocation concurrency pool (#1242).
 *
 * The server-side dispatcher already caps cross-worktree concurrency
 * authoritatively (device.maxConcurrency) and locks a worktree cwd to one
 * in-flight run at a time (nextDispatchableInvocation). The bridge used to
 * throw that away with a single `busy` boolean that serialized every run, so a
 * device executed exactly one agent at a time no matter the cap. This pool lets
 * the bridge claim `next` repeatedly and run several different-worktree
 * invocations at once, up to a cap — the SERVER stays the hard limit (it
 * returns 204 the moment its own cap or the directory lock would be crossed, so
 * the bridge can never oversend).
 */

/**
 * Resolve the bridge's local concurrency cap. The server's live value
 * (echoed on the register response via publicDeviceView) wins; env is a
 * fallback for a bridge that registered against an older server, then a
 * default. Bounded to [1, max] to match the server clamp (control-plane.mjs).
 */
export function resolveBridgeConcurrency({ serverMaxConcurrency, envValue, fallback = 3, max = 16 } = {}) {
  const server = Math.floor(Number(serverMaxConcurrency));
  if (Number.isFinite(server) && server > 0) return Math.min(max, server);
  const env = Math.floor(Number(envValue));
  if (Number.isFinite(env) && env > 0) return Math.min(max, env);
  return Math.min(max, Math.max(1, fallback));
}

/**
 * @param {object} opts
 * @param {number|(() => number)} opts.cap - max concurrent runs (or a getter)
 * @param {() => Promise<any>} opts.claim - claim one work item; falsy = nothing queued / server 204
 * @param {(work: any) => Promise<any>} opts.run - run a claimed item to completion
 * @param {(error: unknown, work: any) => void} [opts.onError] - a run rejected (run itself should normally self-report)
 */
export function createInvocationPool({ cap, claim, run, onError }) {
  const capacity = typeof cap === "function" ? cap : () => cap;
  let active = 0;
  let filling = false;

  return {
    /** In-flight runs right now. */
    size: () => active,
    /**
     * Claim and launch runs until the pool is full or the server has nothing
     * to give (claim() falsy). Launched runs are NOT awaited — they execute in
     * the background; the count decrements in a finally so a throwing run frees
     * its slot and never permanently starves the pool. Re-entrant-safe: a
     * concurrent fill() is a no-op. Returns how many runs it launched.
     */
    async fill() {
      if (filling) return 0;
      filling = true;
      let launched = 0;
      try {
        while (active < capacity()) {
          const work = await claim();
          if (!work) break;
          active += 1;
          launched += 1;
          Promise.resolve()
            .then(() => run(work))
            .catch((error) => onError?.(error, work))
            .finally(() => {
              active -= 1;
            });
        }
      } finally {
        filling = false;
      }
      return launched;
    },
  };
}
