import { execFileSync } from "node:child_process";
import type { Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "playwright/test";

type RuntimeServices = {
  httpDependencies: {
    completeInvocation: (invocation: Record<string, unknown>, body: Record<string, unknown>) => void;
  };
  closeRuntimeServices: () => Promise<void>;
  savePersistentState: () => unknown;
};

let apiBase = "";
let root = "";
let repositoryRoot = "";
let stateStorePath = "";
let server: Server | null = null;
let runtimeServices: RuntimeServices | null = null;
let runtimeState: Record<string, any> | null = null;
let serverPort = 0;

const originalEnvironment = {
  verifyCommands: process.env.MYAGENTTOOL_AUTORUN_VERIFY_COMMANDS_JSON,
  verifyAuto: process.env.MYAGENTTOOL_AUTORUN_VERIFY_AUTO,
  judgeCommand: process.env.MYAGENTTOOL_AUTORUN_JUDGE_COMMAND_JSON,
};

async function waitForValue<T>(read: () => T | null | undefined, message: string, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${message}.`);
}

function git(...args: string[]) {
  return execFileSync("git", ["-C", repositoryRoot, ...args], { encoding: "utf8" }).trim();
}

async function stopServer({ persist = true } = {}) {
  if (persist) runtimeServices?.savePersistentState();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  await runtimeServices?.closeRuntimeServices();
  server = null;
  runtimeServices = null;
}

async function bootServer(port = 0) {
  const { createServerState } = await import("../../server/src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../server/src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../server/src/runtime/http-server.mjs");
  const now = () => new Date().toISOString();
  const { defaultProject, state } = createServerState({ defaultProjectPath: repositoryRoot, now });

  state.device.status = "online";
  state.device.unlinkState = "linked";
  const codex = state.agents.find((agent: { id: string }) => agent.id === "agt_codex_cli");
  if (!codex) throw new Error("The deterministic coding fixture requires the governed Codex agent record.");
  codex.status = "available";
  codex.health = { status: "healthy", checkedAt: now(), message: "Deterministic E2E executor ready." };
  defaultProject.defaultAgentId = codex.id;
  defaultProject.autoExecutionEnabled = true;
  defaultProject.verifyCommandName = "ordinary-coding-e2e";

  runtimeServices = createServerRuntimeServices({
    namespace: "ordinary-coding-real-e2e",
    protocolVersion: "0.0.0",
    state,
    defaultProject,
    defaultProjectPath: repositoryRoot,
    persistenceEnabled: true,
    stateStorePath,
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  }) as RuntimeServices;
  runtimeState = state;
  server = createHttpServer({
    host: "127.0.0.1",
    port,
    namespace: "ordinary-coding-real-e2e",
    protocolVersion: "0.0.0",
    ...runtimeServices.httpDependencies,
  });
  await new Promise<void>((resolve) => server!.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Real ordinary-coding server address unavailable.");
  serverPort = address.port;
  apiBase = `http://127.0.0.1:${serverPort}`;
}

async function completeCodingAttempt({
  summary,
  write,
}: {
  summary: string;
  write: (worktreePath: string) => void;
}) {
  const state = runtimeState!;
  const autoRun = await waitForValue(
    () => state.autoRuns?.find((run: Record<string, unknown>) => run.invocationId && run.worktreeId),
    "the real Auto-run and Worktree",
  );
  const invocation = await waitForValue(
    () => state.invocations?.find((candidate: { id: string }) => candidate.id === autoRun.invocationId),
    "the coding invocation",
  );
  const worktree = state.worktrees.find((candidate: { id: string }) => candidate.id === autoRun.worktreeId);
  if (!worktree?.path) throw new Error("The Auto-run did not materialize a confined Worktree.");
  write(worktree.path);
  runtimeServices!.httpDependencies.completeInvocation(invocation, {
    status: "succeeded",
    summary,
    result: { summary, output: { summary, latestMessage: summary } },
  });

  try {
    await waitForValue(
      () => autoRun.status === "done" && autoRun.deliveryReview?.invocationId ? autoRun.deliveryReview : null,
      "verification and independent delivery review",
      30_000,
    );
  } catch (error) {
    throw new Error([
      String(error instanceof Error ? error.message : error),
      `Auto-run status: ${autoRun.status ?? "unknown"}`,
      `Auto-run error: ${autoRun.error ?? "none"}`,
      `Verification: ${JSON.stringify(autoRun.verification ?? null)}`,
      `Delivery review: ${JSON.stringify(autoRun.deliveryReview ?? null)}`,
    ].join("\n"));
  }
  const reviewInvocation = state.invocations.find(
    (candidate: { id: string }) => candidate.id === autoRun.deliveryReview.invocationId,
  );
  runtimeServices!.httpDependencies.completeInvocation(reviewInvocation, {
    status: "succeeded",
    summary: "No findings were identified; the change and regression coverage look good.",
    result: {
      summary: "No findings were identified; the change and regression coverage look good.",
      output: {
        structured: true,
        verdict: "approved",
        summary: "No findings were identified; the change and regression coverage look good.",
        findings: [],
      },
    },
  });
  await waitForValue(
    () => autoRun.deliveryReview?.status === "completed" ? autoRun.deliveryReview : null,
    "the approved delivery review",
  );
  runtimeServices!.savePersistentState();
  return { autoRun, worktree };
}

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "myagenttool-ordinary-coding-"));
  repositoryRoot = join(root, "repository");
  stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(join(repositoryRoot, "src"), { recursive: true });
  mkdirSync(join(repositoryRoot, "test"), { recursive: true });
  mkdirSync(dirname(stateStorePath), { recursive: true });

  writeFileSync(join(repositoryRoot, "src", "session.mjs"), [
    "export function sessionCanBeReused(session) {",
    "  return Boolean(session?.token);",
    "}",
    "",
  ].join("\n"));
  writeFileSync(join(repositoryRoot, "test", "session.test.mjs"), [
    "import assert from \"node:assert/strict\";",
    "import test from \"node:test\";",
    "import { sessionCanBeReused } from \"../src/session.mjs\";",
    "",
    "test(\"rejects expired sessions\", () => {",
    "  assert.equal(sessionCanBeReused({ token: \"expired\", expiresAt: 1_000 }, 1_000), false);",
    "});",
    "",
    "test(\"keeps active sessions\", () => {",
    "  assert.equal(sessionCanBeReused({ token: \"active\", expiresAt: 1_001 }, 1_000), true);",
    "});",
    "",
  ].join("\n"));
  const judgePath = join(root, "deterministic-acceptance-judge.mjs");
  writeFileSync(judgePath, [
    "process.stdin.resume();",
    "process.stdin.on(\"end\", () => {",
    "  process.stdout.write(JSON.stringify({ solved: true, confidence: 1, summary: \"Deterministic fixture accepted the verified change.\", gaps: [] }));",
    "});",
    "",
  ].join("\n"));

  execFileSync("git", ["init", "-b", "main", repositoryRoot]);
  git("config", "user.email", "ordinary-e2e@example.test");
  git("config", "user.name", "Ordinary E2E");
  git("add", ".");
  git("commit", "-m", "seed session expiry fixture");

  process.env.MYAGENTTOOL_AUTORUN_VERIFY_COMMANDS_JSON = JSON.stringify({
    "ordinary-coding-e2e": [process.execPath, "--test", "test/session.test.mjs"],
  });
  process.env.MYAGENTTOOL_AUTORUN_VERIFY_AUTO = "0";
  process.env.MYAGENTTOOL_AUTORUN_JUDGE_COMMAND_JSON = JSON.stringify([process.execPath, judgePath]);
  await bootServer();
});

