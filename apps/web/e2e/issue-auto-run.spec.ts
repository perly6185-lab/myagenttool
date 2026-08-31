import { expect, test, type Page } from "playwright/test";

const project = { id: "prj_1", name: "E2E Repository", status: "active", path: "/tmp/e2e-repository" };
let workItem: Record<string, unknown> | null;
let autoRunStarted: boolean;
let importedViaExternal: boolean;
let autoRunReady: boolean;
let executionDraftRequests: number;
let executionPrepareRequests: number;
let executionConfirmRequests: number;
let repairWorkItem: Record<string, unknown> | null;
let ordinaryDeliveryReady: boolean;
let ordinaryDeliveryVersion: number;
let localDeliveryConflict: boolean;
let localDeliveryCompleted: boolean;
let recoveryActionState: "none" | "unknown" | "safe" | "retried";
let recoveryRetryRequests: number;

function recoveryActionReceipt() {
  const status = recoveryActionState === "unknown" ? "unknown"
    : recoveryActionState === "safe" ? "safe_to_retry"
      : "succeeded";
  return {
    schemaVersion: 1, id: "ear_recovery", kind: "retry_execution", status,
    messageCode: status === "unknown" ? "action_result_unknown" : status === "safe_to_retry" ? "safe_to_retry" : "retry_started",
    impact: "none", nextOwner: status === "succeeded" ? "ai" : "me",
    requestedAt: "2026-08-05T00:00:00.000Z", updatedAt: "2026-08-05T00:12:00.000Z",
    completedAt: status === "unknown" ? null : "2026-08-05T00:12:00.000Z",
    targetId: status === "succeeded" ? "aur_failed" : null,
    errorCode: null, errorMessage: null, replayed: false,
  };
}

function recoveryExecutionReview() {
  return {
    schemaVersion: 1, state: "failed", stage: "verifying",
    stages: [
      { key: "accepted", status: "complete", at: "2026-08-05T00:01:00.000Z" },
      { key: "preparing", status: "complete", at: "2026-08-05T00:02:00.000Z" },
      { key: "working", status: "complete", at: "2026-08-05T00:02:10.000Z" },
      { key: "verifying", status: "attention", at: "2026-08-05T00:03:00.000Z" },
      { key: "review", status: "pending", at: null },
    ],
    executionKind: "auto_run", targetId: "aur_failed", targetStatus: "failed",
    agentId: "agt_1", agentName: "Codex", acceptedAt: "2026-08-05T00:01:00.000Z",
    startedAt: "2026-08-05T00:02:00.000Z", updatedAt: "2026-08-05T00:03:00.000Z", completedAt: null,
    needsAttention: true, attentionCode: "verification_failed",
    verification: { status: "failed", verified: true, passed: false, commands: ["pnpm test"], command: "pnpm test", exitCode: 1, summary: "One test failed.", checkedAt: "2026-08-05T00:03:00.000Z", durationMs: 1_000, evidenceCount: 1, checks: [] },
    impact: { status: "unknown", reasonCode: "external_impact_not_recorded" },
    riskReasons: [{ code: "execution_failed", severity: "high", scope: "execution" }],
    recommendedAction: { kind: "retry_execution", reasonCode: "execution_failed", requiresConfirmation: true, nextOwner: "me" },
    actionReceipt: recoveryActionReceipt(),
  };
}

function reviewedCodingWorkItem(): Record<string, unknown> {
  return {
    id: "lwi_1", localRef: "LOCAL-1", projectId: project.id,
    title: "Fix the login failure", body: "Repair login and add a regression test.", type: "task", priority: "p1",
    status: "review", state: "open", labels: [], assigneeIds: [], waitingOn: "me",
    acceptanceCriteria: ["Login works again", "Regression tests pass"],
    acceptanceResults: [
      { criterion: "Login works again", status: "passed", note: "Verified", verificationId: "ver_1" },
      { criterion: "Regression tests pass", status: "passed", note: "Verified", verificationId: "ver_1" },
    ],
    verificationSop: ["Run the login regression tests", "Review the code diff"],
    executionContractSource: "manual", executionContractConfirmedAt: "2026-07-24T00:00:00.000Z",
    executionContractGate: { ready: true, missing: [], source: "manual", confirmedAt: "2026-07-24T00:00:00.000Z" },
    executionState: "completed",
    executionBindings: [{ kind: "auto_run", targetId: "aur_1", worktreeId: "wt_1", createdAt: "2026-07-24T00:01:00.000Z" }],
    revision: 3, archivedAt: null, updatedAt: "2026-07-24T00:03:00.000Z",
  };
}

function unplannedCodingWorkItem(): Record<string, unknown> {
  return {
    id: "lwi_1", localRef: "LOCAL-1", projectId: project.id,
    title: "Prepare the release readiness report",
    body: "Summarize release blockers and verify the result.",
    type: "task", priority: "p1", status: "backlog", state: "open",
    labels: [], assigneeIds: [], waitingOn: "none", dueDate: null, plannedDate: null,
    acceptanceCriteria: [], verificationSop: [],
    executionContractSource: null, executionContractConfirmedAt: null,
    executionContractGate: {
      ready: false,
      missing: ["acceptance_criteria", "verification_sop", "confirmation"],
      source: null,
      confirmedAt: null,
    },
    executionState: "unclaimed", executionBindings: [], revision: 1, archivedAt: null,
    updatedAt: "2026-07-24T00:00:00.000Z",
  };
}

