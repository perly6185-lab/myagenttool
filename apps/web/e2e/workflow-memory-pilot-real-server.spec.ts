import { execFileSync } from "node:child_process";
import type { Server } from "node:http";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "playwright/test";

let apiBase = "";
let root = "";
let server: Server | null = null;
let primaryWorkItemTitle = "";
let primaryWorkItemId = "";

async function call(path: string, options: { method?: string; body?: unknown } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method: options.method ?? "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path}: ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "myagenttool-v15-browser-pilot-"));
  const history = join(root, "history");
  const templates = join(history, "templates");
  const ledgers = join(history, "ledgers");
  mkdirSync(templates, { recursive: true });
  mkdirSync(ledgers, { recursive: true });
  const inquiryFixtures = Array.from({ length: 10 }, (_, index) => {
    const sequence = String(index + 1).padStart(3, "0");
    return {
      businessKey: `RFQ-PILOT-${sequence}`,
      customer: `Synthetic Customer ${sequence}`,
      product: index % 2 === 0 ? "Controller" : "Sensor",
      quantity: 5 + index,
      currency: index % 3 === 0 ? "EUR" : "USD",
    };
  });
  for (const fixture of inquiryFixtures) {
    writeFileSync(
      join(history, `inquiry-${fixture.businessKey}.md`),
      [
        "# Request for quotation",
        `Inquiry number: ${fixture.businessKey}`,
        `Customer: ${fixture.customer}`,
        `Product: ${fixture.product}`,
        `Quantity: ${fixture.quantity}`,
        `Currency: ${fixture.currency}`,
      ].join("\n"),
    );
  }
  const quotationTemplateFixtures = [
    {
      name: "quotation-a.md",
      lines: [
        "# Quotation",
        "Customer: {{customer}}",
        "Product: {{product}}",
        "Quantity: {{quantity}}",
        "Unit price: {{unit_price}}",
        "Currency: {{currency}}",
        "Tax rate: {{tax_rate}}",
        "Delivery: {{delivery_terms}}",
      ],
    },
    {
      name: "quotation-b.md",
      lines: [
        "# Commercial offer",
        "Customer: {{customer}}",
        "## Item",
        "{{product}} × {{quantity}}",
        "## Price",
        "{{unit_price}} {{currency}} · Tax {{tax_rate}}",
        "## Delivery",
        "{{delivery_terms}}",
      ],
    },
    {
      name: "quotation-c.md",
      lines: [
        "# Quotation summary",
        "| Customer | Product | Quantity |",
        "| --- | --- | --- |",
        "| {{customer}} | {{product}} | {{quantity}} |",
        "",
        "Unit price: {{unit_price}} {{currency}}",
        "Tax: {{tax_rate}}",
        "Delivery: {{delivery_terms}}",
      ],
    },
  ];
  for (const fixture of quotationTemplateFixtures) {
    writeFileSync(join(templates, fixture.name), fixture.lines.join("\n"));
  }
  writeFileSync(join(ledgers, "inquiries.csv"), "Inquiry No,Customer,Quantity\n");
  writeFileSync(join(ledgers, "quotations.csv"), "Inquiry No,Customer,Amount\n");
  execFileSync("git", ["init", "-b", "main", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "pilot@example.test"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Pilot"]);
  execFileSync("git", ["-C", root, "add", "history"]);
  execFileSync("git", ["-C", root, "commit", "-m", "pilot fixtures"]);

  const { createServerState } = await import("../../server/src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../server/src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../server/src/runtime/http-server.mjs");
  const now = () => new Date().toISOString();
  const { defaultProject, state } = createServerState({ defaultProjectPath: root, now });
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "pilot-e2e",
    protocolVersion: "0.0.0",
    state,
    defaultProject,
    defaultProjectPath: root,
    persistenceEnabled: false,
    stateStorePath: join(root, "unused.json"),
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });
  server = createHttpServer({
    host: "127.0.0.1",
    port: 0,
    namespace: "pilot-e2e",
    protocolVersion: "0.0.0",
    ...httpDependencies,
  });
  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("pilot server address unavailable");
  apiBase = `http://127.0.0.1:${address.port}`;

  const created = await call("/api/workflow-memory/sources", {
    method: "POST",
    body: {
      projectId: defaultProject.id,
      relativePath: "history",
      readMode: "supported_text",
      name: "Pilot sales history",
    },
  });
  const source = created.source;
  await call(`/api/workflow-memory/sources/${source.id}/scan`, { method: "POST" });
  const artifacts = (await call(
    `/api/workflow-memory/artifacts?sourceId=${source.id}`,
  )).artifacts;
  const inquiries = inquiryFixtures.map((fixture) => ({
    fixture,
    artifact: artifacts.find((artifact: { name: string }) =>
      artifact.name === `inquiry-${fixture.businessKey}.md`),
  }));
  expect(inquiries.every((row) => row.artifact)).toBe(true);
  const inquiry = inquiries[0].artifact;
  const quotationTemplates = quotationTemplateFixtures.map((fixture) =>
    artifacts.find((artifact: { name: string }) => artifact.name === fixture.name));
  expect(quotationTemplates.every(Boolean)).toBe(true);
  const confirmedInquiries = [];
  for (const row of inquiries) {
    const analyzed = await call(
      `/api/workflow-memory/artifacts/${row.artifact.id}/analyze-business-document`,
      { method: "POST" },
    );
    const confirmed = await call(
      `/api/workflow-memory/business-document-classifications/${analyzed.classification.id}/confirm`,
      {
        method: "POST",
        body: {
          expectedRevision: analyzed.classification.revision,
          fieldCorrections: {},
        },
      },
    );
    confirmedInquiries.push({ ...row, confirmed });
  }
  const caseIds = Array.from({ length: 10 }, (_, index) => `bcs_pilot_${index + 1}`);
  for (const [index, caseId] of caseIds.entries()) {
    const row = confirmedInquiries[index];
    const stateInquiry = state.workflowArtifacts.find((artifact: { id: string }) =>
      artifact.id === row.artifact.id);
    state.businessCases.push({
      id: caseId,
      ownerTeamId: defaultProject.ownerTeamId,
      projectId: defaultProject.id,
      sourceId: source.id,
      businessKey: row.fixture.businessKey,
      state: "confirmed",
      entityIds: [row.confirmed.entity.id],
      artifactBindings: [{
        artifactId: row.artifact.id,
        documentType: "inquiry",
        roles: ["trigger", "input"],
      }],
      artifactFingerprints: { [row.artifact.id]: stateInquiry.fingerprint },
      revision: 1,
    });
  }
  const steps = [
    {
      key: "register_inquiry",
      kind: "ledger_upsert",
      label: "Register inquiry",
      required: true,
      requirement: "mandatory",
      dependsOn: [],
      configuration: {},
    },
    {
      key: "retrieve_references",
      kind: "retrieve",
      label: "Retrieve approved references",
      required: true,
      requirement: "mandatory",
      dependsOn: ["register_inquiry"],
      configuration: { documentTypes: ["inquiry"] },
    },
    {
      key: "generate_quotation",
      kind: "generate",
      label: "Prepare quotation",
      required: true,
      requirement: "mandatory",
      dependsOn: ["retrieve_references"],
      configuration: {
        templateArtifactIds: quotationTemplates.map((template) => template.id),
      },
    },
    {
      key: "approve_quotation",
      kind: "human_approval",
      label: "Review and approve quotation",
      required: true,
      requirement: "mandatory",
      dependsOn: ["generate_quotation"],
      configuration: {},
    },
    {
      key: "register_quotation",
      kind: "ledger_upsert",
      label: "Register quotation",
      required: true,
      requirement: "mandatory",
      dependsOn: ["approve_quotation"],
      configuration: {},
    },
    {
      key: "order_signal",
      kind: "condition",
      label: "Check whether an order was received",
      required: false,
      requirement: "conditional",
      dependsOn: ["register_quotation"],
      configuration: { condition: "A confirmed customer order was received." },
    },
    {
      key: "order_handoff",
      kind: "create_issue",
      label: "Create order follow-up",
      required: false,
      requirement: "conditional",
      dependsOn: ["order_signal"],
      configuration: {},
    },
  ].map((step) => ({
    ...step,
    coverage: 1,
    supportCaseIds: caseIds,
    exceptionCaseIds: [],
    explanation: "Covered by confirmed pilot history.",
    evidenceRefs: [{
      artifactId: inquiry.id,
      kind: "coverage",
      field: null,
      location: null,
    }],
  }));
  state.routineDiscoveryCandidates.push({
    id: "rdc_pilot",
    ownerTeamId: defaultProject.ownerTeamId,
    projectId: defaultProject.id,
    sourceId: source.id,
    state: "candidate",
    triggerDocumentTypes: ["inquiry"],
    confirmedCaseIds: caseIds,
    steps,
    evidenceRefs: [{ artifactId: inquiry.id, kind: "routine", field: null, location: null }],
    confidence: 0.95,
  });
  const draft = await call(
    "/api/workflow-memory/business-routine-candidates/rdc_pilot/create-draft",
    { method: "POST" },
  );
  const inquiryLedger = await call("/api/workflow-memory/ledger-definitions", {
    method: "POST",
    body: {
      projectId: defaultProject.id,
      sourceId: source.id,
      name: "Inquiry ledger",
      documentType: "inquiry_ledger",
      format: "csv",
      relativePath: "ledgers/inquiries.csv",
      businessKeyField: "inquiry_number",
      fieldMappings: {
        inquiry_number: "Inquiry No",
        customer: "Customer",
        quantity: "Quantity",
      },
      requiredFields: ["inquiry_number", "customer"],
      writePolicy: { approval: "always", allowInsert: true, allowUpdate: true },
    },
  });
  const quotationLedger = await call("/api/workflow-memory/ledger-definitions", {
    method: "POST",
    body: {
      projectId: defaultProject.id,
      sourceId: source.id,
      name: "Quotation ledger",
      documentType: "quotation_ledger",
      format: "csv",
      relativePath: "ledgers/quotations.csv",
      businessKeyField: "inquiry_number",
      fieldMappings: {
        inquiry_number: "Inquiry No",
        customer: "Customer",
        amount: "Amount",
      },
      requiredFields: ["inquiry_number", "customer"],
      writePolicy: { approval: "always", allowInsert: true, allowUpdate: true },
    },
  });
  for (const ledger of [inquiryLedger.ledgerDefinition, quotationLedger.ledgerDefinition]) {
    await call(`/api/workflow-memory/ledger-definitions/${ledger.id}/activate`, {
      method: "POST",
      body: { expectedRevision: ledger.revision },
    });
  }
  const updated = await call(
    `/api/workflow-memory/business-routine-definitions/${draft.routineDefinition.id}/update`,
    {
      method: "POST",
      body: {
        expectedRevision: draft.routineDefinition.revision,
        name: "Pilot inquiry to quotation",
        description: "Review an inquiry, quotation, ledgers, and conditional order.",
        steps: draft.routineDefinition.steps.map((step: {
          key: string;
          configuration: Record<string, unknown>;
        }) => ({
          ...step,
          configuration: {
            ...step.configuration,
            ...(step.key === "register_inquiry"
              ? { ledgerDefinitionId: inquiryLedger.ledgerDefinition.id }
              : {}),
            ...(step.key === "register_quotation"
              ? { ledgerDefinitionId: quotationLedger.ledgerDefinition.id }
              : {}),
          },
        })),
      },
    },
  );
  await call(
    `/api/workflow-memory/business-routine-definitions/${draft.routineDefinition.id}/publish`,
    {
      method: "POST",
      body: { expectedRevision: updated.routineDefinition.revision, confirmed: true },
    },
  );
  const materialized = [];
  for (const [index, caseId] of caseIds.entries()) {
    materialized.push(await call(
      `/api/workflow-memory/business-cases/${caseId}/materialize-routine`,
      {
        method: "POST",
        body: {
          routineDefinitionId: draft.routineDefinition.id,
          triggerArtifactIds: [confirmedInquiries[index].artifact.id],
        },
      },
    ));
  }
  expect(materialized.map((row) => row.workItem.id)).toHaveLength(10);
  primaryWorkItemTitle = materialized[0].workItem.title;
  primaryWorkItemId = materialized[0].workItem.id;
});

