import assert from "node:assert/strict";
import test from "node:test";

import { contextualTaskControl, rememberChannelFocus, resolveChannelTaskFocus } from "../src/services/channel-focus-memory.mjs";

const threads = [
  { id: "article", taskKind: "content_article", taskTitle: "文章创作" },
  { id: "video", taskKind: "content_video", taskTitle: "视频制作" },
];

test("conversation focus survives serialization and resolves ordinary pronouns", () => {
  const conversation = {};
  rememberChannelFocus(conversation, { goalId: "goal_1", taskThreadId: "video", at: "2026-08-24T00:00:00.000Z" });
  const restored = JSON.parse(JSON.stringify(conversation));
  assert.equal(resolveChannelTaskFocus(restored, threads, "这个").thread.id, "video");
  assert.deepEqual(contextualTaskControl("这个先停一下", restored, threads), {
    kind: "pause", threadId: "video", friendly: true, contextual: true,
  });
});

test("a correction moves focus to the explicitly named independent task", () => {
  const conversation = {};
  rememberChannelFocus(conversation, { taskThreadId: "article" });
  assert.equal(contextualTaskControl("不是文章，是视频", conversation, threads).threadId, "video");
});
