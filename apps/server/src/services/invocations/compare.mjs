export function createInvocationCompareRuntime({
  state,
  now,
  nextId,
  createInvocation,
  startInvocationIfAllowed,
  updateCompareRun,
}) {
  function createCompareRun(task, agents, options = {}) {
    const createdAt = now();
    const compareRun = {
      id: nextId("cmp_demo"),
      task,
      requestedBy: "usr_local",
      status: "running",
      childInvocationIds: [],
      preferredInvocationId: null,
      summary: "Compare run started.",
      createdAt,
      updatedAt: createdAt
    };
    state.compareRuns.unshift(compareRun);
    for (const agent of agents) {
      const invocation = createInvocation(task, agent, {
        ...options,
        metadata: {
          ...(options.metadata && typeof options.metadata === "object" && !Array.isArray(options.metadata) ? options.metadata : {}),
          compareRunId: compareRun.id
        }
      });
      invocation.compareRunId = compareRun.id;
      compareRun.childInvocationIds.push(invocation.id);
      startInvocationIfAllowed(invocation, agent);
    }
    updateCompareRun(compareRun);
    return compareRun;
  }

  return {
    createCompareRun,
  };
}
