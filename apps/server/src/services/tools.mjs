import {
  CCUSAGE_REPORT_SPECS,
  CCUSAGE_TOOL_CONTRACT,
} from "./ccusage-agent.mjs";
import { CCUSAGE_APPLICATION_ID } from "./ccusage-application.mjs";
import {
  CODEX_REVIEW_TOOL_CONTRACT,
  CODEX_EXEC_TOOL_CONTRACT,
  isCodexExecEnabled,
  isGovernedCodexExecAgent,
  isGovernedCodexReviewAgent,
} from "./codex-agent.mjs";
import {
  CLAUDE_REVIEW_TOOL_CONTRACT,
  isGovernedClaudeReviewAgent,
} from "./claude-agent.mjs";
import {
  CLAUDE_EXPLAIN_TOOL_CONTRACT,
  isGovernedClaudeExplainAgent,
} from "./claude-explain-agent.mjs";
import {
  CLAUDE_PROPOSE_TOOL_CONTRACT,
  isGovernedClaudeProposeAgent,
} from "./claude-propose-agent.mjs";
import {
  CLAUDE_APPLY_TOOL_CONTRACT,
  CLAUDE_APPLY_VERIFY_COMMANDS,
  isClaudeApplyEnabled,
  isGovernedClaudeApplyAgent,
} from "./claude-apply-agent.mjs";
import { CLAUDE_APPLICATION_ID } from "./claude-application.mjs";
import { LOCAL_TEAM_ID, teamOf } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

const CCUSAGE_APPROVAL_REQUIRED_REPORTS = new Set(["session"]);

