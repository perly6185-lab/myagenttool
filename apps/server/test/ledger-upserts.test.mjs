import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import ExcelJS from "exceljs";

import { createBusinessRoutineService } from "../src/services/business-routines.mjs";
import {
  createLedgerUpsertService,
  ledgerContentRevision,
} from "../src/services/ledger-upserts.mjs";

const ACTOR = { userId: "usr_commercial", teamId: "team_commercial" };

function harness() {
  const root = mkdtempSync(join(tmpdir(), "ledger-upserts-"));
  let id = 0;
  let clock = Date.parse("2026-07-29T00:00:00.000Z");
  const events = [];
  const state = {
    projects: [{ id: "prj_1", ownerTeamId: ACTOR.teamId, path: root }],
    workflowSources: [{
      id: "wfs_1",
      ownerTeamId: ACTOR.teamId,
      projectId: "prj_1",
      state: "active",
      relativePath: ".",
    }],
    workflowArtifacts: [{
      id: "wfa_inquiry",
      ownerTeamId: ACTOR.teamId,
      projectId: "prj_1",
      sourceId: "wfs_1",
      availability: "available",
      fingerprint: "a".repeat(64),
    }, {
      id: "wfa_order",
      ownerTeamId: ACTOR.teamId,
      projectId: "prj_1",
      sourceId: "wfs_1",
      availability: "available",
      fingerprint: "b".repeat(64),
    }],
    businessDocumentClassifications: [],
    businessCases: [],
    routineDefinitions: [],
    routineRuns: [],
    workItems: [],
  };
  const nextId = (prefix) => `${prefix}_${++id}`;
  const now = () => new Date(clock).toISOString();
  const routineService = createBusinessRoutineService({
    state,
    now,
    nextId,
    appendEvent: (event) => events.push(event),
  });
  let routineValidation = null;
  const completions = [];
  const ledgerService = createLedgerUpsertService({
    state,
    now,
    nextId,
    appendEvent: (event) => events.push(event),
    validateRoutineLedgerStep: (input) => routineValidation ?? {
      ok: true,
      routineRunRevision: 3,
      routineVersion: 1,
      triggerArtifactIds: ["wfa_inquiry"],
      ...input,
    },
    completeRoutineLedgerStep: (input) => {
      completions.push(input);
      return { ok: true };
    },
  });
  return {
    root,
    state,
    events,
    routineService,
    ledgerService,
    completions,
    advance: (milliseconds) => { clock += milliseconds; },
    setRoutineValidation: (value) => { routineValidation = value; },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function createCsvDefinition(h, {
  relativePath = "ledgers/inquiries.csv",
  documentType = "inquiry_ledger",
  businessKeyField = "inquiry_number",
  fieldMappings = {
    inquiry_number: "Inquiry No",
    customer: "Customer",
    amount: "Amount",
  },
  requiredFields = [businessKeyField, "customer"],
  writePolicy = { approval: "always", allowInsert: true, allowUpdate: true },
} = {}) {
  const result = h.routineService.createLedgerDefinition({
    projectId: "prj_1",
    sourceId: "wfs_1",
    name: `${documentType} CSV`,
    documentType,
    format: "csv",
    relativePath,
    businessKeyField,
    fieldMappings,
    requiredFields,
    writePolicy,
  }, ACTOR);
  assert.equal(result.status, 201);
  return result.body.ledgerDefinition;
}

async function activate(h, definition) {
  const result = await h.ledgerService.activateDefinition({
    ledgerDefinitionId: definition.id,
    expectedRevision: definition.revision,
  }, ACTOR);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body.ledgerDefinition;
}

test("CSV ledger previews and commits insert, no-op, and update idempotently", async () => {
  const h = harness();
  try {
    const path = join(h.root, "ledgers/inquiries.csv");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "Inquiry No,Customer,Amount,Untouched\r\nRFQ-001,Existing,10,keep\r\n");
    const definition = await activate(h, createCsvDefinition(h));

    const inserted = await h.ledgerService.previewUpsert({
      ledgerDefinitionId: definition.id,
      fields: { inquiry_number: "RFQ-002", customer: "Acme", amount: 42 },
      sourceEvidence: [{ artifactId: "wfa_inquiry", field: "inquiry_number" }],
    }, ACTOR);
    assert.equal(inserted.status, 201);
    assert.equal(inserted.body.preview.action, "insert");
    assert.equal(inserted.body.preview.rowNumber, 3);
    assert.equal(inserted.body.preview.changedCells.length, 3);
    assert.equal(inserted.body.preview.fieldValues, undefined);
    assert.equal((await h.ledgerService.commitPreview({
      previewId: inserted.body.preview.id,
      expectedRevision: inserted.body.preview.revision,
    }, ACTOR)).body.error, "ledger_mutation_approval_required");

    const committed = await h.ledgerService.commitPreview({
      previewId: inserted.body.preview.id,
      expectedRevision: inserted.body.preview.revision,
      approved: true,
    }, ACTOR);
    assert.equal(committed.status, 200);
    assert.equal(committed.body.mutation.action, "insert");
    assert.match(readFileSync(path, "utf8"), /RFQ-002,Acme,42/);
    assert.match(readFileSync(path, "utf8"), /RFQ-001,Existing,10,keep/);

    const replay = await h.ledgerService.commitPreview({
      previewId: inserted.body.preview.id,
      expectedRevision: 1,
      approved: true,
    }, ACTOR);
    assert.equal(replay.body.replayed, true);
    assert.equal(h.state.ledgerMutationAudits.length, 1);

    const noOp = await h.ledgerService.previewUpsert({
      ledgerDefinitionId: definition.id,
      fields: { inquiry_number: "RFQ-002", customer: "Acme", amount: 42 },
      sourceEvidence: [{ artifactId: "wfa_inquiry" }],
    }, ACTOR);
    assert.equal(noOp.body.preview.action, "no_op");
    assert.equal(noOp.body.preview.approvalRequired, false);
    assert.equal((await h.ledgerService.commitPreview({
      previewId: noOp.body.preview.id,
      expectedRevision: noOp.body.preview.revision,
    }, ACTOR)).status, 200);

    const updated = await h.ledgerService.previewUpsert({
      ledgerDefinitionId: definition.id,
      fields: { inquiry_number: "RFQ-002", customer: "Acme Ltd", amount: 45 },
      sourceEvidence: [{ artifactId: "wfa_inquiry" }],
    }, ACTOR);
    assert.equal(updated.body.preview.action, "update");
    assert.deepEqual(updated.body.preview.changedCells.map((cell) => cell.field), ["customer", "amount"]);
    await h.ledgerService.commitPreview({
      previewId: updated.body.preview.id,
      expectedRevision: updated.body.preview.revision,
      approved: true,
    }, ACTOR);
    assert.match(readFileSync(path, "utf8"), /RFQ-002,Acme Ltd,45/);
    assert.equal(readFileSync(path, "utf8").match(/RFQ-002/g).length, 1);
  } finally {
    h.cleanup();
  }
});

test("same-ledger previews serialize durably while independent ledgers remain available", async () => {
  const h = harness();
  try {
    const inquiryPath = join(h.root, "ledgers/inquiries.csv");
    const quotationPath = join(h.root, "ledgers/quotations.csv");
    mkdirSync(dirname(inquiryPath), { recursive: true });
    writeFileSync(inquiryPath, "Inquiry No,Customer,Amount\n");
    writeFileSync(quotationPath, "Inquiry No,Customer,Amount\n");
    const inquiryDefinition = await activate(h, createCsvDefinition(h));
    const quotationDefinition = await activate(h, createCsvDefinition(h, {
      relativePath: "ledgers/quotations.csv",
    }));

    const first = await h.ledgerService.previewUpsert({
      ledgerDefinitionId: inquiryDefinition.id,
      fields: { inquiry_number: "RFQ-Q-1", customer: "First" },
      sourceEvidence: [{ artifactId: "wfa_inquiry" }],
    }, ACTOR);
    const second = await h.ledgerService.previewUpsert({
      ledgerDefinitionId: inquiryDefinition.id,
      fields: { inquiry_number: "RFQ-Q-2", customer: "Second" },
      sourceEvidence: [{ artifactId: "wfa_inquiry" }],
    }, ACTOR);
    const independent = await h.ledgerService.previewUpsert({
      ledgerDefinitionId: quotationDefinition.id,
      fields: { inquiry_number: "RFQ-I-1", customer: "Independent" },
      sourceEvidence: [{ artifactId: "wfa_inquiry" }],
    }, ACTOR);

    assert.equal(first.status, 201);
    assert.equal(second.status, 202);
    assert.equal(second.body.preview.state, "waiting");
    assert.equal(second.body.preview.queue.position, 1);
    assert.equal(independent.status, 201);
    assert.equal(independent.body.preview.state, "pending");
    const repeatedSecond = await h.ledgerService.previewUpsert({
      ledgerDefinitionId: inquiryDefinition.id,
      fields: { inquiry_number: "RFQ-Q-2", customer: "Second" },
      sourceEvidence: [{ artifactId: "wfa_inquiry" }],
    }, ACTOR);
    assert.equal(repeatedSecond.status, 200);
    assert.equal(repeatedSecond.body.replayed, true);
    assert.equal(repeatedSecond.body.preview.id, second.body.preview.id);
    assert.equal((await h.ledgerService.commitPreview({
      previewId: second.body.preview.id,
      expectedRevision: second.body.preview.revision,
      approved: true,
    }, ACTOR)).status, 423);

    const committedFirst = await h.ledgerService.commitPreview({
      previewId: first.body.preview.id,
      expectedRevision: first.body.preview.revision,
      approved: true,
    }, ACTOR);
    assert.equal(committedFirst.body.promotedPreview.id, second.body.preview.id);
    assert.equal(committedFirst.body.promotedPreview.state, "pending");
    assert.equal(committedFirst.body.promotedPreview.rowNumber, 3);

    const listed = await h.ledgerService.listPreviews({
      ledgerDefinitionId: inquiryDefinition.id,
      states: ["pending", "waiting"],
    }, ACTOR);
    assert.equal(listed.body.previews.length, 1);
    assert.equal(listed.body.previews[0].revision, 2);
    const committedSecond = await h.ledgerService.commitPreview({
      previewId: second.body.preview.id,
      expectedRevision: listed.body.previews[0].revision,
      approved: true,
    }, ACTOR);
    assert.equal(committedSecond.status, 200);
    assert.equal(readFileSync(inquiryPath, "utf8").match(/RFQ-Q-/g).length, 2);
  } finally {
    h.cleanup();
  }
});

test("cancelled routine ownership releases a waiting ledger preview without losing it", async () => {
  const h = harness();
  try {
    const path = join(h.root, "ledgers/inquiries.csv");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "Inquiry No,Customer,Amount\n");
    const definition = await activate(h, createCsvDefinition(h));
    const active = await h.ledgerService.previewUpsert({
      ledgerDefinitionId: definition.id,
      routineRunId: "run_cancelled",
      routineStepKey: "register",
      fields: { inquiry_number: "RFQ-CANCEL", customer: "Cancelled" },
      sourceEvidence: [{ artifactId: "wfa_inquiry" }],
    }, ACTOR);
    const waiting = await h.ledgerService.previewUpsert({
      ledgerDefinitionId: definition.id,
      fields: { inquiry_number: "RFQ-AFTER", customer: "After" },
      sourceEvidence: [{ artifactId: "wfa_inquiry" }],
    }, ACTOR);
    assert.equal(active.body.preview.state, "pending");
    assert.equal(waiting.body.preview.state, "waiting");

    const released = h.ledgerService.cancelRoutineReservations({
      routineRunId: "run_cancelled",
    }, ACTOR);
    assert.equal(released.body.released, 1);
    const listed = await h.ledgerService.listPreviews({
      ledgerDefinitionId: definition.id,
      states: ["pending", "waiting", "invalidated"],
    }, ACTOR);
    const cancelledPreview = listed.body.previews.find((preview) => preview.id === active.body.preview.id);
    const promotedPreview = listed.body.previews.find((preview) => preview.id === waiting.body.preview.id);
    assert.equal(cancelledPreview.state, "invalidated");
    assert.equal(promotedPreview.state, "pending");
    assert.equal(promotedPreview.revision, 2);
  } finally {
    h.cleanup();
  }
});

