import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import { installAutoRunTranslations } from "@/lib/i18n/auto-run-resources";
import { installExecutionUiTranslations } from "@/lib/i18n/execution-ui-resources";
import { AutoRunActions } from "./auto-run-actions";
import type { AutoRunRecord } from "./auto-run-model";

const mocks = vi.hoisted(() => ({
  retryAutoRun: vi.fn(),
  cancelAutoRun: vi.fn(),
  approveApproval: vi.fn(),
  denyApproval: vi.fn(),
  reverify: vi.fn(),
}));

vi.mock("@/data/use-console-actions", () => ({
  api: {
    retryAutoRun: mocks.retryAutoRun,
    cancelAutoRun: mocks.cancelAutoRun,
    approveApproval: mocks.approveApproval,
    denyApproval: mocks.denyApproval,
  },
}));
vi.mock("./auto-run-api", () => ({ autoRunApi: { reverify: mocks.reverify } }));

installExecutionUiTranslations();
installAutoRunTranslations();

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  for (const mock of Object.values(mocks)) mock.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function renderActions(run: AutoRunRecord, pending = false) {
  const onAction = vi.fn(async (_runId: string, action: () => Promise<unknown>) => {
    await action();
  });
  render(<AutoRunActions run={run} pending={pending} onAction={onAction} />);
  return onAction;
}

describe("AutoRunActions", () => {
  it("routes retry and re-verification through the shared action coordinator", async () => {
    const retryAction = renderActions({ id: "run-failed", status: "failed" });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mocks.retryAutoRun).toHaveBeenCalledWith("run-failed"));
    expect(retryAction).toHaveBeenCalledWith("run-failed", expect.any(Function));

    cleanup();
    const verifyAction = renderActions({ id: "run-done", status: "done" });
    fireEvent.click(screen.getByRole("button", { name: "重新验证" }));
    await waitFor(() => expect(mocks.reverify).toHaveBeenCalledWith("run-done"));
    expect(verifyAction).toHaveBeenCalledWith("run-done", expect.any(Function));
  });

  it("requires confirmation before cancelling an active run", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const onAction = renderActions({ id: "run-active", status: "running" });
    const cancel = screen.getByRole("button", { name: "Cancel" });

    fireEvent.click(cancel);
    expect(onAction).not.toHaveBeenCalled();
    expect(mocks.cancelAutoRun).not.toHaveBeenCalled();

    fireEvent.click(cancel);
    await waitFor(() => expect(mocks.cancelAutoRun).toHaveBeenCalledWith("run-active"));
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("approves immediately but confirms before denying a pending approval", async () => {
    const run = {
      id: "run-approval",
      status: "awaiting_approval",
      pendingApproval: { id: "approval-1", riskLevel: "high", riskTags: ["shell"], summary: "Install" },
    } as AutoRunRecord;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderActions(run);

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(mocks.approveApproval).toHaveBeenCalledWith("approval-1"));

    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    await waitFor(() => expect(mocks.denyApproval).toHaveBeenCalledWith("approval-1"));
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("disables every visible mutation while another action is pending", () => {
    renderActions({ id: "run-pending", status: "blocked", verification: { verified: true, passed: false } }, true);
    for (const button of screen.getAllByRole("button")) expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
