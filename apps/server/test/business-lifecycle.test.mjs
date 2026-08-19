import assert from "node:assert/strict";
import test from "node:test";

import { businessLifecycleSummaries } from "../src/read-models/business-lifecycle.mjs";

test("business lifecycle summary joins local stages by order or customer and remains source-traceable", () => {
  const result = businessLifecycleSummaries({
    records: [
      { projectId: "prj_1", kind: "order", businessKey: "O-1", fields: { order_number: "O-1", customer: "Acme", status: "已完成" }, sourceId: "src_orders", updatedAt: "2026-08-17T01:00:00Z" },
      { projectId: "prj_1", kind: "quotation", businessKey: "Q-1", fields: { quotation_number: "Q-1", customer: "Acme", status: "已转订单" }, sourceId: "src_quotes", updatedAt: "2026-08-17T02:00:00Z" },
      { projectId: "prj_1", kind: "shipment", businessKey: "O-1", fields: { order_number: "O-1", delivery_status: "已发货" }, sourceId: "src_shipments", updatedAt: "2026-08-17T03:00:00Z" },
      { projectId: "prj_1", kind: "receivable", businessKey: "AR-1", fields: { reference: "AR-1", customer: "Acme", payment_status: "已回款" }, sourceId: "src_receivables", updatedAt: "2026-08-17T04:00:00Z" },
      { projectId: "prj_1", kind: "after_sales", businessKey: "AS-1", fields: { case_number: "AS-1", order_number: "O-1", customer: "Acme", status: "已关闭" }, sourceId: "src_after_sales", updatedAt: "2026-08-17T05:00:00Z" },
    ],
    sources: [
      { id: "src_orders", fileName: "orders.csv" },
      { id: "src_quotes", fileName: "quotations.csv" },
      { id: "src_shipments", fileName: "shipments.csv" },
      { id: "src_receivables", fileName: "receivables.csv" },
      { id: "src_after_sales", fileName: "after-sales.csv" },
    ],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].state, "closed");
  assert.equal(result[0].customer, "Acme");
  assert.equal(result[0].stages.quotation.status, "已转订单");
  assert.equal(result[0].stages.shipment.status, "已发货");
  assert.equal(result[0].stages.receivable.status, "已回款");
  assert.deepEqual(result[0].sources, ["after-sales.csv", "orders.csv", "quotations.csv", "receivables.csv", "shipments.csv"]);
});

test("business lifecycle summary preserves quote revisions, split shipments/payments, returns, and repeated after-sales cases", () => {
  const result = businessLifecycleSummaries({
    records: [
      { projectId: "prj_2", kind: "quotation", businessKey: "Q-1", fields: { quotation_number: "Q-1", customer: "Acme", amount: "10000", status: "已报价" }, sourceId: "quotes", updatedAt: "2026-08-01T01:00:00Z" },
      { projectId: "prj_2", kind: "quotation", businessKey: "Q-2", fields: { quotation_number: "Q-2", customer: "Acme", amount: "12000", status: "已转订单" }, sourceId: "quotes", updatedAt: "2026-08-02T01:00:00Z" },
      { projectId: "prj_2", kind: "order", businessKey: "O-2", fields: { order_number: "O-2", customer: "Acme", amount: "12000", status: "已完成" }, sourceId: "orders", updatedAt: "2026-08-03T01:00:00Z" },
      { projectId: "prj_2", kind: "shipment", businessKey: "S-1", fields: { shipment_number: "S-1", order_number: "O-2", quantity: "3", delivery_status: "已发货" }, sourceId: "shipments", updatedAt: "2026-08-04T01:00:00Z" },
      { projectId: "prj_2", kind: "shipment", businessKey: "S-2", fields: { shipment_number: "S-2", order_number: "O-2", quantity: "2", delivery_status: "已发货" }, sourceId: "shipments", updatedAt: "2026-08-05T01:00:00Z" },
      { projectId: "prj_2", kind: "receivable", businessKey: "AR-1", fields: { reference: "AR-1", order_number: "O-2", amount: "6000", payment_status: "已回款" }, sourceId: "receivables", updatedAt: "2026-08-06T01:00:00Z" },
      { projectId: "prj_2", kind: "receivable", businessKey: "AR-2", fields: { reference: "AR-2", order_number: "O-2", amount: "6000", payment_status: "待回款" }, sourceId: "receivables", updatedAt: "2026-08-07T01:00:00Z" },
      { projectId: "prj_2", kind: "bank_transaction", businessKey: "AR-1", fields: { reference: "AR-1", amount: "6000" }, sourceId: "bank", updatedAt: "2026-08-06T02:00:00Z" },
      { projectId: "prj_2", kind: "after_sales", businessKey: "AS-1", fields: { case_number: "AS-1", order_number: "O-2", status: "已关闭" }, sourceId: "after-sales", updatedAt: "2026-08-08T01:00:00Z" },
      { projectId: "prj_2", kind: "after_sales", businessKey: "AS-2", fields: { case_number: "AS-2", order_number: "O-2", status: "处理中" }, sourceId: "after-sales", updatedAt: "2026-08-09T01:00:00Z" },
      { projectId: "prj_2", kind: "return", businessKey: "RT-1", fields: { return_number: "RT-1", order_number: "O-2", return_amount: "1200", quantity: "1", return_status: "已完成" }, sourceId: "returns", updatedAt: "2026-08-10T01:00:00Z" },
    ],
    sources: [
      { id: "quotes", fileName: "quotations.csv" }, { id: "orders", fileName: "orders.csv" },
      { id: "shipments", fileName: "shipments.csv" }, { id: "receivables", fileName: "receivables.csv" },
      { id: "bank", fileName: "bank.csv" }, { id: "after-sales", fileName: "after-sales.csv" }, { id: "returns", fileName: "returns.csv" },
    ],
  });
  assert.equal(result.length, 1);
  const [summary] = result;
  assert.equal(summary.orderNumber, "O-2");
  assert.equal(summary.state, "active", "open after-sales keeps a completed order active");
  assert.equal(summary.stages.quotation.count, 2);
  assert.equal(summary.stages.shipment.count, 2);
  assert.equal(summary.stages.receivable.count, 2);
  assert.equal(summary.stages.after_sales.count, 2);
  assert.equal(summary.stages.return.count, 1);
  assert.equal(summary.totals.collectedAmount, 6000);
  assert.equal(summary.totals.shipmentQuantity, 5);
  assert.equal(summary.totals.returnAmount, 1200);
  assert.equal(summary.totals.returnQuantity, 1);
});
