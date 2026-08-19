import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DesktopHandoffLink, desktopHandoffHref } from "@/components/common/desktop-handoff";

describe("desktop handoff", () => {
  it("encodes the destination and context in an app protocol URL", () => {
    expect(desktopHandoffHref("documents", "open-system-document", {
      project: "project 1",
      document: "docs/报价单.docx",
    })).toBe("myagenttool://open?section=documents&desktopAction=open-system-document&project=project+1&document=docs%2F%E6%8A%A5%E4%BB%B7%E5%8D%95.docx");
  });

  it("is an accessible link rather than a disabled browser-only button", () => {
    render(<DesktopHandoffLink section="workflowMemory" action="choose-source-folder">在桌面版选择文件夹</DesktopHandoffLink>);
    expect(screen.getByRole("link", { name: "在桌面版选择文件夹" }).getAttribute("href")).toContain("desktopAction=choose-source-folder");
  });
});