async function mockApi(page: Page) {
  await page.route("http://127.0.0.1:5001/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname === "/api/state") return route.fulfill({ json: {
      currentProjectId: project.id,
      projects: [project],
      projectTargets: [{ projectId: project.id, state: "ready", rootPath: "/tmp/e2e-repository" }],
      worktrees: autoRunStarted ? [{
        id: "wt_1", projectId: project.id, targetId: "target_1", branch: "ai/e2e-route",
        branchName: "ai/e2e-route", path: "/tmp/e2e", isMain: false, agentId: "agt_1",
        createdAt: "2026-07-24T00:01:00.000Z",
      }] : [],
      invocations: workItem ? [{
        id: "inv_1",
        status: "queued",
        input: { task: "Explain local wait" },
        agentId: "agt_1",
        projectId: project.id,
        createdAt: "2026-07-24T00:01:00.000Z",
      }] : [],
      issueClaims: [],
      issueClaimEvents: [],
      agents: [{ id: "agt_1", name: "Codex", status: "ready" }],
    } });
    if (url.pathname === "/api/work-items" && method === "GET") {
      return route.fulfill({ json: { workItems: workItem ? [workItem] : [], count: workItem ? 1 : 0 } });
    }
    if (url.pathname === "/api/work-items" && method === "POST") {
      const body = request.postDataJSON();
      workItem = {
        id: "lwi_1", localRef: "LOCAL-1", projectId: project.id,
        title: body.title, body: body.body ?? "", type: body.type, priority: body.priority,
        status: "backlog", state: "open", labels: body.labels ?? [], assigneeIds: [],
        acceptanceCriteria: body.acceptanceCriteria ?? [], revision: 1, archivedAt: null,
        updatedAt: "2026-07-24T00:00:00.000Z",
      };
      return route.fulfill({ status: 201, json: { workItem } });
    }
    if (url.pathname === "/api/work-items/assist/intent-plan" && method === "POST") {
      const body = request.postDataJSON();
      return route.fulfill({ json: {
        plan: {
          tasks: [{
            key: "general", kind: "general", title: body.title,
            outcome: "Produce a reviewable result", requires: [], approvalRequired: false,
          }],
          clarification: null,
        },
        summary: {
          taskCount: 1, requiresRepository: false, approvalTaskCount: 0,
          canCommit: true, canStartAi: true,
          nextStep: "The task plan is ready. Confirm to save it.",
        },
      } });
    }
    if (url.pathname === "/api/work-items/assist/intent-plan/commit" && method === "POST") {
      const body = request.postDataJSON();
      workItem = {
        id: "lwi_1", localRef: "LOCAL-1", projectId: project.id,
        title: body.title, body: body.body ?? "", type: "task", priority: "p2",
        status: "backlog", state: "open", labels: [], assigneeIds: [],
        acceptanceCriteria: body.acceptanceCriteria ?? [], verificationSop: body.verificationSop ?? [],
        waitingOn: "none", dueDate: body.dueDate ?? null, plannedDate: null,
        executionState: "unclaimed", executionBindings: [], revision: 1, archivedAt: null,
        updatedAt: "2026-07-24T00:00:00.000Z",
      };
      return route.fulfill({ status: 201, json: { workItems: [workItem] } });
    }
    if (url.pathname === "/api/work-items/assist/draft" && method === "POST") {
      executionDraftRequests += 1;
      return route.fulfill({ json: {
        draft: {
          acceptanceCriteria: ["Provider handoff is complete"],
          verificationSop: ["Verify the provider handoff end to end"],
        },
      } });
    }
    if (url.pathname === "/api/work-items/providers" && method === "GET") {
      return route.fulfill({ json: {
        providers: [
          { id: "github", label: "GitHub", apiSync: true, webhook: true },
          { id: "gitlab", label: "GitLab", apiSync: true, webhook: false },
          { id: "gitea", label: "Gitea", apiSync: false, webhook: false },
        ],
      } });
    }
    if (url.pathname === "/api/work-items/external-funnel" && method === "GET") {
      return route.fulfill({ json: { metrics: { total: 0, notStarted: 0, running: 0, review: 0, completed: 0, stalled: 0 }, stalls: [] } });
    }
    if (url.pathname === "/api/work-items/external-issues" && method === "GET") {
      return route.fulfill({ json: {
        ok: true,
        issues: [
          { number: 21, title: "Mobile browse one", body: "", state: "open", labels: ["p1"], repository: "group/repo", url: null },
          { number: 22, title: "Mobile browse two", body: "", state: "open", labels: [], repository: "group/repo", url: null },
        ],
        page: 1,
        hasMore: false,
      } });
    }
    if (url.pathname === "/api/work-items/from-external" && method === "POST") {
      const body = request.postDataJSON();
      const provider = body.provider === "github" ? "github" : "gitlab";
      const providerLabel = provider === "github" ? "GitHub" : "GitLab";
      const externalUrl = provider === "github"
        ? `https://github.example/acme/repo/issues/${body.issueNumber}`
        : `https://gitlab.example/group/repo/-/issues/${body.issueNumber}`;
      importedViaExternal = true;
      workItem = {
        id: "lwi_1", localRef: "LOCAL-1", projectId: project.id,
        title: `Imported ${providerLabel} issue`, body: "Implement the provider handoff.", type: "task", priority: "p2",
        status: "backlog", state: "open", labels: ["provider"], assigneeIds: ["usr_local"],
        followUpSchemaVersion: 1, requesterRelation: "unknown", requesterName: null,
        requesterOrganization: null, requesterUserId: null, intakeChannel: "import",
        externalReference: externalUrl, waitingOn: "none",
        commitmentDate: null, nextFollowUpAt: null, lastProgressAt: null, lastProgressSummary: null,
        acceptanceCriteria: [], dueDate: null, plannedDate: null, revision: 2, archivedAt: null,
        updatedAt: "2026-07-24T00:00:00.000Z", executionState: "unclaimed", executionBindings: [],
        externalBindings: [{
          kind: `${provider}_issue`, provider, resourceType: "issue", number: body.issueNumber,
          url: externalUrl, repository: body.repository ?? "acme/repo",
          relation: "source", isPrimary: true, syncPolicy: "manual", conflict: null,
          lastSyncedAt: "2026-07-24T00:00:00.000Z",
        }],
      };
      return route.fulfill({ status: 201, json: { workItem, created: true } });
    }
    if (url.pathname === "/api/work-items/attention") {
      return route.fulfill({ json: { items: [], metrics: { backlog: 0, breached: 0 } } });
    }
    if (url.pathname === "/api/invocation-dispatch-health") {
      return route.fulfill({ json: {
        capacity: { inFlight: 0, maxConcurrency: 3, atCapacity: false },
        queue: { depth: 0, items: [] },
        stats: { indeterminate: true, sampleSize: 0, medianMsToDispatch: null, redeliveryRate: null, exhaustedCount: 0 },
        reliability: {
          failover: { recovered: 0, attempts: 0 },
          claims: { active: 0, expired: 0 },
          intervention: { required: 0 },
        },
      } });
    }
    if (url.pathname === "/api/planning-projects") return route.fulfill({ json: { projects: [] } });
    if (url.pathname === "/api/auto-runs" && method === "GET") return route.fulfill({ json: {
      autoRuns: autoRunStarted ? [{
        id: "aur_1", status: "done", projectId: project.id, worktreeId: "wt_1",
        intent: "Implement browser chain",
        decision: { path: "codex", decidedBy: "router", confidence: 0.96, rationale: "Repository coding task" },
        link: { type: "local_issue", number: 1, title: "Implement browser chain", url: null },
        localDelivery: { worktreeId: "wt_1", branchName: "ai/e2e-route" },
        branchName: "ai/e2e-route",
      }] : [],
      summary: {
        total: autoRunStarted ? 1 : 0,
        active: 0,
        byStatus: autoRunStarted ? { done: 1 } : {},
        outcomes: { prOpen: 0, blocked: 0, failed: 0, reportPosted: 0, needsInput: 0 },
        successRate: autoRunStarted ? 1 : null,
        verification: { passed: 1, failed: 0, unverified: 0 },
        routing: { alignmentRate: 1, conclusive: 1 },
        blockedReasons: [],
        timeToPr: { count: 0, medianSeconds: null, p90Seconds: null },
        rates: { humanEscalation: 0, selfRepair: 0 },
      },
    } });
    if (url.pathname === "/api/work-items/lwi_1" && method === "GET" && recoveryActionState !== "none") {
      return route.fulfill({ json: { workItem, observability: {
        nextAction: "inspect_failure", attention: [],
        latestRun: { id: "aur_failed", status: "failed", phase: "verifying", updatedAt: "2026-08-05T00:03:00.000Z", invocationId: "inv_1", agentId: "agt_1" },
        executionReview: recoveryExecutionReview(), delivery: null,
      } } });
    }
    if (url.pathname === "/api/work-items/lwi_1" && method === "GET") {
      return route.fulfill({ json: { workItem, observability: {
        nextAction: localDeliveryCompleted ? "none" : autoRunStarted ? "review_delivery" : "start_execution",
        attention: [],
        latestRun: autoRunStarted ? {
          id: "aur_1", status: "done", updatedAt: "2026-07-24T00:02:00.000Z",
          invocationId: "inv_1", agentId: "agt_1",
          localDelivery: localDeliveryCompleted ? {
            mode: "local_merge", worktreeId: "wt_1", branchName: "ai/e2e-route",
            baseBranch: "main", deliveredCommit: "reviewed-commit", deliveredAt: "2026-07-24T00:04:00.000Z",
          } : { worktreeId: "wt_1", branchName: "ai/e2e-route" },
          ...(localDeliveryCompleted ? {
            deliveryReport: {
              summary: ordinaryDeliveryVersion > 1
                ? "Revised the login fix to cover expired sessions and kept the regression test."
                : "Fixed the login failure and added a regression test.",
              verification: { passed: true, verified: true, summary: "Login regression tests passed." },
              changedFiles: ["apps/web/src/login.ts", "apps/web/src/login.test.ts"],
              completedAt: "2026-07-24T00:02:00.000Z",
            },
            deliveryReview: {
              status: "completed", invocationId: "inv_review_1", reviewer: "codex",
              startedAt: "2026-07-24T00:02:00.000Z", completedAt: "2026-07-24T00:03:00.000Z",
              verdict: "approved", summary: "No blocking code issues found.", findings: [],
              reviewedCommit: "reviewed-commit", errorCode: null,
            },
          } : {}),
        } : importedViaExternal ? null : {
          id: "aur_trace", status: "queued", updatedAt: "2026-07-24T00:01:00.000Z",
          invocationId: "inv_1", agentId: "agt_1",
        },
        delivery: autoRunStarted && !localDeliveryCompleted ? {
          state: "awaiting_review", mode: "local_merge", worktreeId: "wt_1",
          branchName: "ai/e2e-route", remoteUrl: null,
          report: ordinaryDeliveryReady ? {
            summary: ordinaryDeliveryVersion > 1
              ? "Revised the login fix to cover expired sessions and kept the regression test."
              : "Fixed the login failure and added a regression test.",
            verification: { passed: true, verified: true, summary: "Login regression tests passed." },
            changedFiles: ["apps/web/src/login.ts", "apps/web/src/login.test.ts"],
            completedAt: "2026-07-24T00:02:00.000Z",
          } : null,
          aiReview: ordinaryDeliveryReady ? {
            status: "completed", invocationId: "inv_review_1", reviewer: "codex",
            startedAt: "2026-07-24T00:02:00.000Z", completedAt: "2026-07-24T00:03:00.000Z",
            verdict: "approved", summary: "No blocking code issues found.", findings: [],
            reviewedCommit: "reviewed-commit", errorCode: null,
          } : null,
          review: ordinaryDeliveryReady ? {
            verdict: "approved", summary: "No blocking code issues found.", comments: [],
            reviewedCommit: "reviewed-commit", reviewedBy: "usr_autorun_review", source: "ai",
            reviewerName: "Codex", reviewInvocationId: "inv_review_1", createdAt: "2026-07-24T00:03:00.000Z",
          } : null,
        } : null,
        activeClaim: null,
        cost: { knownUsd: 0, unknownEntries: 0, entryCount: 0, projectBudget: null, teamBudget: null },
        alerts: { queued: 0, failed: 0, sent: 0, skipped: 0, items: [] },
        timeline: [{
          id: "evt_1",
          at: "2026-07-24T00:01:00.000Z",
          source: "issue",
          type: "queued",
          stage: "queue",
          actorId: "usr_local",
          message: "Waiting for local capacity",
          data: {
            principalId: "usr_local",
            deviceId: "dev_local",
            effectiveAuthority: "operator",
            waitingReason: "Another local task is finishing",
          },
        }],
        estimate: null,
        routingExplanation: {
          selectedPath: "develop", via: "policy", confidence: 0.92,
          rationale: "This task requests a repository change.",
          humanCorrection: null,
          candidates: [{ path: "develop", selected: true, score: 0.92, reason: "Repository change" }],
        },
      } } });
    }
    if (url.pathname === "/api/work-items/lwi_1/result-repair" && method === "POST") {
      repairWorkItem = {
        ...(workItem ?? {}),
        id: "lwi_repair",
        localRef: "LOCAL-2",
        title: "Customer proposal repair",
        body: "Repair the failed document format check only.",
        status: "backlog",
        state: "open",
        executionPolicy: "manual",
        repairOfWorkItemId: "lwi_1",
        resultVerification: null,
        revision: 1,
      };
      return route.fulfill({ status: 201, json: { workItem: repairWorkItem, replayed: false } });
    }
    if (url.pathname === "/api/work-items/lwi_repair" && method === "GET") {
      return route.fulfill({ json: { workItem: repairWorkItem, observability: { nextAction: "prepare_execution", attention: [], latestRun: null, delivery: null } } });
    }
    if (url.pathname === "/api/work-items/lwi_1" && method === "PATCH") {
      const body = request.postDataJSON();
      const establishesExecutionContract = Array.isArray(body.acceptanceCriteria) && Array.isArray(body.verificationSop);
      workItem = {
        ...workItem,
        ...body,
        ...(establishesExecutionContract ? {
          executionContractSource: "assisted",
          executionContractConfirmedAt: "2026-07-24T00:00:30.000Z",
          executionContractGate: { ready: true, missing: [], source: "assisted", confirmedAt: "2026-07-24T00:00:30.000Z" },
        } : {}),
        revision: Number(workItem?.revision ?? 0) + 1,
      };
      return route.fulfill({ json: { workItem } });
    }
    if (url.pathname === "/api/work-items/lwi_1/execution-contract/prepare" && method === "POST") {
      executionPrepareRequests += 1;
      const body = request.postDataJSON();
      workItem = {
        ...workItem,
        acceptanceCriteria: body.draftOverride.acceptanceCriteria,
        verificationSop: body.draftOverride.verificationSop,
        executionContractSource: "assisted",
        executionContractConfirmedAt: null,
        executionContractGate: { ready: false, missing: ["confirmation"], source: "assisted", confirmedAt: null },
        revision: Number(workItem?.revision ?? 0) + 1,
      };
      return route.fulfill({ json: { workItem } });
    }
    if (url.pathname === "/api/work-items/lwi_1/execution-contract/confirm" && method === "POST") {
      executionConfirmRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 75));
      workItem = {
        ...workItem,
        executionPolicy: "auto", status: "ready", waitingOn: "ai", executionState: "queued",
        executionContractConfirmedAt: "2026-07-24T00:01:00.000Z",
        executionContractGate: { ready: true, missing: [], source: "assisted", confirmedAt: "2026-07-24T00:01:00.000Z" },
        executionStartReceipt: {
          schemaVersion: 1, id: "wsr_e2e", status: "queued", reasonCode: "waiting_for_turn",
          reasonDetail: null, canCancel: true, agentId: "agt_1", targetId: null,
          requestedAt: "2026-07-24T00:01:00.000Z", updatedAt: "2026-07-24T00:01:00.000Z",
        },
        revision: Number(workItem?.revision ?? 0) + 1,
      };
      return route.fulfill({ json: { workItem } });
    }
    if (url.pathname === "/api/work-items/lwi_1/delivery/local" && method === "POST") {
      if (localDeliveryConflict) {
        return route.fulfill({ status: 409, json: {
          error: "work_item_delivery_failed",
          message: "The base branch main advanced. Rebase or merge it into ai/e2e-route, then review again.",
        } });
      }
      workItem = {
        ...workItem,
        status: "done",
        state: "closed",
        waitingOn: "none",
        revision: Number(workItem?.revision ?? 0) + 1,
        updatedAt: "2026-07-24T00:04:00.000Z",
      };
      localDeliveryCompleted = true;
      return route.fulfill({ json: {
        workItem,
        delivery: {
          mode: "local_merge", worktreeId: "wt_1", branchName: "ai/e2e-route",
          baseBranch: "main", deliveredCommit: "reviewed-commit", deliveredAt: "2026-07-24T00:04:00.000Z",
        },
      } });
    }
    if (url.pathname === "/api/worktrees/wt_1/files" && method === "GET") {
      return route.fulfill({ json: { tree: [] } });
    }
    if (url.pathname === "/api/worktrees/wt_1/git" && method === "GET") {
      return route.fulfill({ json: {
        branch: "ai/e2e-route", clean: false, changedFiles: 2,
        hasUpstream: false, upstream: null, ahead: 1, behind: 0,
      } });
    }
    if (url.pathname === "/api/worktrees/wt_1/diff" && method === "GET") {
      return route.fulfill({ json: {
        files: [
          { path: "apps/web/src/login.ts", index: "M", work: " ", untracked: false },
          { path: "apps/web/src/login.test.ts", index: "A", work: " ", untracked: false },
        ],
        base: "main",
        diff: "diff --git a/apps/web/src/login.ts b/apps/web/src/login.ts\n@@ -1 +1 @@\n+export const loginFixed = true;",
        truncated: false,
      } });
    }
    if (url.pathname.endsWith("/comments")) return route.fulfill({ json: { comments: [] } });
    if (url.pathname.endsWith("/activity")) return route.fulfill({ json: { activities: [] } });
    if (url.pathname === "/api/auto-runs/aur_failed/execution-actions/reconcile" && method === "POST") {
      recoveryActionState = "safe";
      return route.fulfill({ json: { actionReceipt: recoveryActionReceipt(), safeToRetry: true } });
    }
    if (url.pathname === "/api/auto-runs/aur_failed/retry" && method === "POST") {
      recoveryRetryRequests += 1;
      recoveryActionState = "retried";
      return route.fulfill({ status: 201, json: { autoRun: { id: "aur_failed", status: "running" }, actionReceipt: recoveryActionReceipt() } });
    }
    if (url.pathname === "/api/auto-runs/aur_1/retry" && method === "POST") {
      ordinaryDeliveryReady = false;
      ordinaryDeliveryVersion += 1;
      return route.fulfill({ status: 201, json: {
        autoRun: { id: "aur_1", worktreeId: "wt_1", status: "running" },
      } });
    }
    if (url.pathname === "/api/work-items/lwi_1/auto-runs" && method === "POST") {
      autoRunStarted = true;
      workItem = {
        ...workItem,
        status: "review",
        revision: 2,
        executionBindings: [{ kind: "auto_run", targetId: "aur_1", worktreeId: "wt_1", createdAt: "2026-07-24T00:01:00.000Z" }],
      };
      return route.fulfill({ status: 201, json: {
        worktree: { id: "wt_1", projectId: project.id },
        autoRun: { id: "aur_1", worktreeId: "wt_1", status: "queued" },
      } });
    }
    if (url.pathname === `/api/projects/${project.id}/auto-run-readiness`) {
      return route.fulfill({ json: { readiness: autoRunReady
        ? { ready: true, checks: [] }
        : { ready: false, checks: [{ key: "agent", label: "Coding agent", status: "blocked", detail: "No default agent is configured." }] } } });
    }
    if (url.pathname.startsWith("/api/projects/") && url.pathname.endsWith("/github")) {
      return route.fulfill({ json: { available: true, message: "", items: [{
        type: "issue", number: 42, title: "GitHub browser intake", headRefName: null,
        author: "octocat", url: "https://github.example/acme/repo/issues/42", state: "open",
      }] } });
    }
    return route.fulfill({ json: {} });
  });
}

