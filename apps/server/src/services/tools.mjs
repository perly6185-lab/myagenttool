import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CCUSAGE_REPORT_SPECS,
  CCUSAGE_TOOL_CONTRACT,
} from "./ccusage-agent.mjs";
import { describeMcpToolCall } from "@myagenttool/adapters/mcp";
import { CCUSAGE_APPLICATION_ID } from "./ccusage-application.mjs";
import {
  CODEX_APPLY_PATCH_TOOL_CONTRACT,
  CODEX_PLAN_TOOL_CONTRACT,
  CODEX_PATCH_PROPOSAL_TOOL_CONTRACT,
  CODEX_REVIEW_TOOL_CONTRACT,
  isGovernedCodexApplyPatchAgent,
  isGovernedCodexPlanAgent,
  isGovernedCodexPatchProposalAgent,
  isGovernedCodexReviewAgent,
} from "./codex-agent.mjs";
import {
  CLAUDE_REVIEW_TOOL_CONTRACT,
  isGovernedClaudeReviewAgent,
} from "./claude-agent.mjs";
import { agentVisibleToActor, teamOf } from "../runtime/auth.mjs";

const CCUSAGE_APPROVAL_REQUIRED_REPORTS = new Set(["session"]);
const MCP_TOOL_CONTROL_FIELDS = new Set([
  "arguments",
  "approvalToken",
  "idempotencyKey",
  "projectId",
  "timeoutSeconds",
  "toolArguments",
]);

