export function createInvocationCompareRuntime({
  state,
  now,
  nextId,
  createInvocation,
  startInvocationIfAllowed,
  updateCompareRun,
  createWorktree,
}) {
  function createCompareRun(task, agents, options = {}) {
    const createdAt = now();
    const { projectId: rawProjectId, ...restOptions } = options ?? {};
    const projectId = rawProjectId ?? restOptions.metadata?.projectId ?? null;
    // Per-agent worktree ISOLATION (P4.2): when a project is given, each agent runs
    // in its OWN worktree so code-editing agents don't collide + their diffs can be
    // compared. Without a project it stays shared context (read-only/answer compares).
    const isolate = Boolean(projectId) && typeof createWorktree === "function";
    const compareRun = {
      id: nextId("cmp_demo"),
      task,
      requestedBy: options.actor?.userId ?? "usr_local",
      projectId: projectId ?? null,
      isolated: isolate,
      status: "running",
      childInvocationIds: [],
      children: [], // { invocationId, agentId, worktreeId }
      preferredInvocationId: null,
      promotion: null,
      summary: "Compare run started.",
      createdAt,
      updatedAt: createdAt
    };
    state.compareRuns.unshift(compareRun);
    const baseMeta = restOptions.metadata && typeof restOptions.metadata === "object" && !Array.isArray(restOptions.metadata) ? restOptions.metadata : {};
    for (const agent of agents) {
      let worktreeId = null;
      if (isolate) {
        try {
          worktreeId = createWorktree({ projectId, name: `cmp-${compareRun.id.slice(-6)}-${agent.id}`, agentId: agent.id })?.worktree?.id ?? null;
        } catch {
          worktreeId = null; // best-effort: fall back to shared context for this agent
        }
      }
      const invocation = createInvocation(task, agent, {
        ...restOptions,
        metadata: {
          ...baseMeta,
          compareRunId: compareRun.id,
          ...(worktreeId ? { worktreeId, projectId } : {})
        }
      });
      invocation.compareRunId = compareRun.id;
      compareRun.childInvocationIds.push(invocation.id);
      compareRun.children.push({ invocationId: invocation.id, agentId: agent.id, worktreeId });
      startInvocationIfAllowed(invocation, agent);
    }
    updateCompareRun(compareRun);
    return compareRun;
  }

  return {
    createCompareRun,
  };
}
