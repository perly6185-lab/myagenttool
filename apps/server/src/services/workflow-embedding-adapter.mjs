const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_EMBEDDING_INPUT_CHARS = 16_000;

function localEmbeddingUrl(value) {
  const url = new URL(String(value ?? ""));
  if (
    url.protocol !== "http:"
    || url.username
    || url.password
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  ) {
    throw new Error("workflow_embedding_url_must_be_local");
  }
  return url;
}

export function resolveWorkflowEmbeddingConfig(env = process.env) {
  const urlValue = String(env.MYAGENTTOOL_WORKFLOW_EMBEDDING_URL ?? "").trim();
  const model = String(env.MYAGENTTOOL_WORKFLOW_EMBEDDING_MODEL ?? "").trim().slice(0, 200);
  if (!urlValue || !model) {
    return { enabled: false, rolloutPercent: 0, reason: "not_configured" };
  }
  const url = localEmbeddingUrl(urlValue);
  const rolloutPercent = Math.max(
    0,
    Math.min(100, Number(env.MYAGENTTOOL_WORKFLOW_EMBEDDING_ROLLOUT_PERCENT) || 0),
  );
  return {
    enabled: true,
    providerId: "local_http",
    model,
    modelVersion: String(env.MYAGENTTOOL_WORKFLOW_EMBEDDING_MODEL_VERSION ?? model)
      .trim()
      .slice(0, 200),
    url: url.toString(),
    rolloutPercent,
    timeoutMs: Math.max(
      1_000,
      Math.min(60_000, Number(env.MYAGENTTOOL_WORKFLOW_EMBEDDING_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS),
    ),
    maxBatchSize: Math.max(
      1,
      Math.min(32, Number(env.MYAGENTTOOL_WORKFLOW_EMBEDDING_BATCH_SIZE) || 8),
    ),
  };
}

export function createLocalWorkflowEmbeddingAdapter({
  config = resolveWorkflowEmbeddingConfig(),
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!config.enabled) return null;
  return {
    providerId: config.providerId,
    model: config.model,
    modelVersion: config.modelVersion,
    rolloutPercent: config.rolloutPercent,
    maxBatchSize: config.maxBatchSize,
    async embed(texts) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const response = await fetchImpl(config.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: config.model,
            input: texts.map((text) => String(text ?? "").slice(0, MAX_EMBEDDING_INPUT_CHARS)),
            truncate: true,
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`workflow_embedding_http_${response.status}`);
        const payload = await response.json();
        if (!Array.isArray(payload?.embeddings) || payload.embeddings.length !== texts.length) {
          throw new Error("workflow_embedding_invalid_response");
        }
        return payload.embeddings;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export { localEmbeddingUrl };
