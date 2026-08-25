import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loadWechatDraftArticlePackage,
  materializeWechatDraftReconciliationReceipt,
  materializeWechatDraftReceipt,
  parseWechatDraftInvocationResult,
  validateWechatDraftArticlePackage,
  validateWechatDraftSuccessReceipt,
} from "../src/services/wechat-draft-task-execution.mjs";

test("loads one project-confined JSON article package and detects a changed hash", () => {
  const root = mkdtempSync(join(tmpdir(), "wechat-draft-package-"));
  try {
    mkdirSync(join(root, "outputs"));
    const packageBytes = JSON.stringify({ title: "T", contentHtml: "<p>B</p>" });
    writeFileSync(join(root, "outputs", "wechat.json"), packageBytes);
    const state = { projects: [{ id: "prj_1", path: root }] };
    const workItem = { projectId: "prj_1", inputAssets: [{
      id: "a1", path: "outputs/wechat.json",
      hash: `sha256:${createHash("sha256").update(packageBytes).digest("hex")}`,
    }] };
    const loaded = loadWechatDraftArticlePackage({ state, workItem });
    assert.equal(loaded.ok, true);
    assert.equal(loaded.articlePackage.title, "T");
    workItem.inputAssets[0].hash = `sha256:${"0".repeat(64)}`;
    assert.equal(loadWechatDraftArticlePackage({ state, workItem }).error, "wechat_draft_article_package_changed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("materializes a user reconciliation receipt without pretending it was automated", () => {
  const root = mkdtempSync(join(tmpdir(), "wechat-draft-reconciliation-"));
  try {
    const state = { projects: [{ id: "prj_1", path: root }] };
    const workItem = { id: "wi_1", projectId: "prj_1", terminalId: "dev_1" };
    const result = materializeWechatDraftReconciliationReceipt({
      state,
      workItem,
      invocation: { id: "inv_unknown" },
      decision: {
        outcome: "confirmed_saved",
        sourceDecisionId: "channel_event_1",
        decidedBy: "usr_1",
        decidedAt: "2026-08-24T00:00:00.000Z",
      },
    });
    assert.equal(result.ok, true);
    const receipt = JSON.parse(readFileSync(join(root, result.asset.path), "utf8"));
    assert.equal(receipt.verificationSource, "user_draft_box_reconciliation");
    assert.equal(receipt.sideEffectState, "confirmed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("materializes a confirmed draft receipt as a task output", () => {
  const root = mkdtempSync(join(tmpdir(), "wechat-draft-receipt-"));
  try {
    const state = { projects: [{ id: "prj_1", path: root }] };
    const workItem = { id: "wi_1", projectId: "prj_1", terminalId: "dev_1" };
    const invocation = {
      id: "inv_1",
      status: "succeeded",
      completedAt: "2026-08-24T00:00:00.000Z",
      result: { output: { output: JSON.stringify({
        status: "succeeded", sideEffectState: "confirmed", summary: "已保存",
        receipt: { title: "测试草稿", packageDigest: `sha256:${"a".repeat(64)}` },
      }) } },
    };
    assert.equal(parseWechatDraftInvocationResult(invocation).receipt.title, "测试草稿");
    const completed = materializeWechatDraftReceipt({ state, invocation, workItem });
    assert.equal(completed.ok, true);
    assert.equal(completed.asset.family, "text");
    assert.match(readFileSync(join(root, completed.asset.path), "utf8"), /测试草稿/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects an article package without the executable draft contract", () => {
  assert.equal(validateWechatDraftArticlePackage({ title: "标题", contentHtml: "<p>正文</p>" }).error,
    "wechat_draft_article_package_contract_invalid");
  const valid = validateWechatDraftArticlePackage({
    title: "标题",
    contentHtml: "<p>正文</p>",
    packageDigest: `sha256:${"a".repeat(64)}`,
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.title, "标题");
});

test("does not accept a successful receipt for a different article package", () => {
  const result = {
    status: "succeeded",
    sideEffectState: "confirmed",
    receipt: { title: "标题", packageDigest: `sha256:${"a".repeat(64)}` },
  };
  const checked = validateWechatDraftSuccessReceipt({
    result,
    expectedPackageDigest: `sha256:${"b".repeat(64)}`,
    expectedTitle: "标题",
  });
  assert.equal(checked.ok, false);
  assert.equal(checked.error, "wechat_draft_receipt_package_mismatch");
});