test.beforeEach(async ({ page }) => {
  workItem = null;
  autoRunStarted = false;
  importedViaExternal = false;
  autoRunReady = true;
  executionDraftRequests = 0;
  executionPrepareRequests = 0;
  executionConfirmRequests = 0;
  repairWorkItem = null;
  ordinaryDeliveryReady = false;
  ordinaryDeliveryVersion = 1;
  localDeliveryConflict = false;
  localDeliveryCompleted = false;
  recoveryActionState = "none";
  recoveryRetryRequests = 0;
  await page.addInitScript(() => {
    window.localStorage.setItem("myagenttool.token", "e2e-token");
    if (!window.localStorage.getItem("myagenttool-ui")) {
      window.localStorage.setItem("myagenttool-ui", JSON.stringify({ version: 1, state: { locale: "en" } }));
    }
  });
  await mockApi(page);
});

test("creates a separate repair task from failed result checks without auto-starting it", async ({ page }) => {
  workItem = {
    id: "lwi_1", localRef: "LOCAL-1", projectId: project.id,
    title: "Customer proposal", body: "Prepare the customer proposal.", type: "task", priority: "p2",
    status: "blocked", state: "open", labels: [], assigneeIds: [], waitingOn: "none",
    acceptanceCriteria: ["Deliver a DOCX proposal"], verificationSop: ["Check the output format"],
    executionPolicy: "manual", executionState: "blocked", executionBindings: [], revision: 2, archivedAt: null,
    updatedAt: "2026-07-24T00:00:00.000Z",
    resultVerification: {
      schemaVersion: 1, status: "failed", summary: "The output format is invalid.", digest: "repair-digest",
      checks: [{ kind: "artifact_format", status: "failed", summary: "Expected a DOCX document, but received a PNG file." }],
      verificationChecks: [],
      repair: { required: true, mode: "independent_task", reasons: ["Output format is invalid"], suggestedRequest: "Create a DOCX proposal." },
    },
  };
  await page.goto("/?section=task&task=lwi_1", { waitUntil: "domcontentloaded" });
  const detail = page.getByRole("dialog", { name: "Local issue details" });
  await expect(detail.getByTestId("result-repair-card")).toBeVisible();
  const request = page.waitForRequest((candidate) => candidate.url().endsWith("/api/work-items/lwi_1/result-repair") && candidate.method() === "POST");
  await detail.getByRole("button", { name: "Create repair task from checks" }).click();
  await request;
  await expect(page.getByRole("heading", { name: "Customer proposal repair" })).toBeVisible();
  expect(repairWorkItem).toMatchObject({ repairOfWorkItemId: "lwi_1", executionPolicy: "manual", status: "backlog" });
  expect(workItem).toMatchObject({ id: "lwi_1", status: "blocked" });
});

