import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import CreateLocalWorkItemForm from "./create-local-work-item-form";

const mocks = vi.hoisted(() => ({
  createWorkItem: vi.fn(),
  suggestWorkItemDraft: vi.fn(),
  inspect: vi.fn(),
}));

vi.mock("@/data/use-console-actions", () => ({
  api: {
    createWorkItem: mocks.createWorkItem,
    suggestWorkItemDraft: mocks.suggestWorkItemDraft,
  },
  useAsyncAction: () => ({
    pending: false,
    error: null,
    execute: async (action: () => Promise<unknown>) => {
      try {
        await action();
        return true;
      } catch {
        return false;
      }
    },
  }),
}));

vi.mock("./article-workflow-api", () => ({
  articleApi: { inspect: mocks.inspect },
}));

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  mocks.inspect.mockResolvedValue({
    inspection: {
      sourceUrl: "https://mp.weixin.qq.com/s/example",
      canonicalUrl: "https://mp.weixin.qq.com/s/example",
      resolvedUrl: "https://mp.weixin.qq.com/s/example",
      provider: "wechat",
      contentType: "article",
      title: "A useful article",
      author: "Author",
      publishedAt: "2026-08-08",
      publishedAtSource: "source",
      textLength: 1200,
      media: [],
      mediaCounts: { images: 2, audio: 0, video: 0, unavailable: 0 },
      markdownPreview: "Preview",
      fetchedAt: "2026-08-08T00:00:00.000Z",
    },
  });
  mocks.createWorkItem.mockResolvedValue({ workItem: { id: "lwi_article" } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CreateLocalWorkItemForm", () => {
  it("creates a URL issue for the automatic AI scheduler instead of running a standalone import", async () => {
    const onDone = vi.fn();
    render(
      <CreateLocalWorkItemForm
        projects={[{ id: "prj_1", name: "Content" }]}
        users={[]}
        initialProjectId="prj_1"
        onDone={onDone}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Import link" }));
    fireEvent.change(screen.getByLabelText("Public article URL"), {
      target: { value: "https://mp.weixin.qq.com/s/example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));

    expect(await screen.findByText("A useful article")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Expected completion date"), {
      target: { value: "2026-08-10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create and let AI handle it" }));

    await waitFor(() => expect(mocks.createWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "prj_1",
      title: "A useful article",
      body: expect.stringContaining("Source: https://mp.weixin.qq.com/s/example"),
      status: "ready",
      executionPolicy: "auto",
      waitingOn: "ai",
      plannedDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      dueDate: "2026-08-10",
      intakeChannel: "import",
    })));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
