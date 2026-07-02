import { teamOf } from "../runtime/auth.mjs";

export function createCapabilityService({
  state,
  listTools,
  getTool,
  createToolInvocation,
  createInvocation,
  completeInvocation,
  findAgent,
  listApplications,
  listApplicationCapabilities,
  invokeApplicationCapability,
}) {
  function listCapabilities(actor = null) {
    return [
      ...listTools().map(toolToCapability),
      ...visibleApplications(state, actor, listApplications()).flatMap((application) =>
        (listApplicationCapabilities(application.id) ?? []).map((capability) => ({
          ...capability,
          application: {
            id: application.id,
            name: application.name,
            status: application.status,
            projectId: application.projectId,
          },
        })),
      ),
    ];
  }

  function getCapability(name, actor = null) {
    return listCapabilities(actor).find((capability) => capability.name === name) ?? null;
  }

  function createCapabilityInvocation(name, input = {}, actor = null) {
    const tool = getTool(name);
    if (tool) {
      return createToolInvocation(name, input, actor);
    }
    const capability = getCapability(name, actor);
    if (!capability) {
      return { status: 404, body: { error: "capability_not_found" } };
    }
    if (capability.provider?.type === "application") {
      const agent = findAgent("agt_platform_application_control");
      if (!agent || agent.status === "disabled") {
        return {
          status: 409,
          body: {
            error: "agent_not_available",
            message: "The platform Application Control agent is not available.",
          },
        };
      }
      const action = actionFromCapabilityName(name);
      const applicationId = capability.provider.id;
      const invocation = createInvocation(`Run application capability ${action} for ${capability.application?.name ?? applicationId}.`, agent, {
        actor,
        requestedBy: actor?.userId,
        metadata: {
          capability: name,
          providerType: "application",
          applicationId,
          applicationAction: action,
          projectId: capability.application?.projectId ?? input?.projectId ?? null,
        },
        timeoutSeconds: 30,
      });
      if (["rejected", "waiting_for_local_approval"].includes(invocation.status)) {
        return {
          status: invocation.status === "rejected" ? 409 : 202,
          body: {
            capability: capability.name,
            invocationId: invocation.id,
            agentId: agent.id,
            status: invocation.status,
            provider: capability.provider,
            invocation,
          },
        };
      }
      const execution = invokeApplicationCapability(name, input, actor, { applicationId });
      if (!execution.ok) {
        completeInvocation(invocation, {
          status: "failed",
          summary: execution.body?.reason ?? execution.body?.error ?? "Application capability failed.",
          result: execution.body,
        });
        return { status: execution.status, body: { ...execution.body, invocationId: invocation.id, invocation } };
      }
      completeInvocation(invocation, {
        status: "succeeded",
        summary: execution.result.summary,
        result: {
          ...execution.result,
          capability: name,
          provider: capability.provider,
        },
      });
      return {
        status: 201,
        body: {
          capability: capability.name,
          invocationId: invocation.id,
          agentId: agent.id,
          status: invocation.status,
          outputCollection: "invocations",
          provider: capability.provider,
          invocation,
        },
      };
    }
    return { status: 409, body: { error: "capability_not_invokable", capability: name } };
  }

  return {
    createCapabilityInvocation,
    getCapability,
    listCapabilities,
  };
}

function actionFromCapabilityName(capabilityName) {
  return String(capabilityName ?? "").split(".").at(-1) ?? "unknown";
}

function toolToCapability(tool) {
  return {
    ...tool,
    provider: {
      type: "tool",
      id: tool.name,
    },
    kind: "tool",
    source: "governed_tool",
    invocationMode: "tool-facade",
    status: tool.agents?.some((agent) => agent.status !== "disabled") ? "available" : "disabled",
  };
}

function visibleApplications(state, actor, applications) {
  if (!actor?.teamId) return applications;
  const projectTeam = new Map((state.projects ?? []).map((project) => [project.id, teamOf(project)]));
  return applications.filter((application) => {
    if (application.projectId) return projectTeam.get(application.projectId) === actor.teamId;
    return (application.ownerTeamId ?? "team_local") === actor.teamId;
  });
}
