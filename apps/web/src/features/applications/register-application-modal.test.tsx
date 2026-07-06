import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegisterApplicationModal } from "@/features/applications/register-application-modal";

const apiMock = vi.hoisted(() => ({
  registerApplication: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  api: {
    registerApplication: apiMock.registerApplication,
  },
}));

vi.mock("@/data/use-console-state", () => ({
  useConsoleState: () => ({ data: { projects: [] } }),
  useRefreshConsoleState: () => () => Promise.resolve(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RegisterApplicationModal", () => {
  it("surfaces structured npm wrapper descriptor validation errors", async () => {
    const onClose = vi.fn();
    apiMock.registerApplication.mockRejectedValue(
      new Error("npmWrapper.packageManager: packageManager must be npm, pnpm, or yarn."),
    );

    render(<RegisterApplicationModal open={true} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("Source type"), { target: { value: "npm" } });
    fireEvent.change(screen.getByLabelText("Package"), { target: { value: "@scope/bad-wrapper" } });
    fireEvent.click(screen.getByRole("button", { name: /Advanced descriptors/i }));
    fireEvent.change(screen.getByLabelText("npm wrapper descriptor JSON (optional)"), {
      target: {
        value: JSON.stringify({
          mode: "installed-wrapper",
          packageManager: "bun",
          commands: [{ id: "lint", commandType: "npm_script", command: "lint", status: "approved" }],
        }),
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /^Register$/i }));

    await waitFor(() => {
      expect(apiMock.registerApplication).toHaveBeenCalledWith({
        source: {
          type: "npm",
          package: "@scope/bad-wrapper",
          version: null,
          wrapper: {
            mode: "installed-wrapper",
            packageManager: "bun",
            commands: [{ id: "lint", commandType: "npm_script", command: "lint", status: "approved" }],
          },
        },
      });
    });
    expect(await screen.findByText("npmWrapper.packageManager: packageManager must be npm, pnpm, or yarn.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