export function createToolService({
  state,
  now,
  appendEvent,
  createInvocation,
  startInvocationIfAllowed,
  findApplication,
  findAgent,
  findApprovalRequest,
  findInvocation,
  planApplicationWrapperInvocation,
}) {
  function listTools(actor = null) {
    return discoverTools(actor);
  }

  function getTool(name, actor = null) {
    return discoverTools(actor).find((tool) => tool.name === name) ?? null;
  }

  function createToolInvocation(name, input = {}, actor = null) {
    if (name === CCUSAGE_TOOL_CONTRACT.name) {
      return createCcusageToolInvocation(input, actor);
    }
    if (name === CODEX_REVIEW_TOOL_CONTRACT.name) {
      return createReviewInvocation({
        input,
        actor,
        contract: CODEX_REVIEW_TOOL_CONTRACT,
        selectAgent: selectCodexReviewAgent,
        buildTask: buildCodexReviewTask,
        outputCollection: "codexReviewFindings",
        agentLabel: "Codex",
      });
    }
    if (name === CODEX_PLAN_TOOL_CONTRACT.name) {
      return createPlanInvocation(input, actor);
    }
    if (name === CODEX_PATCH_PROPOSAL_TOOL_CONTRACT.name) {
      return createPatchProposalInvocation(input, actor);
    }
    if (name === CODEX_APPLY_PATCH_TOOL_CONTRACT.name) {
      return createApplyPatchInvocation(input, actor);
    }
    if (name === CLAUDE_REVIEW_TOOL_CONTRACT.name) {
      return createReviewInvocation({
        input,
        actor,
        contract: CLAUDE_REVIEW_TOOL_CONTRACT,
        selectAgent: selectClaudeReviewAgent,
        buildTask: buildClaudeReviewTask,
        outputCollection: "claudeReviewFindings",
        agentLabel: "Claude",
      });
    }
    const mcpTool = findMcpToolDescriptor(name, actor);
    if (mcpTool) {
      return createMcpToolInvocation(mcpTool, input, actor);
    }
    return { status: 404, body: { error: "tool_not_found" } };
  }

  function createCcusageToolInvocation(input, actor) {
    const validation = validateCcusageReportInput(input);
    if (!validation.ok) {
      return { status: validation.status, body: validation.body };
    }
    const value = validation.value;
    // Backed by the ccusage Application capability path (#355 full unification),
    // not bespoke agents. The ccusage app is a platform-shared asset and this tool
    // is the platform-wide authorization boundary, so we plan in platform context
    // (actor: null for the app tenancy gate) — ccusage reports are non-team-scoped
    // local usage data. The real caller is still recorded via requestedBy.
    const application = resolveCcusageApp();
    if (!application || !["registered", "active"].includes(application.status)) {
      return { status: 409, body: { error: "application_not_available", message: "The ccusage application is not registered. Run `pnpm ccusage:register-app`." } };
    }
    const runner = findAgent("agt_platform_application_wrapper");
    if (!runner || runner.status === "disabled") {
      return { status: 409, body: { error: "agent_not_available", message: "The platform Application Wrapper Runner agent is not available." } };
    }
    const project = resolveToolProjectId(value.projectId, actor);
    if (!project.ok) {
      return { status: project.status, body: project.body };
    }
    const projectId = project.value;
    const planned = planApplicationWrapperInvocation({
      applicationId: application.id,
      commandId: value.report,
      input: { since: value.since, until: value.until, timezone: value.timezone },
      actor: null,
    });
    if (!planned.ok) {
      return { status: planned.status, body: planned.body };
    }
    const invocation = createInvocation(buildCcusageTask(value), runner, {
      actor,
      requestedBy: actor?.userId,
      metadata: {
        tool: CCUSAGE_TOOL_CONTRACT.name,
        toolVersion: CCUSAGE_TOOL_CONTRACT.version,
        capability: planned.wrapper.capability,
        providerType: "application",
        applicationId: application.id,
        applicationPath: planned.wrapper.applicationPath ?? null,
        applicationWrapper: planned.wrapper,
        report: value.report,
        filters: {
          since: value.since ?? null,
          until: value.until ?? null,
          timezone: value.timezone ?? null,
          offline: value.offline,
        },
        projectId,
      },
      timeoutSeconds: planned.timeoutSeconds ?? 60,
    });
    startInvocationIfAllowed(invocation, runner);
    appendEvent({
      invocationId: invocation.id,
      type: "tool_invocation_created",
      level: "info",
      message: `Tool ${CCUSAGE_TOOL_CONTRACT.name} created ${value.report} invocation.`,
      data: {
        tool: CCUSAGE_TOOL_CONTRACT.name,
        version: CCUSAGE_TOOL_CONTRACT.version,
        report: value.report,
        agentId: runner.id,
      },
    });
    return {
      status: 201,
      body: {
        tool: CCUSAGE_TOOL_CONTRACT.name,
        invocationId: invocation.id,
        agentId: runner.id,
        status: invocation.status,
        outputCollection: "importedUsageEstimates",
        invocation,
      },
    };
  }

  function createReviewInvocation({ input, actor, contract, selectAgent, buildTask, outputCollection, agentLabel }) {
    const validation = validateReviewInput(input);
    if (!validation.ok) {
      return { status: validation.status, body: validation.body };
    }
    const value = validation.value;
    const project = resolveToolProjectId(value.projectId, actor);
    if (!project.ok) {
      return { status: project.status, body: project.body };
    }
    const projectId = project.value;
    const worktree = findToolWorktree(value.worktreeId, projectId);
    if (!worktree) {
      return { status: 404, body: { error: "worktree_not_found" } };
    }
    const agent = selectAgent(actor);
    if (!agent) {
      return { status: 409, body: { error: "agent_not_available", message: `No governed ${agentLabel} diff review agent is available.` } };
    }
    if (agent.status === "disabled") {
      return { status: 409, body: { error: "agent_not_available", message: `The governed ${agentLabel} diff review agent is disabled.`, agentId: agent.id } };
    }
    if (agent.health?.status === "unhealthy") {
      return { status: 409, body: { error: "agent_not_available", message: agent.health.message ?? `The governed ${agentLabel} diff review agent is unhealthy.`, agentId: agent.id } };
    }
    if (agent.location?.type === "local_device" && state.device?.unlinkState === "unlinked") {
      return { status: 409, body: { error: "agent_not_available", message: "The local device is unlinked.", agentId: agent.id } };
    }
    const invocation = createInvocation(buildTask(value), agent, {
      actor,
      requestedBy: actor?.userId,
      metadata: {
        tool: contract.name,
        toolVersion: contract.version,
        projectId,
        worktreeId: worktree.id,
        severityFloor: value.severityFloor,
        instruction: value.instruction,
      },
      timeoutSeconds: 120,
    });
    startInvocationIfAllowed(invocation, agent);
    appendEvent({
      invocationId: invocation.id,
      type: "tool_invocation_created",
      level: "info",
      message: `Tool ${contract.name} created diff review invocation.`,
      data: {
        tool: contract.name,
        version: contract.version,
        agentId: agent.id,
        worktreeId: worktree.id,
      },
    });
    return {
      status: 201,
      body: {
        tool: contract.name,
        invocationId: invocation.id,
        agentId: agent.id,
        status: invocation.status,
        outputCollection,
        invocation,
      },
    };
  }

  function createPlanInvocation(input, actor) {
    const validation = validateCodexPlanInput(input);
    if (!validation.ok) {
      return { status: validation.status, body: validation.body };
    }
    const value = validation.value;
    const project = resolveToolProjectId(value.projectId, actor);
    if (!project.ok) {
      return { status: project.status, body: project.body };
    }
    const projectId = project.value;
    const worktree = findToolWorktree(value.worktreeId, projectId);
    if (!worktree) {
      return { status: 404, body: { error: "worktree_not_found" } };
    }
    const agent = selectCodexPlanAgent(actor);
    if (!agent) {
      return { status: 409, body: { error: "agent_not_available", message: "No governed Codex change plan agent is available." } };
    }
    if (agent.status === "disabled") {
      return { status: 409, body: { error: "agent_not_available", message: "The governed Codex change plan agent is disabled.", agentId: agent.id } };
    }
    if (agent.health?.status === "unhealthy") {
      return { status: 409, body: { error: "agent_not_available", message: agent.health.message ?? "The governed Codex change plan agent is unhealthy.", agentId: agent.id } };
    }
    if (agent.location?.type === "local_device" && state.device?.unlinkState === "unlinked") {
      return { status: 409, body: { error: "agent_not_available", message: "The local device is unlinked.", agentId: agent.id } };
    }
    const invocation = createInvocation(buildCodexPlanTask(value), agent, {
      actor,
      requestedBy: actor?.userId,
      metadata: {
        tool: CODEX_PLAN_TOOL_CONTRACT.name,
        toolVersion: CODEX_PLAN_TOOL_CONTRACT.version,
        projectId,
        worktreeId: worktree.id,
        goal: value.goal,
        constraints: value.constraints,
        severityFloor: value.severityFloor,
      },
      timeoutSeconds: 120,
    });
    startInvocationIfAllowed(invocation, agent);
    appendEvent({
      invocationId: invocation.id,
      type: "tool_invocation_created",
      level: "info",
      message: `Tool ${CODEX_PLAN_TOOL_CONTRACT.name} created change plan invocation.`,
      data: {
        tool: CODEX_PLAN_TOOL_CONTRACT.name,
        version: CODEX_PLAN_TOOL_CONTRACT.version,
        agentId: agent.id,
        worktreeId: worktree.id,
      },
    });
    return {
      status: 201,
      body: {
        tool: CODEX_PLAN_TOOL_CONTRACT.name,
        invocationId: invocation.id,
        agentId: agent.id,
        status: invocation.status,
        outputCollection: "codexChangePlans",
        invocation,
      },
    };
  }

  function createPatchProposalInvocation(input, actor) {
    const validation = validateCodexPatchProposalInput(input);
    if (!validation.ok) {
      return { status: validation.status, body: validation.body };
    }
    const value = validation.value;
    const project = resolveToolProjectId(value.projectId, actor);
    if (!project.ok) {
      return { status: project.status, body: project.body };
    }
    const projectId = project.value;
    const worktree = findToolWorktree(value.worktreeId, projectId);
    if (!worktree) {
      return { status: 404, body: { error: "worktree_not_found" } };
    }
    if (value.basePlanId) {
      const basePlan = (state.codexChangePlans ?? []).find((item) => item.id === value.basePlanId);
      if (!basePlan) {
        return { status: 404, body: { error: "base_plan_not_found" } };
      }
      if (basePlan.projectId !== projectId || basePlan.worktreeId !== worktree.id) {
        return { status: 409, body: { error: "base_plan_scope_mismatch" } };
      }
    }
    if (value.maxFiles > 15) {
      return {
        status: 409,
        body: {
          error: "approval_required",
          reason: "Patch proposals over 15 files require explicit approval before Codex runs.",
        },
      };
    }
    const agent = selectCodexPatchProposalAgent(actor);
    if (!agent) {
      return { status: 409, body: { error: "agent_not_available", message: "No governed Codex patch proposal agent is available." } };
    }
    if (agent.status === "disabled") {
      return { status: 409, body: { error: "agent_not_available", message: "The governed Codex patch proposal agent is disabled.", agentId: agent.id } };
    }
    if (agent.health?.status === "unhealthy") {
      return { status: 409, body: { error: "agent_not_available", message: agent.health.message ?? "The governed Codex patch proposal agent is unhealthy.", agentId: agent.id } };
    }
    if (agent.location?.type === "local_device" && state.device?.unlinkState === "unlinked") {
      return { status: 409, body: { error: "agent_not_available", message: "The local device is unlinked.", agentId: agent.id } };
    }
    const invocation = createInvocation(buildCodexPatchProposalTask(value), agent, {
      actor,
      requestedBy: actor?.userId,
      metadata: {
        tool: CODEX_PATCH_PROPOSAL_TOOL_CONTRACT.name,
        toolVersion: CODEX_PATCH_PROPOSAL_TOOL_CONTRACT.version,
        projectId,
        worktreeId: worktree.id,
        goal: value.goal,
        constraints: value.constraints,
        basePlanId: value.basePlanId,
        maxFiles: value.maxFiles,
      },
      timeoutSeconds: 180,
    });
    startInvocationIfAllowed(invocation, agent);
    appendEvent({
      invocationId: invocation.id,
      type: "tool_invocation_created",
      level: "info",
      message: `Tool ${CODEX_PATCH_PROPOSAL_TOOL_CONTRACT.name} created patch proposal invocation.`,
      data: {
        tool: CODEX_PATCH_PROPOSAL_TOOL_CONTRACT.name,
        version: CODEX_PATCH_PROPOSAL_TOOL_CONTRACT.version,
        agentId: agent.id,
        worktreeId: worktree.id,
        basePlanId: value.basePlanId,
      },
    });
    return {
      status: 201,
      body: {
        tool: CODEX_PATCH_PROPOSAL_TOOL_CONTRACT.name,
        invocationId: invocation.id,
        agentId: agent.id,
        status: invocation.status,
        outputCollection: "codexPatchProposals",
        invocation,
      },
    };
  }

  function createApplyPatchInvocation(input, actor) {
    const validation = validateCodexApplyPatchInput(input);
    if (!validation.ok) {
      return { status: validation.status, body: validation.body };
    }
    const value = validation.value;
    const project = resolveToolProjectId(value.projectId, actor);
    if (!project.ok) {
      return { status: project.status, body: project.body };
    }
    const projectId = project.value;
    const worktree = findToolWorktree(value.worktreeId, projectId);
    if (!worktree) {
      return { status: 404, body: { error: "worktree_not_found" } };
    }
    const proposal = findCodexPatchProposal(state, value.proposalId);
    if (!proposal) {
      return { status: 404, body: { error: "proposal_not_found" } };
    }
    if (proposal.projectId !== projectId || proposal.worktreeId !== worktree.id) {
      return { status: 409, body: { error: "proposal_scope_mismatch" } };
    }
    if (proposal.reviewState !== "approved") {
      return {
        status: 409,
        body: {
          error: "proposal_not_approved",
          reason: "Only reviewed and approved patch proposals can be applied.",
          reviewState: proposal.reviewState ?? null,
        },
      };
    }
    if (proposal.patchSha256 !== value.patchSha256) {
      return { status: 409, body: { error: "patch_hash_mismatch" } };
    }
    const rawDiff = normalizePatchText(proposal.raw?.diff);
    if (!rawDiff) {
      return { status: 409, body: { error: "proposal_missing_diff" } };
    }
    if (sha256(rawDiff) !== value.patchSha256) {
      return { status: 409, body: { error: "patch_hash_mismatch", reason: "Stored proposal diff does not match its reviewed hash." } };
    }
    const approval = verifyCodexApplyApproval(value, { projectId, worktreeId: worktree.id });
    if (!approval.approved) {
      if (approval.error) return approval.error;
      return requestCodexApplyApproval({ value, projectId, worktree, actor });
    }
    const agent = selectCodexApplyPatchAgent(actor);
    if (!agent) {
      return { status: 409, body: { error: "agent_not_available", message: "No governed Codex apply patch agent is available." } };
    }
    if (agent.status === "disabled") {
      return { status: 409, body: { error: "agent_not_available", message: "The governed Codex apply patch agent is disabled.", agentId: agent.id } };
    }
    if (agent.health?.status === "unhealthy") {
      return { status: 409, body: { error: "agent_not_available", message: agent.health.message ?? "The governed Codex apply patch agent is unhealthy.", agentId: agent.id } };
    }
    if (agent.location?.type === "local_device" && state.device?.unlinkState === "unlinked") {
      return { status: 409, body: { error: "agent_not_available", message: "The local device is unlinked.", agentId: agent.id } };
    }
    const patchFile = createTempPatchFileForProposal(proposal, rawDiff);
    const invocation = createInvocation(buildCodexApplyPatchTask(value), agent, {
      actor,
      requestedBy: actor?.userId,
      metadata: {
        tool: CODEX_APPLY_PATCH_TOOL_CONTRACT.name,
        toolVersion: CODEX_APPLY_PATCH_TOOL_CONTRACT.version,
        projectId,
        worktreeId: worktree.id,
        proposalId: value.proposalId,
        patchSha256: value.patchSha256,
        approvalRequestId: value.approvalRequestId,
        patchFilePath: patchFile,
      },
      timeoutSeconds: 120,
    });
    startInvocationIfAllowed(invocation, agent);
    appendEvent({
      invocationId: invocation.id,
      type: "tool_invocation_created",
      level: "info",
      message: `Tool ${CODEX_APPLY_PATCH_TOOL_CONTRACT.name} created approved patch apply invocation.`,
      data: {
        tool: CODEX_APPLY_PATCH_TOOL_CONTRACT.name,
        version: CODEX_APPLY_PATCH_TOOL_CONTRACT.version,
        agentId: agent.id,
        worktreeId: worktree.id,
        proposalId: value.proposalId,
        patchSha256: value.patchSha256,
        approvalRequestId: value.approvalRequestId,
      },
    });
    return {
      status: 201,
      body: {
        tool: CODEX_APPLY_PATCH_TOOL_CONTRACT.name,
        invocationId: invocation.id,
        agentId: agent.id,
        status: invocation.status,
        outputCollection: "codexPatchProposals",
        invocation,
      },
    };
  }

  function requestCodexApplyApproval({ value, projectId, worktree, actor }) {
    const agent = findAgent?.("agt_platform_application_control") ?? null;
    if (!agent || agent.status === "disabled") {
      return {
        status: 409,
        body: {
          error: "agent_not_available",
          message: "The platform Application Control agent is not available to request patch apply approval.",
        },
      };
    }
    const invocation = createInvocation(`Approve applying Codex patch proposal ${value.proposalId}.`, agent, {
      actor,
      requestedBy: actor?.userId,
      requireLocalApproval: true,
      timeoutSeconds: 30,
      metadata: {
        tool: CODEX_APPLY_PATCH_TOOL_CONTRACT.name,
        toolVersion: CODEX_APPLY_PATCH_TOOL_CONTRACT.version,
        providerType: "tool",
        capability: CODEX_APPLY_PATCH_TOOL_CONTRACT.name,
        projectId,
        worktreeId: worktree.id,
        proposalId: value.proposalId,
        patchSha256: value.patchSha256,
        toolApproval: {
          type: "codex_apply_patch",
          proposalId: value.proposalId,
          patchSha256: value.patchSha256,
        },
      },
    });
    return {
      status: invocation.status === "rejected" ? 409 : 202,
      body: {
        tool: CODEX_APPLY_PATCH_TOOL_CONTRACT.name,
        invocationId: invocation.id,
        agentId: agent.id,
        status: invocation.status,
        approvalRequestId: invocation.approvalRequestId ?? null,
        approvalRequest: invocation.approvalRequestId ?? null,
        approvalRequestRequired: true,
        outputCollection: "codexPatchProposals",
        invocation,
      },
    };
  }

  function verifyCodexApplyApproval(value, { projectId, worktreeId }) {
    const approvalRequestId = value.approvalRequestId;
    if (!approvalRequestId) return { approved: false };
    const approval = findApprovalRequest?.(approvalRequestId) ?? (state.approvalRequests ?? []).find((item) => item.id === approvalRequestId) ?? null;
    if (!approval) {
      return codexApplyApprovalError("approval_not_found", "Approval request was not found.", approvalRequestId);
    }
    if (approval.status !== "approved") {
      return codexApplyApprovalError("approval_not_approved", "Approval request has not been approved.", approvalRequestId, approval.status);
    }
    const approvalInvocation = findInvocation?.(approval.invocationId) ?? (state.invocations ?? []).find((item) => item.id === approval.invocationId) ?? null;
    const metadata = approvalInvocation?.options?.metadata ?? {};
    const toolApproval = metadata.toolApproval ?? {};
    const matches =
      approvalInvocation
      && metadata.providerType === "tool"
      && metadata.tool === CODEX_APPLY_PATCH_TOOL_CONTRACT.name
      && metadata.capability === CODEX_APPLY_PATCH_TOOL_CONTRACT.name
      && metadata.projectId === projectId
      && metadata.worktreeId === worktreeId
      && metadata.proposalId === value.proposalId
      && metadata.patchSha256 === value.patchSha256
      && toolApproval.type === "codex_apply_patch"
      && toolApproval.proposalId === value.proposalId
      && toolApproval.patchSha256 === value.patchSha256;
    if (!matches) {
      return codexApplyApprovalError("approval_scope_mismatch", "Approval request does not match this patch apply request.", approvalRequestId, approval.status);
    }
    return { approved: true, approval, invocation: approvalInvocation };
  }

  function codexApplyApprovalError(error, reason, approvalRequestId, approvalStatus = null) {
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

  function createMcpToolInvocation(tool, input, actor) {
    const validation = validateMcpToolInput(input);
    if (!validation.ok) {
      return { status: validation.status, body: validation.body };
    }
    const value = validation.value;
    const agent = findAgent(tool.mcp.agentId);
    if (!agent) {
      return { status: 409, body: { error: "agent_not_available", message: "The registered MCP agent is not available." } };
    }
    if (agent.status === "disabled") {
      return { status: 409, body: { error: "agent_disabled", agentId: agent.id } };
    }
    if (agent.health?.status === "unhealthy") {
      return { status: 409, body: { error: "agent_unhealthy", message: agent.health.message, agentId: agent.id } };
    }
    if (agent.location?.type === "local_device" && state.device?.unlinkState === "unlinked") {
      return { status: 409, body: { error: "device_unlinked", agentId: agent.id } };
    }
    const project = resolveToolProjectId(value.projectId, actor);
    if (!project.ok) {
      return { status: project.status, body: project.body };
    }
    const projectId = project.value;
    try {
      describeMcpToolCall(agent.adapter, tool.mcp.toolName, value.toolArguments);
    } catch (error) {
      return {
        status: /allowed tools/i.test(error?.message ?? "") ? 409 : 400,
        body: {
          error: /allowed tools/i.test(error?.message ?? "") ? "mcp_tool_not_allowed" : "invalid_mcp_tool_call",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
    const timeoutSeconds = value.timeoutSeconds ?? Math.ceil(Number(agent.adapter?.timeoutMs ?? 60_000) / 1000);
    const application = agent.sourceApplicationId ? findApplication?.(agent.sourceApplicationId) ?? null : null;
    const invocation = createInvocation(value.task ?? `Call MCP tool ${tool.mcp.toolName} via ${agent.name}.`, agent, {
      actor,
      requestedBy: actor?.userId,
      toolName: tool.mcp.toolName,
      toolArguments: value.toolArguments,
      timeoutSeconds,
      metadata: {
        tool: tool.name,
        toolVersion: tool.version,
        providerType: "mcp",
        mcpAgentId: agent.id,
        mcpToolName: tool.mcp.toolName,
        capability: tool.name,
        applicationId: application?.id ?? agent.sourceApplicationId ?? null,
        applicationName: application?.name ?? null,
        applicationAction: "mcp_tool_call",
        outputCollection: "invocations",
        projectId,
      },
    });
    startInvocationIfAllowed(invocation, agent);
    appendEvent({
      invocationId: invocation.id,
      type: "tool_invocation_created",
      level: "info",
      message: `Tool ${tool.name} created MCP invocation ${tool.mcp.toolName}.`,
      data: {
        tool: tool.name,
        version: tool.version,
        agentId: agent.id,
        mcpToolName: tool.mcp.toolName,
      },
    });
    return {
      status: 201,
      body: {
        tool: tool.name,
        invocationId: invocation.id,
        agentId: agent.id,
        status: invocation.status,
        outputCollection: "invocations",
        invocation,
      },
    };
  }

  // The ccusage app backs the tool; when the app service isn't wired (review-only
  // harnesses) the tool is simply absent.
  function resolveCcusageApp() {
    return typeof findApplication === "function" ? findApplication(CCUSAGE_APPLICATION_ID) : null;
  }

  function discoverTools(actor = null) {
    const ccusageApp = resolveCcusageApp();
    const ccusageAvailable = ccusageApp && ["registered", "active"].includes(ccusageApp.status);
    const codexReviewAgents = (state.agents ?? []).filter((agent) => isGovernedCodexReviewAgent(agent) && agentVisibleToActor(state, agent, actor));
    const codexPlanAgents = (state.agents ?? []).filter((agent) => isGovernedCodexPlanAgent(agent) && agentVisibleToActor(state, agent, actor));
    const codexPatchProposalAgents = (state.agents ?? []).filter((agent) => isGovernedCodexPatchProposalAgent(agent) && agentVisibleToActor(state, agent, actor));
    const codexApplyPatchAgents = (state.agents ?? []).filter((agent) => isGovernedCodexApplyPatchAgent(agent) && agentVisibleToActor(state, agent, actor));
    const claudeReviewAgents = (state.agents ?? []).filter((agent) => isGovernedClaudeReviewAgent(agent) && agentVisibleToActor(state, agent, actor));
    const mcpAgents = (state.agents ?? []).filter((agent) => agentVisibleToActor(state, agent, actor));
    const builtinNames = new Set([
      ...(ccusageAvailable ? [CCUSAGE_TOOL_CONTRACT.name] : []),
      ...(codexReviewAgents.length ? [CODEX_REVIEW_TOOL_CONTRACT.name] : []),
      ...(codexPlanAgents.length ? [CODEX_PLAN_TOOL_CONTRACT.name] : []),
      ...(codexPatchProposalAgents.length ? [CODEX_PATCH_PROPOSAL_TOOL_CONTRACT.name] : []),
      ...(codexApplyPatchAgents.length ? [CODEX_APPLY_PATCH_TOOL_CONTRACT.name] : []),
      ...(claudeReviewAgents.length ? [CLAUDE_REVIEW_TOOL_CONTRACT.name] : []),
    ]);
    return [
      ...(ccusageAvailable ? [buildCcusageToolDescriptor(ccusageApp)] : []),
      ...(codexReviewAgents.length ? [buildCodexReviewToolDescriptor(codexReviewAgents)] : []),
      ...(codexPlanAgents.length ? [buildCodexPlanToolDescriptor(codexPlanAgents)] : []),
      ...(codexPatchProposalAgents.length ? [buildCodexPatchProposalToolDescriptor(codexPatchProposalAgents)] : []),
      ...(codexApplyPatchAgents.length ? [buildCodexApplyPatchToolDescriptor(codexApplyPatchAgents)] : []),
      ...(claudeReviewAgents.length ? [buildClaudeReviewToolDescriptor(claudeReviewAgents)] : []),
      ...buildMcpToolDescriptors({ agents: mcpAgents, usedNames: builtinNames }),
    ];
  }

  function findMcpToolDescriptor(name, actor = null) {
    const mcpAgents = (state.agents ?? []).filter((agent) => agentVisibleToActor(state, agent, actor));
    return buildMcpToolDescriptors({ agents: mcpAgents, usedNames: new Set([
      CCUSAGE_TOOL_CONTRACT.name,
      CODEX_REVIEW_TOOL_CONTRACT.name,
      CODEX_PLAN_TOOL_CONTRACT.name,
      CODEX_PATCH_PROPOSAL_TOOL_CONTRACT.name,
      CODEX_APPLY_PATCH_TOOL_CONTRACT.name,
      CLAUDE_REVIEW_TOOL_CONTRACT.name,
    ]) }).find((tool) => tool.name === name) ?? null;
  }

  function selectCodexReviewAgent(actor = null) {
    return (state.agents ?? []).find((agent) => isGovernedCodexReviewAgent(agent) && agentVisibleToActor(state, agent, actor)) ?? null;
  }

  function selectCodexPlanAgent(actor = null) {
    return (state.agents ?? []).find((agent) => isGovernedCodexPlanAgent(agent) && agentVisibleToActor(state, agent, actor)) ?? null;
  }

  function selectCodexPatchProposalAgent(actor = null) {
    return (state.agents ?? []).find((agent) => isGovernedCodexPatchProposalAgent(agent) && agentVisibleToActor(state, agent, actor)) ?? null;
  }

  function selectCodexApplyPatchAgent(actor = null) {
    return (state.agents ?? []).find((agent) => isGovernedCodexApplyPatchAgent(agent) && agentVisibleToActor(state, agent, actor)) ?? null;
  }

  function selectClaudeReviewAgent(actor = null) {
    return (state.agents ?? []).find((agent) => isGovernedClaudeReviewAgent(agent) && agentVisibleToActor(state, agent, actor)) ?? null;
  }

  function resolveToolProjectId(projectId, actor) {
    if (projectId) {
      const project = (state.projects ?? []).find((item) => item.id === projectId);
      if (!project || (actor?.teamId && teamOf(project) !== actor.teamId)) {
        return { ok: false, status: 404, body: { error: "project_not_found" } };
      }
      return { ok: true, value: project.id };
    }
    if (!actor?.teamId) {
      const defaultProjectId = state.currentProjectId ?? state.projects?.[0]?.id ?? null;
      return defaultProjectId
        ? { ok: true, value: defaultProjectId }
        : { ok: false, status: 400, body: { error: "project_required", message: "A projectId is required when no actor-owned default project is available." } };
    }
    const ownedProjectId = (state.projects ?? []).find((project) => teamOf(project) === actor.teamId)?.id ?? null;
    return ownedProjectId
      ? { ok: true, value: ownedProjectId }
      : { ok: false, status: 400, body: { error: "project_required", message: "A projectId is required when no actor-owned default project is available." } };
  }

  function findToolWorktree(worktreeId, projectId) {
    const worktree = (state.worktrees ?? []).find((item) => item.id === worktreeId);
    if (!worktree) {
      return null;
    }
    return worktree.projectId === projectId || worktree.workspaceProjectId === projectId
      ? worktree
      : null;
  }

  return {
    createToolInvocation,
    getTool,
    listTools,
    validateCodexReviewInput,
    validateCodexPlanInput,
    validateCodexPatchProposalInput,
    validateClaudeReviewInput,
    validateCcusageReportInput,
  };
}

function buildMcpToolDescriptors({ agents, usedNames }) {
  const tools = [];
  for (const agent of agents ?? []) {
    if (agent?.adapter?.type !== "mcp") continue;
    const allowedTools = normalizeStringList(agent.adapter.allowedTools);
    if (allowedTools.length === 0) continue;
    const namespace = mcpToolNamespace(agent);
    for (const toolName of allowedTools) {
      const baseName = `${namespace}.${slugifyToolSegment(toolName)}`;
      const name = uniqueCapabilityName(baseName, usedNames);
      tools.push(buildMcpToolDescriptor({ name, agent, toolName }));
    }
  }
  return tools;
}

function buildMcpToolDescriptor({ name, agent, toolName }) {
  const riskLevel = highestRiskLevel((agent.capabilities ?? []).map((capability) => capability?.riskLevel));
  const riskTags = uniqueStrings([
    "mcp",
    agent.adapter?.transport === "http" ? "mcp_http" : "mcp_stdio",
    ...(agent.capabilities ?? []).flatMap((capability) => capability?.riskTags ?? []),
  ]);
  return {
    name,
    version: "1",
    displayName: toolName,
    description: `Call MCP tool ${toolName} exposed by ${agent.name}.`,
    riskLevel,
    riskTags,
    requiresLocalDevice: agent.location?.type === "local_device",
    inputSchema: mcpToolInputSchema(),
    outputSchema: {
      type: "object",
      additionalProperties: true,
      description: "MCP tool result stored on the invocation.",
    },
    agents: [{
      id: agent.id,
      name: agent.name,
      status: agent.health?.status === "unhealthy" ? "unhealthy" : agent.status,
      transport: agent.adapter?.transport ?? "stdio",
      toolName,
    }],
    approvalPolicy: {
      defaultAllowedTools: "allowed",
      unknownTool: "blocked",
    },
    authoritativeBilling: false,
    outputCollection: "invocations",
    source: "mcp_agent",
    metadata: {
      readiness: {
        state: agent.status === "disabled" ? "disabled" : agent.health?.status === "unhealthy" ? "needs_setup" : "ready",
        reason: "mcp_agent_registered",
        executionMode: agent.adapter?.transport === "http" ? "mcp_http" : "mcp_stdio",
      },
      resultPath: {
        outputCollection: "invocations",
        evidenceCenter: true,
      },
      mcp: {
        agentId: agent.id,
        toolName,
      },
    },
    application: agent.sourceApplicationId ? { id: agent.sourceApplicationId } : null,
    mcp: {
      agentId: agent.id,
      toolName,
      transport: agent.adapter?.transport ?? "stdio",
    },
  };
}

function mcpToolInputSchema() {
  return {
    type: "object",
    additionalProperties: true,
    properties: {
      projectId: { type: "string" },
      toolArguments: {
        type: "object",
        additionalProperties: true,
        description: "Arguments passed to the MCP tool. If omitted, non-control top-level fields become tool arguments.",
      },
      timeoutSeconds: { type: "number" },
    },
  };
}

function mcpToolNamespace(agent) {
  const explicit =
    stringOrNull(agent.toolNamespace) ??
    stringOrNull(agent.capabilityPrefix) ??
    stringOrNull(agent.adapter?.toolNamespace) ??
    stringOrNull(agent.adapter?.capabilityPrefix);
  const raw = explicit ?? stringOrNull(agent.id) ?? stringOrNull(agent.name) ?? "mcp";
  const normalized = slugifyToolSegment(raw)
    .replace(/^agt_/, "")
    .replace(/_mcp$/, "");
  return normalized || "mcp";
}

function slugifyToolSegment(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return text || "tool";
}

function uniqueCapabilityName(baseName, usedNames) {
  let name = baseName;
  let suffix = 2;
  while (usedNames.has(name)) {
    name = `${baseName}_${suffix}`;
    suffix += 1;
  }
  usedNames.add(name);
  return name;
}

function buildCcusageToolDescriptor(app) {
  // Derived from the ccusage Application (#355 full unification): one descriptor
  // entry per report capability, so /api/tools survives the bespoke agents'
  // retirement. Execution runs via the platform Application Wrapper Runner.
  const status = app.status === "active" ? "available" : "registered";
  return {
    name: CCUSAGE_TOOL_CONTRACT.name,
    version: CCUSAGE_TOOL_CONTRACT.version,
    displayName: "ccusage Usage Report",
    description: "Generate governed local usage and cost reports from ccusage.",
    riskLevel: "low",
    riskTags: ["read_only", "read_local", "shell_exec"],
    requiresLocalDevice: true,
    inputSchema: CCUSAGE_TOOL_CONTRACT.inputSchema,
    outputSchema: CCUSAGE_TOOL_CONTRACT.outputSchema,
    agents: CCUSAGE_REPORT_SPECS.map((spec) => ({
      id: `app.${app.id}.wrapper.${spec.id}`,
      name: spec.name,
      status,
      report: spec.id,
    })),
    approvalPolicy: {
      defaultOfflineReports: "allowed",
      session: "approval_required",
      online: "approval_required",
      rawExport: "approval_required",
    },
    authoritativeBilling: false,
    outputCollection: "importedUsageEstimates",
  };
}

function buildCodexReviewToolDescriptor(agents) {
  return {
    name: CODEX_REVIEW_TOOL_CONTRACT.name,
    version: CODEX_REVIEW_TOOL_CONTRACT.version,
    displayName: "Codex Diff Review",
    description: "Run a governed read-only Codex review over a project worktree diff.",
    riskLevel: "low",
    riskTags: ["read_only", "read_project", "code_review", "local_agent"],
    requiresLocalDevice: true,
    inputSchema: CODEX_REVIEW_TOOL_CONTRACT.inputSchema,
    outputSchema: CODEX_REVIEW_TOOL_CONTRACT.outputSchema,
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      status: agent.status,
      mode: "diff-review",
    })),
    approvalPolicy: {
      defaultReadOnlyReview: "allowed",
      patchProposal: "approval_required",
      applyPatch: "approval_required",
    },
    authoritativeBilling: false,
    outputCollection: "codexReviewFindings",
  };
}

function buildCodexPlanToolDescriptor(agents) {
  return {
    name: CODEX_PLAN_TOOL_CONTRACT.name,
    version: CODEX_PLAN_TOOL_CONTRACT.version,
    displayName: "Codex Change Plan",
    description: "Run a governed read-only Codex planning pass over a project worktree.",
    riskLevel: "low",
    riskTags: ["read_only", "read_project", "planning", "local_agent"],
    requiresLocalDevice: true,
    inputSchema: CODEX_PLAN_TOOL_CONTRACT.inputSchema,
    outputSchema: CODEX_PLAN_TOOL_CONTRACT.outputSchema,
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      status: agent.status,
      mode: "change-plan",
    })),
    approvalPolicy: {
      defaultReadOnlyPlan: "allowed",
      patchProposal: "approval_required",
      applyPatch: "approval_required",
    },
    authoritativeBilling: false,
    outputCollection: "codexChangePlans",
  };
}

