// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { MarkdownBlock } from "./markdown-block";

// #1073: GFM renders (tables, bold, code) and hostile markdown stays inert.

afterEach(cleanup);

const FIXTURE = [
  "**Tree is dirty.**",
  "",
  "| Work | PR |",
  "|---|---|",
  "| parity tool | #1046 |",
  "",
  "- item with `inline code`",
  "",
  "```js",
  "const x = 1;",
  "```",
].join("\n");

test("renders GFM: bold, table, list, inline + fenced code", () => {
  const { container } = render(<MarkdownBlock text={FIXTURE} />);
  expect(screen.getByText("Tree is dirty.").tagName).toBe("STRONG");
  expect(screen.getByRole("table")).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "Work" })).toBeTruthy();
  expect(screen.getByRole("cell", { name: "#1046" })).toBeTruthy();
  expect(screen.getByRole("listitem").textContent).toContain("inline code");
  const fenced = container.querySelector("pre code");
  expect(fenced?.textContent).toContain("const x = 1;");
});

test("the table scrolls in its own container, not the page", () => {
  const { container } = render(<MarkdownBlock text={FIXTURE} />);
  const wrapper = container.querySelector("table")?.parentElement;
  expect(wrapper?.className).toContain("overflow-x-auto");
});

test("hostile markdown is inert: raw HTML dropped, javascript: links neutered", () => {
  const { container } = render(
    <MarkdownBlock text={'<script>window.pwned = true</script>\n\n<img src=x onerror="window.pwned=true">\n\n[click](javascript:alert(1))'} />,
  );
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector("img")).toBeNull();
  expect((window as { pwned?: boolean }).pwned).toBeUndefined();
  const link = screen.getByText("click") as HTMLAnchorElement;
  expect(link.getAttribute("href") ?? "").not.toContain("javascript:");
});

test("external links open in a new tab without an opener handle", () => {
  render(<MarkdownBlock text="[docs](https://example.com)" />);
  const link = screen.getByRole("link", { name: "docs" });
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toContain("noopener");
  expect(link.getAttribute("href")).toBe("https://example.com");
});
