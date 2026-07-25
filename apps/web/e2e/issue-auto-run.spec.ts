import { expect, test, type Page } from "playwright/test";

const project = { id: "prj_1", name: "E2E Repository", status: "active" };
let workItem: Record<string, unknown> | null;
let autoRunStarted: boolean;

async function mockApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname === "/api/state") return route.fulfill({ json: {
      currentProjectId: project.id,
      projects: [project],
      projectTargets: [],
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
        id: "aur_1", status: "pr_open", projectId: project.id, worktreeId: "wt_1",
        intent: "Implement browser chain",
        decision: { path: "codex", decidedBy: "router", confidence: 0.96, rationale: "Repository coding task" },
        link: { type: "pr", number: 77, title: "Implement browser chain", url: "https://github.test/pull/77" },
        branchName: "ai/e2e-route",
      }] : [],
      summary: {
        total: autoRunStarted ? 1 : 0,
        active: 0,
        byStatus: autoRunStarted ? { pr_open: 1 } : {},
        outcomes: { prOpen: autoRunStarted ? 1 : 0, blocked: 0, failed: 0, reportPosted: 0, needsInput: 0 },
        successRate: autoRunStarted ? 1 : null,
        verification: { passed: 1, failed: 0, unverified: 0 },
        routing: { alignmentRate: 1, conclusive: 1 },
        blockedReasons: [],
        timeToPr: { count: 1, medianSeconds: 30, p90Seconds: 30 },
        rates: { humanEscalation: 0, selfRepair: 0 },
      },
    } });
    if (url.pathname === "/api/work-items/lwi_1" && method === "GET") {
      return route.fulfill({ json: { workItem, observability: {
        nextAction: "start_execution",
        attention: [],
        latestRun: {
          id: "aur_trace", status: "queued", updatedAt: "2026-07-24T00:01:00.000Z",
          invocationId: "inv_1", agentId: "agt_1",
        },
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
    if (url.pathname.endsWith("/comments")) return route.fulfill({ json: { comments: [] } });
    if (url.pathname.endsWith("/activity")) return route.fulfill({ json: { activities: [] } });
    if (url.pathname === "/api/work-items/lwi_1/auto-runs" && method === "POST") {
      autoRunStarted = true;
      return route.fulfill({ status: 201, json: {
        worktree: { id: "wt_1", projectId: project.id },
        autoRun: { id: "aur_1", worktreeId: "wt_1", status: "queued" },
      } });
    }
    if (url.pathname.startsWith("/api/projects/") && url.pathname.endsWith("/github")) {
      return route.fulfill({ json: { issues: [], pullRequests: [] } });
    }
    return route.fulfill({ json: {} });
  });
}

test.beforeEach(async ({ page }) => {
  workItem = null;
  autoRunStarted = false;
  await page.addInitScript(() => {
    window.localStorage.setItem("myagenttool.token", "e2e-token");
    window.localStorage.setItem("myagenttool-ui", JSON.stringify({ version: 1, state: { locale: "en" } }));
  });
  await mockApi(page);
});

test("creates an issue, routes AI execution, and reaches a pull request", async ({ page }) => {
  await page.goto("/?section=task");
  await page.getByRole("button", { name: /New local issue/i }).click();
  await page.getByLabel("Title").fill("Implement browser chain");
  await page.getByRole("button", { name: "Create issue" }).click();

  await page.getByText("Implement browser chain").first().click();
  const autoRunRequest = page.waitForRequest((request) =>
    request.url().endsWith("/api/work-items/lwi_1/auto-runs") && request.method() === "POST");
  await page.getByRole("button", { name: "Start Auto-run" }).click();
  await autoRunRequest;

  await page.goto("/?section=autoRuns&autoRun=aur_1");
  await expect(page.getByText("Implement browser chain").first()).toBeVisible();
  await expect(page.getByText("PR open", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("codex", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Open on GitHub" })).toHaveAttribute("href", "https://github.test/pull/77");
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

test("restores a task-first Trace after visiting scheduling Settings", async ({ page }) => {
  workItem = {
    id: "lwi_1", localRef: "LOCAL-1", projectId: project.id,
    title: "Explain local wait", body: "", type: "task", priority: "p1",
    status: "ready", state: "open", labels: [], assigneeIds: [],
    acceptanceCriteria: [], verificationRecords: [], revision: 1, archivedAt: null,
    updatedAt: "2026-07-24T00:00:00.000Z",
  };
  await page.goto("/?section=task&task=lwi_1&taskView=trace");
  const detail = page.getByRole("dialog", { name: "Local issue details" });
  await expect(detail).toBeVisible();
  await expect(detail.getByRole("button", { name: "Trace", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(detail.getByText("usr_local")).toBeVisible();
  await expect(detail.getByText("dev_local")).toBeVisible();
  await expect(detail.getByText("Queued", { exact: true })).toBeVisible();
  const summary = detail.getByRole("region", { name: "Task chain summary" });
  await expect(summary.getByText("Another local task is finishing", { exact: true })).toBeVisible();
  await expect(summary.getByText("0 retries", { exact: true })).toBeVisible();

  await detail.getByRole("button", { name: "Invocations" }).click();
  await expect(page).toHaveURL(/section=invocations.*invocation=inv_1/);
  await expect(page.getByRole("heading", { name: "Invocations" })).toBeVisible();
  await page.getByRole("button", { name: "Return to Tasks" }).click();
  await expect(page).toHaveURL(/section=task.*task=lwi_1.*taskView=trace/);
  await expect(page.getByRole("dialog", { name: "Local issue details" })).toBeVisible();

  await detail.getByRole("button", { name: "Scheduling settings" }).click();
  await expect(page).toHaveURL(/section=automation/);
  await page.getByRole("button", { name: "Return to Tasks" }).click();

  await expect(page).toHaveURL(/section=task.*task=lwi_1.*taskView=trace/);
  await expect(page.getByRole("dialog", { name: "Local issue details" })).toBeVisible();
});