function buildCodexPatchProposalToolDescriptor(agents) {
  return {
    name: CODEX_PATCH_PROPOSAL_TOOL_CONTRACT.name,
    version: CODEX_PATCH_PROPOSAL_TOOL_CONTRACT.version,
    displayName: "Codex Patch Proposal",
    description: "Generate an immutable reviewable patch proposal artifact without mutating files.",
    riskLevel: "medium",
    riskTags: ["read_project", "patch_artifact", "code_generation", "local_agent"],
    requiresLocalDevice: true,
    inputSchema: CODEX_PATCH_PROPOSAL_TOOL_CONTRACT.inputSchema,
    outputSchema: CODEX_PATCH_PROPOSAL_TOOL_CONTRACT.outputSchema,
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      status: agent.status,
      mode: "patch-proposal",
    })),
    approvalPolicy: {
      defaultPatchProposal: "allowed",
      largeScope: "approval_required",
      applyPatch: "approval_required",
    },
    authoritativeBilling: false,
    outputCollection: "codexPatchProposals",
  };
}

function buildCodexApplyPatchToolDescriptor(agents) {
  return {
    name: CODEX_APPLY_PATCH_TOOL_CONTRACT.name,
    version: CODEX_APPLY_PATCH_TOOL_CONTRACT.version,
    displayName: "Codex Apply Patch",
    description: "Apply an approved immutable Codex patch proposal to the selected worktree.",
    riskLevel: "medium",
    riskTags: ["workspace_write", "patch_apply", "local_agent"],
    requiresLocalDevice: true,
    inputSchema: CODEX_APPLY_PATCH_TOOL_CONTRACT.inputSchema,
    outputSchema: CODEX_APPLY_PATCH_TOOL_CONTRACT.outputSchema,
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      status: agent.status,
      mode: "apply-patch",
    })),
    approvalPolicy: {
      defaultApplyPatch: "approval_required",
      requiresApprovedProposal: "required",
      requiresPatchHashMatch: "required",
    },
    authoritativeBilling: false,
    outputCollection: "codexPatchProposals",
  };
}

