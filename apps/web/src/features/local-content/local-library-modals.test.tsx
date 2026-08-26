import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PreviewModal } from "./local-library-modals";
import { COPY } from "./local-library-copy";
import { localContentApi } from "./local-content-api";

vi.mock("./local-content-api", () => ({
  localContentApi: {
    previewAssetBytes: vi.fn(),
  },
}));

const target = {
  id: "lc_article_1",
  kind: "article" as const,
  title: "本地文章",
  summary: "一篇本地文章",
  projectId: null,
  workItemId: null,
  storageMode: "managed" as const,
  root: null,
  relativePath: "articles/article.md",
  stateLocator: null,
  mimeType: "text/markdown",
  size: 128,
  source: { type: "article_import", id: "article_1" },
  original: { available: true, reason: null },
  indexStatus: "ready",
  metadata: {},
  relations: [],
  occurredAt: null,
  importedAt: null,
  modifiedAt: null,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PreviewModal ordinary-user actions", () => {
  it("copies safe preview text without exposing the original path", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    render(<PreviewModal
      target={target}
      copy={COPY.zh}
      locale="zh-CN"
      loading={false}
      error={false}
      errorMessage=""
      preview={{
        contentId: target.id,
        title: target.title,
        kind: "article",
        format: "plain_text",
        text: "这是安全预览正文。",
        truncated: false,
        bytesRead: 128,
        totalBytes: 128,
        mimeType: "text/markdown",
        originalName: "article.md",
        activeContentExecuted: false,
        remoteResourcesLoaded: false,
      }}
      locating={false}
      onClose={vi.fn()}
      onRetry={vi.fn()}
      onLocate={vi.fn()}
      onChoose={vi.fn()}
    />);

    fireEvent.click(screen.getByRole("button", { name: "复制文字" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("这是安全预览正文。"));
    expect(screen.getByText("已复制")).toBeTruthy();
    expect(screen.queryByText("articles/article.md")).toBeNull();
  });

  it("renders local Markdown images through the controlled asset endpoint", async () => {
    vi.mocked(localContentApi.previewAssetBytes).mockResolvedValue(new ArrayBuffer(4));
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:local-preview-image") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });

    render(<PreviewModal
      target={target}
      copy={COPY.zh}
      locale="zh-CN"
      loading={false}
      error={false}
      errorMessage=""
      preview={{
        contentId: target.id,
        title: target.title,
        kind: "article",
        format: "plain_text",
        text: "# 本地文章\n\n正文\n\n![示意图](assets/001.png)",
        truncated: false,
        bytesRead: 128,
        totalBytes: 128,
        mimeType: "text/markdown",
        originalName: "article.md",
        activeContentExecuted: false,
        remoteResourcesLoaded: false,
      }}
      locating={false}
      onClose={vi.fn()}
      onRetry={vi.fn()}
      onLocate={vi.fn()}
      onChoose={vi.fn()}
    />);

    await waitFor(() => expect(localContentApi.previewAssetBytes).toHaveBeenCalledWith(target.id, "assets/001.png"));
    const image = await screen.findByRole("img", { name: "示意图" });
    expect(image.getAttribute("src")).toBe("blob:local-preview-image");
    expect(screen.getByText(/仅加载原件内受控的本地图片/)).toBeTruthy();
  });

  it("does not request remote Markdown images", async () => {
    render(<PreviewModal
      target={target}
      copy={COPY.zh}
      locale="zh-CN"
      loading={false}
      error={false}
      errorMessage=""
      preview={{
        contentId: target.id,
        title: target.title,
        kind: "article",
        format: "plain_text",
        text: "![远程图片](https://example.com/image.png)",
        truncated: false,
        bytesRead: 64,
        totalBytes: 64,
        mimeType: "text/markdown",
        originalName: "article.md",
        activeContentExecuted: false,
        remoteResourcesLoaded: false,
      }}
      locating={false}
      onClose={vi.fn()}
      onRetry={vi.fn()}
      onLocate={vi.fn()}
      onChoose={vi.fn()}
    />);

    expect(localContentApi.previewAssetBytes).not.toHaveBeenCalled();
    expect(screen.getByRole("img", { name: "远程图片" })).toBeTruthy();
  });
});
