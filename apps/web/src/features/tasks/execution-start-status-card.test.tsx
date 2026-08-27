import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutionStartStatusCard } from "./execution-start-status-card";
import type { LocalWorkItem } from "./task-view-types";

afterEach(() => cleanup());

function receipt(overrides: Partial<NonNullable<LocalWorkItem["executionStartReceipt"]>> = {}): NonNullable<LocalWorkItem["executionStartReceipt"]> {
  return {
    schemaVersion: 1,
    id: "wsr_1",
    status: "queued",
    requestedAt: "2026-08-27T02:00:00.000Z",
    requestedBy: "usr_1",
    confirmedRevision: 4,
    contractDigest: "digest",
    updatedAt: "2026-08-27T02:00:00.000Z",
    startedAt: null,
    executionKind: null,
    targetId: null,
    agentId: null,
    phase: null,
    reasonCode: "waiting_capacity",
    reasonDetail: null,
    cancelledAt: null,
    cancelledBy: null,
    canCancel: true,
    ...overrides,
  };
}

describe("execution start status card", () => {
  it("explains a capacity queue and exposes safe actions", () => {
    const recheck = vi.fn();
    const cancel = vi.fn();
    render(<ExecutionStartStatusCard
      receipt={receipt()}
      language="en"
      pendingAction={null}
      onRecheck={recheck}
      onCancel={cancel}
      onOpenDetails={() => {}}
    />);

    expect(screen.getByText("AI accepted the task and is queued")).toBeTruthy();
    expect(screen.getByText(/capacity is full/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Recheck" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel this start" }));
    expect(recheck).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("shows the bound execution and removes cancellation after start", () => {
    render(<ExecutionStartStatusCard
      receipt={receipt({
        status: "started",
        phase: "running",
        targetId: "aur_1",
        agentId: "agt_1",
        startedAt: "2026-08-27T02:00:03.000Z",
        reasonCode: null,
        canCancel: false,
      })}
      language="en"
      agentName="Task assistant"
      pendingAction={null}
      onRecheck={() => {}}
      onOpenDetails={() => {}}
    />);

    expect(screen.getByText("AI has started")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.queryByText("running")).toBeNull();
    expect(screen.getByText("Task assistant")).toBeTruthy();
    expect(screen.getByText("aur_1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel this start" })).toBeNull();
  });

  it("turns a technical capability reason into ordinary language", () => {
    render(<ExecutionStartStatusCard
      receipt={receipt({
        status: "blocked",
        reasonCode: "specialized_capability_unavailable:content_video",
        reasonDetail: "specialized_capability_unavailable:content_video",
      })}
      language="zh"
      pendingAction={null}
      onRecheck={() => {}}
      onOpenDetails={() => {}}
    />);

    expect(screen.getByText("等待处理")).toBeTruthy();
    expect(screen.getByText(/能力或连接器/)).toBeTruthy();
    expect(screen.queryByText(/specialized_capability_unavailable/)).toBeNull();
  });

  it("labels rechecking without pretending cancellation is in progress", () => {
    render(<ExecutionStartStatusCard
      receipt={receipt()}
      language="en"
      pendingAction="recheck"
      onRecheck={() => {}}
      onCancel={() => {}}
      onOpenDetails={() => {}}
    />);

    expect((screen.getByRole("button", { name: "Rechecking…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel this start" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Cancelling…")).toBeNull();
  });
});