function buildClaudeReviewToolDescriptor(agents) {
  return {
    name: CLAUDE_REVIEW_TOOL_CONTRACT.name,
    version: CLAUDE_REVIEW_TOOL_CONTRACT.version,
    displayName: "Claude Diff Review",
    description: "Run a governed read-only Claude review over a project worktree diff.",
    riskLevel: "low",
    riskTags: ["read_only", "read_project", "code_review", "local_agent"],
    requiresLocalDevice: true,
    inputSchema: CLAUDE_REVIEW_TOOL_CONTRACT.inputSchema,
    outputSchema: CLAUDE_REVIEW_TOOL_CONTRACT.outputSchema,
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      status: agent.status,
      mode: "diff-review",
    })),
    approvalPolicy: {
      defaultReadOnlyReview: "allowed",
      patchProposal: "approval_required",
      applyPatch: "approval_required",
    },
    authoritativeBilling: false,
    outputCollection: "claudeReviewFindings",
  };
}

function validateCcusageReportInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, status: 400, body: { error: "invalid_input", message: "Tool input must be an object." } };
  }
  const allowed = new Set(["report", "source", "since", "until", "timezone", "offline", "projectId"]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) {
    return { ok: false, status: 400, body: { error: "unknown_field", fields: unknown } };
  }
  const report = String(input.report ?? "").trim();
  if (!CCUSAGE_REPORT_SPECS.some((spec) => spec.id === report)) {
    return { ok: false, status: 400, body: { error: "unsupported_report" } };
  }
  if (CCUSAGE_APPROVAL_REQUIRED_REPORTS.has(report)) {
    return { ok: false, status: 409, body: { error: "approval_required", reason: "Session-level ccusage reports require explicit approval." } };
  }
  const offline = input.offline === undefined ? true : input.offline;
  if (offline !== true) {
    return { ok: false, status: 409, body: { error: "approval_required", reason: "Online ccusage reports require explicit approval." } };
  }
  const source = input.source === undefined ? "all" : String(input.source);
  if (!["all", "codex", "claude"].includes(source)) {
    return { ok: false, status: 400, body: { error: "unsupported_source" } };
  }
  if ((source === "codex" && !report.startsWith("codex_")) || (source === "claude" && !report.startsWith("claude_"))) {
    return { ok: false, status: 400, body: { error: "source_report_mismatch" } };
  }
  const since = optionalDate(input.since, "since");
  if (!since.ok) return since;
  const until = optionalDate(input.until, "until");
  if (!until.ok) return until;
  const timezone = optionalTimezone(input.timezone);
  if (!timezone.ok) return timezone;
  return {
    ok: true,
    value: {
      report,
      source,
      since: since.value,
      until: until.value,
      timezone: timezone.value,
      offline: true,
      projectId: stringOrNull(input.projectId),
    },
  };
}