test("concurrent recovery checks promote one waiting preview exactly once", async () => {
  const h = harness();
  try {
    const path = join(h.root, "ledgers/inquiries.csv");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "Inquiry No,Customer,Amount\n");
    const definition = await activate(h, createCsvDefinition(h));
    const active = await h.ledgerService.previewUpsert({
      ledgerDefinitionId: definition.id,
      fields: { inquiry_number: "RFQ-EXPIRE", customer: "Expired" },
      sourceEvidence: [{ artifactId: "wfa_inquiry" }],
    }, ACTOR);
    const waiting = await h.ledgerService.previewUpsert({
      ledgerDefinitionId: definition.id,
      fields: { inquiry_number: "RFQ-PROMOTE", customer: "Promoted" },
      sourceEvidence: [{ artifactId: "wfa_inquiry" }],
    }, ACTOR);
    h.advance(15 * 60 * 1_000 + 1);

    await Promise.all([
      h.ledgerService.listPreviews({ ledgerDefinitionId: definition.id }, ACTOR),
      h.ledgerService.listPreviews({ ledgerDefinitionId: definition.id }, ACTOR),
    ]);
    const expired = h.state.ledgerUpsertPreviews.find((preview) => preview.id === active.body.preview.id);
    const promoted = h.state.ledgerUpsertPreviews.find((preview) => preview.id === waiting.body.preview.id);
    assert.equal(expired.state, "expired");
    assert.equal(promoted.state, "pending");
    assert.equal(promoted.revision, 2);
  } finally {
    h.cleanup();
  }
});

