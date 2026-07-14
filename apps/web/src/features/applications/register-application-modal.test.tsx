import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegisterApplicationModal } from "@/features/applications/register-application-modal";
import { useUiStore } from "@/store/ui-store";

const apiMock = vi.hoisted(() => ({
  listKnownApplications: vi.fn(),
  quickRegisterApplication: vi.fn(),
  registerApplication: vi.fn(),
}));

vi.mock("@/data/use-console-state", () => ({
  useConsoleState: () => ({ data: { projects: [] } }),
}));

vi.mock("@/data/use-console-actions", () => ({
  api: apiMock,
  useAsyncAction: () => ({
    pending: false,
    error: null,
    execute: async (action: () => Promise<unknown>) => {
      await action();
      return true;
    },
  }),
}));

afterEach(() => {
  vi.clearAllMocks();
  useUiStore.setState({ selectedApplicationId: null });
});

describe("RegisterApplicationModal quick setup", () => {
  it("registers a governed known application from its short name", async () => {
    apiMock.listKnownApplications.mockResolvedValue({
      applications: [{
        name: "ccusage",
        displayName: "ccusage",
        aliases: ["ccusage"],
        command: "ccusage",
        installHint: "Install with npm install -g ccusage, then re-run setup.",
      }],
    });
    apiMock.quickRegisterApplication.mockResolvedValue({
      application: { id: "app_ccusage", name: "ccusage" },
      capabilities: [],
    });
    const onClose = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <RegisterApplicationModal open onClose={onClose} />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByPlaceholderText("ccusage, git, or claude"), { target: { value: "ccusage" } });
    fireEvent.click(screen.getByRole("button", { name: "Set up" }));

    await waitFor(() => expect(apiMock.quickRegisterApplication).toHaveBeenCalledWith({ name: "ccusage" }));
    expect(useUiStore.getState().selectedApplicationId).toBe("app_ccusage");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