export function createToolService({
  state,
  now,
  nextId,
  appendEvent,
  createInvocation,
  startInvocationIfAllowed,
  findApplication,
  findAgent,
  planApplicationWrapperInvocation,
  // Phase 4a apply gate: the dual-accept grant validator (APPROVAL_GRANTS.md).
  // Absent in unit tests that never exercise apply; the apply path fails closed
  // without it, exactly like the application service's approvalCheck.
  validateApprovalToken = null,
  persistStateSoon = () => {},
  store,
}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  function listTools() {
    return discoverTools();
  }

  function getTool(name) {
    return discoverTools().find((tool) => tool.name === name) ?? null;
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
    if (name === CLAUDE_REVIEW_TOOL_CONTRACT.name) {
      const application = resolveClaudeApp();
      return createReviewInvocation({
        input,
        actor,
        contract: CLAUDE_REVIEW_TOOL_CONTRACT,
        selectAgent: selectClaudeReviewAgent,
        buildTask: buildClaudeReviewTask,
        outputCollection: "claudeReviewFindings",
        agentLabel: "Claude",
        application: application ? { id: application.id, capability: `app.${application.id}.review.diff` } : null,
      });
    }
    if (name === CLAUDE_EXPLAIN_TOOL_CONTRACT.name) {
      const application = resolveClaudeApp();
      return createReviewInvocation({
        input,
        actor,
        contract: CLAUDE_EXPLAIN_TOOL_CONTRACT,
        validate: validateClaudeExplainInput,
        selectAgent: selectClaudeExplainAgent,
        buildTask: buildClaudeExplainTask,
        // Read-only analysis is not queryable evidence: the explanation rides the
        // invocation result and the generic Application-result lineage.
        outputCollection: "invocations",
        agentLabel: "Claude",
        application: application ? { id: application.id, capability: `app.${application.id}.explain.diff` } : null,
      });
    }
    if (name === CLAUDE_PROPOSE_TOOL_CONTRACT.name) {
      const application = resolveClaudeApp();
      return createReviewInvocation({
        input,
        actor,
        contract: CLAUDE_PROPOSE_TOOL_CONTRACT,
        validate: validateClaudeProposeInput,
        selectAgent: selectClaudeProposeAgent,
        buildTask: buildClaudeProposeTask,
        // The proposal is an immutable artifact on the invocation result; a later
        // approval-bound apply (Phase 4) consumes it by invocation id.
        outputCollection: "invocations",
        agentLabel: "Claude",
        application: application ? { id: application.id, capability: `app.${application.id}.propose.patch` } : null,
      });
    }
    if (name === CLAUDE_APPLY_TOOL_CONTRACT.name) {
      return authorizeApply(input, actor);
    }
    if (name === CODEX_EXEC_TOOL_CONTRACT.name) {
      return createExecInvocation({ input, actor });
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
    // local usage data. The real caller is recorded on the invocation
    // (requestedBy) AND stamped on the tool_invocation_created audit event (#884),
    // so this deliberate tenancy bypass is attributable, never anonymous.
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
        // Audit the real caller of this platform-context (actor:null) run so the
        // shared-asset tenancy bypass is attributable, not silent (#884).
        requestedBy: actor?.userId ?? null,
        platformContext: true,
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

  function createReviewInvocation({ input, actor, contract, selectAgent, buildTask, outputCollection, agentLabel, application = null, validate = validateReviewInput }) {
    const validation = validate(input);
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
    const agent = selectAgent();
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
          // Present only for propose.patch; the bridge injects it as --task.
          ...(value.task ? { task: value.task } : {}),
          ...(application ? {
            providerType: "application",
            applicationId: application.id,
            capability: application.capability,
            applicationAction: `tool:${contract.name}`,
          } : {}),
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

  // codex.exec (write-capable) — mirrors createReviewInvocation but requires a
  // task, requires a materialized worktree (writes never touch the base checkout),
  // carries approvalMode, and is gated behind the default-OFF feature flag.
  function createExecInvocation({ input, actor }) {
    if (!isCodexExecEnabled()) {
      return { status: 409, body: { error: "codex_exec_disabled", message: "Codex exec is disabled. Set MYAGENTTOOL_CODEX_EXEC_ENABLED=1 to enable it." } };
    }
    const validation = validateCodexExecInput(input);
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
    const agent = selectCodexExecAgent();
    if (!agent) {
      return { status: 409, body: { error: "agent_not_available", message: "No governed Codex exec agent is available." } };
    }
    if (agent.status === "disabled") {
      return { status: 409, body: { error: "agent_not_available", message: "The governed Codex exec agent is disabled.", agentId: agent.id } };
    }
    if (agent.health?.status === "unhealthy") {
      return { status: 409, body: { error: "agent_not_available", message: agent.health.message ?? "The governed Codex exec agent is unhealthy.", agentId: agent.id } };
    }
    if (agent.location?.type === "local_device" && state.device?.unlinkState === "unlinked") {
      return { status: 409, body: { error: "agent_not_available", message: "The local device is unlinked.", agentId: agent.id } };
    }
    const invocation = createInvocation(buildCodexExecTask(value), agent, {
      actor,
      requestedBy: actor?.userId,
      // approvalMode drives the Codex approval broker (codex.mjs). ask pauses on
      // every permission request; auto auto-approves low-risk requests while the
      // sensitive-pattern list still forces manual review.
      approvalMode: value.approvalMode,
      metadata: {
        tool: CODEX_EXEC_TOOL_CONTRACT.name,
        toolVersion: CODEX_EXEC_TOOL_CONTRACT.version,
        projectId,
        worktreeId: worktree.id,
        task: value.task,
        permissionMode: value.approvalMode,
      },
      timeoutSeconds: 600,
    });
    startInvocationIfAllowed(invocation, agent);
    appendEvent({
      invocationId: invocation.id,
      type: "tool_invocation_created",
      level: "info",
      message: `Tool ${CODEX_EXEC_TOOL_CONTRACT.name} created edit invocation.`,
      data: {
        tool: CODEX_EXEC_TOOL_CONTRACT.name,
        version: CODEX_EXEC_TOOL_CONTRACT.version,
        agentId: agent.id,
        worktreeId: worktree.id,
        approvalMode: value.approvalMode,
      },
    });
    return {
      status: 201,
      body: {
        tool: CODEX_EXEC_TOOL_CONTRACT.name,
        invocationId: invocation.id,
        agentId: agent.id,
        status: invocation.status,
        outputCollection: "codexExecChanges",
        invocation,
      },
    };
  }

  // The ccusage app backs the tool; when the app service isn't wired (review-only
  // harnesses) the tool is simply absent.
  function resolveCcusageApp() {
    return typeof findApplication === "function" ? findApplication(CCUSAGE_APPLICATION_ID) : null;
  }

  function resolveClaudeApp() {
    if (typeof findApplication !== "function") return null;
    const application = findApplication(CLAUDE_APPLICATION_ID);
    return application && ["registered", "active"].includes(application.status) ? application : null;
  }

  function discoverTools() {
    const ccusageApp = resolveCcusageApp();
    const ccusageAvailable = ccusageApp && ["registered", "active"].includes(ccusageApp.status);
    const codexReviewAgents = (state.agents ?? []).filter(isGovernedCodexReviewAgent);
    const claudeReviewAgents = (state.agents ?? []).filter(isGovernedClaudeReviewAgent);
    const claudeExplainAgents = (state.agents ?? []).filter(isGovernedClaudeExplainAgent);
    const claudeProposeAgents = (state.agents ?? []).filter(isGovernedClaudeProposeAgent);
    // Only surface the write-capable exec tool when the feature flag is on, so an
    // off-by-default deployment has no discoverable or invokable Codex write path.
    const codexExecAgents = isCodexExecEnabled() ? (state.agents ?? []).filter(isGovernedCodexExecAgent) : [];
    return [
      ...(ccusageAvailable ? [buildCcusageToolDescriptor(ccusageApp)] : []),
      ...(codexReviewAgents.length ? [buildCodexReviewToolDescriptor(codexReviewAgents)] : []),
      ...(claudeReviewAgents.length ? [buildClaudeReviewToolDescriptor(claudeReviewAgents, resolveClaudeApp())] : []),
      ...(claudeExplainAgents.length ? [buildClaudeExplainToolDescriptor(claudeExplainAgents, resolveClaudeApp())] : []),
      ...(claudeProposeAgents.length ? [buildClaudeProposeToolDescriptor(claudeProposeAgents, resolveClaudeApp())] : []),
      // Apply is server-side (no runner agent in 4a) and write-adjacent, so it is
      // discoverable ONLY when the default-OFF flag is set.
      ...(isClaudeApplyEnabled() ? [buildClaudeApplyToolDescriptor(resolveClaudeApp())] : []),
      ...(codexExecAgents.length ? [buildCodexExecToolDescriptor(codexExecAgents)] : []),
    ];
  }

  function selectCodexReviewAgent() {
    return (state.agents ?? []).find(isGovernedCodexReviewAgent) ?? null;
  }

  function selectCodexExecAgent() {
    return (state.agents ?? []).find(isGovernedCodexExecAgent) ?? null;
  }

  function selectClaudeReviewAgent() {
    return (state.agents ?? []).find(isGovernedClaudeReviewAgent) ?? null;
  }

  function selectClaudeExplainAgent() {
    return (state.agents ?? []).find(isGovernedClaudeExplainAgent) ?? null;
  }

  function selectClaudeProposeAgent() {
    return (state.agents ?? []).find(isGovernedClaudeProposeAgent) ?? null;
  }

  // Phase 4a apply GATE (#914): bind to a Phase 3 proposal, enforce tenancy, and
  // require a valid single-use approval grant. On success record an immutable,
  // non-executable authorization — NO file is written here. Fails closed without
  // the grant validator. A later slice (4b) executes an authorization.
  function authorizeApply(input, actor = null) {
    if (!isClaudeApplyEnabled()) {
      return { status: 403, body: { error: "apply_not_enabled", message: "The Claude apply capability is disabled." } };
    }
    const validation = validateClaudeApplyInput(input);
    if (!validation.ok) return { status: validation.status, body: validation.body };
    const value = validation.value;

    const project = resolveToolProjectId(value.projectId, actor);
    if (!project.ok) return { status: project.status, body: project.body };
    const projectId = project.value;
    const worktree = findToolWorktree(value.worktreeId, projectId);
    if (!worktree) return { status: 404, body: { error: "worktree_not_found" } };

    // Bind to the referenced proposal. An unknown or cross-project invocation is
    // proposal_not_found (no existence leak); a non-proposal or unfinished one is
    // proposal_not_applicable.
    const proposal = (state.invocations ?? []).find((item) => item.id === value.proposalInvocationId) ?? null;
    const proposalProjectId = proposal?.projectId ?? proposal?.options?.metadata?.projectId ?? null;
    if (!proposal || proposalProjectId !== projectId) {
      return { status: 404, body: { error: "proposal_not_found" } };
    }
    const meta = proposal.options?.metadata ?? {};
    const patch = proposal.result?.output?.patch;
    if (meta.tool !== CLAUDE_PROPOSE_TOOL_CONTRACT.name || proposal.status !== "succeeded" || typeof patch !== "string" || !patch.trim()) {
      return { status: 409, body: { error: "proposal_not_applicable", message: "The referenced invocation is not a completed claude.propose.patch proposal." } };
    }
    // Binding: apply only to the worktree the proposal targeted.
    if (meta.worktreeId && meta.worktreeId !== worktree.id) {
      return { status: 409, body: { error: "worktree_binding_mismatch", proposalWorktreeId: meta.worktreeId, requestedWorktreeId: worktree.id } };
    }

    // Require a runner BEFORE consuming the single-use grant: a grant that cannot
    // be executed must not be burned, and an authorization we can never run must not
    // be stranded (the old "4a-only, executable:false" path was a permanent dead
    // end — no UI or server route ever executed it). No runner → refuse; the
    // operator registers one and retries with a fresh grant.
    const runner = availableClaudeApplyRunner();
    if (!runner) {
      return { status: 409, body: { error: "agent_not_available", message: "No governed Claude apply runner is available." } };
    }

    // Approval: a valid, single-use grant for (apply_patch, proposalInvocationId).
    // Fail closed if the validator is not wired — a missing validator must never
    // authorize a write-adjacent action.
    if (typeof validateApprovalToken !== "function") {
      return { status: 409, body: { error: "approval_required", reason: "approval_validator_unavailable" } };
    }
    const approval = validateApprovalToken(value.approvalToken, {
      action: "apply_patch",
      targetId: value.proposalInvocationId,
      actor,
    });
    if (!approval.approved) {
      return { status: 409, body: { error: "approval_required", reason: approval.reason ?? "grant_required" } };
    }

    const files = Array.isArray(proposal.result?.output?.files) ? proposal.result.output.files : [];
    const invocation = createInvocation(`Apply an authorized Claude patch to worktree ${worktree.id}.`, runner, {
      actor,
      requestedBy: actor?.userId,
      metadata: {
        tool: CLAUDE_APPLY_TOOL_CONTRACT.name,
        toolVersion: CLAUDE_APPLY_TOOL_CONTRACT.version,
        projectId,
        worktreeId: worktree.id,
        claudeApplyAuthorizationId: null, // set below once the id is known
        proposalInvocationId: value.proposalInvocationId,
        // The bridge writes this to a temp file and passes --patch-file. Stripped
        // from public state (see sanitizeInvocationOptions).
        applyPatch: patch,
        // Optional allowlisted post-apply verification; the bridge injects
        // --verify <id> and the wrapper maps it to fixed argv independently.
        ...(value.verify ? { verifyCommandId: value.verify } : {}),
      },
      timeoutSeconds: 120,
    });
    const authorization = {
      id: typeof nextId === "function" ? nextId("cap_demo") : `cap_${(state.claudeApplyAuthorizations?.length ?? 0) + 1}`,
      source: "claude",
      tool: CLAUDE_APPLY_TOOL_CONTRACT.name,
      proposalInvocationId: value.proposalInvocationId,
      // Scope this artifact to the proposal's invocation in the public read model.
      invocationId: value.proposalInvocationId,
      executionInvocationId: invocation.id,
      projectId,
      // Team ownership stamped at creation so tenancy survives the project row
      // being deleted/archived later (a project lookup would then resolve null).
      ownerTeamId: authorizationOwnerTeam(projectId, actor),
      worktreeId: worktree.id,
      requestedBy: actor?.userId ?? null,
      grantId: approval.grantId ?? null,
      summary: stringOrNull(proposal.result?.output?.summary),
      patch,
      files,
      verifyCommandId: value.verify ?? null,
      status: "applying",
      applied: false,
      createdAt: now(),
    };
    runTx(() => {
      invocation.options.metadata.claudeApplyAuthorizationId = authorization.id;
      state.claudeApplyAuthorizations = state.claudeApplyAuthorizations ?? [];
      state.claudeApplyAuthorizations.unshift(authorization);
      pruneClaudeApplyAuthorizations();
      startInvocationIfAllowed(invocation, runner);
      appendEvent({
        invocationId: value.proposalInvocationId,
        type: "claude_apply_authorized",
        level: "info",
        message: `Authorized a Claude patch apply for proposal ${value.proposalInvocationId} (grant ${approval.grantId ?? "legacy"}).`,
        data: {
          claudeApplyAuthorizationId: authorization.id,
          proposalInvocationId: value.proposalInvocationId,
          worktreeId: worktree.id,
          grantId: approval.grantId ?? null,
        },
      });
    });
    return {
      status: 201,
      body: {
        tool: CLAUDE_APPLY_TOOL_CONTRACT.name,
        authorizationId: authorization.id,
        status: "applying",
        applied: false,
        executionInvocationId: invocation.id,
        agentId: runner.id,
        proposalInvocationId: value.proposalInvocationId,
        worktreeId: worktree.id,
        files,
      },
    };
  }

  // Owning team of an apply authorization: the project's team when known, else the
  // actor's, else the local team. Stamped once so rollback tenancy never depends on
  // the project row still existing.
  function authorizationOwnerTeam(projectId, actor) {
    const project = projectId ? (state.projects ?? []).find((item) => item.id === projectId) : null;
    return (project ? teamOf(project) : null) ?? actor?.teamId ?? LOCAL_TEAM_ID;
  }

  // Status-aware cap: never evict an in-flight authorization (applying/rolling_back)
  // — it is the only server-held copy of the patch and the only durable write
  // record — and keep the most recent MAX terminal rows. Evicting an in-flight row
  // would silently drop its git-apply result and strand the write.
  function pruneClaudeApplyAuthorizations() {
    const MAX_TERMINAL = 500;
    let terminalKept = 0;
    // Preserve newest-first order (rows are unshifted); keep every in-flight row and
    // the newest MAX_TERMINAL terminal rows.
    state.claudeApplyAuthorizations = (state.claudeApplyAuthorizations ?? []).filter((row) => {
      if (row.status === "applying" || row.status === "rolling_back") return true;
      if (terminalKept < MAX_TERMINAL) { terminalKept += 1; return true; }
      return false;
    });
  }

  // A governed apply runner that can actually execute now: registered, enabled,
  // healthy, and on a linked device.
  function availableClaudeApplyRunner() {
    const runner = (state.agents ?? []).find(isGovernedClaudeApplyAgent) ?? null;
    if (!runner || runner.status === "disabled") return null;
    if (runner.health?.status === "unhealthy") return null;
    if (runner.location?.type === "local_device" && state.device?.unlinkState === "unlinked") return null;
    return runner;
  }

  // Governed ROLLBACK of an applied authorization (#914 follow-up): the recorded
  // rollback guidance becomes an executable action. Same trust shape as the apply:
  // tenancy-scoped, bound to the authorization artifact, and gated on a fresh
  // single-use grant for (rollback_patch, authorizationId) — undoing a write is a
  // write. The runner re-applies the SAME server-held patch with --reverse.
  function rollbackClaudeApply(authorizationId, body = {}, actor = null) {
    if (!isClaudeApplyEnabled()) {
      return { status: 403, body: { error: "apply_not_enabled", message: "The Claude apply capability is disabled." } };
    }
    const authorization = (state.claudeApplyAuthorizations ?? []).find((item) => item.id === String(authorizationId ?? "")) ?? null;
    // Tenancy off the STAMPED owning team, not a project lookup: a scoped actor
    // must match the authorization's team, and an authorization whose team is
    // unknown reads as not-found. (The old project-lookup guard silently passed a
    // foreign actor once the project row was deleted, since `project` went null.)
    const projectRow = authorization?.projectId ? (state.projects ?? []).find((item) => item.id === authorization.projectId) ?? null : null;
    const ownerTeam = authorization?.ownerTeamId ?? (projectRow ? teamOf(projectRow) : null);
    if (!authorization || (actor?.teamId && ownerTeam !== actor.teamId)) {
      return { status: 404, body: { error: "authorization_not_found" } };
    }
    if (authorization.status !== "applied") {
      return { status: 409, body: { error: "authorization_not_applied", status: authorization.status, message: "Only an applied authorization can be rolled back." } };
    }
    // Re-validate the bound worktree still exists. Without this, createInvocation
    // silently substitutes the project's default worktree for a dangling id and the
    // --reverse could git-revert in the WRONG tree (e.g. the main checkout).
    const worktree = findToolWorktree(authorization.worktreeId, authorization.projectId);
    if (!worktree) {
      return { status: 409, body: { error: "worktree_not_found", message: "The bound worktree no longer exists; the patch cannot be safely rolled back." } };
    }
    const token = stringOrNull(body?.approvalToken);
    if (!token) {
      return { status: 409, body: { error: "approval_required", reason: "missing_token" } };
    }
    if (typeof validateApprovalToken !== "function") {
      return { status: 409, body: { error: "approval_required", reason: "approval_validator_unavailable" } };
    }
    // Check the runner BEFORE consuming the single-use grant — a 409 here must not
    // burn the grant (the web UI mints-then-calls in one click).
    const runner = availableClaudeApplyRunner();
    if (!runner) {
      return { status: 409, body: { error: "agent_not_available", message: "No governed Claude apply runner is available to execute the rollback." } };
    }
    const approval = validateApprovalToken(token, { action: "rollback_patch", targetId: authorization.id, actor });
    if (!approval.approved) {
      return { status: 409, body: { error: "approval_required", reason: approval.reason ?? "grant_required" } };
    }
    const invocation = createInvocation(`Roll back an applied Claude patch on worktree ${authorization.worktreeId}.`, runner, {
      actor,
      requestedBy: actor?.userId,
      metadata: {
        tool: CLAUDE_APPLY_TOOL_CONTRACT.name,
        toolVersion: CLAUDE_APPLY_TOOL_CONTRACT.version,
        projectId: authorization.projectId,
        worktreeId: authorization.worktreeId,
        claudeApplyAuthorizationId: authorization.id,
        // The bridge injects --reverse for this flag; the runner then refuses a
        // reverse that no longer checks cleanly (worktree moved on).
        claudeApplyRollback: true,
        applyPatch: authorization.patch,
      },
      timeoutSeconds: 120,
    });
    runTx(() => {
      startInvocationIfAllowed(invocation, runner);
      authorization.status = "rolling_back";
      authorization.rollbackInvocationId = invocation.id;
      appendEvent({
        invocationId: invocation.id,
        type: "claude_rollback_authorized",
        level: "warn",
        message: `Authorized rolling back Claude patch authorization ${authorization.id} (grant ${approval.grantId ?? "legacy"}).`,
        data: {
          claudeApplyAuthorizationId: authorization.id,
          proposalInvocationId: authorization.proposalInvocationId,
          worktreeId: authorization.worktreeId,
          grantId: approval.grantId ?? null,
        },
      });
    });
    return {
      status: 202,
      body: {
        authorizationId: authorization.id,
        status: "rolling_back",
        rollbackInvocationId: invocation.id,
        agentId: runner.id,
        worktreeId: authorization.worktreeId,
      },
    };
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
    rollbackClaudeApply,
    validateCodexReviewInput,
    validateClaudeReviewInput,
    validateCodexExecInput,
    validateCcusageReportInput,
  };
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

function buildClaudeReviewToolDescriptor(agents, application = null) {
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
    application: application ? { id: application.id, capability: `app.${application.id}.review.diff` } : null,
  };
}

function buildClaudeExplainToolDescriptor(agents, application = null) {
  return {
    name: CLAUDE_EXPLAIN_TOOL_CONTRACT.name,
    version: CLAUDE_EXPLAIN_TOOL_CONTRACT.version,
    displayName: "Claude Diff Explain",
    description: "Run a governed read-only Claude explanation over a project worktree diff.",
    riskLevel: "low",
    riskTags: ["read_only", "read_project", "code_analysis", "local_agent"],
    requiresLocalDevice: true,
    inputSchema: CLAUDE_EXPLAIN_TOOL_CONTRACT.inputSchema,
    outputSchema: CLAUDE_EXPLAIN_TOOL_CONTRACT.outputSchema,
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      status: agent.status,
      mode: "diff-explain",
    })),
    approvalPolicy: {
      defaultReadOnlyAnalysis: "allowed",
    },
    authoritativeBilling: false,
    outputCollection: "invocations",
    application: application ? { id: application.id, capability: `app.${application.id}.explain.diff` } : null,
  };
}

