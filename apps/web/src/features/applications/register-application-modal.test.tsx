import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegisterApplicationModal } from "@/features/applications/register-application-modal";
import { useUiStore } from "@/store/ui-store";

const apiMock = vi.hoisted(() => ({
  listKnownApplications: vi.fn(),
  quickRegisterApplication: vi.fn(),
  registerApplication: vi.fn(),
  createApplicationInstallPlan: vi.fn(),
  issueApprovalGrant: vi.fn(),
  queueApplicationInstall: vi.fn(),
  getApplicationInstallRun: vi.fn(),
  cancelApplicationInstall: vi.fn(),
}));

const consoleState = vi.hoisted(() => ({
  data: {
    projects: [],
    device: null,
    devices: [],
  } as Record<string, unknown>,
}));

vi.mock("@/data/use-console-state", () => ({ useConsoleState: () => consoleState }));
vi.mock("@/data/use-console-actions", () => ({
  api: apiMock,
  useAsyncAction: () => ({ pending: false, error: null, execute: async (action: () => Promise<unknown>) => { await action(); return true; } }),
}));

const catalog = {
  applications: [
    { name: "ccusage", displayName: "ccusage", aliases: ["ccusage"], command: "ccusage", installHint: "Managed install", runtimeRequirements: [{ runtimeId: "runtime_ccusage", required: true }] },
    { name: "codex", displayName: "Codex CLI", aliases: ["codex", "codex cli"], command: "codex", installHint: "Managed install", runtimeRequirements: [{ runtimeId: "runtime_codex", required: true }] },
  ],
};
const plan = {
  schemaVersion: "application-install-plan/v1",
  recipeVersion: "2026-07-14.2",
  planId: "aip_plan",
  fingerprint: "fingerprint",
  application: { name: "ccusage", displayName: "ccusage" },
  target: { projectId: null, deviceId: "dev_local", platform: "windows", architecture: "x64" },
  package: { provider: "npm", identifier: "ccusage", resolvedIdentifier: "ccusage@20.0.14", versionPolicy: { kind: "exact", channel: null, allowCallerOverride: false, exactVersion: "20.0.14" }, source: { kind: "npm-registry", registry: "https://registry.npmjs.org/", packageName: "ccusage" } },
  execution: { executable: "npm.cmd", args: ["install", "--global", "--registry=https://registry.npmjs.org/", "ccusage@20.0.14"], shell: false, elevated: false },
  risk: { level: "medium", reasons: ["installs_device_software"] },
  approval: { required: true, action: "application.install", bindsToPlanFingerprint: true },
  policy: { timeoutMs: 300000, cancellable: true },
  validity: { issuedAt: "2026-07-14T09:00:00.000Z", expiresAt: "2026-07-14T09:10:00.000Z", ttlMs: 600000 },
  postInstallProbe: { executable: "ccusage", args: ["--version"], timeoutMs: 15000 },
  rollback: { automatic: false, uninstallSupported: false, summary: "Operator review required." },
  summary: "Install ccusage",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useUiStore.setState({ selectedApplicationId: null });
});

function renderModal(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><RegisterApplicationModal open onClose={onClose} /></QueryClientProvider>);
  return onClose;
}

