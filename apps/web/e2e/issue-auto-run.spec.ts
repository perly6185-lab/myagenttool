import { expect, test, type Page } from "playwright/test";

const project = { id: "prj_1", name: "E2E Repository", status: "active" };
let workItem: Record<string, unknown> | null;
let autoRunStarted: boolean;
let importedViaExternal: boolean;
let autoRunReady: boolean;

async function mockApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname === "/api/state") return route.fulfill({ json: {
      currentProjectId: project.id,
      projects: [project],
      projectTargets: [{ projectId: project.id, state: "ready", rootPath: "/tmp/e2e-repository" }],
      worktrees: autoRunStarted ? [{ id: "wt_1", projectId: project.id, branchName: "ai/e2e-route", path: "/tmp/e2e" }] : [],
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
    if (url.pathname === "/api/work-items/assist/draft" && method === "POST") {
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
    if (url.pathname === "/api/work-items/lwi_1" && method === "GET") {
      return route.fulfill({ json: { workItem, observability: {
        nextAction: autoRunStarted ? "review_delivery" : "start_execution",
        attention: [],
        latestRun: autoRunStarted ? {
          id: "aur_1", status: "done", updatedAt: "2026-07-24T00:02:00.000Z",
          invocationId: "inv_1", agentId: "agt_1",
          localDelivery: { worktreeId: "wt_1", branchName: "ai/e2e-route" },
        } : importedViaExternal ? null : {
          id: "aur_trace", status: "queued", updatedAt: "2026-07-24T00:01:00.000Z",
          invocationId: "inv_1", agentId: "agt_1",
        },
        delivery: autoRunStarted ? {
          state: "awaiting_review", mode: "local_merge", worktreeId: "wt_1",
          branchName: "ai/e2e-route", remoteUrl: null, review: null,
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
    if (url.pathname.endsWith("/comments")) return route.fulfill({ json: { comments: [] } });
    if (url.pathname.endsWith("/activity")) return route.fulfill({ json: { activities: [] } });
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
  await page.addInitScript(() => {
    window.localStorage.setItem("myagenttool.token", "e2e-token");
    window.localStorage.setItem("myagenttool-ui", JSON.stringify({ version: 1, state: { locale: "en" } }));
  });
  await mockApi(page);
});

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
    request.url().endsWith("/api/work-items/lwi_1")
      && request.method() === "PATCH"
      && Array.isArray(request.postDataJSON().acceptanceCriteria));
  await detail.getByRole("button", { name: "Let AI start" }).click();
  expect((await planRequest).postDataJSON()).toMatchObject({
    acceptanceCriteria: ["Provider handoff is complete"],
    verificationSop: ["Verify the provider handoff end to end"],
  });
  await expect(detail.getByText(/execution plan is ready/i)).toBeVisible();
  const scheduleRequest = page.waitForRequest((request) =>
    request.url().endsWith("/api/work-items/lwi_1")
      && request.method() === "PATCH"
      && request.postDataJSON().executionPolicy === "auto");
  await detail.getByRole("button", { name: "Let AI start" }).click();
  expect((await scheduleRequest).postDataJSON()).toMatchObject({
    executionPolicy: "auto",
    status: "ready",
    waitingOn: "ai",
  });
  await expect(detail.getByText(/task is set to automatic/i)).toBeVisible();
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
    request.url().endsWith("/api/work-items/lwi_1")
      && request.method() === "PATCH"
      && Array.isArray(request.postDataJSON().acceptanceCriteria));
  await detail.getByRole("button", { name: "Let AI start" }).click();
  await planRequest;
  await expect(detail.getByText(/execution plan is ready/i)).toBeVisible();
  const scheduleRequest = page.waitForRequest((request) =>
    request.url().endsWith("/api/work-items/lwi_1")
      && request.method() === "PATCH"
      && request.postDataJSON().executionPolicy === "auto");
  await detail.getByRole("button", { name: "Let AI start" }).click();
  expect((await scheduleRequest).postDataJSON()).toMatchObject({
    executionPolicy: "auto",
    status: "ready",
    waitingOn: "ai",
  });
});

test("creates an issue, routes AI execution, and reaches reviewed local delivery", async ({ page }) => {
  await page.goto("/?section=task");
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByRole("textbox", { name: "Create a task" }).fill("Implement browser chain");
  await page.getByRole("button", { name: "Create task only" }).click();

  // Open the authoritative Local Issue after creation, then switch to the
  // expert execution surface explicitly (the summary view is the default).
  await page.goto("/?section=task&task=lwi_1");
  const createdDetail = page.getByRole("dialog", { name: "Local issue details" });
  await createdDetail.getByRole("button", { name: "Technical and audit details" }).click();
  await expect(createdDetail.getByRole("button", { name: "Back to task summary" })).toBeVisible();
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
  await expect(detail.getByRole("alert", { name: "Preflight" })).toContainText("No default agent is configured");
  await detail.getByRole("button", { name: "Open setup and fix" }).click();

  await expect(page).toHaveURL(/section=autoRuns.*task=lwi_1/);
  await expect(page.getByRole("heading", { name: "Auto-runs" })).toBeVisible();
  await page.getByRole("button", { name: "Return to My tasks" }).click();
  await expect(page).toHaveURL(/section=task.*task=lwi_1/);
  await expect(detail).toBeVisible();

  autoRunReady = true;
  await detail.getByRole("button", { name: "Recheck" }).click();
  await expect(detail.getByRole("button", { name: "Let AI start" })).toBeEnabled();
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