function buildClaudeProposeToolDescriptor(agents, application = null) {
  return {
    name: CLAUDE_PROPOSE_TOOL_CONTRACT.name,
    version: CLAUDE_PROPOSE_TOOL_CONTRACT.version,
    displayName: "Claude Patch Proposal",
    description: "Run a governed Claude session that proposes a change as an immutable patch artifact — never applied.",
    riskLevel: "low",
    riskTags: ["read_only", "read_project", "code_proposal", "local_agent"],
    requiresLocalDevice: true,
    inputSchema: CLAUDE_PROPOSE_TOOL_CONTRACT.inputSchema,
    outputSchema: CLAUDE_PROPOSE_TOOL_CONTRACT.outputSchema,
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      status: agent.status,
      mode: "propose-patch",
    })),
    approvalPolicy: {
      // Generating a proposal is read-only. Applying it is the separate,
      // approval-bound Phase 4 path.
      proposePatch: "allowed",
      applyPatch: "approval_required",
    },
    authoritativeBilling: false,
    outputCollection: "invocations",
    application: application ? { id: application.id, capability: `app.${application.id}.propose.patch` } : null,
  };
}

function buildClaudeApplyToolDescriptor(application = null) {
  return {
    name: CLAUDE_APPLY_TOOL_CONTRACT.name,
    version: CLAUDE_APPLY_TOOL_CONTRACT.version,
    displayName: "Claude Patch Apply",
    description: "Authorize applying a reviewed Claude patch proposal to its bound worktree. Requires a single-use approval grant. Phase 4a records the authorization only; execution is a follow-up.",
    riskLevel: "high",
    riskTags: ["write_worktree", "code_change", "local_agent", "approval_required"],
    requiresLocalDevice: true,
    inputSchema: CLAUDE_APPLY_TOOL_CONTRACT.inputSchema,
    outputSchema: CLAUDE_APPLY_TOOL_CONTRACT.outputSchema,
    // No runner agent in 4a: the gate is server-side. 4b adds the bridge apply runner.
    agents: [],
    approvalPolicy: {
      applyPatch: "approval_required",
      executable: false,
    },
    authoritativeBilling: false,
    outputCollection: "claudeApplyAuthorizations",
    application: application ? { id: application.id, capability: `app.${application.id}.apply.patch` } : null,
  };
}

