import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useLocaleSync } from "@/app/use-locale-sync";
import { LanguagePicker } from "@/components/layout/language-picker";
import { i18n } from "@/lib/i18n";
import { useUiStore } from "@/store/ui-store";

function LocaleHarness() {
  useLocaleSync();
  return <LanguagePicker />;
}

beforeEach(async () => {
  localStorage.clear();
  useUiStore.setState({ locale: "en-US" });
  await i18n.changeLanguage("en-US");
});

afterEach(() => {
  cleanup();
});

describe("LanguagePicker", () => {
  it("switches immediately, persists the selection, and synchronizes the document", async () => {
    render(<LocaleHarness />);

    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), {
      target: { value: "zh-CN" },
    });

    await waitFor(() => expect(screen.getByRole("combobox", { name: "语言" })).toBeTruthy());
    expect(useUiStore.getState().locale).toBe("zh-CN");
    expect(i18n.resolvedLanguage).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(document.documentElement.dir).toBe("ltr");

    const persisted = JSON.parse(localStorage.getItem("myagenttool-ui") as string);
    expect(persisted.state.locale).toBe("zh-CN");
  });

  it("renders option labels in the active locale", async () => {
    useUiStore.setState({ locale: "zh-CN" });
    render(<LocaleHarness />);

    await waitFor(() => expect(screen.getByRole("option", { name: "简体中文" })).toBeTruthy());
    expect(screen.getByRole("option", { name: "英语" })).toBeTruthy();
  });
});
