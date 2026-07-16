import { LOCAL_TEAM_ID, teamOf } from "../runtime/auth.mjs";
import { createRefusalRuntime } from "../runtime/refusal-log.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { isCodexCliCommand } from "./agents.mjs";

export function createCodexService({
  state,
  now,
  nextId,
  appendEvent,
  refuse: injectedRefuse,
  currentProject,
  findInvocation,
  persistStateSoon,
  uniqueStrings,
  worktreeForProject,
  store,
}) {
  // Shared writer in production; a state-bound fallback for direct construction.
  const refuse = injectedRefuse ?? createRefusalRuntime({ state, now, nextId, appendEvent }).refuse;
  // #1001 Phase A: durable codex session/evidence/review writes commit through
  // the Store's unit of work (falls back to the debounce where no store injected).
  const runTx = makeRunTx({ store, persistStateSoon });
  function normalizeCodexSessionMode(value, agent) {
    if (!isCodexCliCommand(agent?.adapter?.command)) {
      return "not_applicable";
    }
    return value === "continue_last" ? "continue_last" : "new";
  }

  function normalizeCodexWorkspacePolicy(value, agent) {
    if (!isCodexCliCommand(agent?.adapter?.command)) {
      return "not_applicable";
    }
    return ["current_repo", "new_worktree", "existing_worktree"].includes(value) ? value : "current_repo";
  }

  function createManagedCodexWorkspace({ invocationId, agent, workspacePolicy }) {
    if (!isCodexCliCommand(agent?.adapter?.command)) {
      return null;
    }
    const createdAt = now();
    const project = currentProject();
    const projectWorktree = worktreeForProject(project?.id);
    const workspace = {
      id: nextId("cdx_ws"),
      invocationId,
      policy: workspacePolicy,
      repoPath: project?.path ?? (agent.adapter?.workingDirectoryPolicy === "bridge_default" ? "bridge_default" : agent.adapter?.workingDirectory ?? null),
      worktreePath: projectWorktree?.worktreePath ?? (workspacePolicy === "current_repo" ? null : "pending_explicit_worktree"),
      baseBranch: projectWorktree?.baseBranch ?? null,
      branchName: projectWorktree?.branchName ?? null,
      dirtyState: "unknown",
      lastCommit: null,
      status: projectWorktree ? "registered_worktree" : workspacePolicy === "new_worktree" ? "pending_explicit_creation" : "registered",
      projectId: project?.id ?? null,
      worktreeId: projectWorktree?.id ?? null,
      sessionIds: [],
      createdAt,
      lastSeenAt: createdAt,
    };
    runTx(() => state.codexWorkspaces.unshift(workspace));
    return workspace;
  }

  function createManagedCodexSession({ invocationId, agent, codexSessionMode, workspace, actor = null }) {
    if (!isCodexCliCommand(agent?.adapter?.command)) {
      return null;
    }
    const createdAt = now();
    const project = currentProject();
    const session = {
      id: nextId("cdx_sess"),
      codexSessionId: null,
      codexThreadId: null,
      invocationId,
      userId: actor?.userId ?? "usr_local",
      deviceId: agent.location?.deviceId ?? null,
      repoPath: project?.path ?? (agent.adapter?.workingDirectoryPolicy === "bridge_default" ? "bridge_default" : null),
      workspaceId: workspace?.id ?? null,
      agentId: agent.id,
      sessionMode: codexSessionMode,
      startedAt: createdAt,
      lastSeenAt: createdAt,
      status: "registered",
      policyProfile: "codex_native_controls",
      retentionProfile: "local_demo_retention",
      evidenceIds: [],
    };
    runTx(() => {
      state.codexSessions.unshift(session);
      if (workspace) {
        workspace.sessionIds = uniqueStrings([...workspace.sessionIds, session.id]);
      }
    });
    return session;
  }

  function codexSessionForInvocation(invocationId) {
    return state.codexSessions.find((session) => session.invocationId === invocationId) ?? null;
  }

  // True resume (#163): find the provider session id to continue for a new
  // "continue_last" run. codexSessions is newest-first (unshift), so the first
  // match is the most recent PRIOR session that actually captured a provider
  // session id — scoped to the same repo + user so "continue" never crosses
  // projects or tenants. Returns null when nothing resumable exists, letting
  // the bridge fall back to `--last`.
  function resolveResumeCodexSessionId({ repoPath = null, userId = null, excludeSessionId = null, invocationId = null } = {}) {
    // Specific target: the user clicked a particular session to continue. Resume
    // THAT session's captured provider id — but only if it belongs to the same
    // user (tenancy), so a resume can never continue another user's session.
    if (invocationId) {
      const target = state.codexSessions.find((session) => session.invocationId === invocationId);
      if (!target?.codexSessionId) return null;
      if (userId && target.userId !== userId) return null;
      return target.codexSessionId;
    }
    // Default: continue the newest prior session that captured a provider id,
    // scoped to the same repo + user.
    const match = state.codexSessions.find((session) =>
      session.id !== excludeSessionId
      && session.codexSessionId
      && (userId ? session.userId === userId : true)
      && (repoPath ? session.repoPath === repoPath : true));
    return match?.codexSessionId ?? null;
  }

  function updateCodexSessionFromEvent(record) {
    const session = codexSessionForInvocation(record.invocationId);
    if (!session) {
      return;
    }
    runTx(() => {
      session.lastSeenAt = record.createdAt;
      const workspace = codexWorkspaceForSession(session);
      if (workspace) {
        workspace.lastSeenAt = record.createdAt;
      }
      if (record.type === "execution_preview" && record.data) {
        updateCodexWorkspaceFromPreview(workspace, record.data);
      }
      if (record.type === "agent_output" && record.data?.source === "codex_jsonl") {
        session.status = "observing";
        if (record.data.threadId) {
          session.codexThreadId = record.data.threadId;
        }
        if (record.data.sessionId) {
          session.codexSessionId = record.data.sessionId;
        }
      }
    });
  }

  function codexWorkspaceForSession(session) {
    if (!session?.workspaceId) {
      return null;
    }
    return state.codexWorkspaces.find((workspace) => workspace.id === session.workspaceId) ?? null;
  }

  function updateCodexWorkspaceFromPreview(workspace, data) {
    if (!workspace) {
      return;
    }
    runTx(() => {
      workspace.repoPath = data.workspace?.repoPath ?? data.cwd ?? workspace.repoPath;
      workspace.worktreePath = data.workspace?.worktreePath ?? (workspace.policy === "current_repo" ? null : workspace.worktreePath);
      workspace.baseBranch = data.workspace?.baseBranch ?? workspace.baseBranch;
      workspace.branchName = data.workspace?.branchName ?? workspace.branchName;
      workspace.dirtyState = data.workspace?.dirtyState ?? workspace.dirtyState;
      workspace.lastCommit = data.workspace?.lastCommit ?? workspace.lastCommit;
      workspace.status = data.workspace?.status ?? (workspace.policy === "new_worktree" ? "pending_explicit_creation" : "observed");
    });
  }

  function createCodexEvidenceRecord(record) {
    if (record.type !== "agent_output" || record.data?.source !== "codex_jsonl") {
      return null;
    }
    const session = codexSessionForInvocation(record.invocationId);
    const evidence = {
      id: nextId("cdx_ev"),
      invocationId: record.invocationId,
      codexSessionRegistryId: session?.id ?? null,
      sourceEventId: record.id,
      source: "codex_jsonl",
      eventType: record.data.eventType ?? "unknown",
      itemType: record.data.itemType ?? null,
      threadId: record.data.threadId ?? null,
      sessionId: record.data.sessionId ?? null,
      summary: record.message,
      commandSummary: record.data.commandSummary ?? null,
      fileChangeSummary: record.data.fileChangeSummary ?? null,
      fileChangePath: record.data.fileChangePath ?? null,
      fileChangeAction: record.data.fileChangeAction ?? null,
      diffPreview: record.data.diffPreview ?? null,
      changeRisk: record.data.changeRisk ?? null,
      redactionState: "summary_only",
      createdAt: record.createdAt,
    };
    runTx(() => {
      state.codexEvidenceRecords.unshift(evidence);
      if (session) {
        session.evidenceIds = uniqueStrings([...session.evidenceIds, evidence.id]);
      }
    });
    return evidence;
  }

  // True when the evidence's invocation belongs to a project the actor's team
  // does not own. A null actor (unscoped/local dev) never treats rows as foreign.
  function isForeignEvidence(evidence, actor) {
    if (!actor) return false;
    const invocation = (state.invocations ?? []).find((item) => item.id === evidence?.invocationId);
    const projectId = invocation?.projectId ?? invocation?.input?.metadata?.projectId ?? null;
    const project = projectId ? (state.projects ?? []).find((p) => p.id === projectId) : null;
    return Boolean(project) && teamOf(project) !== actor.teamId;
  }

  function createCodexChangeReview(body, actor = null) {
    const evidenceId = String(body.evidenceId ?? "").trim();
    const evidence = state.codexEvidenceRecords.find((item) => item.id === evidenceId);
    // A foreign-team evidence record is treated as if it doesn't exist, so the
    // response is byte-identical to an unknown evidenceId (no existence leak,
    // and no cross-team write). Same message → same 400 the route already emits.
    if (!evidence || isForeignEvidence(evidence, actor)) {
      throw new Error("evidenceId must reference a Codex evidence record.");
    }
    if (!evidence.fileChangeSummary) {
      throw new Error("evidenceId must reference a file-change evidence record.");
    }
    const decision = normalizeCodexChangeDecision(body.decision);
    const comment = String(body.comment ?? "").trim();
    if (decision === "feedback" && !comment) {
      throw new Error("comment is required when sending feedback.");
    }
    const session = evidence.codexSessionRegistryId
      ? state.codexSessions.find((item) => item.id === evidence.codexSessionRegistryId)
      : codexSessionForInvocation(evidence.invocationId);
    const createdAt = now();
    const review = {
      id: nextId("cdx_change_review"),
      evidenceId: evidence.id,
      invocationId: evidence.invocationId,
      codexSessionRegistryId: evidence.codexSessionRegistryId ?? session?.id ?? null,
      fileChangeSummary: evidence.fileChangeSummary,
      fileChangePath: evidence.fileChangePath,
      fileChangeAction: evidence.fileChangeAction,
      diffPreview: evidence.diffPreview,
      changeRisk: evidence.changeRisk ?? "unknown",
      decision,
      comment: comment.length <= 1000 ? comment : `${comment.slice(0, 997)}...`,
      followUpPrompt: decision === "feedback" ? codexChangeFollowUpPrompt(evidence, comment) : null,
      reviewedBy: actor?.userId ?? "usr_local",
      auditState: "recorded",
      createdAt,
    };
    runTx(() => {
      state.codexChangeReviews.unshift(review);
      appendEvent({
        invocationId: evidence.invocationId,
        type: decision === "feedback" ? "codex_change_feedback_requested" : "codex_change_reviewed",
        level: decision === "rejected" ? "warn" : "info",
        message: codexChangeReviewMessage(review),
        data: {
          codexChangeReviewId: review.id,
          evidenceId: evidence.id,
          decision,
          fileChangeSummary: evidence.fileChangeSummary,
          followUpPrompt: review.followUpPrompt,
        },
      });
    });
    return review;
  }

  function normalizeCodexChangeDecision(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    return ["approved", "rejected", "feedback"].includes(normalized) ? normalized : "feedback";
  }

  function codexChangeReviewMessage(review) {
    if (review.decision === "approved") {
      return `Codex change approved: ${review.fileChangeSummary}.`;
    }
    if (review.decision === "rejected") {
      return `Codex change rejected: ${review.fileChangeSummary}.`;
    }
    return `Codex change feedback recorded for ${review.fileChangeSummary}.`;
  }

  function codexChangeFollowUpPrompt(evidence, comment) {
    const trimmed = String(comment ?? "").replace(/\s+/g, " ").trim();
    const boundedComment = trimmed.length <= 500 ? trimmed : `${trimmed.slice(0, 497)}...`;
    return [
      "Follow up on reviewed Codex change.",
      `Evidence: ${evidence.id}`,
      `Change: ${evidence.fileChangeSummary}`,
      `Reviewer comment: ${boundedComment}`,
    ].join("\n");
  }

  function closeCodexSession(invocation, status) {
    const session = codexSessionForInvocation(invocation.id);
    if (!session) {
      return;
    }
    runTx(() => {
      session.lastSeenAt = now();
      session.status = status === "succeeded" ? "completed" : status === "cancelled" ? "cancelled" : "failed";
    });
  }

  function recordCodexHookEvent(body) {
    const invocationId = String(body.invocationId ?? "");
    if (!invocationId) {
      throw new Error("invocationId is required.");
    }
    const invocation = findInvocation(invocationId);
    if (!invocation) {
      throw new Error("invocation was not found.");
    }
    const eventName = normalizeCodexHookEventName(body.eventName);
    const policy = evaluateCodexHookPolicy(eventName, body);
    const session = codexSessionForInvocation(invocationId);
    return runTx(() => {
      const record = {
        id: nextId("cdx_hook"),
        invocationId,
        codexSessionRegistryId: session?.id ?? null,
        eventName,
        toolName: body.toolName ? String(body.toolName) : null,
        policyDecision: policy.decision,
        policyReason: policy.reason,
        summary: String(body.summary ?? policy.summary),
        redactionState: "summary_only",
        createdAt: now(),
      };
      state.codexHookEvents.unshift(record);
      if (session) {
        session.lastSeenAt = record.createdAt;
      }
      const brokerRequest = eventName === "PermissionRequest"
        ? createCodexApprovalBrokerRequest({ invocation, session, hookEvent: record, body, policy })
        : null;
      appendEvent({
        invocationId,
        type: "codex_hook_event",
        level: policy.decision === "blocked" ? "warn" : "info",
        message: `${eventName}: ${policy.reason}`,
        data: {
          hookEventId: record.id,
          brokerRequestId: brokerRequest?.id ?? null,
          eventName,
          toolName: record.toolName,
          policyDecision: policy.decision,
        },
      });
      return {
        hookEvent: record,
        brokerRequest,
        policyDecision: policy.decision,
      };
    });
  }

  function createCodexApprovalBrokerRequest({ invocation, session, hookEvent, body, policy }) {
    const createdAt = now();
    const approvalMode = normalizeCodexApprovalMode(invocation.options?.approvalMode ?? invocation.options?.metadata?.permissionMode);
    const autoApproved = policy.decision !== "blocked" && (approvalMode === "full" || (approvalMode === "auto" && !codexApprovalRequiresManualReview({ invocation, body, policy })));
    const request = {
      id: nextId("cdx_appr"),
      invocationId: invocation.id,
      codexSessionRegistryId: session?.id ?? null,
      hookEventId: hookEvent.id,
      toolName: body.toolName ? String(body.toolName) : "unknown",
      summary: String(body.summary ?? "Codex permission request"),
      riskLevel: "high",
      status: policy.decision === "blocked" ? "denied" : autoApproved ? "approved" : "pending",
      timeoutAt: new Date(Date.now() + codexApprovalTimeoutMs(body)).toISOString(),
      decision: policy.decision === "blocked" ? "deny" : autoApproved ? "allow" : null,
      decidedAt: policy.decision === "blocked" || autoApproved ? createdAt : null,
      notificationState: policy.decision === "blocked" || autoApproved ? "resolved" : "queued",
      approvalMode,
      createdAt,
      updatedAt: createdAt,
    };
    runTx(() => {
      state.codexApprovalBrokerRequests.unshift(request);
      appendEvent({
        invocationId: invocation.id,
        type: "codex_approval_requested",
        level: request.status === "pending" ? "warn" : "info",
        message: request.status === "pending"
          ? `Codex approval broker is waiting on ${request.toolName}.`
          : request.status === "approved"
            ? `Codex approval broker approved ${request.toolName} by ${approvalMode} mode.`
            : `Codex approval broker denied ${request.toolName}.`,
        data: { approvalBrokerRequestId: request.id, status: request.status },
      });
      if (autoApproved) {
        appendEvent({
          invocationId: invocation.id,
          type: "codex_approval_granted",
          level: "info",
          message: `Codex approval broker auto-approved the request in ${approvalMode} mode.`,
          data: { approvalBrokerRequestId: request.id, decision: request.decision, approvalMode },
        });
      }
    });
    return request;
  }

  function normalizeCodexApprovalMode(value) {
    const normalized = String(value ?? "ask").trim().toLowerCase();
    return ["ask", "auto", "full"].includes(normalized) ? normalized : "ask";
  }

  function codexApprovalRequiresManualReview({ invocation, body, policy }) {
    const text = [
      invocation?.input?.task,
      body?.summary,
      body?.toolName,
      policy?.reason,
    ].map((item) => String(item ?? "").toLowerCase()).join(" ");
    return [
      "auth.json",
      "private key",
      "password",
      "secret",
      "token",
      "credential",
      "rm -rf",
      "delete",
      "remove-item",
      "format",
      "registry",
      "full access",
      "dangerously",
    ].some((pattern) => text.includes(pattern));
  }

  function codexApprovalTimeoutMs(body) {
    const seconds = Number(body.timeoutSeconds);
    if (Number.isFinite(seconds) && seconds >= 1 && seconds <= 300) {
      return seconds * 1000;
    }
    return 5 * 60 * 1000;
  }

  function expireCodexApprovalBrokerRequests() {
    const nowMs = Date.now();
    for (const request of state.codexApprovalBrokerRequests) {
      if (request.status !== "pending" || !request.timeoutAt) {
        continue;
      }
      if (Date.parse(request.timeoutAt) > nowMs) {
        continue;
      }
      resolveCodexApprovalBrokerRequest(request, "timeout");
    }
  }

  function resolveCodexApprovalBrokerRequest(request, action, actor = null) {
    if (request.status !== "pending") {
      return request;
    }
    const timedOut = action === "timeout";
    return runTx(() => {
    request.status = action === "approve" ? "approved" : timedOut ? "timed_out" : "denied";
    request.decision = action === "approve" ? "allow" : timedOut ? "timeout_deny" : "deny";
    request.decidedAt = now();
    // #1151: settle must record WHO, not only when — a second operator acting on
    // this row is told who beat them. A timeout is the system's decision.
    request.decidedBy = timedOut ? "system:timeout" : (actor?.userId ?? "usr_local");
    request.updatedAt = request.decidedAt;
    request.notificationState = "resolved";
    const event = {
      invocationId: request.invocationId,
      type: action === "approve" ? "codex_approval_granted" : timedOut ? "codex_approval_timed_out" : "codex_approval_denied",
      level: action === "approve" ? "info" : "warn",
      message: action === "approve"
        ? "Codex approval broker approved the request."
        : timedOut ? "Codex approval broker timed out and denied the request." : "Codex approval broker denied the request.",
      data: { approvalBrokerRequestId: request.id, decision: request.decision },
    };
    // An explicit deny is a human refusal; approve and timeout are not routed
    // through the refusal writer (timeout is its own signal, not a decision).
    if (event.type === "codex_approval_denied") {
      refuse({
        subject: { kind: "capability_call", id: request.invocationId },
        requester: { kind: "local_user", id: "usr_local" },
        category: "human",
        code: "approval_denied",
        decidedBy: { kind: "arbiter", id: request.id },
        summary: "Codex approval broker denied the request.",
        evidence: { approvalBrokerRequestId: request.id, decision: request.decision },
        remedy: "Re-request the permission and approve it at the Codex approval broker.",
        retryAfter: null,
        appealTo: "device_owner",
        event,
      });
    } else {
      appendEvent(event);
    }
    return request;
    });
  }

  function createCodexImportedEvidenceRecord(body, actor = null) {
    const source = String(body.source ?? "user_selected_local_evidence").trim();
    const summary = String(body.summary ?? "").trim();
    if (!summary) {
      throw new Error("summary is required.");
    }
    const createdAt = now();
    // Imported evidence has no invocation to hang tenancy on, so stamp the
    // owning team (and user) from the actor. buildPublicState scopes these
    // records by teamId; without it they leaked to every team (invVisible treats
    // a null invocationId as globally visible). Legacy rows → the local team.
    const record = {
      id: nextId("cdx_import"),
      source,
      userId: actor?.userId ?? "usr_local",
      teamId: actor?.teamId ?? LOCAL_TEAM_ID,
      repoPath: body.repoPath ? String(body.repoPath) : null,
      marker: "imported_after_the_fact",
      status: "imported",
      redactionState: "preview_confirmed_summary_only",
      summary: summary.length <= 500 ? summary : `${summary.slice(0, 497)}...`,
      retentionProfile: "local_demo_retention",
      linkedManagedSessionId: null,
      createdAt,
      updatedAt: createdAt,
    };
    runTx(() => {
      state.codexImportedEvidenceRecords.unshift(record);
      appendEvent({
        invocationId: null,
        type: "codex_imported_evidence_recorded",
        level: "info",
        message: "Imported Codex evidence was recorded after explicit preview and confirmation.",
        data: {
          importedEvidenceId: record.id,
          marker: record.marker,
          redactionState: record.redactionState,
        },
      });
    });
    return record;
  }

  function normalizeCodexHookEventName(value) {
    const normalized = String(value ?? "");
    const allowed = new Set(["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "Stop", "PreCompact", "PostCompact"]);
    return allowed.has(normalized) ? normalized : "Unknown";
  }

  function evaluateCodexHookPolicy(eventName, body) {
    const summary = String(body.summary ?? "");
    if (eventName === "UserPromptSubmit" && /(~\/\.codex\/auth\.json|auth\.json|api[_-]?key|secret)/i.test(summary)) {
      return {
        decision: "blocked",
        reason: "Prompt needs review because it appears to reference credentials or secrets.",
        summary: "Prompt policy check",
      };
    }
    if (eventName === "PreToolUse") {
      return {
        decision: "review_required",
        reason: `Tool use observed for ${body.toolName ?? "unknown tool"}.`,
        summary: "Tool policy check",
      };
    }
    if (eventName === "PermissionRequest") {
      return {
        decision: "review_required",
        reason: `Permission request observed for ${body.toolName ?? "unknown tool"}.`,
        summary: "Permission policy check",
      };
    }
    return {
      decision: "allowed",
      reason: `${eventName} recorded.`,
      summary: "Hook event recorded",
    };
  }

  function codexApprovalQueue() {
    return state.codexApprovalBrokerRequests.map((request) => {
      const invocation = findInvocation(request.invocationId);
      const session = request.codexSessionRegistryId
        ? state.codexSessions.find((item) => item.id === request.codexSessionRegistryId)
        : codexSessionForInvocation(request.invocationId);
      const workspace = codexWorkspaceForSession(session);
      return {
        id: request.id,
        status: request.status,
        summary: request.summary,
        toolName: request.toolName,
        riskLevel: request.riskLevel,
        timeoutAt: request.timeoutAt,
        invocationId: request.invocationId,
        codexSessionRegistryId: session?.id ?? null,
        workspaceId: workspace?.id ?? null,
        repoPath: workspace?.repoPath ?? session?.repoPath ?? null,
        taskSummary: invocation?.input?.task ? summarizeText(invocation.input.task, 140) : null,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
      };
    });
  }

  function repoPathForEvidence(codexSessionRegistryId) {
    const session = codexSessionRegistryId ? state.codexSessions.find((item) => item.id === codexSessionRegistryId) : null;
    const workspace = codexWorkspaceForSession(session);
    return workspace?.repoPath ?? session?.repoPath ?? null;
  }

  function summarizeText(value, maxLength = 160) {
    const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!normalized) {
      return "";
    }
    return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
  }

  return {
    closeCodexSession,
    codexApprovalQueue,
    codexSessionForInvocation,
    codexWorkspaceForSession,
    createCodexChangeReview,
    createCodexEvidenceRecord,
    createCodexImportedEvidenceRecord,
    createManagedCodexSession,
    createManagedCodexWorkspace,
    expireCodexApprovalBrokerRequests,
    normalizeCodexApprovalMode,
    normalizeCodexSessionMode,
    normalizeCodexWorkspacePolicy,
    recordCodexHookEvent,
    repoPathForEvidence,
    resolveCodexApprovalBrokerRequest,
    resolveResumeCodexSessionId,
    updateCodexSessionFromEvent,
  };
}
