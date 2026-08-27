import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkItemContextCard } from "./work-item-context-card";
import type { LocalWorkItem } from "./task-view-types";

afterEach(cleanup);

describe("WorkItemContextCard", () => {
  it("shows one ordinary-user relationship across Channel, template, materials, and delivery", () => {
    const onOpenChannel = vi.fn();
    const summary = {
      schemaVersion: 1,
      origin: { kind: "channel", label: "采购协作", provider: "wechat_ilink", channelId: "chn_1", conversationId: "conv_1", threadId: "cth_1", sourceMessageCount: 2 },
      method: { kind: "template", name: "报价整理", definitionId: "rtd_1", familyId: "rtf_1", version: 3, expectedOutput: "比价表.xlsx", snapshotHash: "hash" },
      materials: [
        { id: "asset_1", title: "报价单.xlsx", role: "required_input", source: "channel_attachment", locality: "local", availability: "ready", versionPolicy: "pinned" },
        { id: "resource_1", title: "供应商台账", role: "change_target", source: "local_resource", locality: "local", availability: "selected", versionPolicy: "pinned" },
      ],
      delivery: { destination: "channel", label: "采购协作", channelId: "chn_1", conversationId: "conv_1", status: null },
    } as NonNullable<LocalWorkItem["taskContextSummary"]>;

    render(<WorkItemContextCard summary={summary} language="zh" onOpenChannel={onOpenChannel} />);

    const card = screen.getByTestId("work-item-context-card");
    expect(card.textContent).toContain("微信 · 采购协作");
    expect(card.textContent).toContain("报价整理");
    expect(card.textContent).toContain("Channel 附件");
    expect(card.textContent).toContain("允许修改");
    expect(card.textContent).toContain("先在任务中确认，再回传到 采购协作");
    fireEvent.click(screen.getByRole("button", { name: "查看 Channel" }));
    expect(onOpenChannel).toHaveBeenCalledOnce();
  });

  it("keeps a manual task simple when it has no extra materials", () => {
    const summary = {
      schemaVersion: 1,
      origin: { kind: "manual", label: "manual", provider: null, channelId: null, conversationId: null, threadId: null, sourceMessageCount: 0 },
      method: { kind: "custom", name: "本任务方案", definitionId: null, familyId: null, version: null, expectedOutput: null, snapshotHash: null },
      materials: [],
      delivery: { destination: "task", label: "task", channelId: null, conversationId: null, status: null },
    } as NonNullable<LocalWorkItem["taskContextSummary"]>;

    render(<WorkItemContextCard summary={summary} language="zh" />);
    expect(screen.getByTestId("work-item-context-card").textContent).toContain("手工创建");
    expect(screen.getByText("未指定额外资料，只使用任务说明和项目内容。")).toBeTruthy();
  });

  it("lets the user correct editable material roles and the Channel result destination", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const summary = {
      schemaVersion: 1,
      origin: { kind: "channel", label: "采购协作", provider: "wechat_ilink", channelId: "chn_1", conversationId: "conv_1", threadId: "cth_1", sourceMessageCount: 1 },
      method: { kind: "custom", name: "本任务方案", definitionId: null, familyId: null, version: null, expectedOutput: null, snapshotHash: null },
      materials: [{ id: "resource_1", title: "供应商台账", role: "query_source", source: "remote_resource", locality: "remote", availability: "selected", versionPolicy: "pinned" }],
      delivery: { destination: "channel", label: "采购协作", channelId: "chn_1", conversationId: "conv_1", status: null },
    } as NonNullable<LocalWorkItem["taskContextSummary"]>;

    render(<WorkItemContextCard summary={summary} language="zh" onUpdate={onUpdate} />);
    fireEvent.click(screen.getByRole("button", { name: "调整范围" }));
    fireEvent.change(screen.getByLabelText("供应商台账 资料作用"), { target: { value: "change_target" } });
    fireEvent.change(screen.getByDisplayValue("确认后回传到 采购协作"), { target: { value: "task" } });
    fireEvent.click(screen.getByRole("button", { name: "保存任务范围" }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({
      deliveryDestination: "task",
      materialRoles: [{ id: "resource_1", role: "change_target" }],
    }));
  });
});