function buildCodexExecToolDescriptor(agents) {
  return {
    name: CODEX_EXEC_TOOL_CONTRACT.name,
    version: CODEX_EXEC_TOOL_CONTRACT.version,
    displayName: "Codex Exec",
    description: "Run a governed Codex edit session in a project worktree and return the resulting changeset.",
    riskLevel: "high",
    riskTags: ["write_worktree", "code_change", "local_agent"],
    requiresLocalDevice: true,
    inputSchema: CODEX_EXEC_TOOL_CONTRACT.inputSchema,
    outputSchema: CODEX_EXEC_TOOL_CONTRACT.outputSchema,
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      status: agent.status,
      mode: "edit",
    })),
    approvalPolicy: {
      // Writes always go through the approval broker; the sensitive-pattern list
      // forces manual review even in auto mode. Promotion is separately human-gated.
      edit: "approval_required",
      promote: "approval_required",
    },
    authoritativeBilling: false,
    outputCollection: "codexExecChanges",
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

function validateCodexReviewInput(input = {}) {
  return validateReviewInput(input);
}

function validateCodexExecInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, status: 400, body: { error: "invalid_input", message: "Tool input must be an object." } };
  }
  const allowed = new Set(["projectId", "worktreeId", "task", "approvalMode"]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) {
    return { ok: false, status: 400, body: { error: "unknown_field", fields: unknown } };
  }
  const worktreeId = stringOrNull(input.worktreeId);
  if (!worktreeId) {
    return { ok: false, status: 400, body: { error: "worktree_required" } };
  }
  const task = input.task === undefined || input.task === null ? "" : String(input.task).trim();
  if (!task) {
    return { ok: false, status: 400, body: { error: "task_required" } };
  }
  if (task.length > 4000) {
    return { ok: false, status: 400, body: { error: "task_too_long", maxLength: 4000 } };
  }
  const approvalMode = input.approvalMode === undefined ? "ask" : String(input.approvalMode);
  // codex.exec offers ask + auto only. `full` is intentionally NOT offered
  // (design §11.1): for exec, `auto` already auto-approves every non-sensitive
  // request while forcing manual review on the sensitive-pattern list — so a
  // "full that keeps the fallback" would be identical to `auto`, and a "full that
  // bypasses the fallback" would auto-approve rm -rf / secret access on an
  // autonomous code-writer. Bypassing the guardrail must be a separate, explicit
  // danger flag, never a routine approvalMode.
  if (approvalMode === "full") {
    return { ok: false, status: 400, body: { error: "invalid_approval_mode", message: "codex.exec does not offer approvalMode \"full\"; use \"auto\" (auto-approves non-sensitive requests, forces manual review on sensitive ones)." } };
  }
  if (!["ask", "auto"].includes(approvalMode)) {
    return { ok: false, status: 400, body: { error: "invalid_approval_mode" } };
  }
  return {
    ok: true,
    value: {
      projectId: stringOrNull(input.projectId),
      worktreeId,
      task,
      approvalMode,
    },
  };
}