test("rechecks an unknown high-risk action before allowing one safe retry", async ({ page }) => {
  recoveryActionState = "unknown";
  workItem = {
    id: "lwi_1", localRef: "LOCAL-1", projectId: project.id,
    title: "Recover failed verification", body: "Retry only after confirming the previous request did not run.",
    type: "task", priority: "p1", status: "blocked", state: "open", labels: [], assigneeIds: [], waitingOn: "me",
    acceptanceCriteria: ["Verification passes"], verificationSop: ["Run pnpm test"],
    executionContractSource: "manual", executionContractConfirmedAt: "2026-08-05T00:00:00.000Z",
    executionContractGate: { ready: true, missing: [], source: "manual", confirmedAt: "2026-08-05T00:00:00.000Z" },
    executionState: "failed", executionBindings: [{ kind: "auto_run", targetId: "aur_failed", worktreeId: "wt_1", createdAt: "2026-08-05T00:02:00.000Z" }],
    revision: 2, archivedAt: null, updatedAt: "2026-08-05T00:03:00.000Z",
  };

  await page.goto("/?section=task&task=lwi_1", { waitUntil: "domcontentloaded" });
  const review = page.getByTestId("execution-review-card");
  await expect(review.getByText("Action result is not confirmed")).toBeVisible();
  await expect(review.getByRole("button", { name: "Retry AI work" })).toHaveCount(0);
  expect(recoveryRetryRequests).toBe(0);

  await review.getByRole("button", { name: "Recheck action status" }).click();
  await expect(review.getByText("Safe to retry")).toBeVisible();
  await review.getByRole("button", { name: "Retry AI work" }).click();
  const confirmation = page.getByRole("dialog", { name: "Retry AI work?" });
  await confirmation.getByRole("button", { name: "Retry" }).click();

  await expect.poll(() => recoveryRetryRequests).toBe(1);
  await expect(review.getByText("AI work restarted.")).toBeVisible();
});