test("stale previews, active locks, unsafe formulas, and escaping links are refused", async () => {
  const h = harness();
  try {
    const path = join(h.root, "ledgers/inquiries.csv");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "Inquiry No,Customer,Amount\n");
    const definition = await activate(h, createCsvDefinition(h));
    assert.equal((await h.ledgerService.previewUpsert({
      ledgerDefinitionId: definition.id,
      fields: { inquiry_number: "RFQ-X", customer: "=HYPERLINK(\"bad\")" },
      sourceEvidence: [{ artifactId: "wfa_inquiry" }],
    }, ACTOR)).body.error, "invalid_ledger_fields");

    const stale = await h.ledgerService.previewUpsert({
      ledgerDefinitionId: definition.id,
      fields: { inquiry_number: "RFQ-STALE", customer: "Before" },
      sourceEvidence: [{ artifactId: "wfa_inquiry" }],
    }, ACTOR);
    writeFileSync(path, "Inquiry No,Customer,Amount\nRFQ-OTHER,Concurrent,1\n");
    assert.equal((await h.ledgerService.commitPreview({
      previewId: stale.body.preview.id,
      expectedRevision: stale.body.preview.revision,
      approved: true,
    }, ACTOR)).body.error, "ledger_changed_since_preview");
    assert.match(readFileSync(path, "utf8"), /RFQ-OTHER/);

    const locked = await h.ledgerService.previewUpsert({
      ledgerDefinitionId: definition.id,
      fields: { inquiry_number: "RFQ-LOCK", customer: "Locked" },
      sourceEvidence: [{ artifactId: "wfa_inquiry" }],
    }, ACTOR);
    writeFileSync(`${path}.myagenttool.lock`, JSON.stringify({
      pid: 999,
      createdAt: Date.parse("2026-07-29T00:00:00.000Z"),
    }));
    assert.equal((await h.ledgerService.commitPreview({
      previewId: locked.body.preview.id,
      expectedRevision: locked.body.preview.revision,
      approved: true,
    }, ACTOR)).status, 423);
    rmSync(`${path}.myagenttool.lock`);

    const outside = join(h.root, "..", `outside-${Date.now()}.csv`);
    writeFileSync(outside, "Inquiry No,Customer,Amount\n");
    const linkPath = join(h.root, "ledgers/link.csv");
    symlinkSync(outside, linkPath);
    const linked = createCsvDefinition(h, { relativePath: "ledgers/link.csv" });
    const activation = await h.ledgerService.activateDefinition({
      ledgerDefinitionId: linked.id,
      expectedRevision: linked.revision,
    }, ACTOR);
    assert.equal(activation.body.error, "ledger_link_escapes_authorized_source");
    rmSync(outside, { force: true });
  } finally {
    h.cleanup();
  }
});

