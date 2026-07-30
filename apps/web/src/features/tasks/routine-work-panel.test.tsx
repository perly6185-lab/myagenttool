import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoutineWorkPanel } from "./routine-work-panel";
import type { RoutineWorkExecution } from "./routine-workflow";

afterEach(cleanup);

function execution(overrides: Partial<RoutineWorkExecution["run"]> = {}): RoutineWorkExecution {
  return {
    workItemId: "wi_1",
    definition: { id: "routine_1", name: "Inquiry to quotation", version: 3 },
    run: {
      id: "run_1",
      status: "planned",
      revision: 1,
      waitingReason: null,
      cancellationRequestedAt: null,
      ...overrides,
    },
    availableOrderTriggers: [{ artifactId: "order_1", label: "PO-1001.pdf" }],
    steps: [
      {
        key: "extract",
        label: "Extract inquiry",
        kind: "extract",
        required: true,
        dependsOn: [],
        configuration: {},
        run: {
          state: "pending",
          attempts: 0,
          errorCode: null,
          conditionOutcome: null,
          outputRefs: [],
        },
      },
    ],
  };
}

function handlers() {
  return {
    onStart: vi.fn(),
    onCancel: vi.fn(),
    onExecute: vi.fn(),
    onQuotationInputs: vi.fn(),
    onComplete: vi.fn(),
    onPreviewLedger: vi.fn(),
    onCommitLedger: vi.fn(),
    onRetry: vi.fn(),
    onApproval: vi.fn(),
    onCondition: vi.fn(),
  };
}

