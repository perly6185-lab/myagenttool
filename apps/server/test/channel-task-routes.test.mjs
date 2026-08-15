import assert from "node:assert/strict";
import { test } from "node:test";

import { handleChannelRoutes } from "../src/routes/channels.mjs";

test("task operation routes dispatch route, dismiss, retry, reroute, and takeover to distinct handlers", async () => {
  for (const action of ["route", "dismiss", "retry", "reroute", "takeover"]) {
    const calls = [];
    let response;
    const handlers = Object.fromEntries(["route", "dismiss", "retry", "reroute", "takeover"].map((name) => [`${name}ChannelTask`, async (id, actor) => {
      calls.push({ name, id, actor });
      return { status: 200, body: { ok: true, action: name } };
    }]));
    const handled = await handleChannelRoutes({
      req: { method: "POST" }, res: {}, url: new URL(`http://local/api/channel-tasks/ctr_1/${action}`),
      sendJson: (_res, status, body) => { response = { status, body }; }, readJson: async () => ({}),
      actor: { userId: "usr_1", teamId: "team_1" }, ...handlers,
    });
    assert.equal(handled, true);
    assert.deepEqual(calls, [{ name: action, id: "ctr_1", actor: { userId: "usr_1", teamId: "team_1" } }]);
    assert.deepEqual(response, { status: 200, body: { ok: true, action } });
  }
});

test("human task reply route passes bounded user content to its handler", async () => {
  let response;
  const handled = await handleChannelRoutes({
    req: { method: "POST" },
    res: {},
    url: new URL("http://local/api/channel-tasks/cth_1/reply"),
    sendJson: (_res, status, body) => { response = { status, body }; },
    readJson: async () => ({ content: "已确认，人工正在继续处理。" }),
    actor: { userId: "usr_1", teamId: "team_1" },
    replyChannelTask: async (id, content, actor) => ({ status: 200, body: { ok: true, id, content, actor } }),
  });
  assert.equal(handled, true);
  assert.equal(response.status, 200);
  assert.equal(response.body.id, "cth_1");
  assert.equal(response.body.content, "已确认，人工正在继续处理。");
});