function validateClaudeReviewInput(input = {}) {
  return validateReviewInput(input);
}

// Explain takes no severityFloor (it does not judge), so it cannot reuse the
// review validator — a stray severityFloor must be a hard unknown_field, matching
// the contract's additionalProperties:false.
function validateClaudeExplainInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, status: 400, body: { error: "invalid_input", message: "Tool input must be an object." } };
  }
  const allowed = new Set(["projectId", "worktreeId", "instruction"]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) {
    return { ok: false, status: 400, body: { error: "unknown_field", fields: unknown } };
  }
  const worktreeId = stringOrNull(input.worktreeId);
  if (!worktreeId) {
    return { ok: false, status: 400, body: { error: "worktree_required" } };
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
    },
  };
}

// Propose requires a task (the change to propose) and an optional instruction; it
// takes no severityFloor. A stray field is a hard unknown_field.
function validateClaudeProposeInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, status: 400, body: { error: "invalid_input", message: "Tool input must be an object." } };
  }
  const allowed = new Set(["projectId", "worktreeId", "task", "instruction"]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) {
    return { ok: false, status: 400, body: { error: "unknown_field", fields: unknown } };
  }
  const worktreeId = stringOrNull(input.worktreeId);
  if (!worktreeId) {
    return { ok: false, status: 400, body: { error: "worktree_required" } };
  }
  const task = input.task === undefined || input.task === null ? "" : String(input.task).trim();
  if (!task) {
    return { ok: false, status: 400, body: { error: "task_required" } };
  }
  if (task.length > 4000) {
    return { ok: false, status: 400, body: { error: "task_too_long", maxLength: 4000 } };
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
      task,
      instruction,
    },
  };
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

