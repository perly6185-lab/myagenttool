import { expect, test, type Page } from "playwright/test";

const source = {
  id: "src_1",
  projectId: "prj_1",
  name: "Sales history",
  relativePath: "sales/history",
  readMode: "supported_text",
  state: "active",
  scanState: "ready",
  fileCount: 6,
  skippedCount: 0,
  parsedCount: 6,
  parseFailedCount: 0,
  lastScanAt: "2026-07-29T10:00:00.000Z",
  truncated: false,
  revision: 1,
};

const artifact = {
  id: "art_1",
  projectId: "prj_1",
  sourceId: "src_1",
  name: "RFQ-1001.xlsx",
  relativePath: "2026/07/RFQ-1001.xlsx",
  extension: "xlsx",
  role: "requirement",
  roleInference: { confidence: 0.96, reasons: ["inquiry_fields"] },
  confirmationState: "confirmed",
  availability: "available",
  exclusion: null,
  revision: 1,
};

const candidate = {
  id: "rdc_1",
  familyId: "commercial-inquiry",
  projectId: "prj_1",
  sourceId: "src_1",
  name: "Inquiry and quotation",
  version: 1,
  state: "candidate",
  triggerDocumentTypes: ["inquiry"],
  confirmedCaseIds: ["case_1", "case_2", "case_3"],
  minimumCaseCount: 3,
  mandatoryCoverageThreshold: 0.67,
  confidence: 0.93,
  steps: [{
    key: "register_inquiry",
    kind: "ledger_upsert",
    label: "Register the inquiry",
    required: true,
    requirement: "mandatory",
    coverage: 1,
    supportCaseIds: ["case_1", "case_2", "case_3"],
    exceptionCaseIds: [],
    explanation: "All three confirmed examples update the inquiry ledger.",
    dependsOn: [],
    evidenceRefs: [{ artifactId: "art_1", kind: "artifact", field: null, location: null }],
    configuration: { ledgerMapping: "Inquiry ledger" },
  }, {
    key: "prepare_quote",
    kind: "generate",
    label: "Prepare the quotation",
    required: true,
    requirement: "mandatory",
    coverage: 1,
    supportCaseIds: ["case_1", "case_2", "case_3"],
    exceptionCaseIds: [],
    explanation: "All three confirmed examples produce a quotation.",
    dependsOn: ["register_inquiry"],
    evidenceRefs: [{ artifactId: "art_1", kind: "artifact", field: null, location: null }],
    configuration: { output: "Reviewed quotation" },
  }],
  evidenceHealth: { state: "valid", issues: [], healthyCaseCount: 3 },
  revision: 1,
  createdAt: "2026-07-29T10:00:00.000Z",
  updatedAt: "2026-07-29T10:00:00.000Z",
};

