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
let workItemTitle = "";

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
  writeFileSync(
    join(history, "inquiry-RFQ-PILOT-001.md"),
    [
      "# Request for quotation",
      "Inquiry number: RFQ-PILOT-001",
      "Customer: Pilot Customer",
      "Product: Controller",
      "Quantity: 5",
      "Currency: USD",
    ].join("\n"),
  );
  writeFileSync(
    join(templates, "quotation.md"),
    [
      "# Quotation",
      "",
      "Customer: {{customer}}",
      "Product: {{product}}",
      "Quantity: {{quantity}}",
      "Unit price: {{unit_price}}",
      "Currency: {{currency}}",
      "Tax rate: {{tax_rate}}",
      "Delivery: {{delivery_terms}}",
    ].join("\n"),
  );
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
  const inquiry = artifacts.find((artifact: { name: string }) =>
    artifact.name === "inquiry-RFQ-PILOT-001.md");
  const template = artifacts.find((artifact: { name: string }) =>
    artifact.name === "quotation.md");
  const analyzed = await call(
    `/api/workflow-memory/artifacts/${inquiry.id}/analyze-business-document`,
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
  const stateInquiry = state.workflowArtifacts.find((row: { id: string }) =>
    row.id === inquiry.id);
  const caseIds = [1, 2, 3].map((index) => `bcs_pilot_${index}`);
  for (const [index, caseId] of caseIds.entries()) {
    state.businessCases.push({
      id: caseId,
      ownerTeamId: defaultProject.ownerTeamId,
      projectId: defaultProject.id,
      sourceId: source.id,
      businessKey: index === 0 ? "RFQ-PILOT-001" : `RFQ-PILOT-HISTORY-${index + 1}`,
      state: "confirmed",
      entityIds: index === 0 ? [confirmed.entity.id] : [],
      artifactBindings: [{
        artifactId: inquiry.id,
        documentType: "inquiry",
        roles: ["trigger", "input"],
      }],
      artifactFingerprints: { [inquiry.id]: stateInquiry.fingerprint },
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
      configuration: { templateArtifactIds: [template.id] },
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
  const materialized = await call(
    `/api/workflow-memory/business-cases/${caseIds[0]}/materialize-routine`,
    {
      method: "POST",
      body: {
        routineDefinitionId: draft.routineDefinition.id,
        triggerArtifactIds: [inquiry.id],
      },
    },
  );
  workItemTitle = materialized.workItem.title;
});

test.afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(resolve));
  }
  rmSync(root, { recursive: true, force: true });
});

test("completes the governed no-order journey against real business APIs", async ({ page }, testInfo) => {
  await page.goto(`/?section=task&api=${encodeURIComponent(apiBase)}`);
  await page.getByText(workItemTitle).first().click();
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
  await inputs.getByLabel("Quotation template").selectOption({ label: "templates/quotation.md" });
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
  await testInfo.attach("v1.5-real-server-no-order", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});
