import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import { HomeTaskComposer } from "./home-task-composer";

const mocks = vi.hoisted(() => ({
  createWorkItem: vi.fn(),
  startWorkItemAutoRun: vi.fn(),
  createTaskMaterialDraft: vi.fn(),
  uploadTaskMaterialFile: vi.fn(),
  removeTaskMaterialFile: vi.fn(),
  autoRunReadiness: vi.fn(),
  suggestWorkItemDraft: vi.fn(),
}));

vi.mock("@/data/use-console-actions", () => ({
  api: {
    createWorkItem: mocks.createWorkItem,
    startWorkItemAutoRun: mocks.startWorkItemAutoRun,
    createTaskMaterialDraft: mocks.createTaskMaterialDraft,
    uploadTaskMaterialFile: mocks.uploadTaskMaterialFile,
    removeTaskMaterialFile: mocks.removeTaskMaterialFile,
    autoRunReadiness: mocks.autoRunReadiness,
    suggestWorkItemDraft: mocks.suggestWorkItemDraft,
  },
}));

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  mocks.autoRunReadiness.mockResolvedValue({ readiness: { ready: true, checks: [] } });
  mocks.suggestWorkItemDraft.mockResolvedValue({
    draft: {
      acceptanceCriteria: ["The requested outcome is complete"],
      verificationSop: ["Exercise the real user flow", "Review automated evidence"],
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("HomeTaskComposer", () => {
  it("keeps the mobile inline creator collapsed until the user expands it", () => {
    const onMobileOpenChange = vi.fn();
    const view = render(
      <HomeTaskComposer
        inline
        mobileOpen={false}
        onMobileOpenChange={onMobileOpenChange}
        projectId="prj_1"
        onCreated={() => {}}
        onOpenTask={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand task creation" }));
    expect(onMobileOpenChange).toHaveBeenCalledWith(true);

    view.rerender(
      <HomeTaskComposer
        inline
        mobileOpen
        onMobileOpenChange={onMobileOpenChange}
        projectId="prj_1"
        onCreated={() => {}}
        onOpenTask={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Collapse task creation" }).getAttribute("aria-expanded")).toBe("true");
  });

  function openComposer() {
    fireEvent.click(screen.getByTestId("home-create-task-trigger"));
    expect(screen.getByRole("dialog")).toBeTruthy();
  }

  it("keeps the creation action discoverable and opens the form on demand", () => {
    render(<HomeTaskComposer projectId="prj_1" onCreated={() => {}} onOpenTask={() => {}} />);

    expect(screen.queryByTestId("home-task-composer")).toBeNull();
    openComposer();
    expect(screen.getByTestId("home-task-composer")).toBeTruthy();
  });

  it("gives an empty-project user a direct setup action", () => {
    const onOpenProjects = vi.fn();
    render(<HomeTaskComposer inline projectId={null} onCreated={() => {}} onOpenTask={() => {}} onOpenProjects={onOpenProjects} />);

    expect(screen.getByText("Choose or create a project first.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open project setup" }));
    expect(onOpenProjects).toHaveBeenCalledTimes(1);
  });

  it("shows and switches the project context inside the ordinary composer", async () => {
    const onProjectChange = vi.fn().mockResolvedValue(undefined);
    render(
      <HomeTaskComposer
        inline
        projectId="prj_1"
        projectName="Customer one"
        projects={[{ id: "prj_1", name: "Customer one" }, { id: "prj_2", name: "Customer two" }]}
        onProjectChange={onProjectChange}
        onCreated={() => {}}
        onOpenTask={() => {}}
      />,
    );

    expect(screen.getByText("More options").closest("details")?.hasAttribute("open")).toBe(false);
    expect(screen.getByLabelText("Attachments (optional)")).toBeTruthy();
    expect(screen.getByText("You can also paste files or screenshots")).toBeTruthy();
    fireEvent.click(screen.getByText("More options"));
    const project = screen.getByRole("combobox", { name: "New task project" }) as HTMLSelectElement;
    expect(project.value).toBe("prj_1");
    fireEvent.change(project, { target: { value: "prj_2" } });
    await waitFor(() => expect(onProjectChange).toHaveBeenCalledWith("prj_2"));
  });

  it("creates one durable task that the scheduler will run automatically", async () => {
    mocks.createWorkItem.mockResolvedValue({ workItem: { id: "lwi_new" } });
    const onCreated = vi.fn();
    const onOpenTask = vi.fn();
    render(<HomeTaskComposer projectId="prj_1" projectName="Customer work" onCreated={onCreated} onOpenTask={onOpenTask} />);
    openComposer();

    fireEvent.change(screen.getByRole("textbox", { name: "Create a task" }), {
      target: { value: "Prepare the weekly customer update\nUse plain language." },
    });
    fireEvent.click(screen.getByText("More options"));
    fireEvent.change(screen.getByPlaceholderText(/One item per line/), {
      target: { value: "Cover every open risk\nProduce a shareable document" },
    });
    await waitFor(() => expect((screen.getByRole("button", { name: "Let AI handle it" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Let AI handle it" }));
    expect(await screen.findByText(/execution-plan draft is ready/i)).toBeTruthy();
    expect(screen.getByRole("region", { name: "Confirm before AI starts" })).toBeTruthy();
    expect(mocks.createWorkItem).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm and start AI" }));

    await waitFor(() => expect(mocks.createWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "prj_1",
      title: "Prepare the weekly customer update",
      body: "Prepare the weekly customer update\nUse plain language.",
      acceptanceCriteria: ["Cover every open risk", "Produce a shareable document"],
      verificationSop: ["Exercise the real user flow", "Review automated evidence"],
      waitingOn: "ai",
      executionPolicy: "auto",
      status: "ready",
      plannedDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      idempotencyKey: expect.any(String),
    })));
    expect(mocks.startWorkItemAutoRun).not.toHaveBeenCalled();
    expect(mocks.suggestWorkItemDraft).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/AI will work automatically/)).toBeTruthy();
    expect(onCreated).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "View task" }));
    expect(onOpenTask).toHaveBeenCalledWith("lwi_new");
  });

  it("matches My templates from the requested result and pins the match when creating the Issue", async () => {
    mocks.suggestWorkItemDraft.mockResolvedValueOnce({
      draft: {
        acceptanceCriteria: ["A quotation workbook is produced"],
        verificationSop: ["Open the workbook and verify customer totals"],
        templateMatch: {
          state: "matched",
          decision: { kind: "auto_apply", confidence: "high", reason: "explicit_result_match" },
          candidates: [],
          selected: {
            templateId: "family_quote",
            definitionId: "rtd_quote",
            version: 2,
            name: "Customer quotation",
            description: "Prepare a quotation from an inquiry",
            expectedOutput: "Quotation Excel",
            steps: ["Read inquiry", "Generate quotation"],
            reasons: ["Expected result matches quotation"],
          },
        },
      },
    });
    mocks.createWorkItem.mockResolvedValue({ workItem: { id: "lwi_quote" } });
    render(<HomeTaskComposer projectId="prj_1" onCreated={() => {}} onOpenTask={() => {}} />);
    openComposer();
    fireEvent.change(screen.getByRole("textbox", { name: "Create a task" }), {
      target: { value: "Generate a quotation Excel from this customer inquiry" },
    });
    await waitFor(() => expect((screen.getByRole("button", { name: "Let AI handle it" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Let AI handle it" }));

    await waitFor(() => expect(mocks.createWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      myTemplateBinding: {
        definitionId: "rtd_quote",
        familyId: "family_quote",
        version: 2,
        matchReasons: ["Expected result matches quotation"],
      },
    })));
    expect(screen.queryByRole("button", { name: "Confirm and start AI" })).toBeNull();
  });

  it("asks for the desired result instead of asking the user to choose a template", async () => {
    const quotation = {
      templateId: "family_quote",
      definitionId: "rtd_quote",
      version: 2,
      name: "Customer quotation",
      description: "Prepare a quotation from an inquiry",
      expectedOutput: "Quotation Excel",
      steps: ["Read inquiry", "Generate quotation"],
      reasons: ["The inquiry could lead to more than one result"],
    };
    const summary = {
      templateId: "family_summary",
      definitionId: "rtd_summary",
      version: 1,
      name: "Inquiry summary",
      description: "Summarize inquiry records",
      expectedOutput: "Inquiry summary",
      steps: ["Read inquiry", "Summarize inquiry"],
      reasons: ["The inquiry could lead to more than one result"],
    };
    mocks.suggestWorkItemDraft.mockResolvedValueOnce({
      draft: {
        acceptanceCriteria: ["The requested result is produced"],
        verificationSop: ["Open and verify the result"],
        templateMatch: {
          state: "ambiguous",
          decision: { kind: "confirm_output", confidence: "low", reason: "learned_preference_conflict" },
          candidates: [quotation, summary],
          selected: null,
          clarification: {
            kind: "desired_output",
            question: "What result do you want this time?",
            reason: "learned_preference_conflict",
            message: "You previously chose different results.",
            learnedChoices: [
              { label: "Quotation Excel", count: 1 },
              { label: "Inquiry summary", count: 1 },
            ],
            options: [
              { definitionId: "rtd_quote", label: "Quotation Excel" },
              { definitionId: "rtd_summary", label: "Inquiry summary" },
            ],
          },
        },
      },
    });
    mocks.createWorkItem.mockResolvedValue({ workItem: { id: "lwi_quote" } });
    render(<HomeTaskComposer projectId="prj_1" onCreated={() => {}} onOpenTask={() => {}} />);
    openComposer();
    fireEvent.change(screen.getByRole("textbox", { name: "Create a task" }), {
      target: { value: "Handle this customer inquiry" },
    });
    await waitFor(() => expect((screen.getByRole("button", { name: "Let AI handle it" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Let AI handle it" }));

    expect(await screen.findByRole("region", { name: "What result do you want this time?" })).toBeTruthy();
    expect(screen.getByText(/previously chose different results/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Confirm and start AI" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Quotation Excel" }));
    expect(await screen.findByRole("region", { name: "Will follow your previous way of working" })).toBeTruthy();
    expect(screen.getByText("Result confirmed by you")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Confirm and start AI" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Confirm and start AI" }));

    await waitFor(() => expect(mocks.createWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      myTemplateBinding: expect.objectContaining({
        definitionId: "rtd_quote",
        familyId: "family_quote",
        version: 2,
        userConfirmedResult: true,
      }),
    })));
  });

  it("explains a feedback-paused template and uses it only after explicit confirmation", async () => {
    const candidate = {
      templateId: "family_quote",
      definitionId: "rtd_quote",
      version: 2,
      name: "Customer quotation",
      description: "Prepare a quotation from an inquiry",
      expectedOutput: "Quotation Excel",
      steps: ["Read inquiry", "Generate quotation"],
      reasons: ["Automatic matching paused after repeated wrong result feedback"],
      governance: { state: "paused", autoMatchAllowed: false, requiresConfirmation: true },
    };
    mocks.suggestWorkItemDraft.mockResolvedValueOnce({
      draft: {
        acceptanceCriteria: ["A quotation workbook is produced"],
        verificationSop: ["Open and verify the workbook"],
        templateMatch: {
          state: "ambiguous",
          decision: { kind: "confirm_output", confidence: "low", reason: "outcome_feedback_paused" },
          candidates: [candidate], selected: null,
          clarification: {
            kind: "desired_output", reason: "outcome_feedback_paused",
            question: "Still use this template?", options: [{ definitionId: "rtd_quote", label: "Quotation Excel" }],
          },
        },
      },
    });
    mocks.createWorkItem.mockResolvedValue({ workItem: { id: "lwi_quote" } });
    render(<HomeTaskComposer projectId="prj_1" onCreated={() => {}} onOpenTask={() => {}} />);
    openComposer();
    fireEvent.change(screen.getByRole("textbox", { name: "Create a task" }), {
      target: { value: "Generate a quotation Excel from this customer inquiry" },
    });
    await waitFor(() => expect((screen.getByRole("button", { name: "Let AI handle it" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Let AI handle it" }));

    expect(await screen.findByText(/automatic matching is paused/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Confirm and start AI" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Quotation Excel" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Confirm and start AI" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and start AI" }));

    await waitFor(() => expect(mocks.createWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      myTemplateBinding: expect.objectContaining({
        definitionId: "rtd_quote", familyId: "family_quote", userConfirmedResult: true,
      }),
    })));
  });

  it("keeps an automatically queued task accessible after explicit plan confirmation", async () => {
    mocks.createWorkItem.mockResolvedValue({ workItem: { id: "lwi_partial" } });
    const onOpenTask = vi.fn();
    render(<HomeTaskComposer projectId="prj_1" onCreated={() => {}} onOpenTask={onOpenTask} />);
    openComposer();

    fireEvent.change(screen.getByRole("textbox", { name: "Create a task" }), { target: { value: "Draft a launch note" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Let AI handle it" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Let AI handle it" }));
    await screen.findByText(/execution-plan draft is ready/i);
    fireEvent.click(screen.getByRole("button", { name: "Confirm and start AI" }));

    expect(await screen.findByText(/AI will work automatically/)).toBeTruthy();
    expect(mocks.startWorkItemAutoRun).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "View task" }));
    expect(onOpenTask).toHaveBeenCalledWith("lwi_partial");
  });

  it("adds optional reference files without exposing the advanced runner", async () => {
    const draft = {
      id: "draft_1", projectId: "prj_1", status: "draft", revision: 0, workItemId: null,
      assets: [], createdAt: "2026-08-05T00:00:00Z", updatedAt: "2026-08-05T00:00:00Z", expiresAt: "2026-08-06T00:00:00Z",
    } as const;
    mocks.createTaskMaterialDraft.mockResolvedValue({ draft });
    mocks.uploadTaskMaterialFile.mockResolvedValue({
      draft: { ...draft, revision: 1, assets: [{ id: "asset_1", originalName: "brief.txt" }] },
      asset: { id: "asset_1", originalName: "brief.txt" },
    });
    mocks.createWorkItem.mockResolvedValue({ workItem: { id: "lwi_with_file" } });
    render(
      <HomeTaskComposer
        projectId="prj_1"
        onCreated={() => {}}
        onOpenTask={() => {}}
      />,
    );
    openComposer();

    fireEvent.change(screen.getByRole("textbox", { name: "Create a task" }), { target: { value: "Summarize the attached brief" } });
    expect(screen.getByText("More options").closest("details")?.hasAttribute("open")).toBe(false);
    const fileInput = screen.getByLabelText("Attachments (optional)") as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(["brief"], "brief.txt", { type: "text/plain" })] } });
    expect(await screen.findByText("brief.txt")).toBeTruthy();
    await waitFor(() => expect(mocks.uploadTaskMaterialFile).toHaveBeenCalledWith(
      "prj_1", "draft_1", expect.any(String), expect.objectContaining({ name: "brief.txt" }),
    ));
    fireEvent.click(screen.getByRole("button", { name: "Save only" }));

    await waitFor(() => expect(mocks.createWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      materialDraftId: "draft_1",
      materialDraftRevision: 1,
    })));
    expect(mocks.createWorkItem.mock.calls[0]?.[0]).not.toHaveProperty("inputAssets");
    expect(mocks.createWorkItem.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ waitingOn: "none", plannedDate: null, executionPolicy: "manual" }));
  });

  it("pastes a clipboard file or screenshot into the primary task composer", async () => {
    const draft = {
      id: "draft_paste", projectId: "prj_1", status: "draft", revision: 0, workItemId: null,
      assets: [], createdAt: "2026-08-05T00:00:00Z", updatedAt: "2026-08-05T00:00:00Z", expiresAt: "2026-08-06T00:00:00Z",
    } as const;
    mocks.createTaskMaterialDraft.mockResolvedValue({ draft });
    mocks.uploadTaskMaterialFile.mockResolvedValue({
      draft: { ...draft, revision: 1, assets: [{ id: "asset_paste", originalName: "screenshot.png" }] },
      asset: { id: "asset_paste", originalName: "screenshot.png" },
    });
    render(<HomeTaskComposer projectId="prj_1" onCreated={() => {}} onOpenTask={() => {}} />);
    openComposer();

    const screenshot = new File(["image"], "screenshot.png", { type: "image/png" });
    const taskInput = screen.getByRole("textbox", { name: "Create a task" });
    fireEvent.paste(taskInput, {
      clipboardData: {
        files: [],
        items: [{ kind: "file", getAsFile: () => screenshot }],
      },
    });

    expect(await screen.findByText("screenshot.png")).toBeTruthy();
    await waitFor(() => expect(mocks.uploadTaskMaterialFile).toHaveBeenCalledWith(
      "prj_1", "draft_paste", expect.any(String), screenshot,
    ));
    expect(screen.getByText("More options").closest("details")?.hasAttribute("open")).toBe(false);
  });

  it("includes uploaded file metadata when asking for the AI plan", async () => {
    const draft = {
      id: "draft_ai", projectId: "prj_1", status: "draft", revision: 0, workItemId: null,
      assets: [], createdAt: "2026-08-05T00:00:00Z", updatedAt: "2026-08-05T00:00:00Z", expiresAt: "2026-08-06T00:00:00Z",
    } as const;
    mocks.createTaskMaterialDraft.mockResolvedValue({ draft });
    mocks.uploadTaskMaterialFile.mockResolvedValue({
      draft: { ...draft, revision: 1, assets: [{ id: "asset_pdf", originalName: "设备技术协议.pdf" }] },
      asset: { id: "asset_pdf", originalName: "设备技术协议.pdf" },
    });
    render(<HomeTaskComposer inline projectId="prj_1" onCreated={() => {}} onOpenTask={() => {}} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Create a task" }), { target: { value: "Turn this into a purchasing list" } });
    fireEvent.change(screen.getByLabelText("Attachments (optional)"), {
      target: { files: [new File(["pdf"], "设备技术协议.pdf", { type: "application/pdf" })] },
    });
    await waitFor(() => expect(mocks.uploadTaskMaterialFile).toHaveBeenCalled());
    const action = await screen.findByRole("button", { name: "Let AI handle it" });
    await waitFor(() => expect((action as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(action);
    await waitFor(() => expect(mocks.suggestWorkItemDraft).toHaveBeenCalledWith(expect.objectContaining({
      materialDraftId: "draft_ai", materialDraftRevision: 1,
    })));
  });

  it("blocks create-and-run before creating a task and routes the user to the precise setup section", async () => {
    mocks.autoRunReadiness.mockResolvedValue({
      readiness: { ready: false, checks: [{ key: "agent", label: "Coding agent", status: "blocked", detail: "No default agent." }] },
    });
    const onOpenSetup = vi.fn();
    render(<HomeTaskComposer inline projectId="prj_1" onCreated={() => {}} onOpenTask={() => {}} onOpenSetup={onOpenSetup} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Create a task" }), { target: { value: "Prepare a release note" } });
    expect((await screen.findByRole("alert", { name: "Preflight" })).textContent).toContain("No default agent");
    expect((screen.getByRole("button", { name: "Let AI handle it" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Open setup and fix" }));

    expect(onOpenSetup).toHaveBeenCalledWith("autoRuns");
    expect(mocks.createWorkItem).not.toHaveBeenCalled();
  });

  it("queues an AI task while execution capacity is temporarily full", async () => {
    mocks.autoRunReadiness.mockResolvedValue({
      readiness: { ready: false, checks: [{ key: "capacity", label: "Capacity", status: "blocked", detail: "At capacity: 1/1." }] },
    });
    mocks.createWorkItem.mockResolvedValue({ workItem: { id: "lwi_queued" } });
    render(<HomeTaskComposer inline projectId="prj_1" onCreated={() => {}} onOpenTask={() => {}} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Create a task" }), { target: { value: "Queue the next task" } });
    const action = await screen.findByRole("button", { name: "Let AI handle it" });
    await waitFor(() => expect((action as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(action);
    await screen.findByText(/execution-plan draft is ready/i);
    fireEvent.click(screen.getByRole("button", { name: "Confirm and start AI" }));

    await waitFor(() => expect(mocks.createWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      status: "ready",
      executionPolicy: "auto",
    })));
  });

  it("clears project-bound material state on project switch and disables creation while offline", async () => {
    const draft = {
      id: "draft_1", projectId: "prj_1", status: "draft", revision: 0, workItemId: null,
      assets: [], createdAt: "2026-08-05T00:00:00Z", updatedAt: "2026-08-05T00:00:00Z", expiresAt: "2026-08-06T00:00:00Z",
    } as const;
    mocks.createTaskMaterialDraft.mockResolvedValue({ draft });
    mocks.uploadTaskMaterialFile.mockResolvedValue({ draft: { ...draft, revision: 1 }, asset: { id: "asset_1" } });
    const view = render(<HomeTaskComposer inline projectId="prj_1" onCreated={() => {}} onOpenTask={() => {}} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Create a task" }), { target: { value: "Review the brief" } });
    fireEvent.change(screen.getByLabelText("Attachments (optional)"), {
      target: { files: [new File(["brief"], "brief.txt", { type: "text/plain" })] },
    });
    expect(await screen.findByText("brief.txt")).toBeTruthy();

    view.rerender(<HomeTaskComposer inline projectId="prj_2" unavailable onCreated={() => {}} onOpenTask={() => {}} />);
    await waitFor(() => expect(screen.queryByText("brief.txt")).toBeNull());
    expect(screen.getByText(/previous project were cleared/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save only" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
