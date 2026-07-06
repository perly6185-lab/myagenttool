import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegisterApplicationModal } from "@/features/applications/register-application-modal";

const apiMock = vi.hoisted(() => ({
  registerApplication: vi.fn(),
}));

vi.mock("@/lib/api-client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client")),
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
  it("previews approved npm wrapper capabilities before registration", () => {
    render(<RegisterApplicationModal open={true} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Source type"), { target: { value: "npm" } });
    fireEvent.change(screen.getByLabelText("Package"), { target: { value: "@scope/report-tool" } });
    fireEvent.click(screen.getByRole("button", { name: /Advanced descriptors/i }));
    fireEvent.change(screen.getByLabelText("npm wrapper descriptor JSON (optional)"), {
      target: {
        value: JSON.stringify({
          mode: "installed-wrapper",
          packageManager: "npm",
          commands: [
            { id: "daily", commandType: "npm_script", command: "daily", status: "approved" },
            { id: "draft", commandType: "npm_script", command: "draft", status: "draft" },
          ],
        }),
      },
    });

    expect(screen.getByText("Capability impact")).toBeTruthy();
    expect(screen.getByText("1 added")).toBeTruthy();
    expect(screen.getByText("+ app.app_scope_report_tool.wrapper.daily")).toBeTruthy();
    expect(screen.queryByText(/wrapper\.draft/)).toBeNull();
  });

  it("builds an npm wrapper descriptor from command fields", async () => {
    const onClose = vi.fn();
    apiMock.registerApplication.mockResolvedValue({ application: { id: "app_report_tool" }, capabilities: [] });

    render(<RegisterApplicationModal open={true} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("Source type"), { target: { value: "npm" } });
    fireEvent.change(screen.getByLabelText("Package"), { target: { value: "report-tool" } });
    fireEvent.click(screen.getByRole("button", { name: /Advanced descriptors/i }));
    fireEvent.change(screen.getByLabelText("Wrapper command id"), { target: { value: "daily" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Daily report" } });
    fireEvent.change(screen.getByLabelText("Command"), { target: { value: "daily" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply command draft/i }));

    expect(screen.getByText("Command draft applied.")).toBeTruthy();
    expect(screen.getByText("+ app.app_report_tool.wrapper.daily")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Register$/i }));

    await waitFor(() => {
      expect(apiMock.registerApplication).toHaveBeenCalledWith({
        source: {
          type: "npm",
          package: "report-tool",
          version: null,
          wrapper: {
            mode: "installed-wrapper",
            installState: "installed",
            packageManager: "npm",
            commands: [{
              id: "daily",
              displayName: "Daily report",
              commandType: "npm_script",
              command: "daily",
              status: "approved",
              riskLevel: "medium",
              requiresApproval: true,
              filePolicy: "read_only",
              networkPolicy: "forbidden",
            }],
          },
        },
      });
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("surfaces structured npm wrapper descriptor validation errors", async () => {
    const onClose = vi.fn();
    const { ApiError } = await import("@/lib/api-client");
    apiMock.registerApplication.mockRejectedValue(new ApiError({
      status: 422,
      method: "POST",
      path: "/api/applications/register",
      body: {
        error: "invalid_application_descriptor",
        validation: {
          errors: [{
            path: "npmWrapper.packageManager",
            code: "invalid_package_manager",
            message: "packageManager must be npm, pnpm, or yarn.",
          }],
        },
      },
    }));

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
    expect(await screen.findByText("Descriptor feedback")).toBeTruthy();
    expect(screen.getByText(/code invalid_application_descriptor/)).toBeTruthy();
    expect(screen.getByText(/status 422/)).toBeTruthy();
    expect(screen.getByText("npmWrapper.packageManager:")).toBeTruthy();
    expect(screen.getByText("packageManager must be npm, pnpm, or yarn.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