async function mockApi(page: Page) {
  const routineDefinitions: Record<string, unknown>[] = [];
  let intakeObservation: Record<string, unknown> = {
    id: "wio_1",
    projectId: "prj_1",
    sourceId: "src_1",
    relativePath: "2026/07/RFQ-1002.md",
    name: "RFQ-1002.md",
    state: "ready",
    reason: null,
    artifactId: "art_intake_1",
    canonicalArtifactId: "art_intake_1",
    revision: 2,
    updatedAt: "2026-07-29T10:02:00.000Z",
  };
  const workItem = {
    id: "wi_routine_1",
    localRef: "LOCAL-ROUTINE-1",
    projectId: "prj_1",
    title: "Process INQ-004",
    body: "Prepare and register a reviewed quotation.",
    type: "task",
    priority: "p1",
    status: "ready",
    state: "open",
    labels: ["routine-work", "commercial-inquiry"],
    assigneeIds: [],
    acceptanceCriteria: ["Inquiry and quotation ledgers are reviewed."],
    verificationRecords: [],
    revision: 1,
    archivedAt: null,
    updatedAt: "2026-07-29T10:00:00.000Z",
    routineDefinitionId: "rtn_1",
    routineVersion: 1,
    businessCaseId: "case_4",
    businessKey: "INQ-004",
    triggerArtifactIds: ["art_1"],
  };
  const baseSteps = [{
    key: "register_inquiry",
    label: "Register the inquiry",
    kind: "ledger_upsert",
    required: true,
    dependsOn: [],
    configuration: { ledgerDefinitionId: "ledger_inquiry" },
  }, {
    key: "generate_quote",
    label: "Prepare the quotation",
    kind: "generate",
    required: true,
    dependsOn: ["register_inquiry"],
    configuration: {},
  }, {
    key: "approve_quote",
    label: "Review and approve the quotation",
    kind: "human_approval",
    required: true,
    dependsOn: ["generate_quote"],
    configuration: {},
  }, {
    key: "order_signal",
    label: "Check whether an order was received",
    kind: "condition",
    required: false,
    dependsOn: ["approve_quote"],
    configuration: { condition: "A confirmed order was received." },
  }] as const;
  const quotationReview = (status: "needs_input" | "ready" | "generated") => ({
    status,
    fields: [
      {
        key: "customer",
        label: "Customer",
        state: "confirmed" as const,
        value: "Acme",
        conflictingValues: [],
        sourceSummaries: ["inquiries/INQ-004.md"],
        evidenceArtifactIds: ["art_1"],
      },
      {
        key: "unit_price",
        label: "Unit price",
        state: status === "needs_input" ? "missing" as const : "confirmed" as const,
        value: status === "needs_input" ? null : "25.00",
        conflictingValues: [],
        sourceSummaries: status === "needs_input" ? [] : ["Confirmed by user"],
        evidenceArtifactIds: [],
      },
    ],
    templateOptions: [{
      artifactId: "template_1",
      label: "templates/quotation.md",
      format: "markdown",
      supported: true,
      reason: null,
      placeholderKeys: ["customer", "unit_price"],
    }],
    selectedTemplate: status === "needs_input"
      ? null
      : { artifactId: "template_1", label: "templates/quotation.md", format: "markdown" },
    plannedOutputPath: "sales/history/outputs/quotations/quotation-INQ-004-r1-d1-abcd1234.md",
    draftRevision: 1,
    draftPreview: status === "generated"
      ? "# Quotation\n\nCustomer: Acme\n\nUnit price: 25.00"
      : null,
  });
  const step = (
    row: typeof baseSteps[number],
    state: "pending" | "running" | "awaiting_approval" | "awaiting_condition" | "succeeded" | "skipped",
    review: ReturnType<typeof quotationReview> | null = null,
  ) => ({
    ...row,
    run: {
      state,
      attempts: state === "pending" ? 0 : 1,
      errorCode: null,
      conditionOutcome: state === "skipped" ? false : null,
      quotationReview: review,
      outputRefs: row.key === "generate_quote" && state === "succeeded"
        ? [{
            kind: "file",
            relativePath: "sales/history/outputs/quotations/quotation-INQ-004-r1-d1-abcd1234.md",
            summary: "quotation-INQ-004-r1-d1-abcd1234.md",
          }]
        : [],
    },
  });
  let routineExecution = {
    workItemId: workItem.id,
    definition: { id: "rtn_1", name: "Inquiry to quotation", version: 1 },
    run: {
      id: "run_1",
      status: "planned",
      revision: 1,
      waitingReason: null,
      cancellationRequestedAt: null,
      capacity: {
        limit: 2,
        active: 0,
        state: "ready",
        position: null,
        waitingSince: null,
      },
    },
    availableOrderTriggers: [{ artifactId: "order_4", label: "PO-004.pdf" }],
    steps: baseSteps.map((row) => step(row, "pending")),
  };
  let quotationInputsConfirmed = false;
  let activeLedgerPreview: Record<string, unknown> | null = null;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/state") {
      return route.fulfill({ json: {
        currentProjectId: "prj_1",
        projects: [{ id: "prj_1", name: "Sales", status: "active", path: "/projects/sales" }],
        agents: [],
        worktrees: [],
        invocations: [],
        pendingDecisions: [],
        evidenceLedger: [],
        issueClaims: [],
        issueClaimEvents: [],
        projectTargets: [],
      } });
    }
    if (url.pathname === "/api/workflow-memory/sources") {
      return route.fulfill({ json: { sources: [source] } });
    }
    if (url.pathname === "/api/workflow-memory/artifacts") {
      return route.fulfill({ json: { artifacts: [artifact], count: 1 } });
    }
    if (url.pathname === "/api/workflow-memory/intake-observations"
      && request.method() === "GET") {
      return route.fulfill({ json: { observations: [intakeObservation], count: 1 } });
    }
    if (url.pathname.endsWith("/scan-intake") && request.method() === "POST") {
      return route.fulfill({ json: {
        source,
        intake: {
          scanRevision: 2,
          scannedEntries: 1,
          skipped: 0,
          truncated: false,
          observed: 0,
          waitingStable: 0,
          ready: 1,
          duplicate: 0,
          blocked: 0,
          unchanged: 0,
        },
        observations: [intakeObservation],
      } });
    }
    if (url.pathname.endsWith("/intake-observations/wio_1/inspect")
      && request.method() === "POST") {
      return route.fulfill({ json: {
        state: "needs_confirmation",
        observation: {
          id: "wio_1",
          sourceId: "src_1",
          artifactId: "art_intake_1",
          relativePath: "2026/07/RFQ-1002.md",
          revision: 2,
        },
        classification: {
          id: "bdc_intake_1",
          revision: 1,
          documentType: "inquiry",
          confirmationState: "proposed",
          confidence: 0.95,
          fieldProposals: [{
            key: "inquiry_number",
            value: "RFQ-1002",
            normalizedValue: "RFQ-1002",
            confidence: 0.98,
            confirmationState: "proposed",
            evidenceRefs: [],
          }, {
            key: "customer",
            value: "Acme",
            normalizedValue: "Acme",
            confidence: 0.91,
            confirmationState: "proposed",
            evidenceRefs: [],
          }],
        },
        routines: [{
          id: "rtn_1",
          name: "Inquiry to quotation",
          description: "Prepare and register a reviewed quotation.",
          version: 1,
          triggerDocumentTypes: ["inquiry"],
        }],
      } });
    }
    if (url.pathname.endsWith("/intake-observations/wio_1/accept")
      && request.method() === "POST") {
      const body = request.postDataJSON();
      if (body.confirmed !== true) {
        return route.fulfill({
          status: 400,
          json: { error: "workflow_intake_confirmation_required" },
        });
      }
      intakeObservation = {
        ...intakeObservation,
        state: "triggered",
        revision: 3,
        receipt: {
          id: "wir_1",
          businessKey: "RFQ-1002",
          routineDefinitionId: "rtn_1",
          routineVersion: 1,
          businessCaseId: "case_intake_1",
          workItemId: workItem.id,
          workItemLocalRef: workItem.localRef,
          routineRunId: "run_1",
          state: "triggered",
          triggeredAt: "2026-07-29T10:03:00.000Z",
        },
      };
      return route.fulfill({ status: 201, json: {
        state: "triggered",
        replayed: false,
        receipt: intakeObservation.receipt,
      } });
    }
    if (url.pathname.endsWith("/pair-proposals")) {
      return route.fulfill({ json: { sourceId: source.id, proposals: [] } });
    }
    if (url.pathname === "/api/workflow-memory/business-routine-candidates") {
      return route.fulfill({ json: { candidates: [candidate], count: 1 } });
    }
    if (url.pathname === "/api/workflow-memory/business-routine-definitions") {
      return route.fulfill({
        json: { routineDefinitions, count: routineDefinitions.length },
      });
    }
    if (url.pathname.endsWith("/create-draft") && request.method() === "POST") {
      const routineDefinition = {
        ...candidate,
        id: "rtn_1",
        description: "Prepare and register a reviewed quotation.",
        state: "draft",
        discoveryCandidateId: candidate.id,
        historicalCaseIds: candidate.confirmedCaseIds,
        steps: candidate.steps.map(({ requirement: _requirement, coverage: _coverage,
          supportCaseIds: _support, exceptionCaseIds: _exceptions, explanation: _explanation, ...step }) => step),
        supersedesId: null,
        supersededById: null,
        evidenceHealth: { state: "valid", issues: [], recovery: null },
      };
      routineDefinitions.splice(0, routineDefinitions.length, routineDefinition);
      return route.fulfill({ json: { routineDefinition, replayed: false } });
    }
    if (url.pathname.endsWith("/publish") && request.method() === "POST") {
      const body = request.postDataJSON();
      if (body.confirmed !== true) {
        return route.fulfill({ status: 400, json: { error: "routine_publish_confirmation_required" } });
      }
      const routineDefinition = {
        ...routineDefinitions[0],
        state: "published",
        revision: Number(routineDefinitions[0]?.revision ?? 1) + 1,
      };
      routineDefinitions.splice(0, routineDefinitions.length, routineDefinition);
      return route.fulfill({ json: { routineDefinition, replayed: false } });
    }
    if (url.pathname === "/api/work-items/my-template-learning") {
      return route.fulfill({ json: { feedback: [], count: 0 } });
    }
    if (url.pathname === "/api/work-items" && request.method() === "GET") {
      return route.fulfill({ json: { workItems: [workItem], count: 1 } });
    }
    if (url.pathname === "/api/workflow-memory/routine-work-queue") {
      return route.fulfill({ json: {
        items: [{
          workItemId: workItem.id,
          localRef: workItem.localRef,
          title: workItem.title,
          projectId: workItem.projectId,
          sourceId: "src_1",
          businessKey: workItem.businessKey,
          definitionName: "Inquiry to quotation",
          routineVersion: 1,
          status: routineExecution.run.status,
          revision: routineExecution.run.revision,
          waitingReason: routineExecution.run.waitingReason,
          ledgerQueuePosition: null,
          capacity: routineExecution.run.capacity,
          progress: {
            completed: routineExecution.steps.filter((candidate) =>
              ["succeeded", "skipped"].includes(candidate.run.state)).length,
            total: routineExecution.steps.length,
          },
          currentStep: null,
          nextAction: routineExecution.run.status === "planned" ? "start" : "continue_step",
          updatedAt: "2026-07-29T10:00:00.000Z",
        }],
        summary: {
          total: 1,
          running: routineExecution.run.status === "running" ? 1 : 0,
          waiting: 0,
          needsAction: 1,
        },
      } });
    }
    if (url.pathname === "/api/work-items/attention") {
      return route.fulfill({ json: { items: [], metrics: { backlog: 0, breached: 0 } } });
    }
    if (url.pathname === "/api/invocation-dispatch-health") {
      return route.fulfill({ json: {
        capacity: { inFlight: 0, maxConcurrency: 2, atCapacity: false },
        queue: { depth: 0, items: [] },
        stats: {
          indeterminate: true,
          sampleSize: 0,
          medianMsToDispatch: null,
          redeliveryRate: null,
          exhaustedCount: 0,
        },
        reliability: {
          failover: { recovered: 0, attempts: 0 },
          claims: { active: 0, expired: 0 },
          intervention: { required: 0 },
        },
      } });
    }
    if (url.pathname === "/api/planning-projects") {
      return route.fulfill({ json: { projects: [] } });
    }
    if (url.pathname === "/api/auto-runs" && request.method() === "GET") {
      return route.fulfill({ json: {
        autoRuns: [],
        summary: {
          total: 0,
          active: 0,
          byStatus: {},
          outcomes: {},
          successRate: null,
          verification: { passed: 0, failed: 0, unverified: 0 },
          routing: { alignmentRate: null, conclusive: 0 },
          blockedReasons: [],
          timeToPr: { count: 0, medianSeconds: null, p90Seconds: null },
          rates: { humanEscalation: null, selfRepair: null },
        },
      } });
    }
    if (url.pathname === `/api/work-items/${workItem.id}` && request.method() === "GET") {
      return route.fulfill({ json: {
        workItem,
        observability: {
          nextAction: "continue_routine",
          attention: [],
          latestRun: null,
          delivery: null,
          activeClaim: null,
          cost: {
            knownUsd: 0,
            unknownEntries: 0,
            entryCount: 0,
            projectBudget: null,
            teamBudget: null,
          },
          alerts: { queued: 0, failed: 0, sent: 0, skipped: 0, items: [] },
          timeline: [],
          estimate: null,
          routingExplanation: null,
        },
      } });
    }
    if (url.pathname.endsWith("/comments")) return route.fulfill({ json: { comments: [] } });
    if (url.pathname.endsWith("/activity")) return route.fulfill({ json: { activities: [] } });
    if (url.pathname === `/api/projects/${workItem.projectId}/auto-run-readiness`) {
      return route.fulfill({ json: { readiness: { ready: true, checks: [] } } });
    }
    if (url.pathname.startsWith("/api/projects/") && url.pathname.endsWith("/github")) {
      return route.fulfill({ json: { issues: [], pullRequests: [] } });
    }
    if (url.pathname === `/api/workflow-memory/routine-work-items/${workItem.id}`
      && request.method() === "GET") {
      return route.fulfill({ json: { execution: routineExecution } });
    }
    if (url.pathname.endsWith(`/routine-work-items/${workItem.id}/start`)
      && request.method() === "POST") {
      routineExecution = {
        ...routineExecution,
        run: { ...routineExecution.run, status: "running", revision: 2 },
        steps: [
          step(baseSteps[0], "running"),
          step(baseSteps[1], "pending"),
          step(baseSteps[2], "pending"),
          step(baseSteps[3], "pending"),
        ],
      };
      return route.fulfill({ json: { execution: routineExecution } });
    }
    if (url.pathname.endsWith("/ledger-definitions/ledger_inquiry/preview-upsert")
      && request.method() === "POST") {
      activeLedgerPreview = {
        id: "preview_1",
        ledgerDefinitionId: "ledger_inquiry",
        routineRunId: "run_1",
        routineStepKey: "register_inquiry",
        businessKey: "INQ-004",
        action: "insert",
        rowNumber: 5,
        changedCells: [{
          field: "inquiry_number",
          column: "Inquiry No",
          before: null,
          after: "INQ-004",
        }],
        warnings: [],
        approvalRequired: true,
        state: "pending",
        waitingReason: null,
        waitingSince: null,
        queue: { state: "ready", position: null, waitingSince: null },
        expiresAt: "2026-07-29T10:15:00.000Z",
        revision: 1,
      };
      return route.fulfill({ status: 201, json: {
        preview: activeLedgerPreview,
      } });
    }
    if (url.pathname === "/api/workflow-memory/ledger-upsert-previews"
      && request.method() === "GET") {
      return route.fulfill({ json: {
        previews: activeLedgerPreview ? [activeLedgerPreview] : [],
      } });
    }
    if (url.pathname.endsWith("/ledger-upsert-previews/preview_1/commit")
      && request.method() === "POST") {
      activeLedgerPreview = null;
      routineExecution = {
        ...routineExecution,
        run: { ...routineExecution.run, status: "awaiting_approval", revision: 3 },
        steps: [
          step(baseSteps[0], "succeeded"),
          step(baseSteps[1], "running"),
          step(baseSteps[2], "pending"),
          step(baseSteps[3], "pending"),
        ],
      };
      return route.fulfill({ json: {
        preview: { id: "preview_1", state: "committed" },
        execution: routineExecution,
        mutation: { id: "mutation_1", action: "insert" },
      } });
    }
    if (url.pathname.endsWith(`/routine-work-items/${workItem.id}/steps/generate_quote/execute`)
      && request.method() === "POST") {
      if (!quotationInputsConfirmed) {
        routineExecution = {
          ...routineExecution,
          run: {
            ...routineExecution.run,
            status: "running",
            revision: 4,
            waitingReason: "routine_quotation_facts_required",
          },
          steps: [
            step(baseSteps[0], "succeeded"),
            step(baseSteps[1], "running", quotationReview("needs_input")),
            step(baseSteps[2], "pending"),
            step(baseSteps[3], "pending"),
          ],
        };
        return route.fulfill({ json: { execution: routineExecution } });
      }
      routineExecution = {
        ...routineExecution,
        run: {
          ...routineExecution.run,
          status: "awaiting_approval",
          revision: 6,
          waitingReason: null,
        },
        steps: [
          step(baseSteps[0], "succeeded"),
          step(baseSteps[1], "succeeded", quotationReview("generated")),
          step(baseSteps[2], "awaiting_approval"),
          step(baseSteps[3], "pending"),
        ],
      };
      return route.fulfill({ json: { execution: routineExecution } });
    }
    if (url.pathname.endsWith(`/routine-work-items/${workItem.id}/steps/generate_quote/quotation-inputs`)
      && request.method() === "POST") {
      quotationInputsConfirmed = true;
      routineExecution = {
        ...routineExecution,
        run: {
          ...routineExecution.run,
          status: "running",
          revision: 5,
          waitingReason: null,
        },
        steps: [
          step(baseSteps[0], "succeeded"),
          step(baseSteps[1], "running", quotationReview("ready")),
          step(baseSteps[2], "pending"),
          step(baseSteps[3], "pending"),
        ],
      };
      return route.fulfill({ json: { execution: routineExecution } });
    }
    if (url.pathname.endsWith(`/routine-work-items/${workItem.id}/steps/approve_quote/approval`)
      && request.method() === "POST") {
      routineExecution = {
        ...routineExecution,
        run: { ...routineExecution.run, status: "awaiting_condition", revision: 7 },
        steps: [
          step(baseSteps[0], "succeeded"),
          step(baseSteps[1], "succeeded"),
          step(baseSteps[2], "succeeded"),
          step(baseSteps[3], "awaiting_condition"),
        ],
      };
      return route.fulfill({ json: { execution: routineExecution } });
    }
    if (url.pathname.endsWith(`/routine-work-items/${workItem.id}/steps/order_signal/condition`)
      && request.method() === "POST") {
      routineExecution = {
        ...routineExecution,
        run: { ...routineExecution.run, status: "succeeded", revision: 8 },
        steps: [
          step(baseSteps[0], "succeeded"),
          step(baseSteps[1], "succeeded"),
          step(baseSteps[2], "succeeded"),
          step(baseSteps[3], "succeeded"),
        ],
      };
      return route.fulfill({ json: {
        execution: routineExecution,
        childWorkItem: { id: "wi_order_1" },
      } });
    }
    if (url.pathname === "/api/workflow-memory/cases") return route.fulfill({ json: { cases: [], count: 0 } });
    if (url.pathname === "/api/workflow-memory/profiles") return route.fulfill({ json: { profiles: [], count: 0 } });
    if (url.pathname === "/api/workflow-memory/profile-drafts") return route.fulfill({ json: { drafts: [], count: 0 } });
    if (url.pathname === "/api/workflow-memory/inbox") return route.fulfill({ json: { artifacts: [], count: 0 } });
    if (url.pathname === "/api/workflow-memory/runs") return route.fulfill({ json: { runs: [], count: 0 } });
    if (url.pathname === "/api/workflow-memory/retrieval-evaluation") {
      return route.fulfill({ json: {
        sourceId: source.id,
        retrieval: { version: 2, mode: "structured_lexical", vector: { state: "not_configured", used: false } },
        current: { sampleCount: 0, top1: null, top5: null, mrr: null, noResultRate: null },
        baseline: null,
        gate: { status: "insufficient", minimumSamples: 3, embeddingEligible: false },
        samples: [],
      } });
    }
    if (url.pathname === "/api/workflow-memory/adaptive-workbench") {
      return route.fulfill({ json: {
        policy: {
          mode: "observe",
          revision: 1,
          scope: "source",
          sourceId: source.id,
          inheritedMode: null,
          updatedAt: null,
          updatedBy: null,
          boundary: { localIssueOnly: true, externalDelivery: false, overwriteFiles: false },
        },
        monitor: null,
        suggestions: [],
        metrics: {
          total: 0,
          ready: 0,
          needsAttention: 0,
          materialized: 0,
          automationEligible: 0,
          accepted: 0,
          rejected: 0,
          acceptanceRate: null,
          tracked: 0,
          completed: 0,
          completionRate: null,
        },
        permissions: { canUse: true, canManage: true },
      } });
    }
    if (url.pathname === "/api/workflow-memory/adaptive-workbench/learning") {
      return route.fulfill({ json: {
        readiness: {
          evidenceCount: 0,
          accepted: 0,
          rejected: 0,
          draftRequired: 5,
          evaluationRequired: 3,
          canGenerate: false,
          canEvaluate: false,
        },
        drafts: [],
        rules: [],
      } });
    }
    if (url.pathname === "/api/workflow-memory/adaptive-workbench/notifications") {
      return route.fulfill({ json: { notifications: [], unread: 0 } });
    }
    if (url.pathname === "/api/workflow-memory/commercial-pilot/workbench") {
      return route.fulfill({
        status: 403,
        json: { error: "pilot_workbench_not_available_in_routine_fixture" },
      });
    }
    return route.fulfill({ json: {} });
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("myagenttool.token", "e2e-token");
    window.localStorage.setItem(
      "myagenttool-ui",
      JSON.stringify({ version: 1, state: { locale: "en" } }),
    );
    Object.defineProperty(window, "myagenttoolDesktop", {
      configurable: true,
      value: {
        pickWorkflowCaseFiles: async () => ({
          selectionId: "e2e-case-selection",
          files: [
            { name: "RFQ-2026-101.xlsx", extension: "xlsx", size: 42_000, readiness: "ready" },
            { name: "product-photo.png", extension: "png", size: 84_000, readiness: "needs_ocr" },
          ],
        }),
        stageWorkflowCase: async () => {
          throw new Error("The visual fixture does not submit data.");
        },
      },
    });
  });
  await mockApi(page);
  await page.goto("/?section=workflowMemory");
  await expect(page.getByRole("heading", { name: "我的模版", exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: /查看和管理|继续完成/ }).first().click();
  await expect(page.getByRole("heading", { name: "创建我的模版", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "高级调整" }).click();
  await expect(page.getByRole("heading", { name: "Delivery memory" })).toBeVisible();
});

