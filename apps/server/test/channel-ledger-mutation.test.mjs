import test from "node:test";
import assert from "node:assert/strict";

import {
  channelLedgerMutationFieldHint,
  parseLedgerMutationPlan,
  parseSingleRecordLedgerMutation,
} from "../src/services/channel-ledger-mutation.mjs";

const definition = {
  businessKeyField: "inquiry_number",
  fieldMappings: {
    inquiry_number: "Inquiry No",
    customer: "Customer",
    status: "Status",
  },
};

test("parses a single-record Chinese update and maps a friendly field alias", () => {
  const result = parseSingleRecordLedgerMutation(
    "把 inquiries.csv 里的 1001 的 客户 改成 Acme Ltd",
    definition,
  );
  assert.equal(result.ok, true);
  assert.equal(result.businessKey, "1001");
  assert.equal(result.field, "customer");
  assert.deepEqual(result.fields, { customer: "Acme Ltd" });
});

test("fails closed for batch operations and immutable business keys", () => {
  assert.equal(parseSingleRecordLedgerMutation("把所有客户的状态改为已发货", definition).reason, "single_record_only");
  assert.equal(parseSingleRecordLedgerMutation("把 1001 的 询价单号改成 1002", definition).reason, "business_key_immutable");
  assert.deepEqual(channelLedgerMutationFieldHint(definition), ["inquiry_number", "customer", "status"]);
});

test("parses explicitly file-scoped multi-row changes and rejects duplicates", () => {
  const result = parseLedgerMutationPlan(
    "把 inquiries.csv 里的 1001 的 客户 改成 Acme；把 inquiries.csv 里的 1002 的 状态 改成 已发货",
    [{ ...definition, id: "ledger_inquiries", relativePath: "ledgers/inquiries.csv" }],
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.operations.map((operation) => operation.businessKey), ["1001", "1002"]);
  assert.equal(parseLedgerMutationPlan(
    "把 inquiries.csv 里的 1001 的 客户 改成 A；把 inquiries.csv 里的 1001 的 客户 改成 B",
    [{ ...definition, id: "ledger_inquiries", relativePath: "ledgers/inquiries.csv" }],
  ).reason, "batch_duplicate_mutation_target");
});

test("requires an explicit file for each multi-file clause", () => {
  const other = { ...definition, id: "ledger_orders", relativePath: "ledgers/orders.csv" };
  assert.equal(parseLedgerMutationPlan(
    "把 inquiries.csv 里的 1001 的 客户 改成 A；把 1002 的 状态 改成 已发货",
    [{ ...definition, id: "ledger_inquiries", relativePath: "ledgers/inquiries.csv" }, other],
  ).reason, "batch_file_scope_required");
});
