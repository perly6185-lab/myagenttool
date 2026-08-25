import test from "node:test";
import assert from "node:assert/strict";
import {
  snapshotTaskBasket,
  taskBasketAction,
  taskBasketExpired,
  taskBasketPreviewRequested,
  taskBasketReply,
} from "../src/services/task-basket.mjs";

const plan = {
  goal: { title: "整理编码成果", domains: ["content"] },
  intent: { id: "intent_1" },
  tasks: [
    { key: "article", kind: "content_article", title: "文章创作", outcome: "形成文章", requires: [], approvalRequired: false },
    { key: "image", kind: "content_image", title: "图片创作", outcome: "形成配图", requires: [], approvalRequired: false },
  ],
};

test("task basket recognizes preview, edit, confirm, and cancel language", () => {
  assert.equal(taskBasketPreviewRequested("先规划一下，写文章、做图片"), true);
  assert.deepEqual(taskBasketAction("去掉图片"), { kind: "remove", kinds: ["content_image"] });
  assert.deepEqual(taskBasketAction("先不发布"), {
    kind: "remove",
    kinds: ["content_publish", "platform_adaptation", "wechat_draft_sync"],
  });
  assert.deepEqual(taskBasketAction("确认执行"), { kind: "confirm" });
  assert.deepEqual(taskBasketAction("取消规划"), { kind: "cancel" });
});

test("task basket snapshot is bounded and ordinary-user readable", () => {
  const basket = snapshotTaskBasket(plan, { id: "basket_1", originalText: "先规划", createdAt: "2026-08-24T10:00:00.000Z" });
  assert.equal(basket.id, "basket_1");
  assert.equal(basket.tasks.length, 2);
  assert.match(taskBasketReply(basket), /暂不创建或执行/);
  assert.match(taskBasketReply(basket), /确认执行/);
  assert.equal(taskBasketExpired(basket, "2026-08-24T10:05:00.000Z"), false);
  assert.equal(taskBasketExpired(basket, "2026-08-24T10:11:00.000Z"), true);
});
