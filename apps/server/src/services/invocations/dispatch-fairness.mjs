/*
 * Fair Layer-A dispatch selection. The bridge polls `next` and gets ONE queued
 * invocation per call; the question is WHICH of the dispatchable ones to hand out.
 * The original code returned the first in `state.invocations` array order, so a
 * team/project that enqueued a burst sat at the front and starved everyone behind
 * it until it drained.
 *
 * This replaces array-order first-match with a hierarchical fair pick: at each
 * level (team, then project) restrict to the LEAST-LOADED group — the group with
 * the fewest in-flight runs right now — breaking ties toward the group that has
 * waited longest; then at the leaf pick the OLDEST-waiting invocation (FIFO,
 * anti-starvation), breaking ties by original order for stability. Because the
 * bridge marks the pick in-flight immediately, that group's load rises and the
 * next poll naturally rotates to another group — load-weighted round-robin across
 * tenants without any global scheduler state.
 */

// The project an invocation is anchored to (mirrors invocations.mjs's
// invocationProjectId). `__no_project__` groups the projectless ones together.
export function invocationProjectKey(invocation) {
  return (
    invocation?.projectId
    ?? invocation?.options?.metadata?.projectId
    ?? invocation?.input?.metadata?.projectId
    ?? "__no_project__"
  );
}

// The team that owns an invocation — via its project's ownerTeamId, else the
// requester's team, else the single-tenant local default. Mirrors the ownership
// rule denyForeignInvocationRead uses, so fairness groups match tenancy.
export function invocationTeamKey(invocation, state) {
  const projectId = invocation?.projectId ?? invocation?.options?.metadata?.projectId ?? invocation?.input?.metadata?.projectId ?? null;
  if (projectId) {
    const project = (state?.projects ?? []).find((p) => p.id === projectId);
    if (project) return project.ownerTeamId ?? "team_local";
  }
  const requester = (state?.users ?? []).find((u) => u.id === invocation?.requestedBy);
  return requester?.teamId ?? "team_local";
}

/**
 * Pick one invocation from `candidates` by descending a hierarchy of fairness
 * `levels`, then FIFO at the leaf.
 *
 * @param candidates dispatchable invocations (already eligibility-filtered)
 * @param levels ordered [{ keyOf(inv) => groupKey, loadOf(groupKey) => number }]
 * @param ageMsOf (inv) => ms waited (larger = older = waited longer)
 * @returns the chosen invocation, or undefined if `candidates` is empty
 */
export function selectFairInvocation(candidates, { levels = [], ageMsOf = () => 0 } = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return undefined;
  let pool = candidates.map((inv, index) => ({ inv, index }));
  for (const { keyOf, loadOf } of levels) {
    const groups = new Map();
    for (const entry of pool) {
      const key = keyOf(entry.inv);
      const bucket = groups.get(key);
      if (bucket) bucket.push(entry);
      else groups.set(key, [entry]);
    }
    let best = null;
    for (const members of groups.values()) {
      const load = loadOf(keyOf(members[0].inv));
      const oldest = Math.max(...members.map((m) => ageMsOf(m.inv)));
      // Least-loaded wins; tie → the group that has waited longest.
      if (best === null || load < best.load || (load === best.load && oldest > best.oldest)) {
        best = { load, oldest, members };
      }
    }
    pool = best.members;
  }
  // Leaf: oldest-waiting first (FIFO / anti-starvation), stable by original order.
  pool.sort((a, b) => (ageMsOf(b.inv) - ageMsOf(a.inv)) || (a.index - b.index));
  return pool[0].inv;
}
