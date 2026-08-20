import assert from "node:assert/strict";
import test from "node:test";

import { channelFailureCopy, channelResultCopy } from "../src/services/channel-user-copy.mjs";

test("微信结果保留直接答案并移除英文报告结构和本机绝对路径", () => {
  const result = channelResultCopy(`## Result

已找到 3 个文件：
1. [.env.example](/Users/psy/work/.env.example)
2. [package.json](/Users/psy/work/package.json)

## What changed

没有创建、修改或删除任何文件。

## Checks performed

- ran git ls-files

## Remaining risks

none`, { readOnly: true });

  assert.match(result, /^已找到 3 个文件/);
  assert.match(result, /package\.json/);
  assert.match(result, /没有创建、修改或删除任何文件/);
  assert.doesNotMatch(result, /Result|What changed|Checks performed|Remaining risks|\/Users\//);
});

test("执行失败按原因转换为普通用户可理解的信息", () => {
  assert.equal(channelFailureCopy({ invocation: { result: { errorCode: "policy_blocked" } }, summary: "Agent run failed." }), "安全检查发现执行要求存在冲突，已停止本次执行，没有修改文件。");
  assert.match(channelFailureCopy({ invocation: { result: { errorCode: "dispatch_timeout" } } }), /执行设备暂时不可用/);
  assert.doesNotMatch(channelFailureCopy({ summary: "Agent run failed." }), /Agent run failed/);
});
