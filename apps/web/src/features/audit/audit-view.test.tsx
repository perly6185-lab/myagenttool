import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditView } from "@/features/audit/audit-view";
import { useUiStore } from "@/store/ui-store";
import type { ConsoleSnapshot } from "@/lib/console-state";

const apiMock = vi.hoisted(() => ({
  fetchState: vi.fn(),
}));

vi.mock("@/lib/api-client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client")),
  fetchState: apiMock.fetchState,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useUiStore.setState({
    section: "dashboard",
    selectedEvidenceId: null,
  });
});

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(createElement(QueryClientProvider, { client }, ui));
}

function auditState(): ConsoleSnapshot {
  return {
    currentProjectId: null,
    device: {
      id: "dev_local",
      name: "Local Workstation",
      status: "online",
      platform: "win32",
      architecture: "x64",
      lastSeenAt: "2026-07-08T02:00:00.000Z",
    },
    projects: [],
    worktrees: [],
    agent: null,
    agents: [],
    invocations: [],
    events: [],
    auditSummaries: [],
    evidenceCenterRecords: [{
      id: "app_smoke_1",
      type: "application_smoke_evidence",
      source: "application_smoke_evidence",
      redactionState: "summary_with_checklist",
      repoPath: "D:/repo/app",
      summary: "Application smoke evidence for ccusage · 2/3 checks complete",
      detail: "applicationId=app_ccusage · completed=2/3 · completedSteps=register, probe",
      marker: "managed",
      createdAt: "2026-07-08T02:00:00.000Z",
    }],
  };
}

describe("AuditView Evidence Center", () => {
  it("renders and selects Application smoke evidence", async () => {
    apiMock.fetchState.mockResolvedValue(auditState());
    useUiStore.setState({ section: "audit", selectedEvidenceId: "app_smoke_1" });

    renderWithClient(createElement(AuditView));

    expect((await screen.findAllByText(/Application smoke evidence for ccusage/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Application smoke").length).toBeGreaterThan(0);
    expect(screen.getByText(/completed=2\/3/)).toBeTruthy();
    expect(screen.getByText("selected")).toBeTruthy();
  });

  it("updates selected evidence when a record is clicked", async () => {
    apiMock.fetchState.mockResolvedValue(auditState());

    renderWithClient(createElement(AuditView));

    const record = await screen.findByRole("button", {
      name: /Application smoke evidence for ccusage/,
    });
    fireEvent.click(record);

    await waitFor(() => {
      expect(useUiStore.getState().selectedEvidenceId).toBe("app_smoke_1");
    });
  });
});
