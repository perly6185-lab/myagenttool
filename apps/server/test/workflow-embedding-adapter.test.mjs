import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createLocalWorkflowEmbeddingAdapter,
  resolveWorkflowEmbeddingConfig,
} from "../src/services/workflow-embedding-adapter.mjs";

test("local embedding config is opt-in and accepts only loopback HTTP", () => {
  assert.equal(resolveWorkflowEmbeddingConfig({}).enabled, false);
  assert.throws(
    () => resolveWorkflowEmbeddingConfig({
      MYAGENTTOOL_WORKFLOW_EMBEDDING_URL: "https://embeddings.example.test/api/embed",
      MYAGENTTOOL_WORKFLOW_EMBEDDING_MODEL: "model",
    }),
    /workflow_embedding_url_must_be_local/,
  );
  const config = resolveWorkflowEmbeddingConfig({
    MYAGENTTOOL_WORKFLOW_EMBEDDING_URL: "http://127.0.0.1:11434/api/embed",
    MYAGENTTOOL_WORKFLOW_EMBEDDING_MODEL: "nomic-embed-text",
    MYAGENTTOOL_WORKFLOW_EMBEDDING_ROLLOUT_PERCENT: "25",
  });
  assert.equal(config.enabled, true);
  assert.equal(config.rolloutPercent, 25);
});

test("local adapter sends bounded batches and validates the response shape", async () => {
  const calls = [];
  const adapter = createLocalWorkflowEmbeddingAdapter({
    config: {
      enabled: true,
      providerId: "local_http",
      model: "fixture",
      modelVersion: "v1",
      url: "http://127.0.0.1:11434/api/embed",
      rolloutPercent: 10,
      timeoutMs: 1_000,
      maxBatchSize: 4,
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return {
        ok: true,
        json: async () => ({ embeddings: [[1, 2], [3, 4]] }),
      };
    },
  });
  assert.deepEqual(await adapter.embed(["one", "two"]), [[1, 2], [3, 4]]);
  assert.equal(calls[0].url, "http://127.0.0.1:11434/api/embed");
  assert.deepEqual(calls[0].body.input, ["one", "two"]);
});
