import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import JSZip from "jszip";

import {
  inspectLocalQuotationTemplate,
  writeLocalQuotationDraft,
} from "../src/services/business-routine-executors.mjs";
import {
  inspectOfficeTemplateBuffer,
  renderOfficeTemplateBuffer,
} from "../src/services/office-template-fidelity.mjs";

async function officePackage(format, { formulaPlaceholder = false, splitPlaceholder = false } = {}) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  if (format === "docx") {
    zip.file("word/document.xml", splitPlaceholder
      ? "<w:document><w:body><w:p><w:r><w:t>Customer: {{cus</w:t></w:r><w:r><w:t>tomer}}</w:t></w:r></w:p></w:body></w:document>"
      : "<w:document><w:body><w:p><w:r><w:t>Customer: {{customer}}</w:t></w:r></w:p></w:body></w:document>");
    zip.file("word/styles.xml", "<w:styles><w:style w:styleId=\"Normal\"/></w:styles>");
    zip.file("word/media/logo.png", Buffer.from([1, 2, 3, 4]));
  } else {
    zip.file("xl/workbook.xml", "<workbook/>");
    zip.file("xl/styles.xml", "<styleSheet><fonts count=\"1\"/></styleSheet>");
    zip.file("xl/sharedStrings.xml", "<sst><si><t>Customer: {{customer}}</t></si></sst>");
    zip.file("xl/worksheets/sheet1.xml", formulaPlaceholder
      ? "<worksheet><c><f>{{customer}}+1</f></c></worksheet>"
      : "<worksheet><c><f>B2*2</f></c><c t=\"inlineStr\"><is><t>{{amount}}</t></is></c></worksheet>");
    zip.file("xl/tables/table1.xml", "<table name=\"Quote\"/>");
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

test("DOCX placeholders are replaced while styles and media remain intact", async () => {
  const source = await officePackage("docx");
  const inspection = inspectOfficeTemplateBuffer({ buffer: source, format: "docx" });
  assert.equal(inspection.ok, true);
  assert.deepEqual(inspection.placeholderKeys, ["customer"]);
  assert.equal(inspection.fidelity.preservesStyles, true);
  assert.equal(inspection.fidelity.mediaPartCount, 1);

  const rendered = renderOfficeTemplateBuffer({
    buffer: source,
    format: "docx",
    fields: { customer: "星海科技 & Co" },
  });
  assert.equal(rendered.ok, true);
  const output = await JSZip.loadAsync(rendered.buffer);
  assert.match(await output.file("word/document.xml").async("string"), /星海科技 &amp; Co/);
  assert.deepEqual(await output.file("word/media/logo.png").async("nodebuffer"), Buffer.from([1, 2, 3, 4]));
  assert.match(await output.file("word/styles.xml").async("string"), /Normal/);
});

test("DOCX placeholders split across styled text runs are still replaced safely", async () => {
  const source = await officePackage("docx", { splitPlaceholder: true });
  const rendered = renderOfficeTemplateBuffer({ buffer: source, format: "docx", fields: { customer: "Acme" } });
  assert.equal(rendered.ok, true);
  const output = await JSZip.loadAsync(rendered.buffer);
  const xml = await output.file("word/document.xml").async("string");
  assert.match(xml, /Customer: Acme/);
  assert.doesNotMatch(xml, /\{\{|tomer\}\}/);
});

test("XLSX placeholder rendering preserves formulas, styles, and table parts", async () => {
  const source = await officePackage("xlsx");
  const rendered = renderOfficeTemplateBuffer({
    buffer: source,
    format: "xlsx",
    fields: { customer: "Acme", amount: "1250" },
  });
  assert.equal(rendered.ok, true);
  assert.equal(rendered.preview.unchanged.formulaCount, 1);
  assert.equal(rendered.preview.unchanged.tablePartCount, 1);
  const output = await JSZip.loadAsync(rendered.buffer);
  assert.match(await output.file("xl/sharedStrings.xml").async("string"), /Customer: Acme/);
  assert.match(await output.file("xl/worksheets/sheet1.xml").async("string"), /<f>B2\*2<\/f>/);
  assert.match(await output.file("xl/worksheets/sheet1.xml").async("string"), /<t>1250<\/t>/);
  assert.match(await output.file("xl/styles.xml").async("string"), /fonts count="1"/);
});

test("Office templates fail closed for missing values and formula placeholders", async () => {
  const source = await officePackage("docx");
  assert.deepEqual(renderOfficeTemplateBuffer({ buffer: source, format: "docx", fields: {} }), {
    ok: false,
    error: "routine_template_values_missing",
    missingFields: ["customer"],
  });
  const unsafe = inspectOfficeTemplateBuffer({
    buffer: await officePackage("xlsx", { formulaPlaceholder: true }),
    format: "xlsx",
  });
  assert.equal(unsafe.ok, false);
  assert.equal(unsafe.error, "routine_office_formula_placeholder_not_allowed");
});

test("Routine executor creates a new format-preserving XLSX draft and never overwrites it", async () => {
  const root = mkdtempSync(join(tmpdir(), "routine-office-template-"));
  const sourceRoot = join(root, "commercial");
  mkdirSync(join(sourceRoot, "templates"), { recursive: true });
  writeFileSync(join(sourceRoot, "templates", "quotation.xlsx"), await officePackage("xlsx"));
  try {
    const inspected = inspectLocalQuotationTemplate({
      projectPath: root,
      sourceRelativePath: "commercial",
      templateRelativePath: "templates/quotation.xlsx",
    });
    assert.equal(inspected.ok, true);
    assert.deepEqual(inspected.placeholderKeys, ["amount", "customer"]);
    const input = {
      projectPath: root,
      sourceRelativePath: "commercial",
      outputDirectory: "outputs/quotations",
      businessKey: "RFQ-88",
      routineVersion: 2,
      executionSuffix: "1234abcd",
      draftRevision: 1,
      fields: { customer: "Acme", amount: "50" },
      templateRelativePath: "templates/quotation.xlsx",
      templateFingerprint: inspected.fingerprint,
    };
    const created = writeLocalQuotationDraft(input);
    assert.equal(created.ok, true);
    assert.match(created.relativePath, /quotation-RFQ-88-r2-d1-1234abcd\.xlsx$/);
    assert.match(created.preview, /formulas, styles, tables, and media/);
    assert.deepEqual(writeLocalQuotationDraft(input), created);
    writeFileSync(join(root, created.relativePath), "user content");
    assert.deepEqual(writeLocalQuotationDraft(input), { ok: false, error: "routine_output_conflict" });
    assert.equal(readFileSync(join(root, created.relativePath), "utf8"), "user content");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
