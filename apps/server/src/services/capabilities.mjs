import { teamOf } from "../runtime/auth.mjs";

export function createCapabilityService({
  state,
  listTools,
  getTool,
  createToolInvocation,
  createInvocation,
  completeInvocation,
  findApprovalRequest = () => null,
  findInvocation = () => null,
  findAgent,
  listApplications,
  listApplicationCapabilities,
  invokeApplicationCapability,
  planApplicationWrapperInvocation,
}) {
  function listCapabilities(actor = null) {
    return [
      ...listTools(actor).map(toolToCapability),
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
    const tool = getTool(name, actor);
    if (tool) {
      return createToolInvocation(name, input, actor);
    }
    const capability = getCapability(name, actor);
    if (!capability) {
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
      const approval = verifyApplicationApproval(input, {
        findApprovalRequest,
        findInvocation,
        applicationId,
        capability: name,
        type: "application_action",
        action,
      });
      if (sideEffectingApplicationAction(action) && !approval.approved) {
        if (approval.error) return approval.error;
        return requestApplicationApproval({
          createInvocation,
          agent,
          actor,
          task: `Approve application capability ${action} for ${capability.application?.name ?? applicationId}.`,
          capability: name,
          applicationId,
          applicationProjectId: capability.application?.projectId ?? input?.projectId ?? null,
          approval: { type: "application_action", action },
        });
      }
      const invocation = approval.invocation ?? createInvocation(`Run application capability ${action} for ${capability.application?.name ?? applicationId}.`, agent, {
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
      const execution = invokeApplicationCapability(name, approvedApplicationInput(input, approval), actor, { applicationId });
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
    const approval = verifyApplicationApproval(input, {
      findApprovalRequest,
      findInvocation,
      applicationId,
      capability: name,
      type: "application_wrapper",
      commandId,
    });
    if (approval.error) return approval.error;
    const planned = planApplicationWrapperInvocation({ applicationId, commandId, input: approvedApplicationInput(input, approval), actor });
    if (!planned.ok) {
      if (planned.body?.error !== "approval_required") {
        return { status: planned.status, body: planned.body };
      }
      const approvalAgent = findAgent("agt_platform_application_control");
      if (!approvalAgent || approvalAgent.status === "disabled") {
        return {
          status: 409,
          body: {
            error: "agent_not_available",
            message: "The platform Application Control agent is not available.",
          },
        };
      }
      return requestApplicationApproval({
        createInvocation,
        agent: approvalAgent,
        actor,
        task: `Approve application wrapper capability ${name}.`,
        capability: name,
        applicationId,
        applicationProjectId: capability.application?.projectId ?? input?.projectId ?? null,
        approval: { type: "application_wrapper", commandId },
      });
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
        applicationPath: planned.wrapper.applicationPath ?? null,
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

export function requestApplicationApproval({
  createInvocation,
  agent,
  actor,
  task,
  capability,
  applicationId,
  applicationProjectId,
  approval,
}) {
  const invocation = createInvocation(task, agent, {
    actor,
    requestedBy: actor?.userId,
    requireLocalApproval: true,
    timeoutSeconds: 30,
    metadata: {
      capability,
      providerType: "application",
      applicationId,
      applicationApproval: approval,
      projectId: applicationProjectId ?? null,
    },
  });
  return {
    status: invocation.status === "rejected" ? 409 : 202,
    body: {
      capability,
      invocationId: invocation.id,
      agentId: agent.id,
      status: invocation.status,
      approvalRequestId: invocation.approvalRequestId ?? null,
      approvalRequest: invocation.approvalRequestId ?? null,
      approvalRequestRequired: true,
      invocation,
    },
  };
}

export function verifyApplicationApproval(input, {
  findApprovalRequest,
  findInvocation,
  applicationId,
  capability,
  type,
  action = null,
  commandId = null,
}) {
  if (hasApprovalToken(input)) return { approved: true, legacy: true, invocation: null };
  const approvalRequestId = String(input?.approvalRequestId ?? "").trim();
  if (!approvalRequestId) return { approved: false };
  const approval = findApprovalRequest(approvalRequestId);
  if (!approval) {
    return approvalVerificationError("approval_not_found", "Approval request was not found.", approvalRequestId);
  }
  if (approval.status !== "approved") {
    return approvalVerificationError("approval_not_approved", "Approval request has not been approved.", approvalRequestId, approval.status);
  }
  const invocation = findInvocation(approval.invocationId);
  const metadata = invocation?.options?.metadata ?? {};
  const approvalMetadata = metadata.applicationApproval ?? {};
  const matches =
    invocation
    && metadata.providerType === "application"
    && metadata.applicationId === applicationId
    && metadata.capability === capability
    && approvalMetadata.type === type
    && (action === null || approvalMetadata.action === action)
    && (commandId === null || approvalMetadata.commandId === commandId);
  if (!matches) {
    return approvalVerificationError("approval_scope_mismatch", "Approval request does not match this Application action.", approvalRequestId, approval.status);
  }
  return { approved: true, legacy: false, invocation: null };
}

function approvalVerificationError(error, reason, approvalRequestId, approvalStatus = null) {
  return {
    approved: false,
    error: {
      status: 409,
      body: {
        error,
        reason,
        approvalRequestId,
        approvalStatus,
      },
    },
  };
}

export function approvedApplicationInput(input, approval) {
  if (approval?.approved && !approval.legacy) {
    return { ...(input && typeof input === "object" && !Array.isArray(input) ? input : {}), __verifiedApplicationApproval: true };
  }
  return input;
}

function sideEffectingApplicationAction(action) {
  return ["archive", "offline", "online", "refresh", "generate_orchestration"].includes(action);
}

function hasApprovalToken(input) {
  return Boolean(input && typeof input === "object" && !Array.isArray(input) && String(input.approvalToken ?? "").trim());
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
    source: tool.source ?? "governed_tool",
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
