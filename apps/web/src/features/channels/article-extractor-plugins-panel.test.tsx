import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ArticleExtractorPluginsPanel } from "./article-extractor-plugins-panel";

const mocks = vi.hoisted(() => ({
  list: vi.fn(async () => ({ plugins: [] })),
  plan: vi.fn(),
  grant: vi.fn(async () => ({ token: "grant_1", grantId: "apg_1", expiresAt: "later" })),
  install: vi.fn(async () => ({ plugin: {} })),
  disable: vi.fn(),
  activate: vi.fn(),
}));

vi.mock("@/data/use-console-actions", () => ({
  api: {
    listArticleExtractorPlugins: mocks.list,
    planArticleExtractorPluginInstall: mocks.plan,
    issueApprovalGrant: mocks.grant,
    installArticleExtractorPlugin: mocks.install,
    disableArticleExtractorPlugin: mocks.disable,
    activateArticleExtractorPluginVersion: mocks.activate,
  },
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("ArticleExtractorPluginsPanel", () => {
  it("requires a server-validated preview and a fresh scoped approval before enabling", async () => {
    mocks.plan.mockImplementation(async (manifest) => ({
      manifest,
      checksum: "a".repeat(64),
      approval: { action: "article_extractor_plugin.install", targetId: "team_1:site.news.example.com:1.0.0" },
    }));
    render(<ArticleExtractorPluginsPanel />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    fireEvent.click(screen.getByText("高级：网页采集能力"));

    fireEvent.change(screen.getByLabelText(/网站域名/), { target: { value: "news.example.com" } });
    fireEvent.change(screen.getByLabelText(/正文位置/), { target: { value: "main.story, article" } });
    fireEvent.click(screen.getByRole("button", { name: "检查并预览" }));
    await screen.findByText("启用前确认");
    expect(mocks.install).not.toHaveBeenCalled();
    expect(mocks.plan).toHaveBeenCalledWith(expect.objectContaining({
      id: "site.news.example.com",
      hosts: ["news.example.com"],
      extraction: expect.objectContaining({ content: ["main.story", "article"] }),
    }));

    fireEvent.click(screen.getByRole("button", { name: "确认启用" }));
    await waitFor(() => expect(mocks.grant).toHaveBeenCalledWith(
      "article_extractor_plugin.install",
      "team_1:site.news.example.com:1.0.0",
    ));
    await waitFor(() => expect(mocks.install).toHaveBeenCalledWith(expect.any(Object), "grant_1"));
    expect(await screen.findByText(/无需重启/)).toBeTruthy();
  });
});