test("a stale lock and an interrupted post-rename commit recover without duplicate rows", async () => {
  const h = harness();
  try {
    const path = join(h.root, "ledgers/inquiries.csv");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "Inquiry No,Customer,Amount\n");
    const definition = await activate(h, createCsvDefinition(h));
    const staleLockPreview = await h.ledgerService.previewUpsert({
      ledgerDefinitionId: definition.id,
      fields: { inquiry_number: "RFQ-LOCK-RECOVER", customer: "Recovered" },
      sourceEvidence: [{ artifactId: "wfa_inquiry" }],
    }, ACTOR);
    writeFileSync(`${path}.myagenttool.lock`, JSON.stringify({
      pid: 999,
      createdAt: Date.parse("2026-07-28T23:50:00.000Z"),
    }));
    const staleLockCommit = await h.ledgerService.commitPreview({
      previewId: staleLockPreview.body.preview.id,
      expectedRevision: staleLockPreview.body.preview.revision,
      approved: true,
    }, ACTOR);
    assert.equal(staleLockCommit.status, 200);

    const interrupted = await h.ledgerService.previewUpsert({
      ledgerDefinitionId: definition.id,
      fields: { inquiry_number: "RFQ-RENAME", customer: "After rename" },
      sourceEvidence: [{ artifactId: "wfa_inquiry" }],
    }, ACTOR);
    writeFileSync(path,
      "Inquiry No,Customer,Amount\nRFQ-LOCK-RECOVER,Recovered,\nRFQ-RENAME,After rename,\n");
    const recovered = await h.ledgerService.commitPreview({
      previewId: interrupted.body.preview.id,
      expectedRevision: interrupted.body.preview.revision,
      approved: true,
    }, ACTOR);
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.mutation.afterHash, interrupted.body.preview.proposedTargetRevision);
    assert.equal(readFileSync(path, "utf8").match(/RFQ-RENAME/g).length, 1);
  } finally {
    h.cleanup();
  }
});