describe("RoutineWorkPanel", () => {
  it("offers one primary action for a planned inquiry", () => {
    const actions = handlers();
    render(<RoutineWorkPanel execution={execution()} pending={false} ledgerPreviews={{}} {...actions} />);

    fireEvent.click(screen.getByRole("button", { name: "Process inquiry" }));

    expect(actions.onStart).toHaveBeenCalledOnce();
    expect(screen.getByText((_, element) =>
      element?.tagName === "P" && element.textContent?.includes("Inquiry to quotation") === true)).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
  });

  it("keeps approval and conditional order work visible and gated", () => {
    const actions = handlers();
    const current = execution({ status: "awaiting_approval", revision: 5 });
    current.steps = [
      {
        key: "approve",
        label: "Approve quotation",
        kind: "human_approval",
        required: true,
        dependsOn: [],
        configuration: {},
        run: {
          state: "awaiting_approval",
          attempts: 1,
          errorCode: null,
          conditionOutcome: null,
          outputRefs: [],
        },
      },
      {
        key: "order_signal",
        label: "Check whether an order was received",
        kind: "condition",
        required: false,
        dependsOn: ["approve"],
        configuration: { condition: "A confirmed order was received." },
        run: {
          state: "awaiting_condition",
          attempts: 0,
          errorCode: null,
          conditionOutcome: null,
          outputRefs: [],
        },
      },
    ];

    render(<RoutineWorkPanel execution={current} pending={false} ledgerPreviews={{}} {...actions} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve and continue" }));
    const approvalDialog = screen.getByRole("dialog", { name: "Review the quotation" });
    expect(within(approvalDialog).getByText(
      "After approval, the task will register the quotation and wait for a confirmed order before creating order work.",
    )).toBeTruthy();
    fireEvent.click(within(approvalDialog).getByRole("button", { name: "Approve and continue" }));
    expect(actions.onApproval).toHaveBeenCalledWith("approve", true);

    const received = screen.getByRole("button", { name: "Confirmed order received" });
    expect((received as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Confirmed order document"), {
      target: { value: "order_1" },
    });
    fireEvent.click(received);
    expect(actions.onCondition).toHaveBeenCalledWith("order_signal", true, ["order_1"]);

    fireEvent.click(screen.getByRole("button", { name: "No order received" }));
    expect(actions.onCondition).toHaveBeenCalledWith("order_signal", false, []);
  });

  it("reviews the exact ledger row instead of allowing a manual completion bypass", () => {
    const actions = handlers();
    const current = execution({ status: "running", revision: 4 });
    current.steps = [{
      key: "register_inquiry",
      label: "Register inquiry",
      kind: "ledger_upsert",
      required: true,
      dependsOn: [],
      configuration: { ledgerDefinitionId: "ldg_1" },
      run: {
        state: "running",
        attempts: 1,
        errorCode: null,
        conditionOutcome: null,
        outputRefs: [],
      },
    }];
    const preview = {
      id: "lup_1",
      ledgerDefinitionId: "ldg_1",
      routineRunId: "run_1",
      routineStepKey: "register_inquiry",
      businessKey: "RFQ-001",
      action: "update" as const,
      rowNumber: 3,
      changedCells: [{
        field: "customer",
        column: "Customer",
        before: "Acme",
        after: "Acme Ltd",
      }],
      warnings: [],
      approvalRequired: true,
      state: "pending" as const,
      expiresAt: "2026-07-29T00:15:00.000Z",
      revision: 1,
    };

    const { rerender } = render(
      <RoutineWorkPanel execution={current} pending={false} ledgerPreviews={{}} {...actions} />,
    );
    expect(screen.queryByRole("button", { name: "Mark step complete" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review ledger change" }));
    expect(actions.onPreviewLedger).toHaveBeenCalledWith("register_inquiry", "ldg_1");

    rerender(
      <RoutineWorkPanel execution={current} pending={false}
        ledgerPreviews={{ register_inquiry: preview }} {...actions} />,
    );
    const ledgerDialog = screen.getByRole("dialog", { name: "Confirm the ledger update" });
    expect(within(ledgerDialog).getByText("Acme Ltd")).toBeTruthy();
    fireEvent.click(within(ledgerDialog).getByRole("button", { name: "Approve ledger change" }));
    expect(actions.onCommitLedger).toHaveBeenCalledWith("register_inquiry", preview);
  });

  it("runs governed business executors instead of offering a manual success bypass", () => {
    const actions = handlers();
    const current = execution({ status: "running", revision: 4 });
    current.steps = [{
      key: "quotation",
      label: "Prepare quotation",
      kind: "generate",
      required: true,
      dependsOn: [],
      configuration: {},
      run: {
        state: "running",
        attempts: 1,
        errorCode: null,
        conditionOutcome: null,
        outputRefs: [],
      },
    }];

    render(<RoutineWorkPanel execution={current} pending={false} ledgerPreviews={{}} {...actions} />);

    expect(screen.queryByRole("button", { name: "Mark step complete" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Run this step" }));
    expect(actions.onExecute).toHaveBeenCalledWith("quotation");
    expect(actions.onComplete).not.toHaveBeenCalled();
  });

  it("collects missing quotation facts and an approved template in plain language", () => {
    const actions = handlers();
    const current = execution({
      status: "running",
      revision: 5,
      waitingReason: "routine_quotation_facts_required",
    });
    current.steps = [{
      key: "quotation",
      label: "Prepare quotation",
      kind: "generate",
      required: true,
      dependsOn: [],
      configuration: {},
      run: {
        state: "running",
        attempts: 1,
        errorCode: null,
        conditionOutcome: null,
        outputRefs: [],
        quotationReview: {
          status: "needs_input",
          fields: [
            {
              key: "customer",
              label: "Customer",
              state: "confirmed",
              value: "Acme",
              conflictingValues: [],
              sourceSummaries: ["inquiries/RFQ-1.md"],
              evidenceArtifactIds: ["artifact_1"],
            },
            {
              key: "unit_price",
              label: "Unit price",
              state: "missing",
              value: null,
              conflictingValues: [],
              sourceSummaries: [],
              evidenceArtifactIds: [],
            },
          ],
          templateOptions: [
            {
              artifactId: "template_md",
              label: "templates/quotation.md",
              format: "markdown",
              supported: true,
              reason: null,
              placeholderKeys: ["customer", "unit_price", "sales_contact"],
            },
            {
              artifactId: "template_docx",
              label: "templates/quotation.docx",
              format: "docx",
              supported: false,
              reason: "routine_template_preservation_unavailable",
              placeholderKeys: [],
            },
          ],
          selectedTemplate: null,
          plannedOutputPath: "commercial/outputs/quotations/quotation-RFQ-1-r1-d1-abcd1234.md",
          draftRevision: 1,
          draftPreview: null,
        },
      },
    }];

    render(<RoutineWorkPanel execution={current} pending={false} ledgerPreviews={{}} {...actions} />);
    fireEvent.click(screen.getByRole("button", { name: "Review quotation details" }));
    const dialog = screen.getByRole("dialog", { name: "Confirm quotation details" });
    expect(within(dialog).getByText("Acme")).toBeTruthy();
    expect(within(dialog).getByText(/quotation-RFQ-1-r1-d1-abcd1234\.md/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Quotation template"), {
      target: { value: "template_md" },
    });
    fireEvent.change(within(dialog).getByLabelText("Unit price"), {
      target: { value: "25.00" },
    });
    fireEvent.change(within(dialog).getByLabelText("sales contact"), {
      target: { value: "Alex" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm details" }));
    expect(actions.onQuotationInputs).toHaveBeenCalledWith(
      "quotation",
      "template_md",
      { unit_price: "25.00", sales_contact: "Alex" },
    );
    expect(actions.onExecute).not.toHaveBeenCalled();
  });
});