function buildClaudeReviewTask(value) {
  const suffix = value.instruction ? ` Instruction: ${value.instruction}` : "";
  return `Review the selected worktree diff with Claude. Severity floor: ${value.severityFloor}.${suffix}`;
}

function buildClaudeExplainTask(value) {
  const suffix = value.instruction ? ` Instruction: ${value.instruction}` : "";
  return `Explain the selected worktree diff with Claude.${suffix}`;
}

function buildClaudeProposeTask(value) {
  const suffix = value.instruction ? ` Instruction: ${value.instruction}` : "";
  return `Propose a patch with Claude for: ${value.task}.${suffix}`;
}

// Apply requires the bound proposal id and a grant token; it produces no task.
function validateClaudeApplyInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, status: 400, body: { error: "invalid_input", message: "Tool input must be an object." } };
  }
  const allowed = new Set(["projectId", "worktreeId", "proposalInvocationId", "approvalToken", "verify"]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) {
    return { ok: false, status: 400, body: { error: "unknown_field", fields: unknown } };
  }
  const worktreeId = stringOrNull(input.worktreeId);
  if (!worktreeId) {
    return { ok: false, status: 400, body: { error: "worktree_required" } };
  }
  const proposalInvocationId = stringOrNull(input.proposalInvocationId);
  if (!proposalInvocationId) {
    return { ok: false, status: 400, body: { error: "proposal_required" } };
  }
  // Post-apply verification: an allowlisted command ID only, never argv.
  const verify = stringOrNull(input.verify);
  if (verify && !CLAUDE_APPLY_VERIFY_COMMANDS.includes(verify)) {
    return { ok: false, status: 400, body: { error: "invalid_verify_command", allowed: CLAUDE_APPLY_VERIFY_COMMANDS } };
  }
  const approvalToken = stringOrNull(input.approvalToken);
  if (!approvalToken) {
    return { ok: false, status: 409, body: { error: "approval_required", reason: "missing_token" } };
  }
  return { ok: true, value: { projectId: stringOrNull(input.projectId), worktreeId, proposalInvocationId, approvalToken, verify } };
}

function buildCodexExecTask(value) {
  return `Make the requested code changes in the selected worktree with Codex. Task: ${value.task}`;
}


function stringOrNull(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}