test.afterAll(async () => {
  await stopServer();
  if (originalEnvironment.verifyCommands === undefined) delete process.env.MYAGENTTOOL_AUTORUN_VERIFY_COMMANDS_JSON;
  else process.env.MYAGENTTOOL_AUTORUN_VERIFY_COMMANDS_JSON = originalEnvironment.verifyCommands;
  if (originalEnvironment.verifyAuto === undefined) delete process.env.MYAGENTTOOL_AUTORUN_VERIFY_AUTO;
  else process.env.MYAGENTTOOL_AUTORUN_VERIFY_AUTO = originalEnvironment.verifyAuto;
  if (originalEnvironment.judgeCommand === undefined) delete process.env.MYAGENTTOOL_AUTORUN_JUDGE_COMMAND_JSON;
  else process.env.MYAGENTTOOL_AUTORUN_JUDGE_COMMAND_JSON = originalEnvironment.judgeCommand;
  if (root && existsSync(root)) rmSync(root, { recursive: true, force: true });
});

test("ordinary user completes a deterministic real-Worktree coding task through revision and local delivery", async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    window.localStorage.setItem("myagenttool-ui", JSON.stringify({
      version: 1,
      state: { locale: "en-US", section: "task", experienceMode: "ordinary" },
    }));
  });
  await page.goto(`/?section=task&api=${encodeURIComponent(apiBase)}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "New task" }).click();
  const createDialog = page.getByRole("dialog", { name: "New task" });
  await createDialog.getByRole("textbox", { name: "Create a task" })
    .fill("Implement expiry handling in the login session module");
  await createDialog.getByRole("button", { name: "Save only" }).click();
  await expect(createDialog.getByTestId("home-intent-task-plan")).toBeVisible();
  await createDialog.getByRole("button", { name: "Confirm and save" }).click();
  await expect(createDialog.getByText("Task created and added to your boards.")).toBeVisible();
  await createDialog.getByRole("button", { name: "View task" }).click();

  let detail = page.getByRole("dialog", { name: "Local issue details" });
  await expect(detail.getByRole("button", { name: "Professional view" })).toHaveAttribute("aria-pressed", "false");
  await detail.getByRole("button", { name: "Let AI start" }).click();
  await expect(detail.getByText(/task is set to automatic/i)).toBeVisible();

  const first = await completeCodingAttempt({
    summary: "Implemented expiry checks for active and expired login sessions.",
    write: (worktreePath) => {
      writeFileSync(join(worktreePath, "src", "session.mjs"), [
        "export function sessionCanBeReused(session, nowMs) {",
        "  return Boolean(session?.token) && session.expiresAt > nowMs;",
        "}",
        "",
      ].join("\n"));
    },
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  detail = page.getByRole("dialog", { name: "Local issue details" });
  await expect(detail.getByText("Implemented expiry checks for active and expired login sessions.").first()).toBeVisible();

  await detail.getByRole("button", { name: "Ask AI to revise" }).click();
  await detail.locator("textarea").fill("Also reject malformed timestamps and add regression coverage.");
  await detail.getByRole("button", { name: "Send changes to AI" }).click();
  await expect(detail.getByText("Your changes were recorded and AI has started another pass.")).toBeVisible();

  const second = await completeCodingAttempt({
    summary: "Hardened expiry validation and added malformed-session regression coverage.",
    write: (worktreePath) => {
      writeFileSync(join(worktreePath, "src", "session.mjs"), [
        "export function sessionCanBeReused(session, nowMs) {",
        "  if (!session?.token || typeof session.expiresAt !== \"number\" || !Number.isFinite(session.expiresAt)) return false;",
        "  if (typeof nowMs !== \"number\" || !Number.isFinite(nowMs)) return false;",
        "  return session.expiresAt > nowMs;",
        "}",
        "",
      ].join("\n"));
      writeFileSync(join(worktreePath, "test", "session.test.mjs"), [
        "import assert from \"node:assert/strict\";",
        "import test from \"node:test\";",
        "import { sessionCanBeReused } from \"../src/session.mjs\";",
        "",
        "test(\"rejects expired sessions\", () => {",
        "  assert.equal(sessionCanBeReused({ token: \"expired\", expiresAt: 1_000 }, 1_000), false);",
        "});",
        "",
        "test(\"keeps active sessions\", () => {",
        "  assert.equal(sessionCanBeReused({ token: \"active\", expiresAt: 1_001 }, 1_000), true);",
        "});",
        "",
        "test(\"rejects malformed timestamps\", () => {",
        "  assert.equal(sessionCanBeReused({ token: \"malformed\", expiresAt: \"later\" }, 1_000), false);",
        "  assert.equal(sessionCanBeReused({ token: \"missing\" }, 1_000), false);",
        "});",
        "",
      ].join("\n"));
    },
  });
  expect(second.autoRun.id).toBe(first.autoRun.id);
  expect(second.worktree.id).toBe(first.worktree.id);
  expect(second.autoRun.outcomeHistory).toHaveLength(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  detail = page.getByRole("dialog", { name: "Local issue details" });
  await expect(detail.getByText("Hardened expiry validation and added malformed-session regression coverage.").first()).toBeVisible();
  const intentSummary = detail.getByTestId("work-item-intent-summary");
  await expect(intentSummary.getByText("Here’s what I understand")).toBeVisible();
  await expect(intentSummary.getByText("Implement expiry handling in the login session module")).toBeVisible();
  expect(await intentSummary.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const reviewChanges = detail.getByRole("button", { name: "Review changes" });
  await reviewChanges.focus();
  await expect(reviewChanges).toBeFocused();
  await reviewChanges.press("Enter");
  await expect(page).toHaveURL(/section=projects/);
  await expect(page.getByRole("button", { name: "src/session.mjs", exact: true })).toBeVisible();
  await expect(page.getByText(/Number\.isFinite\(session\.expiresAt\)/).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const returnToTask = page.getByRole("button", { name: "Return to task" });
  await returnToTask.focus();
  await expect(returnToTask).toBeFocused();
  await returnToTask.press("Enter");
  await expect(page).toHaveURL(/section=task/);
  detail = page.getByRole("dialog", { name: "Local issue details" });
  await detail.getByRole("button", { name: "Approve and apply locally" }).click();
  const confirm = page.getByRole("dialog", { name: "Approve and apply this delivery locally?" });
  await expect(confirm.getByText(/No remote branch will be pushed or merged/)).toBeVisible();
  await confirm.getByRole("button", { name: "Apply locally" }).click();
  await expect(detail.getByText("This work is complete")).toBeVisible();

  expect(git("branch", "--show-current")).toBe("main");
  expect(git("remote")).toBe("");
  expect(readFileSync(join(repositoryRoot, "src", "session.mjs"), "utf8")).toContain("Number.isFinite(session.expiresAt)");
  expect(git("diff", "--name-only", "HEAD~1", "HEAD").split("\n").sort()).toEqual([
    "src/session.mjs",
    "test/session.test.mjs",
  ]);

  const receipt = detail.getByLabel("Local delivery receipt");
  await expect(receipt.getByText("Applied successfully")).toBeVisible();
  await expect(receipt.getByText("main")).toBeVisible();
  await expect(receipt.getByText("2 file(s) applied")).toBeVisible();
  await expect(receipt.getByText(/node --test test\/session\.test\.mjs/)).toBeVisible();

  await stopServer();
  await bootServer(serverPort);
  await page.reload({ waitUntil: "domcontentloaded" });
  const restored = page.getByRole("dialog", { name: "Local issue details" });
  await expect(restored.getByText("This work is complete")).toBeVisible();
  await expect(restored.getByLabel("Local delivery receipt").getByText("Applied successfully")).toBeVisible();
  await expect(restored.getByLabel("Local delivery receipt").getByText("2 file(s) applied")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
