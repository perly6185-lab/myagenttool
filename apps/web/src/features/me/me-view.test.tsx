import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import { MeView } from "./me-view";
import { useUiStore } from "@/store/ui-store";

vi.mock("@/components/layout/login-control", () => ({
  LoginControl: () => <div>Identity controls</div>,
}));
vi.mock("@/components/layout/language-picker", () => ({
  LanguagePicker: () => <div>Language controls</div>,
}));
vi.mock("@/components/layout/skin-picker", () => ({
  SkinPicker: () => <div>Appearance controls</div>,
}));
vi.mock("@/hooks/use-page-navigation", () => ({
  usePageNavigation: () => vi.fn(),
}));

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  useUiStore.setState({ workItemDetailPreference: "summary", experienceMode: "ordinary" });
});

afterEach(() => cleanup());

describe("MeView", () => {
  it("keeps personal preferences but removes the recursive settings destination when embedded", () => {
    render(<MeView embedded />);

    expect(screen.getByText("Language controls")).toBeTruthy();
    expect(screen.getByText("Appearance controls")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "My settings" })).toBeNull();
    expect(screen.queryByRole("button", { name: /My settings/ })).toBeNull();
  });

  it("keeps the My settings destination on the standalone fallback page", () => {
    render(<MeView />);

    expect(screen.getByRole("heading", { name: "My settings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /My settings/ })).toBeTruthy();
  });

  it("lets the user opt into the product-wide professional mode", () => {
    render(<MeView embedded />);

    const toggle = screen.getByRole("switch", { name: "Professional mode" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);

    expect(useUiStore.getState().workItemDetailPreference).toBe("expert");
    expect(useUiStore.getState().experienceMode).toBe("professional");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });
});