async function openAdvancedWorkTools(page: import("@playwright/test").Page) {
  const summary = page.getByText("Advanced learning and pilot tools", { exact: true });
  const details = page.locator("#advanced-workflow-tools");
  if (!(await details.evaluate((element: HTMLDetailsElement) => element.open))) {
    await summary.click();
  }
  await expect(details).toHaveAttribute("open", "");
}

test("guides an ordinary user from discovered work to task-type review", async ({ page }) => {
  const setup = page.getByRole("region", { name: "Set up your daily work" });
  await expect(setup.getByText("Choose a work folder")).toBeVisible();
  await expect(setup.getByText("an inquiry arrives")).toBeVisible();
  await expect(setup.getByText("Register the inquiry → Prepare the quotation")).toBeVisible();

  await setup.getByText("Why did we identify this?").click();
  await expect(setup.getByText("RFQ-1001.xlsx")).toBeVisible();
  await expect(setup.getByText("All three confirmed examples update the inquiry ledger.")).toBeVisible();

  const createDraft = page.waitForRequest((request) =>
    request.method() === "POST" && request.url().endsWith("/business-routine-candidates/rdc_1/create-draft"));
  await setup.getByRole("button", { name: "Review this task type" }).click();
  await createDraft;
});

test("lets an ordinary user confirm one new inquiry before a task is created", async ({ page }) => {
  await openAdvancedWorkTools(page);
  await expect(page.getByText("RFQ-1002.md", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review inquiry" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm the new inquiry" });
  await expect(dialog.getByText("2026/07/RFQ-1002.md")).toBeVisible();
  await expect(dialog.getByLabel("Routine")).toHaveValue("rtn_1");
  const accepted = page.waitForRequest((request) =>
    request.method() === "POST"
    && request.url().endsWith("/intake-observations/wio_1/accept"));
  await dialog.getByRole("button", { name: "Confirm and create inquiry task" }).click();
  expect((await accepted).postDataJSON()).toMatchObject({
    expectedRevision: 2,
    routineDefinitionId: "rtn_1",
    confirmed: true,
  });
  await expect(page.getByText("Task created")).toBeVisible();
  await expect(page.getByRole("button", { name: "Review inquiry" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open task" })).toBeVisible();
});

test("shows a clear governed real-case intake dialog on desktop and mobile", async ({ page }, testInfo) => {
  await openAdvancedWorkTools(page);
  await page.getByRole("button", { name: "Add real case" }).click();
  const dialog = page.getByRole("dialog", { name: "Add one real business case" });
  await dialog.getByRole("button", { name: "Choose files" }).click();

  await expect(dialog.getByText("RFQ-2026-101.xlsx")).toBeVisible();
  await expect(dialog.getByText("product-photo.png")).toBeVisible();
  await expect(dialog.getByText("Needs OCR")).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "Primary inquiry: product-photo.png" })).toBeEnabled();
  await expect(dialog.getByLabel("I confirm I may use these files in this local workflow.")).not.toBeChecked();
  await testInfo.attach("real-case-intake-desktop", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Add and review" })).toBeVisible();
  await testInfo.attach("real-case-intake-mobile", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

test("requires explicit review before enabling a discovered work type", async ({ page }) => {
  const setup = page.getByRole("region", { name: "Set up your daily work" });
  const created = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && response.url().endsWith("/business-routine-candidates/rdc_1/create-draft"));
  await setup.getByRole("button", { name: "Review this task type" }).click();
  await created;
  const enable = page.getByRole("button", { name: "Enable this work type" });
  await expect(enable).toBeDisabled();
  await page.getByLabel(
    "I reviewed the trigger, steps, outputs, ledgers, and approval points.",
  ).check();
  await expect(enable).toBeEnabled();
  const publish = page.waitForRequest((request) =>
    request.method() === "POST"
    && request.url().endsWith("/business-routine-definitions/rtn_1/publish"));
  await enable.click();
  expect((await publish).postDataJSON()).toMatchObject({ confirmed: true });
  const learned = page.getByRole("region", {
    name: "This computer has learned how you do this work",
  });
  await expect(learned.getByText("Ready to use")).toBeVisible();
});

test("processes a routine Issue through ledger review, quotation approval, and order handoff", async ({ page }) => {
  await page.goto("/?section=task");
  await page.getByText("Process INQ-004").first().click();
  const detail = page.getByRole("dialog", { name: "Local issue details" });
  const dailyWork = detail.getByRole("region", { name: "Daily work" });
  await expect(dailyWork.getByRole("button", { name: "Process inquiry" })).toBeVisible();
  await dailyWork.getByRole("button", { name: "Process inquiry" }).click();

  await dailyWork.getByRole("button", { name: "Review ledger change" }).click();
  const ledgerDialog = page.getByRole("dialog", { name: "Confirm the ledger update" });
  await expect(ledgerDialog.getByText("INQ-004")).toBeVisible();
  await ledgerDialog.getByRole("button", { name: "Approve ledger change" }).click();

  await dailyWork.getByRole("button", { name: "Run this step" }).click();
  await dailyWork.getByRole("button", { name: "Review quotation details" }).click();
  const quotationDialog = page.getByRole("dialog", { name: "Confirm quotation details" });
  await quotationDialog.getByLabel("Quotation template").selectOption("template_1");
  await quotationDialog.getByLabel("Unit price").fill("25.00");
  await quotationDialog.getByRole("button", { name: "Confirm details" }).click();
  await dailyWork.getByRole("button", { name: "Generate quotation draft" }).click();
  await dailyWork.getByRole("button", { name: "Review result" }).click();
  const approvalDialog = page.getByRole("dialog", { name: "Review the quotation" });
  await expect(approvalDialog.getByText(/quotation-INQ-004-r1-d1-abcd1234\.md/).first()).toBeVisible();
  await expect(approvalDialog.getByText(/Unit price: 25.00/).first()).toBeVisible();
  await approvalDialog.getByRole("button", { name: "Approve and continue" }).click();

  await dailyWork.getByLabel("Confirmed order document").selectOption("order_4");
  await dailyWork.getByRole("button", { name: "Confirmed order received" }).click();
  await expect(dailyWork.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  await expect(dailyWork.getByText("Completed", { exact: true }).first()).toBeVisible();
});

test("opens the next inquiry from a keyboard-accessible narrow batch view", async ({ page }, testInfo) => {
  await page.goto("/?section=task");
  await expect(page.getByRole("region", { name: "Inquiry batch" })).toBeVisible();
  await testInfo.attach("inquiry-batch-desktop", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  await page.setViewportSize({ width: 320, height: 844 });
  const batch = page.getByRole("region", { name: "Inquiry batch" });
  const next = batch.getByRole("button", { name: "Open next action" });
  await expect(next).toBeVisible();
  await next.focus();
  await expect(next).toBeFocused();
  await next.press("Enter");
  await expect(page.getByRole("dialog", { name: "Local issue details" })).toBeVisible();
  await testInfo.attach("inquiry-batch-mobile", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("keeps the guided setup usable on a narrow screen and by keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.reload();
  await page.getByRole("button", { name: "高级调整" }).click();
  await expect(page.getByRole("heading", { name: "Delivery memory" })).toBeVisible();
  await openAdvancedWorkTools(page);
  const intakeButton = page.getByRole("button", { name: "Review inquiry" });
  await intakeButton.focus();
  await expect(intakeButton).toBeFocused();
  await intakeButton.press("Enter");
  const intakeDialog = page.getByRole("dialog", { name: "Confirm the new inquiry" });
  await expect(intakeDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(intakeDialog).toHaveCount(0);
  const setup = page.getByRole("region", { name: "Set up your daily work" });
  const button = setup.getByRole("button", { name: "Review this task type" });
  await button.focus();
  await expect(button).toBeFocused();
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
