import { expect, test, type Page, type Route } from "playwright/test";

type Entry = "home" | "worktree";
type JsonBody = Record<string, unknown>;
type Deferred = { promise: Promise<void>; resolve: () => void };

const WORKTREE = {
  id: "worktree-1",
  projectId: "project-1",
  targetId: "target-1",
  branch: "feat/composer-retry",
  path: "D:\\repo-worktree",
  isMain: false,
  agentId: "agent-1",
  createdAt: "2026-08-03T00:00:00.000Z",
};

const AGENT = {
  id: "agent-1",
  name: "Local runner",
  status: "enabled",
  health: { status: "healthy" },
  location: { type: "local_device", deviceId: "device-1" },
  adapter: {
    type: "cli",
    command: "codex",
    permissionMode: "auto",
    models: ["gpt-5.6-sol", "gpt-5.6-terra"],
    defaultModel: "gpt-5.6-terra",
  },
};

function deferred(): Deferred {
  let resolve = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function invocationFrom(body: JsonBody) {
  return {
    id: "inv-composer-retry",
    status: "queued",
    projectId: "project-1",
    worktreeId: "worktree-1",
    agentId: "agent-1",
    createdAt: "2026-08-03T00:01:00.000Z",
    input: { task: body.task },
  };
}

class ComposerFaultRoutes {
  readonly uploadBodies: JsonBody[] = [];
  readonly invocationBodies: JsonBody[] = [];
  readonly uploadGate = deferred();
  readonly invocationGate = deferred();
  readonly serverInvocations = new Map<string, ReturnType<typeof invocationFrom>>();
  private exposeInvocations = false;

  constructor(
    readonly entry: Entry,
    readonly fault: "upload_abort" | "partial_rejection" | "invocation_response_lost",
  ) {}

  async install(page: Page) {
    await page.route("http://127.0.0.1:5001/api/**", async (route) => this.handle(route));
  }

  private state() {
    return {
      device: {
        id: "device-1",
        name: "Synthetic computer",
        status: "online",
        platform: "windows",
        architecture: "x64",
      },
      projects: [{ id: "project-1", name: "Example project" }],
      projectTargets: [{ id: "target-1", projectId: "project-1", state: "ready" }],
      worktrees: [WORKTREE],
      agents: [AGENT],
      events: [],
      invocations: this.exposeInvocations ? [...this.serverInvocations.values()] : [],
      approvalRequests: [],
      auditSummaries: [],
      troubleshootingReports: [],
      agentUsageSummaries: [],
      pendingDecisions: [],
      evidenceLedger: [],
    };
  }

  private async handle(route: Route) {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/state") return route.fulfill({ json: this.state() });
    if (pathname === "/api/worktrees/worktree-1/files") return route.fulfill({ json: { tree: [] } });
    if (pathname === "/api/worktrees/worktree-1/git") {
      return route.fulfill({ json: { branch: WORKTREE.branch, upstream: null, ahead: 0, behind: 0, changedFiles: 0, hasUpstream: false } });
    }
    if (pathname === "/api/worktrees/worktree-1/diff") {
      return route.fulfill({ json: { files: [], base: "main", diff: "", truncated: false } });
    }
    if (pathname === "/api/invocations/inv-composer-retry/events") {
      return route.fulfill({ json: { events: [], nextCursor: null, retentionTruncated: false } });
    }
    if (pathname === "/api/worktrees/worktree-1/attachments") return this.handleUpload(route);
    if (pathname === "/api/invocations") return this.handleInvocation(route);
    return route.fulfill({ json: {} });
  }

  private async handleUpload(route: Route) {
    const body = route.request().postDataJSON() as JsonBody;
    this.uploadBodies.push(body);
    const attempt = this.uploadBodies.length;
    if (attempt === 1 && this.fault !== "invocation_response_lost") {
      await this.uploadGate.promise;
      if (this.fault === "upload_abort") {
        return route.abort(this.entry === "home" ? "failed" : "timedout");
      }
      const files = body.files as { name: string }[];
      return route.fulfill({
        status: 201,
        json: {
          batchId: body.batchId,
          attachments: [{
            name: files[0]?.name,
            path: `.myagenttool/attachments/${body.batchId}/${files[0]?.name}`,
            bytes: 5,
          }],
          skipped: [{ name: files[1]?.name, reason: "too_large" }],
        },
      });
    }
    const files = body.files as { name: string }[];
    return route.fulfill({
      status: 201,
      json: {
        batchId: body.batchId,
        attachments: files.map((file) => ({
          name: file.name,
          path: `.myagenttool/attachments/${body.batchId}/${file.name}`,
          bytes: 5,
        })),
        skipped: [],
      },
    });
  }

  private async handleInvocation(route: Route) {
    const body = route.request().postDataJSON() as JsonBody;
    this.invocationBodies.push(body);
    const key = String(body.idempotencyKey);
    const invocation = this.serverInvocations.get(key) ?? invocationFrom(body);
    this.serverInvocations.set(key, invocation);
    if (this.fault === "invocation_response_lost" && this.invocationBodies.length === 1) {
      await this.invocationGate.promise;
      return route.abort("failed");
    }
    this.exposeInvocations = true;
    return route.fulfill({ status: 201, json: { invocation } });
  }
}

async function openComposer(page: Page, entry: Entry) {
  await page.addInitScript(({ section }) => {
    window.localStorage.setItem("myagenttool-ui", JSON.stringify({
      version: 1,
      state: {
        section,
        locale: "en-US",
        selectedAgentId: "agent-1",
        selectedProjectId: "project-1",
        selectedWorktreeId: "worktree-1",
      },
    }));
  }, { section: entry === "home" ? "dashboard" : "projects" });
  await page.goto(entry === "home" ? "/?section=dashboard" : "/?section=projects");
  const task = page.getByRole("textbox", { name: "Task" });
  await expect(task).toBeVisible({ timeout: 15_000 });
  const fieldset = task.locator("xpath=ancestor::fieldset[1]");
  const surface = task.locator("xpath=ancestor::*[@aria-busy][1]");
  return {
    task,
    fieldset,
    surface,
    file: fieldset.locator('input[type="file"]'),
    agent: fieldset.getByRole("combobox", { name: "Agent" }),
    model: fieldset.getByRole("combobox", { name: "Model" }),
    permission: fieldset.getByRole("combobox", { name: "Permission level" }),
    run: () => page.getByRole("button", {
      name: entry === "home" ? "Run on this computer" : "Run in this worktree",
    }),
  };
}

async function stageSnapshot(page: Page, entry: Entry, fileNames: string[]) {
  const composer = await openComposer(page, entry);
  await composer.file.setInputFiles(fileNames.map((name) => ({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(`content:${name}`),
  })));
  await composer.task.fill(`${entry} retry task`);
  await composer.model.selectOption("gpt-5.6-sol");
  await composer.permission.selectOption("full");
  return composer;
}

async function expectSnapshot(page: Page, composer: Awaited<ReturnType<typeof openComposer>>, entry: Entry, fileNames: string[]) {
  await expect(composer.surface).toHaveAttribute("aria-busy", "false");
  await expect(composer.fieldset).not.toHaveAttribute("disabled", "");
  await expect(composer.task).toBeEnabled();
  await expect(composer.file).toBeEnabled();
  await expect(composer.agent).toBeEnabled();
  await expect(composer.model).toBeEnabled();
  await expect(composer.permission).toBeEnabled();
  await expect(composer.run()).toBeEnabled();
  await expect(composer.task).toHaveValue(`${entry} retry task`);
  await expect(composer.agent).toHaveValue("agent-1");
  await expect(composer.model).toHaveValue("gpt-5.6-sol");
  await expect(composer.permission).toHaveValue("full");
  await expect(composer.surface).toContainText(WORKTREE.path);
  for (const name of fileNames) await expect(composer.fieldset.getByText(name, { exact: true })).toBeVisible();
}

async function expectAtomicallyLocked(page: Page, composer: Awaited<ReturnType<typeof openComposer>>) {
  await expect(composer.surface).toHaveAttribute("aria-busy", "true");
  await expect(composer.fieldset).toHaveAttribute("disabled", "");
  await expect(composer.task).toBeDisabled();
  await expect(composer.file).toBeDisabled();
  await expect(composer.agent).toBeDisabled();
  await expect(composer.model).toBeDisabled();
  await expect(composer.permission).toBeDisabled();
  await expect(page.getByRole("button", { name: "Starting…" })).toBeDisabled();
}

async function expectLockedThenRelease(
  page: Page,
  composer: Awaited<ReturnType<typeof openComposer>>,
  gate: Deferred,
) {
  try {
    await expectAtomicallyLocked(page, composer);
  } finally {
    gate.resolve();
  }
}

async function expectActionableFailure(page: Page, entry: Entry, expectedWorktreeMessage?: string) {
  if (entry === "home") {
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("The action could not be completed.");
    await expect(alert).toContainText("Check the task details and retry.");
    await expect(alert.getByRole("button", { name: "Retry" })).toBeVisible();
    return;
  }
  await expect(page.getByText(expectedWorktreeMessage ?? "Failed to fetch", { exact: false })).toBeVisible();
}

async function expectSuccessfulClear(page: Page, composer: Awaited<ReturnType<typeof openComposer>>, entry: Entry, fileNames: string[]) {
  await expect(composer.task).toHaveValue("");
  for (const name of fileNames) await expect(composer.fieldset.getByText(name, { exact: true })).toHaveCount(0);
  if (entry === "home") {
    await expect(page.getByRole("button", { name: new RegExp(`${entry} retry task`) })).toHaveCount(1);
  } else {
    await expect(page.getByText("inv-composer-retry · queued", { exact: true })).toHaveCount(1);
  }
}

for (const entry of ["home", "worktree"] as const) {
  test.describe(`${entry} composer fault recovery`, () => {
    test("keeps and reuses the full snapshot after attachment transport failure", async ({ page }) => {
      const routes = new ComposerFaultRoutes(entry, "upload_abort");
      await routes.install(page);
      const composer = await stageSnapshot(page, entry, ["network.txt"]);

      await composer.run().click();
      await expect.poll(() => routes.uploadBodies.length).toBe(1);
      await expectLockedThenRelease(page, composer, routes.uploadGate);

      await expectActionableFailure(page, entry);
      await expectSnapshot(page, composer, entry, ["network.txt"]);
      await composer.run().click();

      await expect.poll(() => routes.invocationBodies.length).toBe(1);
      expect(routes.uploadBodies).toHaveLength(2);
      expect(routes.uploadBodies[1]?.batchId).toBe(routes.uploadBodies[0]?.batchId);
      expect(routes.invocationBodies[0]?.idempotencyKey).toBe(routes.uploadBodies[0]?.batchId);
      expect(routes.serverInvocations.size).toBe(1);
      await expectSuccessfulClear(page, composer, entry, ["network.txt"]);
    });

    test("blocks invocation creation and restores every control after partial attachment rejection", async ({ page }) => {
      const routes = new ComposerFaultRoutes(entry, "partial_rejection");
      await routes.install(page);
      const composer = await stageSnapshot(page, entry, ["accepted.txt", "rejected.txt"]);

      await composer.run().click();
      await expect.poll(() => routes.uploadBodies.length).toBe(1);
      await expectLockedThenRelease(page, composer, routes.uploadGate);

      await expectActionableFailure(
        page,
        entry,
        "The server rejected one or more attachments. Fix or remove them before retrying.",
      );
      await expectSnapshot(page, composer, entry, ["accepted.txt", "rejected.txt"]);
      expect(routes.invocationBodies).toHaveLength(0);
      expect(routes.serverInvocations.size).toBe(0);
    });

    test("replays one invocation after its create response is lost", async ({ page }) => {
      const routes = new ComposerFaultRoutes(entry, "invocation_response_lost");
      await routes.install(page);
      const composer = await stageSnapshot(page, entry, ["response.txt"]);

      await composer.run().click();
      await expect.poll(() => routes.invocationBodies.length).toBe(1);
      await expectLockedThenRelease(page, composer, routes.invocationGate);

      await expectActionableFailure(page, entry);
      await expectSnapshot(page, composer, entry, ["response.txt"]);
      await composer.run().click();

      await expect.poll(() => routes.invocationBodies.length).toBe(2);
      expect(routes.uploadBodies).toHaveLength(2);
      const firstKey = routes.uploadBodies[0]?.batchId;
      expect(routes.uploadBodies[1]?.batchId).toBe(firstKey);
      expect(routes.invocationBodies[0]?.idempotencyKey).toBe(firstKey);
      expect(routes.invocationBodies[1]?.idempotencyKey).toBe(firstKey);
      expect(routes.serverInvocations.size).toBe(1);
      await expectSuccessfulClear(page, composer, entry, ["response.txt"]);
    });
  });
}
