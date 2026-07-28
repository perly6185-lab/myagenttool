import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePdfcpuApplicationResult } from "../src/services/pdfcpu-result.mjs";

test("parses pdfcpu info JSON and validation status", () => {
  assert.deepEqual(parsePdfcpuApplicationResult({ capability: "app.app_pdfcpu.wrapper.info", text: '{"pages":3,"title":"Report"}' }), { pages: 3, title: "Report" });
  assert.deepEqual(parsePdfcpuApplicationResult({ capability: "app.app_pdfcpu.wrapper.validate", text: "validation ok" }), { valid: true, summary: "validation ok" });
  assert.equal(parsePdfcpuApplicationResult({ capability: "app.app_pdfcpu.wrapper.info", text: "not json" }), null);
});
