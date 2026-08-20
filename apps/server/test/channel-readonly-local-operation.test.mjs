import assert from "node:assert/strict";
import test from "node:test";

import {
  canExecuteChannelReadonlyLocalOperation,
  executeChannelReadonlyLocalOperation,
} from "../src/services/channel-readonly-local-operation.mjs";

const intent = {
  accessMode: "read_only",
  action: "list_directory",
  resource: "current_project",
  explicitReadOnly: true,
  confidence: 0.99,
};

test("明确的当前项目文件列举走受控本地快速路径", () => {
  const calls = [];
  const result = executeChannelReadonlyLocalOperation({
    text: "帮我只读取当前项目目录，列出 3 个文件，不要修改任何文件",
    operationIntent: intent,
    project: { id: "prj_1", name: "演示项目", path: "/safe/project" },
    completedAt: "2026-08-20T00:00:00.000Z",
    readProjectTree: (project, options) => {
      calls.push({ project, options });
      return {
        entries: [
          { name: ".env", path: ".env", kind: "file", gitStatus: "untracked" },
          { name: ".env.example", path: ".env.example", kind: "file", gitStatus: "clean" },
          { name: "ignored.log", path: "ignored.log", kind: "file", gitStatus: "ignored" },
          { name: "package.json", path: "package.json", kind: "file", gitStatus: "clean" },
          { name: "README.md", path: "README.md", kind: "file", gitStatus: "untracked" },
          { name: "src", path: "src", kind: "directory", gitStatus: "clean" },
        ],
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options, { relativePath: "", search: "" });
  assert.deepEqual(result.files.map((file) => file.path), [".env.example", "package.json", "README.md"]);
  assert.match(result.summary, /找到以下 3 个文件/);
  assert.match(result.summary, /没有修改任何文件/);
  assert.doesNotMatch(result.summary, /\/safe\/project|\.env\n/);
});

test("快速路径只接受明确只读的当前项目文件列举", () => {
  assert.equal(canExecuteChannelReadonlyLocalOperation({ text: "列出文件", operationIntent: intent }), true);
  assert.equal(canExecuteChannelReadonlyLocalOperation({ text: "列出文件", operationIntent: { ...intent, explicitReadOnly: false } }), false);
  assert.equal(canExecuteChannelReadonlyLocalOperation({ text: "列出文件", operationIntent: { ...intent, resource: "directory" } }), false);
  assert.equal(canExecuteChannelReadonlyLocalOperation({ text: "查看订单", operationIntent: { ...intent, action: "query_data" } }), false);
});
