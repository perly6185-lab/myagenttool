import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BusinessRoutineDefinition } from "@/lib/api-client";
import type { LocalWorkItem } from "./task-view-types";
import { WorkItemTemplateBindingCard } from "./work-item-template-binding-card";

type MyTemplateBinding = NonNullable<LocalWorkItem["myTemplateBinding"]>;

function binding(overrides: Partial<MyTemplateBinding> = {}): MyTemplateBinding {
  return {
    schemaVersion: 1,
    definitionId: "rtd_quote",
    familyId: "family_quote",
    version: 2,
    name: "Customer quotation",
    expectedOutput: "Quotation workbook",
    matchReasons: ["The task result matches a quotation workbook"],
    snapshot: {
      name: "Customer quotation",
      description: "Prepare a checked quotation",
      expectedOutput: "Quotation workbook",
      steps: [{ key: "generate", kind: "generate", label: "Generate quotation", required: true }],
    },
    snapshotHash: "hidden-snapshot-hash",
    matchedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function definition(): BusinessRoutineDefinition {
  return {
    id: "rtd_summary",
    familyId: "family_summary",
    projectId: "prj_1",
    sourceId: "src_1",
    name: "Inquiry summary",
    description: "Summarize inquiries",
    version: 2,
    state: "published",
    historicalCaseIds: [],
    triggerDocumentTypes: ["inquiry"],
    steps: [{ key: "summary", kind: "generate", label: "Generate summary", required: true, dependsOn: [], evidenceRefs: [], configuration: { output: "Inquiry summary" } }],
  } as unknown as BusinessRoutineDefinition;
}

afterEach(cleanup);

describe("work item template binding card", () => {
  it("explains a learned match without exposing correction authority or trace data", () => {
    const value = binding({ matchReasons: ["The result was corrected for a similar task"] });

    render(
      <WorkItemTemplateBindingCard
        workItemId="lwi_1"
        binding={value}
        language="en"
        canCorrect={false}
        correctionOpen={false}
        correctionOptions={[]}
        correctionPending={false}
        correctionError={null}
        onOpenCorrection={vi.fn()}
        onCorrect={vi.fn()}
        onCancelCorrection={vi.fn()}
      />,
    );

    const card = screen.getByTestId("work-item-template-binding");
    expect(card.textContent).toContain("Learned from your correction");
    expect(card.textContent).toContain("Quotation workbook");
    expect(card.textContent).toContain("Generate quotation");
    expect(card.textContent).not.toContain("hidden-snapshot-hash");
    expect(within(card).queryByRole("button", { name: "Wrong result" })).toBeNull();
  });

  it("delegates correction selection and cancellation through explicit callbacks", () => {
    const onCorrect = vi.fn();
    const onCancel = vi.fn();
    const option = definition();

    render(
      <WorkItemTemplateBindingCard
        workItemId="lwi_1"
        binding={binding()}
        language="en"
        canCorrect
        correctionOpen
        correctionOptions={[option]}
        correctionPending={false}
        correctionError={null}
        onOpenCorrection={vi.fn()}
        onCorrect={onCorrect}
        onCancelCorrection={onCancel}
      />,
    );

    const correction = screen.getByRole("region", { name: "Correct the result" });
    fireEvent.click(within(correction).getByRole("button", { name: "Inquiry summary" }));
    expect(onCorrect).toHaveBeenCalledWith(option);

    fireEvent.click(within(correction).getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
