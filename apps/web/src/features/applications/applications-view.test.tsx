import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationsView } from "@/features/applications/applications-view";
import { useUiStore } from "@/store/ui-store";
import type { ConsoleSnapshot } from "@/lib/console-state";

const apiMock = vi.hoisted(() => ({
  fetchState: vi.fn(),
  registerApplication: vi.fn(),
}));

vi.mock("@/lib/api-client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client")),
  fetchState: apiMock.fetchState,
  api: {
    registerApplication: apiMock.registerApplication,
  },
}));

beforeEach(() => {
  apiMock.fetchState.mockResolvedValue(consoleState());
  useUiStore.setState({
    section: "applications",
    selectedApplicationId: null,
    selectedApplicationRun: null,
    selectedApplicationEventLevel: "all",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useUiStore.setState({
    section: "dashboard",
    selectedApplicationId: null,
    selectedApplicationRun: null,
    selectedApplicationEventLevel: "all",
  });
});

describe("ApplicationsView timeline routing", () => {
  it("selects an application timeline level from attention shortcuts", async () => {
    renderWithClient(createElement(ApplicationsView));

    fireEvent.click(await screen.findByRole("button", { name: /View errors/i }));

    expect(useUiStore.getState().selectedApplicationId).toBe("app_failed");
    expect(useUiStore.getState().selectedApplicationEventLevel).toBe("error");

    fireEvent.click(screen.getByText("Docs Ready"));

    expect(useUiStore.getState().selectedApplicationId).toBe("app_ready");
    expect(useUiStore.getState().selectedApplicationEventLevel).toBe("all");
  });
});

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchInterval: false },
      mutations: { retry: false },
    },
  });
  return render(createElement(QueryClientProvider, { client }, ui));
}

function consoleState(): ConsoleSnapshot {
  return {
    device: {
      id: "dev_local",
      name: "Local Workstation",
      status: "online",
      platform: "win32",
      architecture: "x64",
      lastSeenAt: "2026-07-06T00:00:00.000Z",
    },
    agent: null,
    agents: [],
    invocations: [],
    events: [],
    auditSummaries: [],
    applications: [{
      id: "app_failed",
      name: "Docs Failed",
      kind: "repository",
      source: { type: "local", path: "/apps/failed" },
      status: "failed",
      lifecycle: { error: "Probe failed." },
      createdAt: "2026-07-06T00:00:00.000Z",
      updatedAt: "2026-07-06T03:00:00.000Z",
    }, {
      id: "app_ready",
      name: "Docs Ready",
      kind: "repository",
      source: { type: "local", path: "/apps/ready" },
      status: "active",
      probe: { capabilities: [] },
      orchestrationIds: ["routine"],
      createdAt: "2026-07-06T00:00:00.000Z",
      updatedAt: "2026-07-06T02:00:00.000Z",
    }],
    applicationRecoveryActions: [],
  };
}