test("XLSX updates preserve unrelated sheets, formulas, and cell formatting", async () => {
  const h = harness();
  try {
    const path = join(h.root, "ledgers/quotes.xlsx");
    mkdirSync(dirname(path), { recursive: true });
    const workbook = new ExcelJS.Workbook();
    const ledger = workbook.addWorksheet("Quotes");
    ledger.addRow(["Quote No", "Customer", "Amount", "Calculated"]);
    const dataRow = ledger.addRow(["Q-001", "Existing", 10, { formula: "C2*2", result: 20 }]);
    dataRow.getCell(2).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFFF00" },
    };
    const summary = workbook.addWorksheet("Summary");
    summary.getCell("A1").value = { formula: "Quotes!C2", result: 10 };
    await workbook.xlsx.writeFile(path);
    const created = h.routineService.createLedgerDefinition({
      projectId: "prj_1",
      sourceId: "wfs_1",
      name: "Quotation ledger",
      documentType: "quotation_ledger",
      format: "xlsx",
      relativePath: "ledgers/quotes.xlsx",
      sheet: "Quotes",
      businessKeyField: "quotation_number",
      fieldMappings: {
        quotation_number: "Quote No",
        customer: "Customer",
        amount: "Amount",
      },
      requiredFields: ["quotation_number", "customer"],
    }, ACTOR);
    assert.equal(created.status, 201);
    const definition = await activate(h, created.body.ledgerDefinition);
    const preview = await h.ledgerService.previewUpsert({
      ledgerDefinitionId: definition.id,
      fields: { quotation_number: "Q-001", customer: "Updated", amount: 12 },
      sourceEvidence: [{ artifactId: "wfa_inquiry" }],
    }, ACTOR);
    assert.equal(preview.status, 201, JSON.stringify(preview.body));
    const committed = await h.ledgerService.commitPreview({
      previewId: preview.body.preview.id,
      expectedRevision: preview.body.preview.revision,
      approved: true,
    }, ACTOR);
    assert.equal(committed.status, 200);
    assert.equal(committed.body.mutation.afterHash, preview.body.preview.proposedTargetRevision);

    const reloaded = new ExcelJS.Workbook();
    await reloaded.xlsx.readFile(path);
    assert.equal(reloaded.getWorksheet("Quotes").getCell("B2").value, "Updated");
    assert.equal(reloaded.getWorksheet("Quotes").getCell("C2").value, 12);
    assert.equal(reloaded.getWorksheet("Quotes").getCell("D2").value.formula, "C2*2");
    assert.equal(reloaded.getWorksheet("Quotes").getCell("B2").fill.fgColor.argb, "FFFFFF00");
    assert.equal(reloaded.getWorksheet("Summary").getCell("A1").value.formula, "Quotes!C2");
  } finally {
    h.cleanup();
  }
});

