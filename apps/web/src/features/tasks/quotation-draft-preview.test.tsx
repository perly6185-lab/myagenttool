import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { QuotationDraftPreview } from "@/features/tasks/quotation-draft-preview";

vi.mock("@/lib/i18n/use-app-translation", () => ({
  useAppTranslation: () => ({ i18n: { resolvedLanguage: "zh-CN" } }),
}));

describe("QuotationDraftPreview", () => {
  it("turns an Office JSON preview into ordinary-language changes", () => {
    render(<QuotationDraftPreview preview={JSON.stringify({
      changes: [{ field: "customer_name", after: "示例客户" }],
      unchanged: {
        formulaCount: 2,
        preservesStyles: true,
        tablePartCount: 1,
        mediaPartCount: 1,
      },
    })} />);

    expect(screen.getByText("将填写以下内容")).toBeTruthy();
    expect(screen.getByText("customer name")).toBeTruthy();
    expect(screen.getByText("示例客户")).toBeTruthy();
    expect(screen.getByText(/模板的其他内容不会改变/).textContent).toContain("原有样式");
    expect(screen.queryByText(/\"changes\"/)).toBeNull();
  });

  it("keeps the readable preview for non-Office drafts", () => {
    render(<QuotationDraftPreview preview="# 报价草稿\n客户：示例客户" />);
    expect(screen.getByText(/报价草稿/)).toBeTruthy();
  });
});
