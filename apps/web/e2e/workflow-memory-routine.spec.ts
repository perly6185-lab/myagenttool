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
      } });
    }
    if (url.pathname === "/api/workflow-memory/sources") {
      return route.fulfill({ json: { sources: [source] } });
    }
    if (url.pathname === "/api/workflow-memory/artifacts") {
      return route.fulfill({ json: { artifacts: [artifact], count: 1 } });
    }
    if (url.pathname.endsWith("/pair-proposals")) {
      return route.fulfill({ json: { sourceId: source.id, proposals: [] } });
    }
    if (url.pathname === "/api/workflow-memory/business-routine-candidates") {
      return route.fulfill({ json: { candidates: [candidate], count: 1 } });
    }
    if (url.pathname === "/api/workflow-memory/business-routine-definitions") {
      return route.fulfill({ json: { routineDefinitions: [], count: 0 } });
    }
    if (url.pathname.endsWith("/create-draft") && request.method() === "POST") {
      return route.fulfill({ json: { routineDefinition: {
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
      }, replayed: false } });
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
    return route.fulfill({ json: {} });
  });
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await page.goto("/?section=workflowMemory");
  await expect(page.getByRole("heading", { name: "Delivery memory" })).toBeVisible();
});

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

test("keeps the guided setup usable on a narrow screen and by keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.reload();
  const setup = page.getByRole("region", { name: "Set up your daily work" });
  const button = setup.getByRole("button", { name: "Review this task type" });
  await button.focus();
  await expect(button).toBeFocused();
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
