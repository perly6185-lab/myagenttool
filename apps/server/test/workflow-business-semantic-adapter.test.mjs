import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createLocalWorkflowBusinessSemanticAdapter,
  localSemanticUrl,
  minimizeBusinessProviderText,
  resolveWorkflowBusinessSemanticConfig,
} from "../src/services/workflow-business-semantic-adapter.mjs";

test("business semantic AI is disabled by default and only accepts loopback HTTP", () => {
  assert.equal(resolveWorkflowBusinessSemanticConfig({}).enabled, false);
  assert.equal(localSemanticUrl("http://127.0.0.1:8080/analyze").hostname, "127.0.0.1");
  assert.throws(
    () => localSemanticUrl("https://provider.example/analyze"),
    /workflow_business_ai_url_must_be_local/,
  );
  assert.throws(
    () => resolveWorkflowBusinessSemanticConfig({
      MYAGENTTOOL_WORKFLOW_BUSINESS_AI_URL: "http://10.0.0.4/analyze",
      MYAGENTTOOL_WORKFLOW_BUSINESS_AI_MODEL: "private-model",
    }),
    /workflow_business_ai_url_must_be_local/,
  );
});

test("provider input is bounded and redacts common secret shapes", () => {
  const minimized = minimizeBusinessProviderText([
    "客户名称：星海科技",
    "api_key: sk-this-is-a-sensitive-token-123456",
    "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
  ].join("\n"));
  assert.match(minimized, /\[REDACTED/);
  assert.doesNotMatch(minimized, /sensitive-token/);
  assert.doesNotMatch(minimized, /abcdefghijklmnopqrstuvwxyz/);
});

test("local semantic adapter sends a fixed task envelope and validates response shape", async () => {
  let request;
  const adapter = createLocalWorkflowBusinessSemanticAdapter({
    config: {
      enabled: true,
      providerId: "local_http",
      model: "business-local",
      modelVersion: "business-local-v2",
      url: "http://127.0.0.1:8080/analyze",
      timeoutMs: 1_000,
      maxConcurrency: 3,
    },
    fetchImpl: async (url, init) => {
      request = { url, init, body: JSON.parse(init.body) };
      return {
        ok: true,
        json: async () => ({
          analysis: {
            documentType: "quotation",
            confidence: 0.88,
            reasons: ["Quotation number found"],
          },
        }),
      };
    },
  });
  const result = await adapter.analyze({
    fileName: "报价单.md",
    extension: "md",
    text: "报价编号：QT-001",
    deterministic: { documentType: "quotation", confidence: 0.8, fieldProposals: [] },
  });
  assert.equal(result.documentType, "quotation");
  assert.equal(adapter.maxConcurrency, 3);
  assert.equal(request.url, "http://127.0.0.1:8080/analyze");
  assert.equal(request.body.task, "business_document_analysis_v1");
  assert.equal(request.body.input.text, "报价编号：QT-001");
  assert.equal(request.init.redirect, "manual");
  assert.equal(request.init.signal.aborted, false);
});

test("local semantic adapter rejects oversized and redirected responses", async () => {
  const config = {
    enabled: true,
    providerId: "local_http",
    model: "business-local",
    modelVersion: "business-local-v1",
    url: "http://127.0.0.1:8080/analyze",
    timeoutMs: 1_000,
    maxConcurrency: 1,
  };
  const oversized = createLocalWorkflowBusinessSemanticAdapter({
    config,
    fetchImpl: async () => ({
      ok: true,
      text: async () => "x".repeat((256 * 1024) + 1),
    }),
  });
  await assert.rejects(
    () => oversized.analyze({ text: "报价单" }),
    /workflow_business_ai_response_too_large/,
  );
  let cancelled = false;
  const streamingOversized = createLocalWorkflowBusinessSemanticAdapter({
    config,
    fetchImpl: async () => ({
      ok: true,
      text: async () => {
        throw new Error("streaming response must not allocate the full body");
      },
      body: {
        getReader: () => ({
          read: async () => ({ done: false, value: new Uint8Array((256 * 1024) + 1) }),
          cancel: async () => {
            cancelled = true;
          },
          releaseLock: () => {},
        }),
      },
    }),
  });
  await assert.rejects(
    () => streamingOversized.analyze({ text: "报价单" }),
    /workflow_business_ai_response_too_large/,
  );
  assert.equal(cancelled, true);
  const redirected = createLocalWorkflowBusinessSemanticAdapter({
    config,
    fetchImpl: async (_url, init) => {
      assert.equal(init.redirect, "manual");
      return { ok: false, status: 302 };
    },
  });
  await assert.rejects(
    () => redirected.analyze({ text: "报价单" }),
    /workflow_business_ai_http_302/,
  );
});