test("creates an ordinary task from the mobile task modal without a dead collapsed form", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?section=task", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "New task" }).click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  const task = dialog.getByRole("textbox", { name: "Create a task" });
  await expect(task).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Expand task creation" })).toHaveCount(0);
  await task.fill("Prepare the mobile customer update");
  await dialog.getByRole("button", { name: "Close" }).click();
  const confirm = page.getByRole("dialog", { name: "Discard this unsaved task?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await dialog.getByRole("button", { name: "Save only" }).click();
  await expect(dialog.getByTestId("home-intent-task-plan")).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm and save" }).click();
  await expect(dialog.getByText("Task created and added to your boards.")).toBeVisible();
});

for (const fixture of [
  {
    name: "desktop English",
    locale: "en",
    viewport: { width: 1366, height: 768 },
    start: "Let AI start",
    resume: "Review and start AI",
    dialog: "Confirm AI start",
    confirm: "Confirm and start AI",
  },
  {
    name: "desktop Chinese",
    locale: "zh-CN",
    viewport: { width: 1366, height: 768 },
    start: "交给 AI 开始处理",
    resume: "核对并让 AI 开始",
    dialog: "确认让 AI 开始",
    confirm: "确认并让 AI 开始",
  },
  {
    name: "390 px English",
    locale: "en",
    viewport: { width: 390, height: 844 },
    start: "Let AI start",
    resume: "Review and start AI",
    dialog: "Confirm AI start",
    confirm: "Confirm and start AI",
  },
  {
    name: "390 px Chinese",
    locale: "zh-CN",
    viewport: { width: 390, height: 844 },
    start: "交给 AI 开始处理",
    resume: "核对并让 AI 开始",
    dialog: "确认让 AI 开始",
    confirm: "确认并让 AI 开始",
  },
] as const) {
  test(`prepares, cancels, restores, and confirms one AI start on ${fixture.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(fixture.viewport);
    workItem = unplannedCodingWorkItem();
    // This flag makes the shared fixture return no synthetic legacy Run, so
    // the task remains genuinely unstarted until this test confirms it.
    importedViaExternal = true;
    await page.addInitScript(({ locale }) => {
      window.localStorage.setItem("myagenttool-ui", JSON.stringify({
        version: 1,
        state: { locale, section: "task", experienceMode: "ordinary" },
      }));
    }, { locale: fixture.locale });
    await page.goto("/?section=task&task=lwi_1", { waitUntil: "domcontentloaded" });

    const start = page.getByTestId("review-and-start-ai");
    await expect(start).toHaveText(fixture.start, { timeout: 15_000 });
    await start.focus();
    await expect(start).toBeFocused();
    await start.press("Enter");

    const confirmation = page.getByRole("dialog", { name: fixture.dialog });
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByText("Prepare the release readiness report", { exact: true })).toBeVisible();
    await expect(confirmation.getByText("Provider handoff is complete", { exact: true })).toBeVisible();
    await expect(confirmation.getByText("Verify the provider handoff end to end", { exact: true })).toBeVisible();
    await expect(confirmation.getByText("E2E Repository", { exact: true })).toBeVisible();
    await expect(confirmation.getByText("/tmp/e2e-repository", { exact: true })).toBeVisible();
    expect(executionDraftRequests).toBe(1);
    expect(executionPrepareRequests).toBe(1);
    expect(executionConfirmRequests).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(await confirmation.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`ai-start-confirmation-${fixture.locale}-${fixture.viewport.width}.png`),
      fullPage: true,
    });

    await page.keyboard.press("Escape");
    await expect(confirmation).toBeHidden();
    await expect(start).toBeFocused();
    expect(executionConfirmRequests).toBe(0);
    expect(workItem).toMatchObject({
      acceptanceCriteria: ["Provider handoff is complete"],
      verificationSop: ["Verify the provider handoff end to end"],
      executionContractConfirmedAt: null,
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    const resume = page.getByTestId("review-and-start-ai");
    await expect(resume).toHaveText(fixture.resume);
    await resume.focus();
    await resume.press("Enter");
    const restoredConfirmation = page.getByRole("dialog", { name: fixture.dialog });
    await expect(restoredConfirmation).toBeVisible();
    expect(executionDraftRequests).toBe(1);
    expect(executionPrepareRequests).toBe(1);

    const confirm = restoredConfirmation.getByRole("button", { name: fixture.confirm });
    await confirm.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect.poll(() => executionConfirmRequests).toBe(1);
    await expect(restoredConfirmation).toBeHidden();
    expect(workItem).toMatchObject({
      executionPolicy: "auto",
      waitingOn: "ai",
      executionState: "queued",
      executionContractGate: { ready: true, missing: [] },
    });
  });
}

test("imports a GitLab issue, opens its Local Issue, and schedules AI from simple details", async ({ page }) => {
  await page.goto("/?section=externalWork", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Create tasks from issues" }).click();
  const importer = page.getByRole("dialog", { name: "Import external issue" });
  await importer.getByLabel("Source provider").selectOption("gitlab");
  await importer.getByPlaceholder("owner/repo").fill("group/repo");
  await importer.getByLabel("Issue number").fill("19");
  await expect(importer.getByText("API configured")).toBeVisible();
  await importer.getByRole("button", { name: "Create task" }).click();

  const detail = page.getByRole("dialog", { name: "Local issue details" });
  await expect(detail).toBeVisible();
  await expect(detail.getByText("GitLab #19")).toBeVisible();
  const planRequest = page.waitForRequest((request) =>
    request.url().endsWith("/api/work-items/lwi_1/execution-contract/prepare")
      && request.method() === "POST");
  await detail.getByTestId("review-and-start-ai").click();
  expect((await planRequest).postDataJSON()).toMatchObject({
    draftOverride: {
      acceptanceCriteria: ["Provider handoff is complete"],
      verificationSop: ["Verify the provider handoff end to end"],
    },
  });
  await expect(detail.getByText(/execution plan is ready/i)).toBeVisible();
  const scheduleRequest = page.waitForRequest((request) =>
    request.url().endsWith("/api/work-items/lwi_1/execution-contract/confirm")
      && request.method() === "POST");
  await page.getByRole("dialog", { name: "Confirm AI start" })
    .getByRole("button", { name: "Confirm and start AI" }).click();
  await scheduleRequest;
  await expect(detail.getByRole("heading", { name: "AI accepted the task and is queued" })).toBeVisible();
});

test("browses and bulk imports GitLab issues on a narrow keyboard-accessible dialog", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?section=externalWork", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Create tasks from issues" }).click();
  const importer = page.getByRole("dialog", { name: "Import external issue" });
  await importer.getByLabel("Source provider").selectOption("gitlab");
  await importer.getByLabel("External repository").fill("group/repo");
  await importer.getByLabel("Search titles or descriptions").fill("mobile");
  await importer.getByRole("button", { name: "Find issues" }).click();
  const first = importer.getByRole("checkbox", { name: /#21 Mobile browse one/ });
  await first.focus();
  await expect(first).toBeFocused();
  await first.press("Space");
  await importer.getByRole("checkbox", { name: /#22 Mobile browse two/ }).check();
  await expect(importer.getByText("2 selected")).toBeVisible();
  await importer.getByRole("button", { name: "Import selected issues" }).click();
  const detail = page.getByRole("dialog", { name: "Local issue details" });
  await expect(detail).toBeVisible();
  await expect(detail.getByText("GitLab #22")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("adopts a browsed GitHub issue and continues through the same Local Issue handoff", async ({ page }) => {
  await page.goto("/?section=externalWork", { waitUntil: "domcontentloaded" });
  const externalRow = page.getByRole("row", { name: /#42 GitHub browser intake/ });
  await expect(externalRow).toBeVisible();
  const intakeRequest = page.waitForRequest((request) =>
    request.url().endsWith("/api/work-items/from-external") && request.method() === "POST");
  await externalRow.getByRole("button", { name: "Turn into task" }).click();
  await intakeRequest;

  const detail = page.getByRole("dialog", { name: "Local issue details" });
  await expect(detail).toBeVisible();
  await expect(detail.getByText("GitHub #42")).toBeVisible();
  const planRequest = page.waitForRequest((request) =>
    request.url().endsWith("/api/work-items/lwi_1/execution-contract/prepare")
      && request.method() === "POST");
  await detail.getByTestId("review-and-start-ai").click();
  await planRequest;
  await expect(detail.getByText(/execution plan is ready/i)).toBeVisible();
  const scheduleRequest = page.waitForRequest((request) =>
    request.url().endsWith("/api/work-items/lwi_1/execution-contract/confirm")
      && request.method() === "POST");
  await page.getByRole("dialog", { name: "Confirm AI start" })
    .getByRole("button", { name: "Confirm and start AI" }).click();
  await scheduleRequest;
});

test("creates an issue, routes AI execution, and reaches reviewed local delivery", async ({ page }) => {
  await page.goto("/?section=task");
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByRole("textbox", { name: "Create a task" }).fill("Implement browser chain");
  await page.getByRole("button", { name: "Save only" }).click();
  await expect(page.getByTestId("home-intent-task-plan")).toBeVisible();
  await page.getByRole("button", { name: "Confirm and save" }).click();

  // Open the authoritative Local Issue after creation, then switch to the
  // expert execution surface explicitly (the summary view is the default).
  await page.goto("/?section=task&task=lwi_1");
  const createdDetail = page.getByRole("dialog", { name: "Local issue details" });
  await createdDetail.getByRole("button", { name: "Technical and audit details" }).click();
  await expect(createdDetail.getByRole("button", { name: "Professional view" })).toHaveAttribute("aria-pressed", "true");
  await expect(createdDetail.getByRole("tab", { name: "Process", exact: true })).toBeVisible();
  await createdDetail.getByRole("tab", { name: "Process", exact: true }).click();
  const autoRunRequest = page.waitForRequest((request) =>
    request.url().endsWith("/api/work-items/lwi_1/auto-runs") && request.method() === "POST");
  await page.getByRole("button", { name: "Start Auto-run" }).click();
  await autoRunRequest;

  await page.goto("/?section=task");
  await page.getByText("Implement browser chain").first().click();
  const detail = page.getByRole("dialog", { name: "Local issue details" });
  await detail.getByRole("button", { name: "Technical and audit details" }).click();
  await detail.getByRole("tab", { name: "Process", exact: true }).click();
  await expect(detail.getByText("Ready for delivery")).toBeVisible();
  await expect(detail.getByText("Review required")).toBeVisible();
  await expect(detail.getByRole("button", { name: "Merge into base" })).toBeDisabled();
  await page.goto("/?section=autoRuns&autoRun=aur_1");
  await expect(page.getByText("Implement browser chain").first()).toBeVisible();
  const queue = page.getByRole("region", { name: "Dispatch queue" });
  await expect(queue).toBeVisible();
  await expect(queue.getByText(/Queue clear/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(queue).toBeVisible();
  const refresh = page.getByRole("button", { name: "Refresh" });
  await expect(refresh).toBeVisible();
  await refresh.focus();
  await expect(refresh).toBeFocused();
  await refresh.press("Enter");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("completes an ordinary coding task through revision and durable local delivery", async ({ page }) => {
  await page.goto("/?section=task", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "New task" }).click();
  const createDialog = page.getByRole("dialog", { name: "New task" });
  await createDialog.getByRole("textbox", { name: "Create a task" }).fill("Implement browser chain");
  await createDialog.getByRole("button", { name: "Save only" }).click();
  await expect(createDialog.getByTestId("home-intent-task-plan")).toBeVisible();
  await createDialog.getByRole("button", { name: "Confirm and save" }).click();
  await expect(createDialog.getByText("Task created and added to your boards.")).toBeVisible();

  // Keep the whole journey on the ordinary task surface. The scheduler is
  // represented by changing the mocked task state after the user opts in.
  importedViaExternal = true;
  await createDialog.getByRole("button", { name: "View task" }).click();
  let detail = page.getByRole("dialog", { name: "Local issue details" });
  await expect(detail.getByRole("button", { name: "Professional view" })).toHaveAttribute("aria-pressed", "false");
  await detail.getByTestId("review-and-start-ai").click();
  const scheduleRequest = page.waitForRequest((request) =>
    request.url().endsWith("/api/work-items/lwi_1/execution-contract/confirm")
      && request.method() === "POST");
  await page.getByRole("dialog", { name: "Confirm AI start" })
    .getByRole("button", { name: "Confirm and start AI" }).click();
  await scheduleRequest;
  await expect(detail.getByRole("heading", { name: "AI accepted the task and is queued" })).toBeVisible();

  autoRunStarted = true;
  ordinaryDeliveryReady = true;
  workItem = { ...reviewedCodingWorkItem(), title: "Implement browser chain" };
  await page.reload({ waitUntil: "domcontentloaded" });
  detail = page.getByRole("dialog", { name: "Local issue details" });
  await expect(detail.getByText("Fixed the login failure and added a regression test.").first()).toBeVisible();
  await expect(detail.getByRole("button", { name: "Professional view" })).toHaveAttribute("aria-pressed", "false");

  await detail.getByRole("button", { name: "Ask AI to revise" }).click();
  await detail.locator("textarea").fill("Also cover expired sessions in the regression test.");
  const commentRequest = page.waitForRequest((request) =>
    request.url().endsWith("/api/work-items/lwi_1/comments") && request.method() === "POST");
  const revisionRequest = page.waitForRequest((request) =>
    request.url().endsWith("/api/auto-runs/aur_1/retry") && request.method() === "POST");
  await detail.getByRole("button", { name: "Send changes to AI" }).click();
  expect((await commentRequest).postDataJSON()).toMatchObject({ body: "Also cover expired sessions in the regression test." });
  await revisionRequest;
  await expect(detail.getByText("Your changes were recorded and AI has started another pass.")).toBeVisible();

  ordinaryDeliveryReady = true;
  await page.reload({ waitUntil: "domcontentloaded" });
  detail = page.getByRole("dialog", { name: "Local issue details" });
  await expect(detail.getByText("Revised the login fix to cover expired sessions and kept the regression test.").first()).toBeVisible();
  const reviewChanges = detail.getByRole("button", { name: "Review changes" });
  await reviewChanges.focus();
  await expect(reviewChanges).toBeFocused();
  await reviewChanges.press("Enter");
  await expect(page).toHaveURL(/section=projects/);
  await expect(page.getByText("+export const loginFixed = true;")).toBeVisible();

  const returnToTask = page.getByRole("button", { name: "Return to task" });
  await returnToTask.focus();
  await expect(returnToTask).toBeFocused();
  await returnToTask.press("Enter");
  await expect(page).toHaveURL(/section=task.*task=lwi_1/);
  detail = page.getByRole("dialog", { name: "Local issue details" });
  await detail.getByRole("button", { name: "Approve and apply locally" }).click();
  const confirm = page.getByRole("dialog", { name: "Approve and apply this delivery locally?" });
  await confirm.getByRole("button", { name: "Apply locally" }).click();
  await expect(detail.getByText("This work is complete")).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  detail = page.getByRole("dialog", { name: "Local issue details" });
  await expect(detail.getByText("This work is complete")).toBeVisible();
  const receipt = detail.getByLabel("Local delivery receipt");
  await expect(receipt.getByText("Applied successfully")).toBeVisible();
  await expect(receipt.getByText("2 file(s) applied")).toBeVisible();
  await expect(receipt.getByText("Login regression tests passed.")).toBeVisible();
  await expect(detail.getByRole("button", { name: "Professional view" })).toHaveAttribute("aria-pressed", "false");
});

for (const fixture of [
  { name: "desktop", viewport: { width: 1366, height: 768 } },
  { name: "mobile", viewport: { width: 390, height: 844 } },
]) {
  test(`lets an ordinary developer review delivered code directly on ${fixture.name}`, async ({ page }) => {
    await page.setViewportSize(fixture.viewport);
    autoRunStarted = true;
    ordinaryDeliveryReady = true;
    workItem = reviewedCodingWorkItem();

    await page.goto("/?section=task&task=lwi_1", { waitUntil: "domcontentloaded" });
    const detail = page.getByRole("dialog", { name: "Local issue details" });
    await expect(detail.getByText("Result passed automated review and verification")).toBeVisible();
    await expect(detail.getByText("Login regression tests passed.")).toBeVisible();
    await expect(detail.getByText(/1 product file, 1 test file/).first()).toBeVisible();
    await expect(detail.getByRole("button", { name: "Review changes" })).toBeVisible();
    await expect(detail.getByRole("button", { name: "Professional view" })).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await detail.getByRole("button", { name: "Review changes" }).click();
    await expect(page).toHaveURL(/section=projects/);
    await expect.poll(() => page.evaluate(() => {
      const state = JSON.parse(window.localStorage.getItem("myagenttool-ui") ?? "null")?.state;
      return { projectId: state?.selectedProjectId, worktreeId: state?.selectedWorktreeId };
    })).toEqual({ projectId: "prj_1", worktreeId: "wt_1" });
    await expect(page.getByRole("button", { name: "apps/web/src/login.ts", exact: true })).toBeVisible();
    await expect(page.getByText("+export const loginFixed = true;")).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Return to task" })).toBeVisible();
    await expect(page.getByRole("button", { name: "apps/web/src/login.ts", exact: true })).toBeVisible();
    await expect(page.getByText("+export const loginFixed = true;")).toBeVisible();

    await page.getByRole("button", { name: "Return to task" }).click();
    await expect(page).toHaveURL(/section=task.*task=lwi_1/);
    const reopenedDetail = page.getByRole("dialog", { name: "Local issue details" });
    await expect(reopenedDetail).toBeVisible();
    const deliveryRequest = page.waitForRequest((request) =>
      request.url().endsWith("/api/work-items/lwi_1/delivery/local") && request.method() === "POST");
    await reopenedDetail.getByRole("button", { name: "Approve and apply locally" }).click();
    const confirm = page.getByRole("dialog", { name: "Approve and apply this delivery locally?" });
    await expect(confirm.getByText(/No remote branch will be pushed or merged/)).toBeVisible();
    await confirm.getByRole("button", { name: "Apply locally" }).click();
    await deliveryRequest;
    await expect(reopenedDetail.getByText("This work is complete")).toBeVisible();
    const receipt = reopenedDetail.getByLabel("Local delivery receipt");
    await expect(receipt.getByText("Applied successfully")).toBeVisible();
    await expect(receipt.getByText("main")).toBeVisible();
    await expect(receipt.getByText("reviewed-com")).toBeVisible();
    await expect(receipt.getByText("2 file(s) applied")).toBeVisible();
    await expect(receipt.getByText("Login regression tests passed.")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await page.reload({ waitUntil: "domcontentloaded" });
    const restoredDetail = page.getByRole("dialog", { name: "Local issue details" });
    await expect(restoredDetail.getByText("This work is complete")).toBeVisible();
    const restoredReceipt = restoredDetail.getByLabel("Local delivery receipt");
    await expect(restoredReceipt.getByText("Applied successfully")).toBeVisible();
    await expect(restoredReceipt.getByText("main")).toBeVisible();
    await expect(restoredReceipt.getByText("reviewed-com")).toBeVisible();
    await expect(restoredReceipt.getByText("2 file(s) applied")).toBeVisible();
    await expect(restoredReceipt.getByText("Login regression tests passed.")).toBeVisible();
  });
}

test("restores the completed local delivery receipt on Chinese mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("myagenttool-ui", JSON.stringify({
      version: 1,
      state: { locale: "zh-CN", section: "task" },
    }));
  });
  autoRunStarted = true;
  ordinaryDeliveryReady = true;
  localDeliveryCompleted = true;
  workItem = {
    ...reviewedCodingWorkItem(),
    status: "done",
    state: "closed",
    waitingOn: "none",
    updatedAt: "2026-07-24T00:04:00.000Z",
  };

  await page.goto("/?section=task&task=lwi_1", { waitUntil: "domcontentloaded" });
  const detail = page.getByRole("dialog", { name: "任务详情" });
  await expect(detail.getByText("这项工作已完成")).toBeVisible();
  const receipt = detail.getByLabel("本地交付回执");
  await expect(receipt.getByText("应用成功")).toBeVisible();
  await expect(receipt.getByText("main")).toBeVisible();
  await expect(receipt.getByText("2 个文件已应用")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("dialog", { name: "任务详情" }).getByLabel("本地交付回执")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("keeps an ordinary coding task reviewable when the local base branch advances", async ({ page }) => {
  autoRunStarted = true;
  ordinaryDeliveryReady = true;
  localDeliveryConflict = true;
  workItem = reviewedCodingWorkItem();

  await page.goto("/?section=task&task=lwi_1", { waitUntil: "domcontentloaded" });
  const detail = page.getByRole("dialog", { name: "Local issue details" });
  await detail.getByRole("button", { name: "Approve and apply locally" }).click();
  const confirm = page.getByRole("dialog", { name: "Approve and apply this delivery locally?" });
  await confirm.getByRole("button", { name: "Apply locally" }).click();

  const alert = confirm.getByRole("alert");
  await expect(alert).toContainText("local base branch advanced");
  await expect(detail.getByText("This work is complete")).toHaveCount(0);
  await alert.getByRole("button", { name: "Review current changes" }).click();
  await expect(page).toHaveURL(/section=projects/);
  await expect(page.getByRole("button", { name: "apps/web/src/login.ts", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Return to task" })).toBeVisible();
});

test("keeps the Local Issue selected while fixing preflight and rechecks after returning", async ({ page }) => {
  autoRunReady = false;
  importedViaExternal = true;
  workItem = {
    id: "lwi_1", localRef: "LOCAL-1", projectId: project.id,
    title: "Restore the execution setup", body: "Start after the coding agent is configured.", type: "task", priority: "p2",
    status: "backlog", state: "open", labels: [], assigneeIds: [], acceptanceCriteria: [],
    waitingOn: "none", plannedDate: null, dueDate: "2026-08-31",
    executionState: "unclaimed", executionBindings: [], revision: 1, archivedAt: null,
    updatedAt: "2026-08-06T00:00:00.000Z",
  };
  await page.goto("/?section=task&task=lwi_1");
  const detail = page.getByRole("dialog", { name: "Local issue details" });
  await expect(detail.getByRole("alert", { name: "Preflight" })).toContainText("does not have an available task assistant");
  await detail.getByRole("button", { name: "Choose task assistant" }).click();

  await expect(page).toHaveURL(/section=autoRuns.*task=lwi_1/);
  await expect(page.getByRole("heading", { name: "Auto-runs" })).toBeVisible();
  await page.getByRole("button", { name: "Return to My tasks" }).click();
  await expect(page).toHaveURL(/section=task.*task=lwi_1/);
  await expect(detail).toBeVisible();

  autoRunReady = true;
  await detail.getByRole("button", { name: "Recheck" }).click();
  await expect(detail.getByTestId("review-and-start-ai")).toBeEnabled();
});

test("restores a task-first Trace after visiting scheduling Settings", async ({ page }) => {
  workItem = {
    id: "lwi_1", localRef: "LOCAL-1", projectId: project.id,
    title: "Explain local wait", body: "", type: "task", priority: "p1",
    status: "ready", state: "open", labels: [], assigneeIds: [],
    acceptanceCriteria: [], verificationRecords: [], revision: 1, archivedAt: null,
    updatedAt: "2026-07-24T00:00:00.000Z",
  };
  await page.goto("/?section=task&task=lwi_1&taskMode=expert&taskView=trace");
  const detail = page.getByRole("dialog", { name: "Local issue details" });
  await expect(detail).toBeVisible();
  await expect(detail.getByRole("tab", { name: "Trace", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(detail.getByText("usr_local")).toBeVisible();
  await expect(detail.getByText("dev_local")).toBeVisible();
  await expect(detail.getByText("Queued", { exact: true })).toBeVisible();
  const summary = detail.getByRole("region", { name: "Task chain summary" });
  await expect(summary.getByText("Another local task is finishing", { exact: true })).toBeVisible();
  await expect(summary.getByText("0 retries", { exact: true })).toBeVisible();

  await detail.getByRole("button", { name: "Invocations" }).click();
  await expect(page).toHaveURL(/section=invocations.*invocation=inv_1/);
  const settings = page.getByRole("dialog", { name: "My settings" });
  await expect(settings.getByRole("heading", { name: "Invocations" })).toBeVisible();
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(page).toHaveURL(/section=task.*task=lwi_1.*taskView=trace/);
  await expect(page.getByRole("dialog", { name: "Local issue details" })).toBeVisible();

  await detail.getByRole("button", { name: "Scheduling settings" }).click();
  await expect(page).toHaveURL(/section=automation/);
  await page.getByRole("dialog", { name: "My settings" }).getByRole("button", { name: "Close" }).click();

  await expect(page).toHaveURL(/section=task.*task=lwi_1.*taskView=trace/);
  await expect(page.getByRole("dialog", { name: "Local issue details" })).toBeVisible();
});