test("XLSX revisions ignore volatile ZIP entry timestamps", async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Quotes").addRow(["Quote No", "Customer"]);
  const first = Buffer.from(await workbook.xlsx.writeBuffer());
  const second = Buffer.from(first);
  const eocd = second.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.notEqual(eocd, -1);
  const entryCount = second.readUInt16LE(eocd + 10);
  let centralOffset = second.readUInt32LE(eocd + 16);
  for (let entry = 0; entry < entryCount; entry += 1) {
    const localOffset = second.readUInt32LE(centralOffset + 42);
    second.writeUInt16LE(0x7bef, centralOffset + 12);
    second.writeUInt16LE(0x579d, centralOffset + 14);
    second.writeUInt16LE(0x7bef, localOffset + 10);
    second.writeUInt16LE(0x579d, localOffset + 12);
    centralOffset += 46
      + second.readUInt16LE(centralOffset + 28)
      + second.readUInt16LE(centralOffset + 30)
      + second.readUInt16LE(centralOffset + 32);
  }
  assert.notDeepEqual(second, first);
  assert.equal(
    ledgerContentRevision(second, "xlsx"),
    ledgerContentRevision(first, "xlsx"),
  );
});

test("XLSX named tables validate their location and expand on insert", async () => {
  const h = harness();
  try {
    const path = join(h.root, "ledgers/table-quotes.xlsx");
    mkdirSync(dirname(path), { recursive: true });
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Quotes");
    worksheet.addTable({
      name: "QuoteLedger",
      ref: "B2",
      headerRow: true,
      totalsRow: false,
      style: { theme: "TableStyleMedium4", showRowStripes: true },
      columns: [{ name: "Quote No" }, { name: "Customer" }, { name: "Amount" }],
      rows: [["Q-001", "Existing", 10]],
    });
    await workbook.xlsx.writeFile(path);
    const created = h.routineService.createLedgerDefinition({
      projectId: "prj_1",
      sourceId: "wfs_1",
      name: "Named quotation table",
      documentType: "quotation_ledger",
      format: "xlsx",
      relativePath: "ledgers/table-quotes.xlsx",
      sheet: "Quotes",
      table: "QuoteLedger",
      headerRow: 2,
      businessKeyField: "quotation_number",
      fieldMappings: {
        quotation_number: "Quote No",
        customer: "Customer",
        amount: "Amount",
      },
      requiredFields: ["quotation_number", "customer"],
    }, ACTOR);
    const definition = await activate(h, created.body.ledgerDefinition);
    const preview = await h.ledgerService.previewUpsert({
      ledgerDefinitionId: definition.id,
      fields: { quotation_number: "Q-002", customer: "New", amount: 20 },
      sourceEvidence: [{ artifactId: "wfa_inquiry" }],
    }, ACTOR);
    assert.equal(preview.status, 201, JSON.stringify(preview.body));
    assert.equal(preview.body.preview.action, "insert");
    assert.equal(preview.body.preview.rowNumber, 4);
    assert.equal((await h.ledgerService.commitPreview({
      previewId: preview.body.preview.id,
      expectedRevision: preview.body.preview.revision,
      approved: true,
    }, ACTOR)).status, 200);

    const reloaded = new ExcelJS.Workbook();
    await reloaded.xlsx.readFile(path);
    const reloadedSheet = reloaded.getWorksheet("Quotes");
    const table = reloadedSheet.getTable("QuoteLedger");
    assert.deepEqual(
      ["B4", "C4", "D4"].map((address) => reloadedSheet.getCell(address).value),
      ["Q-002", "New", 20],
    );
    assert.equal(table.table.tableRef, "B2:D4");
    assert.equal(table.table.style.theme, "TableStyleMedium4");
  } finally {
    h.cleanup();
  }
});

