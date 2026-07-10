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

  function createCapabilityInvocation(name, input = {}, actor = null, context = {}) {
    const tool = getTool(name, actor);
    if (tool) {
      return createToolInvocation(name, input, actor);
    }
    const capability = getCapability(name, actor);
    if (!capability) {
      return { status: 404, body: { error: "capability_not_found" } };
    }
    if (capability.provider?.type === "application") {
      const inputValidation = validateCapabilityInput(capability, input);
      if (!inputValidation.ok) {
        return {
          status: 422,
          body: {
            error: "invalid_capability_input",
            message: "Application capability input failed validation.",
            capability: name,
            validation: { errors: inputValidation.errors },
          },
        };
      }
      // Wrapper capabilities execute a real command on the local machine, so they
      // run through the bridge (async), not the synchronous Application Control
      // agent. Everything else (inspect/search/lifecycle/orchestration) stays
      // synchronous below.
      const wrapperCommandId = wrapperCommandIdFromCapabilityName(name);
      if (wrapperCommandId) {
        return dispatchApplicationWrapper(capability, name, wrapperCommandId, input, actor, context);
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
          automation: context.automation,
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
          ...automationMetadata(context.automation),
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

  function dispatchApplicationWrapper(capability, name, commandId, input, actor, context = {}) {
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
        automation: context.automation,
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
        ...automationMetadata(context.automation),
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

function validateCapabilityInput(capability, input) {
  const errors = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      errors: [capabilityInputError("", "invalid_type", "Input must be a JSON object.")],
    };
  }
  const publicInput = {};
  for (const [key, value] of Object.entries(input)) {
    if (APPLICATION_CONTROL_INPUT_KEYS.has(key)) continue;
    publicInput[key] = value;
  }
  validateObjectSchema(publicInput, publicCapabilityInputSchema(capability), "", errors);
  return { ok: errors.length === 0, errors };
}

function publicCapabilityInputSchema(capability) {
  const schema = effectiveCapabilityInputSchema(capability);
  const properties = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
    ? Object.fromEntries(Object.entries(schema.properties).filter(([key]) => !APPLICATION_CONTROL_INPUT_KEYS.has(key)))
    : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key) => !APPLICATION_CONTROL_INPUT_KEYS.has(key))
    : undefined;
  return {
    ...schema,
    properties,
    ...(required ? { required } : {}),
  };
}

const APPLICATION_CONTROL_INPUT_KEYS = new Set(["approvalRequestId", "__verifiedApplicationApproval", "projectId"]);

function effectiveCapabilityInputSchema(capability) {
  const base = capability?.inputSchema && typeof capability.inputSchema === "object" && !Array.isArray(capability.inputSchema)
    ? capability.inputSchema
    : { type: "object", additionalProperties: false, properties: {} };
  const wrapperInputs = capability?.metadata?.wrapper?.argInputs;
  if (!Array.isArray(wrapperInputs) || wrapperInputs.length === 0) return base;
  const properties = {
    ...(base.properties && typeof base.properties === "object" && !Array.isArray(base.properties) ? base.properties : {}),
  };
  for (const input of wrapperInputs) {
    if (!input?.key || properties[input.key]) continue;
    properties[input.key] = schemaForWrapperArgInput(input);
  }
  return {
    ...base,
    type: "object",
    additionalProperties: base.additionalProperties ?? false,
    properties,
  };
}

function schemaForWrapperArgInput(input) {
  if (input.type === "boolean-flag") return { type: "boolean" };
  if (input.type === "enum") return { enum: Array.isArray(input.values) ? input.values : [] };
  if (input.type === "date") return { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
  if (input.type === "string") return { type: "string", maxLength: 200 };
  return { type: "string", maxLength: 64 };
}

function validateObjectSchema(value, schema, path, errors) {
  const expectedType = schema?.type ?? "object";
  if (expectedType !== "object") return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(capabilityInputError(path, "invalid_type", "Expected object."));
    return;
  }
  const properties = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
    ? schema.properties
    : {};
  for (const required of Array.isArray(schema.required) ? schema.required : []) {
    if (!Object.hasOwn(value, required)) {
      errors.push(capabilityInputError(joinInputPath(path, required), "required", "Required property is missing."));
    }
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(properties, key)) {
        errors.push(capabilityInputError(joinInputPath(path, key), "additional_property", "Additional property is not allowed."));
      }
    }
  }
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!Object.hasOwn(value, key)) continue;
    validatePropertySchema(value[key], propertySchema, joinInputPath(path, key), errors);
  }
}

function validatePropertySchema(value, schema, path, errors) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;
  if (Object.hasOwn(schema, "const") && value !== schema.const) {
    errors.push(capabilityInputError(path, "invalid_const", `Expected ${JSON.stringify(schema.const)}.`));
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(capabilityInputError(path, "invalid_enum", `Expected one of: ${schema.enum.join(", ")}.`));
    return;
  }
  if (schema.type && !jsonTypeMatches(value, schema.type)) {
    errors.push(capabilityInputError(path, "invalid_type", `Expected ${schema.type}.`));
    return;
  }
  if (typeof value === "string") {
    if (Number.isFinite(schema.minLength) && value.length < schema.minLength) {
      errors.push(capabilityInputError(path, "too_short", `Must be at least ${schema.minLength} characters.`));
    }
    if (Number.isFinite(schema.maxLength) && value.length > schema.maxLength) {
      errors.push(capabilityInputError(path, "too_long", `Must be at most ${schema.maxLength} characters.`));
    }
    if (schema.pattern) {
      const regex = new RegExp(String(schema.pattern));
      if (!regex.test(value)) errors.push(capabilityInputError(path, "pattern", "Value does not match the required pattern."));
    }
  }
}

function jsonTypeMatches(value, type) {
  if (Array.isArray(type)) return type.some((item) => jsonTypeMatches(value, item));
  if (type === "array") return Array.isArray(value);
  if (type === "object") return Boolean(value && typeof value === "object" && !Array.isArray(value));
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "null") return value === null;
  return typeof value === type;
}

function joinInputPath(base, key) {
  return base ? `${base}.${key}` : key;
}

function capabilityInputError(path, code, message) {
  return { path, code, message };
}

function automationMetadata(automation = null) {
  if (!automation || typeof automation !== "object" || Array.isArray(automation)) return {};
  return {
    automationId: typeof automation.id === "string" ? automation.id : null,
    automationName: typeof automation.name === "string" ? automation.name : null,
    scheduled: Boolean(automation.scheduled),
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
  automation = null,
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
      ...automationMetadata(automation),
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
  return { approved: true, invocation: null };
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
  if (approval?.approved) {
    return { ...(input && typeof input === "object" && !Array.isArray(input) ? input : {}), __verifiedApplicationApproval: true };
  }
  return input;
}

function sideEffectingApplicationAction(action) {
  return ["archive", "offline", "online", "refresh", "generate_orchestration"].includes(action);
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
