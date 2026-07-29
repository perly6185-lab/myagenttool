const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_PROVIDER_INPUT_CHARS = 16_000;
const MAX_PROVIDER_RESPONSE_CHARS = 256 * 1024;

async function boundedResponseText(response) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (text.length > MAX_PROVIDER_RESPONSE_CHARS) {
      throw new Error("workflow_business_ai_response_too_large");
    }
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value?.byteLength ?? 0;
      if (size > MAX_PROVIDER_RESPONSE_CHARS) {
        await reader.cancel();
        throw new Error("workflow_business_ai_response_too_large");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock?.();
  }
}

function localSemanticUrl(value) {
  const url = new URL(String(value ?? ""));
  if (
    url.protocol !== "http:"
    || url.username
    || url.password
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  ) {
    throw new Error("workflow_business_ai_url_must_be_local");
  }
  return url;
}

export function minimizeBusinessProviderText(value) {
  return String(value ?? "")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]")
    .replace(/\b(?:sk|pk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/g, "[REDACTED TOKEN]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*\b/gi, "Bearer [REDACTED]")
    .replace(/((?:password|passphrase|secret|token|api[ _-]?key|密码|口令|密钥|令牌)\s*[:：=]\s*)[^\s,;|]{4,}/gi, "$1[REDACTED]")
    .slice(0, MAX_PROVIDER_INPUT_CHARS);
}

export function resolveWorkflowBusinessSemanticConfig(env = process.env) {
  const urlValue = String(env.MYAGENTTOOL_WORKFLOW_BUSINESS_AI_URL ?? "").trim();
  const model = String(env.MYAGENTTOOL_WORKFLOW_BUSINESS_AI_MODEL ?? "").trim().slice(0, 200);
  if (!urlValue || !model) {
    return {
      enabled: false,
      providerId: null,
      model: null,
      modelVersion: null,
      reason: "not_configured",
      maxConcurrency: 2,
    };
  }
  const url = localSemanticUrl(urlValue);
  return {
    enabled: true,
    providerId: "local_http",
    model,
    modelVersion: String(env.MYAGENTTOOL_WORKFLOW_BUSINESS_AI_MODEL_VERSION ?? model)
      .trim()
      .slice(0, 200),
    url: url.toString(),
    timeoutMs: Math.max(
      1_000,
      Math.min(60_000, Number(env.MYAGENTTOOL_WORKFLOW_BUSINESS_AI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS),
    ),
    maxConcurrency: Math.max(
      1,
      Math.min(8, Number(env.MYAGENTTOOL_WORKFLOW_BUSINESS_AI_CONCURRENCY) || 2),
    ),
  };
}

export function createLocalWorkflowBusinessSemanticAdapter({
  config = resolveWorkflowBusinessSemanticConfig(),
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!config.enabled) return null;
  return {
    providerId: config.providerId,
    model: config.model,
    modelVersion: config.modelVersion,
    maxConcurrency: config.maxConcurrency,
    async analyze({ fileName, extension, text, deterministic }) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const response = await fetchImpl(config.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: config.model,
            task: "business_document_analysis_v1",
            input: {
              fileName: String(fileName ?? "").slice(0, 300),
              extension: String(extension ?? "").slice(0, 20),
              text: minimizeBusinessProviderText(text),
              deterministic: {
                documentType: deterministic?.documentType ?? "unknown",
                confidence: deterministic?.confidence ?? 0,
                fieldKeys: (deterministic?.fieldProposals ?? []).map((field) => field.key),
              },
            },
          }),
          redirect: "manual",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`workflow_business_ai_http_${response.status}`);
        let payload;
        if (typeof response.text === "function") {
          const responseText = await boundedResponseText(response);
          payload = JSON.parse(responseText);
        } else {
          payload = await response.json();
        }
        const analysis = payload?.analysis ?? payload?.output ?? payload;
        if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) {
          throw new Error("workflow_business_ai_invalid_response");
        }
        return analysis;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export { localSemanticUrl };
