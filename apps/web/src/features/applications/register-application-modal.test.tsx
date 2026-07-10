import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegisterApplicationModal } from "@/features/applications/register-application-modal";
import { useUiStore } from "@/store/ui-store";

const apiMock = vi.hoisted(() => ({
  registerApplication: vi.fn(),
  applicationLifecycle: vi.fn(),
}));

vi.mock("@/lib/api-client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client")),
  api: {
    registerApplication: apiMock.registerApplication,
    applicationLifecycle: apiMock.applicationLifecycle,
  },
}));

vi.mock("@/data/use-console-state", () => ({
  useConsoleState: () => ({ data: { projects: [] } }),
  useRefreshConsoleState: () => () => Promise.resolve(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useUiStore.setState({ section: "dashboard", selectedApplicationId: null, selectedApplicationAutomationId: null });
});

describe("RegisterApplicationModal", () => {
  it("applies the doocs/md preset and probes after registration", async () => {
    const onClose = vi.fn();
    apiMock.registerApplication.mockResolvedValue({ application: { id: "app_doocs_md" }, capabilities: [] });
    apiMock.applicationLifecycle.mockResolvedValue({ application: { id: "app_doocs_md" } });

    render(<RegisterApplicationModal open={true} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /Use preset/i }));
    expect((screen.getByLabelText("Local path") as HTMLInputElement).value).toBe("doocs-md");
    expect((screen.getByLabelText("Name (optional)") as HTMLInputElement).value).toBe("doocs/md");
    expect(screen.getByText("Onboarding guide")).toBeTruthy();
    expect(screen.getByText("3/4 onboarding inputs ready")).toBeTruthy();
    expect(screen.getByText("2 smoke check(s) captured. Auto-probe is enabled.")).toBeTruthy();
    expect(screen.getByText("This preset will run Probe after registration and open the Application inspector.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Register$/i }));

    await waitFor(() => {
      expect(apiMock.registerApplication).toHaveBeenCalledWith({
        name: "doocs/md",
        source: { type: "local", path: "doocs-md" },
        integrationBrief: expect.objectContaining({
          intent: expect.stringContaining("doocs/md MCP"),
          fixedCommands: expect.arrayContaining(["render_markdown", "list_themes", "pnpm run start"]),
          smokeTests: expect.arrayContaining(["pnpm smoke:doocs-md-editor"]),
        }),
      });
    });
    await waitFor(() => {
      expect(apiMock.applicationLifecycle).toHaveBeenCalledWith("app_doocs_md", "probe");
    });
    expect(useUiStore.getState().section).toBe("applications");
    expect(useUiStore.getState().selectedApplicationId).toBe("app_doocs_md");
    expect(onClose).toHaveBeenCalled();
  });

  it("submits an integration brief for Codex-assisted custom onboarding", async () => {
    const onClose = vi.fn();
    apiMock.registerApplication.mockResolvedValue({ application: { id: "app_briefed_tool" }, capabilities: [] });

    render(<RegisterApplicationModal open={true} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /Integration brief for Codex/i }));
    fireEvent.change(screen.getByLabelText("Job to support"), {
      target: { value: "Render markdown previews through a reviewed local MCP server." },
    });
    fireEvent.change(screen.getByLabelText("Discoverable capabilities"), {
      target: { value: "render markdown\nlist themes" },
    });
    fireEvent.change(screen.getByLabelText("Invokable capabilities"), {
      target: { value: "render markdown" },
    });
    fireEvent.change(screen.getByLabelText("Data boundary"), {
      target: { value: "Read markdown input and write imported preview evidence only." },
    });
    fireEvent.change(screen.getByLabelText("Fixed commands or tools"), {
      target: { value: "render_markdown\nlist_themes" },
    });
    fireEvent.change(screen.getByLabelText("Smoke tests"), {
      target: { value: "register\nprobe\ninvoke\nrestart" },
    });
    fireEvent.change(screen.getByLabelText("Source type"), { target: { value: "manual" } });
    fireEvent.change(screen.getByLabelText("Name (optional)"), { target: { value: "Briefed Tool" } });
    expect(screen.getByText("3/4 onboarding inputs ready")).toBeTruthy();
    expect(screen.getByText("4 smoke check(s) captured.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Register$/i }));

    await waitFor(() => {
      expect(apiMock.registerApplication).toHaveBeenCalledWith({
        name: "Briefed Tool",
        source: { type: "manual", uri: null },
        integrationBrief: expect.objectContaining({
          version: "application-intake.v1",
          status: "draft",
          intent: "Render markdown previews through a reviewed local MCP server.",
          sourceType: "manual",
          discoverableCapabilities: ["render markdown", "list themes"],
          invokableCapabilities: ["render markdown"],
          dataBoundary: "Read markdown input and write imported preview evidence only.",
          fixedCommands: ["render_markdown", "list_themes"],
          smokeTests: ["register", "probe", "invoke", "restart"],
          aiAssistance: expect.objectContaining({
            requested: true,
            nextDrafts: expect.arrayContaining(["descriptor", "safe_probe", "smoke_tests"]),
          }),
        }),
      });
    });
    expect(onClose).toHaveBeenCalled();
  });

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

    expect(screen.getByText("2/4 onboarding inputs ready")).toBeTruthy();
    expect(screen.getByText("Descriptor draft JSON is attached for operator review.")).toBeTruthy();
    expect(screen.getByText("Capability impact")).toBeTruthy();
    expect(screen.getByText("1 added")).toBeTruthy();
    expect(screen.getByText("+ app.app_scope_report_tool.wrapper.daily")).toBeTruthy();
    expect(screen.queryByText(/wrapper\.draft/)).toBeNull();
  });

  it("applies a Codex-generated npm wrapper draft before registration", async () => {
    const onClose = vi.fn();
    apiMock.registerApplication.mockResolvedValue({ application: { id: "app_report_tool" }, capabilities: [] });

    render(<RegisterApplicationModal open={true} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("Source type"), { target: { value: "npm" } });
    fireEvent.change(screen.getByLabelText("Package"), { target: { value: "report-tool" } });
    fireEvent.click(screen.getByRole("button", { name: /Integration brief for Codex/i }));
    fireEvent.change(screen.getByLabelText("Job to support"), {
      target: { value: "Import daily report evidence." },
    });
    fireEvent.change(screen.getByLabelText("Invokable capabilities"), {
      target: { value: "daily report" },
    });
    fireEvent.change(screen.getByLabelText("Fixed commands or tools"), {
      target: { value: "daily" },
    });
    fireEvent.change(screen.getByLabelText("Data boundary"), {
      target: { value: "Read local report input." },
    });
    fireEvent.change(screen.getByLabelText("Smoke tests"), {
      target: { value: "register\nprobe\ninvoke" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Apply npm wrapper draft/i }));

    expect(screen.getByText("npm wrapper draft applied.")).toBeTruthy();
    expect(screen.getByText("ready for reviewed registration")).toBeTruthy();
    const wrapperEditor = screen.getByLabelText("npm wrapper descriptor JSON (optional)") as HTMLTextAreaElement;
    expect(wrapperEditor.value).toContain('"status": "draft"');
    expect(wrapperEditor.value).toContain('"requiresApproval": true');
    expect(wrapperEditor.value).toContain('"command": "daily"');

    fireEvent.click(screen.getByRole("button", { name: /^Register$/i }));

    await waitFor(() => {
      expect(apiMock.registerApplication).toHaveBeenCalledWith({
        source: {
          type: "npm",
          package: "report-tool",
          version: null,
          wrapper: expect.objectContaining({
            mode: "installed-wrapper",
            packageManager: "npm",
            commands: expect.arrayContaining([
              expect.objectContaining({
                id: "daily",
                command: "daily",
                status: "draft",
                requiresApproval: true,
              }),
              expect.objectContaining({
                id: "daily-report",
                command: "daily-report",
                status: "draft",
                requiresApproval: true,
              }),
            ]),
          }),
        },
        integrationBrief: expect.objectContaining({
          intent: "Import daily report evidence.",
          fixedCommands: ["daily"],
          smokeTests: ["register", "probe", "invoke"],
        }),
      });
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("previews MCP and manual manifest policy risk before registration", () => {
    render(<RegisterApplicationModal open={true} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Source type"), { target: { value: "manual" } });
    fireEvent.click(screen.getByRole("button", { name: /Advanced descriptors/i }));
    fireEvent.change(screen.getByLabelText("MCP descriptor JSON (optional)"), {
      target: {
        value: JSON.stringify({
          transport: "http",
          url: "https://mcp.example.test/rpc",
          allowedTools: ["render_markdown"],
        }),
      },
    });
    fireEvent.change(screen.getByLabelText("Manual manifest JSON (optional)"), {
      target: {
        value: JSON.stringify({
          capabilities: [{ id: "render", displayName: "Render", requiresApproval: true }],
        }),
      },
    });

    expect(screen.getByText("Descriptor risk preview")).toBeTruthy();
    expect(screen.getByText("1 projected")).toBeTruthy();
    expect(screen.getByText("1 draft/candidate")).toBeTruthy();
    expect(screen.getByText("2 approval")).toBeTruthy();
    expect(screen.getByText("1 high risk")).toBeTruthy();
    expect(screen.getAllByText(/render_markdown/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/MCP/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Render/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/manual manifest/).length).toBeGreaterThan(0);
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
