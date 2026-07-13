import { teamOf } from "../runtime/auth.mjs";

export function createCapabilityService({
  state,
  refuse,
  listTools,
  getTool,
  createToolInvocation,
  createInvocation,
  completeInvocation,
  findAgent,
  listApplications,
  listApplicationCapabilities,
  invokeApplicationCapability,
  planApplicationWrapperInvocation,
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
      // Refusal model Phase 4 (#758): if the capability EXISTS but is not granted
      // to this requester (tenancy/ownership), record a `not_granted` refusal —
      // evaluated BEFORE any policy/state/human gate, so an ungranted request
      // never reveals downstream (approval/budget) detail. The refusal carries NO
      // event: `capability_not_granted` must never surface to the requester (the
      // response stays an opaque capability_not_found whether the capability is
      // unknown or merely not granted), so it lands only in the owner's ledger.
      // A genuinely-unknown name mints nothing — that is a client typo, not a veto.
      const unscoped = typeof refuse === "function" ? getCapability(name, null) : null;
      if (unscoped) {
        refuse({
          subject: { kind: "capability_call", id: name },
          requester: { kind: actor?.userId ? "local_user" : "control_plane", id: actor?.userId ?? actor?.teamId ?? null },
          category: "not_granted",
          code: "capability_not_granted",
          decidedBy: { kind: "grant", id: unscoped.provider?.id ?? name },
          summary: `Capability ${name} is not granted to this requester.`,
          evidence: { capability: name, providerType: unscoped.provider?.type ?? null, actorTeamId: actor?.teamId ?? null },
          remedy: "Grant this requester's team access to the owning application, or invoke from an authorized context.",
          retryAfter: null,
          appealTo: "device_owner",
          event: null,
        });
      }
      return { status: 404, body: { error: "capability_not_found" } };
    }
    if (capability.provider?.type === "application") {
      // Wrapper capabilities execute a real command on the local machine, so they
      // run through the bridge (async), not the synchronous Application Control
      // agent. Everything else (inspect/search/lifecycle/orchestration) stays
      // synchronous below.
      const wrapperCommandId = wrapperCommandIdFromCapabilityName(name);
      if (wrapperCommandId) {
        return dispatchApplicationWrapper(capability, name, wrapperCommandId, input, actor);
      }
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

  function dispatchApplicationWrapper(capability, name, commandId, input, actor) {
    const applicationId = capability.provider.id;
    // Guards first (tenancy, status, approvalToken, approved-command resolution)
    // so approval/authorization errors take precedence over agent availability —
    // the same order the synchronous path enforced.
    const planned = planApplicationWrapperInvocation({ applicationId, commandId, input, actor });
    if (!planned.ok) {
      return { status: planned.status, body: planned.body };
    }
    // A cwdPolicy:"invocation_root" command is defined by the repository it runs
    // in. With no project to confine to, the bridge would silently fall back to
    // its own directory — the exact bug #773 exists to remove. Refuse here, with
    // evidence, rather than dispatch an unrooted command.
    const resolvedProjectId = capability.application?.projectId ?? input?.projectId ?? null;
    if (planned.wrapper.cwdPolicy === "invocation_root" && !resolvedProjectId) {
      return {
        status: 409,
        body: {
          error: "invocation_root_requires_project",
          capability: name,
          message: "This command runs in the invocation's repository, but no project is scoped to the invocation.",
          evidence: { cwdPolicy: "invocation_root", applicationId },
        },
      };
    }
    const agent = findAgent("agt_platform_application_wrapper");
    if (!agent || agent.status === "disabled") {
      return {
        status: 409,
        body: { error: "agent_not_available", message: "The platform Application Wrapper Runner agent is not available." },
      };
    }
    // Create a queued invocation for the bridge. The server-resolved, approved
    // command travels as allowlisted metadata; the bridge injects it as discrete
    // argv into the fixed application-wrapper agent command.
    const invocation = createInvocation(`Run application capability ${name}.`, agent, {
      actor,
      requestedBy: actor?.userId,
      timeoutSeconds: planned.timeoutSeconds ?? 120,
      metadata: {
        capability: name,
        providerType: "application",
        applicationId,
        applicationWrapper: planned.wrapper,
        projectId: capability.application?.projectId ?? input?.projectId ?? null,
      },
    });
    if (invocation.status === "rejected") {
      return { status: 409, body: { capability: name, invocationId: invocation.id, status: invocation.status, invocation } };
    }
    return {
      status: 202,
      body: {
        capability: name,
        invocationId: invocation.id,
        agentId: agent.id,
        status: invocation.status,
        outputCollection: planned.outputCollection ?? "invocations",
        provider: capability.provider,
        invocation,
      },
    };
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

// A wrapper capability is named `app.<slug>.wrapper.<commandId>`; return the
// command id (or null for non-wrapper application capabilities).
function wrapperCommandIdFromCapabilityName(capabilityName) {
  return String(capabilityName ?? "").match(/\.wrapper\.([a-z0-9._-]+)$/)?.[1] ?? null;
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