async function enterKnownApplication(value = "ccusage") {
  const input = screen.getByPlaceholderText("Codex, Claude, Git, or ccusage");
  fireEvent.change(input, { target: { value } });
  const button = screen.getByRole("button", { name: "Set up" }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
}

describe("RegisterApplicationModal governed setup", () => {
  it("skips installation when readiness already confirms the binary", async () => {
    consoleState.data = {
      projects: [],
      device: { id: "dev_local", name: "Workstation", status: "online", platform: "windows", architecture: "x64", lastSeenAt: null, applicationBinaryReadiness: [{ command: "ccusage", capabilityPrefix: "app.app_ccusage.wrapper.", status: "available", version: "20.0.14", checkedAt: "2026-07-14T00:00:00Z" }] },
      devices: [],
    };
    apiMock.listKnownApplications.mockResolvedValue(catalog);
    apiMock.quickRegisterApplication.mockResolvedValue({ application: { id: "app_ccusage", name: "ccusage" }, capabilities: [] });
    const onClose = renderModal();

    await enterKnownApplication();

    await waitFor(() => expect(apiMock.quickRegisterApplication).toHaveBeenCalledWith({ name: "ccusage" }));
    expect(await screen.findByText(/registered and ready/i)).toBeTruthy();
    expect(apiMock.createApplicationInstallPlan).not.toHaveBeenCalled();
    expect(useUiStore.getState().selectedApplicationId).toBe("app_ccusage");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("registers the Codex Application when its bundled CLI is already present", async () => {
    consoleState.data = {
      projects: [],
      device: { id: "dev_local", name: "Workstation", status: "online", platform: "windows", architecture: "x64", lastSeenAt: null, runtimeReadiness: [{ runtimeId: "runtime_codex", command: "codex", capabilityPrefix: "app.setup.codex.", status: "available", version: "0.144.6", checkedAt: "2026-07-14T00:00:00Z" }] },
      devices: [],
    };
    apiMock.listKnownApplications.mockResolvedValue(catalog);
    apiMock.quickRegisterApplication.mockResolvedValue({ application: { id: "app_codex", name: "Codex" }, capabilities: [] });
    renderModal();

    await enterKnownApplication("codex");

    expect(await screen.findByText(/Codex is registered and ready/i)).toBeTruthy();
    expect(apiMock.quickRegisterApplication).toHaveBeenCalledWith({ name: "codex" });
    expect(apiMock.createApplicationInstallPlan).not.toHaveBeenCalled();
    expect(useUiStore.getState().selectedApplicationId).toBe("app_codex");
  });

  it("stops before registration when Codex is installed but not authenticated", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    consoleState.data = {
      projects: [],
      device: { id: "dev_local", name: "Workstation", status: "online", platform: "windows", architecture: "x64", lastSeenAt: null, applicationBinaryReadiness: [{ command: "codex", capabilityPrefix: "app.setup.codex.", status: "available", version: "0.144.6", authenticationStatus: "unauthenticated", authenticationMethod: null, checkedAt: "2026-07-19T00:00:00Z" }] },
      devices: [],
    };
    apiMock.listKnownApplications.mockResolvedValue(catalog);
    renderModal();

    await enterKnownApplication("codex");

    expect(await screen.findByText(/Sign in with codex login/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy login command" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("codex login"));
    expect(await screen.findByText(/Copied codex login/i)).toBeTruthy();
    expect(apiMock.quickRegisterApplication).not.toHaveBeenCalled();
    expect(apiMock.createApplicationInstallPlan).not.toHaveBeenCalled();
  });

  it("shows a safe plan summary and requires explicit approval for a missing binary", async () => {
    consoleState.data = {
      projects: [],
      device: { id: "dev_local", name: "Workstation", status: "online", platform: "windows", architecture: "x64", lastSeenAt: null, applicationBinaryReadiness: [{ command: "ccusage", capabilityPrefix: "app.app_ccusage.wrapper.", status: "absent", version: null, checkedAt: "2026-07-14T00:00:00Z" }] },
      devices: [],
    };
    apiMock.listKnownApplications.mockResolvedValue(catalog);
    apiMock.createApplicationInstallPlan.mockResolvedValue({ plan });
    apiMock.issueApprovalGrant.mockResolvedValue({ token: "approval-token" });
    apiMock.queueApplicationInstall.mockResolvedValue({ run: { id: "air_1", planId: plan.planId, deviceId: "dev_local", status: "queued", progress: [], createdAt: "2026-07-14T00:00:00Z" } });
    apiMock.getApplicationInstallRun.mockResolvedValue({ run: { id: "air_1", planId: plan.planId, deviceId: "dev_local", status: "running", progress: [{ at: "2026-07-14T00:00:00Z", type: "started", summary: "Desktop Bridge accepted the plan." }], createdAt: "2026-07-14T00:00:00Z" } });
    renderModal();

    await enterKnownApplication();
    expect(await screen.findByRole("button", { name: "Approve & install" })).toBeTruthy();
    expect(screen.getByText("ccusage")).toBeTruthy();
    expect(screen.getByText("npm")).toBeTruthy();
    expect(screen.queryByText("npm.cmd")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Approve & install" }));
    await waitFor(() => expect(apiMock.issueApprovalGrant).toHaveBeenCalledWith("application.install", plan.planId));
    expect(apiMock.queueApplicationInstall).toHaveBeenCalledWith({ plan, approvalToken: "approval-token" });
    expect(await screen.findByRole("button", { name: "Cancel installation" })).toBeTruthy();
  });

  it("explains how to recover when the selected device is offline", async () => {
    consoleState.data = {
      projects: [],
      device: { id: "dev_local", name: "Offline laptop", status: "offline", platform: "windows", architecture: "x64", lastSeenAt: null, applicationBinaryReadiness: [] },
      devices: [],
    };
    apiMock.listKnownApplications.mockResolvedValue(catalog);
    renderModal();
    await enterKnownApplication();
    expect(await screen.findByText(/Start Desktop Bridge or choose an online device/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