test.afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(resolve));
  }
  rmSync(root, { recursive: true, force: true });
});

test("shows all ten synthetic cases in the Chinese mobile batch UI", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("myagenttool-ui", JSON.stringify({
      version: 1,
      state: { locale: "zh-CN", section: "task" },
    }));
  });
  await page.goto(`/?section=task&api=${encodeURIComponent(apiBase)}`);
  const batch = page.getByRole("region", { name: "询价批次" });
  await expect(batch.getByRole("listitem")).toHaveCount(10);
  await expect(batch.getByRole("button", { name: "打开下一项" })).toBeVisible();
  await batch.getByRole("button", { name: "打开下一项" }).click();
  await expect(page.getByRole("dialog", { name: "本地 Issue 详情" })).toBeVisible();
  await page.keyboard.press("Escape");
  await testInfo.attach("v1.5-ten-case-mobile-zh", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

test("opens the governed pilot workbench on mobile and requires explicit case selection", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("myagenttool-ui", JSON.stringify({
      version: 1,
      state: { locale: "zh-CN", section: "workflowMemory" },
    }));
  });
  await page.goto(`/?section=workflowMemory&api=${encodeURIComponent(apiBase)}`);
  await expect(page.getByRole("heading", { name: "交付记忆" })).toBeVisible();
  await page.getByRole("button", { name: "打开试运行工作台" }).click();
  const workbench = page.getByRole("dialog", { name: "正式试运行" });
  await expect(workbench).toBeVisible();
  await expect(workbench.getByText(primaryWorkItemTitle).first()).toBeVisible();
  const caseLabel = workbench.getByText(primaryWorkItemTitle).first().locator("../..");
  await caseLabel.getByRole("checkbox").check();
  await expect(workbench.getByText("case-01")).toBeVisible();
  await expect(workbench.getByRole("button", { name: "生成证据包" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(workbench).toBeHidden();
  await testInfo.attach("v1.5-pilot-workbench-mobile-zh", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

test("shows the ten-case batch and binds one completed UI journey to pilot evidence", async ({ page }, testInfo) => {
  await page.goto(`/?section=task&api=${encodeURIComponent(apiBase)}`);
  const batch = page.getByRole("region", { name: "Inquiry batch" });
  await expect(batch.getByRole("listitem")).toHaveCount(10);
  await batch.getByRole("button", { name: "Open next action" }).click();
  await expect(page.getByRole("dialog", { name: "Local issue details" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Local issue details" })).toBeHidden();
  await page.getByText(primaryWorkItemTitle).first().click();
  const detail = page.getByRole("dialog", { name: "Local issue details" });
  const dailyWork = detail.getByRole("region", { name: "Daily work" });
  await dailyWork.getByRole("button", { name: "Process inquiry" }).click();

  await dailyWork.getByRole("button", { name: "Review ledger change" }).click();
  let ledgerDialog = page.getByRole("dialog", { name: "Confirm the ledger update" });
  await expect(ledgerDialog.getByText("RFQ-PILOT-001")).toBeVisible();
  await ledgerDialog.getByRole("button", { name: "Approve ledger change" }).click();

  await dailyWork.getByRole("button", { name: "Run this step" }).click();
  await dailyWork.getByRole("button", { name: "Run this step" }).click();
  await dailyWork.getByRole("button", { name: "Review quotation details" }).click();
  const inputs = page.getByRole("dialog", { name: "Confirm quotation details" });
  const templateSelect = inputs.getByLabel("Quotation template");
  for (const name of ["quotation-a.md", "quotation-b.md", "quotation-c.md"]) {
    await expect(
      templateSelect.getByRole("option", { name: `templates/${name}` }),
    ).toHaveCount(1);
  }
  await inputs.getByLabel("Quotation template").selectOption({ label: "templates/quotation-a.md" });
  const answers: Record<string, string> = {
    "Unit price": "25.00",
    "Tax rate": "10%",
    "Delivery date or terms": "Ten business days",
  };
  for (const [label, value] of Object.entries(answers)) {
    const field = inputs.getByLabel(label);
    if (await field.count()) await field.fill(value);
  }
  await inputs.getByRole("button", { name: "Confirm details" }).click();
  await dailyWork.getByRole("button", { name: "Generate quotation draft" }).click();
  await dailyWork.getByRole("button", { name: "Approve and continue" }).click();
  const approval = page.getByRole("dialog", { name: "Review the quotation" });
  await expect(approval.getByText(/quotation-RFQ-PILOT-001/).first()).toBeVisible();
  await approval.getByRole("button", { name: "Approve and continue" }).click();

  await dailyWork.getByRole("button", { name: "Review ledger change" }).click();
  ledgerDialog = page.getByRole("dialog", { name: "Confirm the ledger update" });
  await ledgerDialog.getByRole("button", { name: "Approve ledger change" }).click();
  await dailyWork.getByRole("button", { name: "No order received" }).click();

  await expect(dailyWork.getByText("Completed", { exact: true }).first()).toBeVisible();
  await expect(dailyWork.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  expect(readFileSync(join(root, "history", "ledgers", "inquiries.csv"), "utf8"))
    .toContain("RFQ-PILOT-001");
  expect(readFileSync(join(root, "history", "ledgers", "quotations.csv"), "utf8"))
    .toContain("RFQ-PILOT-001");
  const pilotEvidence = await call(
    "/api/workflow-memory/commercial-pilot/evidence",
    {
      method: "POST",
      body: {
        schemaVersion: 1,
        pilotId: "ui-ten-case-synthetic-regression",
        description: "Synthetic UI regression; never formal release evidence.",
        dataClassification: "synthetic",
        consent: { confirmed: false },
        releaseReview: {
          confirmed: false,
          recordedAt: "2026-07-30T00:00:00.000Z",
          reviewerRole: "test operator",
          performance: false,
          security: false,
          privacy: false,
          accessibility: false,
          localization: false,
          migration: false,
          rollback: false,
        },
        thresholds: {
          minimumFormalCases: 10,
          documentRoleTop1: 0.8,
          relationshipTop1: 0.75,
        },
        cases: [{
          id: "ui-case-01",
          workItemId: primaryWorkItemId,
          templateId: "markdown-a",
          traits: ["missing_fact"],
          expectedDocumentRole: "inquiry",
          relationshipExpected: false,
          expectedOutcome: "no_order",
        }],
        safetyScenarios: [],
      },
    },
  );
  expect(pilotEvidence.evidence.state).toBe("incomplete");
  expect(pilotEvidence.evidence.missing).toContain("minimum_formal_cases");
  expect(pilotEvidence.manifest.cases[0].observed).toMatchObject({
    documentRole: "inquiry",
    completed: true,
    evidenceComplete: true,
    outcome: "no_order",
    duplicateIssueCount: 0,
    duplicateBusinessCaseCount: 0,
    duplicateQuotationCount: 0,
    duplicateLedgerRowCount: 0,
    quotationMutationCount: 1,
    ledgerMutationCount: 2,
    approvalCount: 3,
    approvalComplete: true,
  });
  expect((await call(
    "/api/workflow-memory/commercial-pilot/evidence/verify",
    { method: "POST", body: { manifest: pilotEvidence.manifest } },
  )).verified).toBe(true);
  await testInfo.attach("v1.5-real-server-no-order", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});