test("order ledger requires confirmed order evidence and routine commits are synchronized", async () => {
  const h = harness();
  try {
    const path = join(h.root, "ledgers/orders.csv");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "Order No,Customer\n");
    const definition = await activate(h, createCsvDefinition(h, {
      relativePath: "ledgers/orders.csv",
      documentType: "order_ledger",
      businessKeyField: "order_number",
      fieldMappings: { order_number: "Order No", customer: "Customer" },
      requiredFields: ["order_number", "customer"],
    }));
    h.setRoutineValidation({
      ok: true,
      routineRunRevision: 7,
      routineVersion: 2,
      businessCaseId: "bcs_order",
      triggerArtifactIds: ["wfa_order"],
    });
    h.state.businessCases.push({
      id: "bcs_order",
      ownerTeamId: ACTOR.teamId,
      entityIds: ["ben_order"],
      artifactBindings: [{ artifactId: "wfa_order", documentType: "order", roles: ["trigger"] }],
    });
    h.state.businessEntities.push({
      id: "ben_order",
      ownerTeamId: ACTOR.teamId,
      fields: { order_number: "ORD-001", customer: "Acme" },
    });
    const input = {
      ledgerDefinitionId: definition.id,
      fields: { order_number: "ORD-001", customer: "Acme" },
      routineRunId: "rtr_1",
      routineStepKey: "register_order",
    };
    assert.equal((await h.ledgerService.previewUpsert(input, ACTOR)).body.error,
      "confirmed_order_business_event_required");
    h.state.businessDocumentClassifications.push({
      id: "bdc_order",
      ownerTeamId: ACTOR.teamId,
      projectId: "prj_1",
      sourceId: "wfs_1",
      artifactId: "wfa_order",
      documentType: "order",
      confirmationState: "confirmed",
    });
    const preview = await h.ledgerService.previewUpsert(input, ACTOR);
    assert.equal(preview.status, 201);
    const committed = await h.ledgerService.commitPreview({
      previewId: preview.body.preview.id,
      expectedRevision: preview.body.preview.revision,
      approved: true,
    }, ACTOR);
    assert.equal(committed.status, 200);
    assert.equal(h.completions.length, 1);
    assert.equal(h.completions[0].mutation.businessKey, "ORD-001");
    assert.equal(h.completions[0].expectedRunRevision, 7);
  } finally {
    h.cleanup();
  }
});