function optionalDate(value, field) {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }
  const text = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? { ok: true, value: text }
    : { ok: false, status: 400, body: { error: "invalid_date_filter", field } };
}

function optionalTimezone(value) {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }
  const text = String(value).trim();
  // No leading "-": aligns with the wrapper capability's `token` validator so a
  // timezone that would be dropped downstream is rejected here with a clear error
  // instead of silently ignored.
  return /^[A-Za-z0-9_+/:.][A-Za-z0-9_+\-/:.]{0,63}$/.test(text)
    ? { ok: true, value: text }
    : { ok: false, status: 400, body: { error: "invalid_timezone" } };
}

function validateReviewInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, status: 400, body: { error: "invalid_input", message: "Tool input must be an object." } };
  }
  const allowed = new Set(["projectId", "worktreeId", "instruction", "severityFloor"]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) {
    return { ok: false, status: 400, body: { error: "unknown_field", fields: unknown } };
  }
  const worktreeId = stringOrNull(input.worktreeId);
  if (!worktreeId) {
    return { ok: false, status: 400, body: { error: "worktree_required" } };
  }
  const severityFloor = input.severityFloor === undefined ? "low" : String(input.severityFloor);
  if (!["low", "medium", "high"].includes(severityFloor)) {
    return { ok: false, status: 400, body: { error: "invalid_severity_floor" } };
  }
  const instruction = input.instruction === undefined || input.instruction === null
    ? null
    : String(input.instruction).trim();
  if (instruction && instruction.length > 1200) {
    return { ok: false, status: 400, body: { error: "instruction_too_long", maxLength: 1200 } };
  }
  return {
    ok: true,
    value: {
      projectId: stringOrNull(input.projectId),
      worktreeId,
      instruction,
      severityFloor,
    },
  };
}

function validateMcpToolInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, status: 400, body: { error: "invalid_input", message: "Tool input must be an object." } };
  }
  const explicitArguments = input.toolArguments ?? input.arguments;
  let toolArguments = null;
  if (explicitArguments !== undefined) {
    if (!explicitArguments || typeof explicitArguments !== "object" || Array.isArray(explicitArguments)) {
      return { ok: false, status: 400, body: { error: "invalid_tool_arguments", message: "MCP tool arguments must be an object." } };
    }
    toolArguments = { ...explicitArguments };
  } else {
    toolArguments = Object.fromEntries(
      Object.entries(input).filter(([key]) => !MCP_TOOL_CONTROL_FIELDS.has(key)),
    );
  }
  const timeoutSeconds = optionalPositiveSeconds(input.timeoutSeconds);
  if (!timeoutSeconds.ok) return timeoutSeconds;
  return {
    ok: true,
    value: {
      projectId: stringOrNull(input.projectId),
      task: stringOrNull(input.task),
      timeoutSeconds: timeoutSeconds.value,
      toolArguments,
    },
  };
}

function validateCodexReviewInput(input = {}) {
  return validateReviewInput(input);
}

function validateCodexPlanInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, status: 400, body: { error: "invalid_input", message: "Tool input must be an object." } };
  }
  const allowed = new Set(["projectId", "worktreeId", "goal", "constraints", "severityFloor"]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) {
    return { ok: false, status: 400, body: { error: "unknown_field", fields: unknown } };
  }
  const projectId = stringOrNull(input.projectId);
  if (!projectId) {
    return { ok: false, status: 400, body: { error: "project_required" } };
  }
  const worktreeId = stringOrNull(input.worktreeId);
  if (!worktreeId) {
    return { ok: false, status: 400, body: { error: "worktree_required" } };
  }
  const goal = stringOrNull(input.goal);
  if (!goal) {
    return { ok: false, status: 400, body: { error: "goal_required" } };
  }
  if (goal.length > 2000) {
    return { ok: false, status: 400, body: { error: "goal_too_long", maxLength: 2000 } };
  }
  const constraints = stringOrNull(input.constraints);
  if (constraints && constraints.length > 2000) {
    return { ok: false, status: 400, body: { error: "constraints_too_long", maxLength: 2000 } };
  }
  const severityFloor = input.severityFloor === undefined ? "low" : String(input.severityFloor);
  if (!["low", "medium", "high"].includes(severityFloor)) {
    return { ok: false, status: 400, body: { error: "invalid_severity_floor" } };
  }
  return {
    ok: true,
    value: {
      projectId,
      worktreeId,
      goal,
      constraints,
      severityFloor,
    },
  };
}

function validateCodexPatchProposalInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, status: 400, body: { error: "invalid_input", message: "Tool input must be an object." } };
  }
  const allowed = new Set(["projectId", "worktreeId", "goal", "constraints", "basePlanId", "maxFiles"]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) {
    return { ok: false, status: 400, body: { error: "unknown_field", fields: unknown } };
  }
  const projectId = stringOrNull(input.projectId);
  if (!projectId) {
    return { ok: false, status: 400, body: { error: "project_required" } };
  }
  const worktreeId = stringOrNull(input.worktreeId);
  if (!worktreeId) {
    return { ok: false, status: 400, body: { error: "worktree_required" } };
  }
  const goal = stringOrNull(input.goal);
  if (!goal) {
    return { ok: false, status: 400, body: { error: "goal_required" } };
  }
  if (goal.length > 2000) {
    return { ok: false, status: 400, body: { error: "goal_too_long", maxLength: 2000 } };
  }
  const constraints = stringOrNull(input.constraints);
  if (constraints && constraints.length > 2000) {
    return { ok: false, status: 400, body: { error: "constraints_too_long", maxLength: 2000 } };
  }
  const basePlanId = stringOrNull(input.basePlanId);
  const maxFiles = input.maxFiles === undefined || input.maxFiles === null || input.maxFiles === ""
    ? 10
    : Number(input.maxFiles);
  if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > 25) {
    return { ok: false, status: 400, body: { error: "invalid_max_files", min: 1, max: 25 } };
  }
  return {
    ok: true,
    value: {
      projectId,
      worktreeId,
      goal,
      constraints,
      basePlanId,
      maxFiles,
    },
  };
}

function validateCodexApplyPatchInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, status: 400, body: { error: "invalid_input", message: "Tool input must be an object." } };
  }
  const allowed = new Set(["projectId", "worktreeId", "proposalId", "patchSha256", "approvalRequestId"]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) {
    return { ok: false, status: 400, body: { error: "unknown_field", fields: unknown } };
  }
  const projectId = stringOrNull(input.projectId);
  if (!projectId) {
    return { ok: false, status: 400, body: { error: "project_required" } };
  }
  const worktreeId = stringOrNull(input.worktreeId);
  if (!worktreeId) {
    return { ok: false, status: 400, body: { error: "worktree_required" } };
  }
  const proposalId = stringOrNull(input.proposalId);
  if (!proposalId) {
    return { ok: false, status: 400, body: { error: "proposal_required" } };
  }
  const patchSha256 = stringOrNull(input.patchSha256);
  if (!patchSha256 || !/^[a-f0-9]{64}$/i.test(patchSha256)) {
    return { ok: false, status: 400, body: { error: "patch_hash_required" } };
  }
  const approvalRequestId = stringOrNull(input.approvalRequestId);
  return {
    ok: true,
    value: {
      projectId,
      worktreeId,
      proposalId,
      patchSha256: patchSha256.toLowerCase(),
      approvalRequestId,
    },
  };
}

function validateClaudeReviewInput(input = {}) {
  return validateReviewInput(input);
}

function buildCcusageTask(value) {
  const filters = [
    value.since ? `since ${value.since}` : null,
    value.until ? `until ${value.until}` : null,
    value.timezone ? `timezone ${value.timezone}` : null,
  ].filter(Boolean);
  return filters.length
    ? `Generate ccusage ${value.report.replaceAll("_", " ")} report (${filters.join(", ")}).`
    : `Generate ccusage ${value.report.replaceAll("_", " ")} report.`;
}

function buildCodexReviewTask(value) {
  const suffix = value.instruction ? ` Instruction: ${value.instruction}` : "";
  return `Review the selected worktree diff with Codex. Severity floor: ${value.severityFloor}.${suffix}`;
}

function buildCodexPlanTask(value) {
  const suffix = value.constraints ? ` Constraints: ${value.constraints}` : "";
  return `Plan the requested change with Codex. Goal: ${value.goal}.${suffix}`;
}

function buildCodexPatchProposalTask(value) {
  const pieces = [
    `Goal: ${value.goal}.`,
    value.constraints ? `Constraints: ${value.constraints}.` : null,
    value.basePlanId ? `Base plan: ${value.basePlanId}.` : null,
    `Max files: ${value.maxFiles}.`,
  ].filter(Boolean);
  return `Generate a reviewable patch proposal with Codex. ${pieces.join(" ")}`;
}

function buildCodexApplyPatchTask(value) {
  return `Apply approved Codex patch proposal ${value.proposalId}. Patch SHA-256: ${value.patchSha256}.`;
}

function buildClaudeReviewTask(value) {
  const suffix = value.instruction ? ` Instruction: ${value.instruction}` : "";
  return `Review the selected worktree diff with Claude. Severity floor: ${value.severityFloor}.${suffix}`;
}

function optionalPositiveSeconds(value) {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return { ok: false, status: 400, body: { error: "invalid_timeout_seconds" } };
  }
  return { ok: true, value: Math.ceil(number) };
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function highestRiskLevel(values) {
  const order = new Map(["low", "medium", "high", "critical"].map((level, index) => [level, index]));
  let highest = null;
  for (const value of values ?? []) {
    const level = order.has(value) ? value : "medium";
    if (!highest || order.get(level) > order.get(highest)) highest = level;
  }
  return highest ?? "medium";
}

function findCodexPatchProposal(state, proposalId) {
  return (state.codexPatchProposals ?? []).find((item) => item.id === proposalId) ?? null;
}

function normalizePatchText(value) {
  const text = String(value ?? "").replace(/\r\n/g, "\n").trim();
  return text || null;
}

function createTempPatchFileForProposal(proposal, diff) {
  const dir = mkdtempSync(join(tmpdir(), "myagenttool-codex-apply-"));
  const safeProposalId = String(proposal.id ?? "proposal").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80);
  const patchFile = join(dir, `${safeProposalId}.patch`);
  writeFileSync(patchFile, `${diff}\n`, "utf8");
  return patchFile;
}

function sha256(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

function stringOrNull(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}
