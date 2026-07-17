// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { CollapsiblePanel } from "./collapsible-panel";

// #1073: the shared collapse primitive — closed by default, content unmounted
// while closed, toggled through a real button (keyboard-operable for free).

afterEach(cleanup);

test("starts closed, toggles open and closed again via the header button", () => {
  render(
    <CollapsiblePanel label="IN">
      <span>tool input</span>
    </CollapsiblePanel>,
  );
  const header = screen.getByRole("button", { name: /IN/ });
  expect(header.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("tool input")).toBeNull();
  fireEvent.click(header);
  expect(header.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("tool input")).toBeTruthy();
  expect(header.getAttribute("aria-controls")).toBe(screen.getByText("tool input").parentElement?.id);
  fireEvent.click(header);
  expect(screen.queryByText("tool input")).toBeNull();
});

test("defaultOpen renders the content immediately and meta stays on the header", () => {
  render(
    <CollapsiblePanel label="OUT" meta={<span>8.2 KB</span>} defaultOpen>
      <span>tool output</span>
    </CollapsiblePanel>,
  );
  expect(screen.getByText("tool output")).toBeTruthy();
  expect(screen.getByText("8.2 KB")).toBeTruthy();
});
