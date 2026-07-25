const RETRYABLE = new Set([429, 500, 502, 503, 504]);

const cleanBase = (value) => String(value ?? "").trim().replace(/\/+$/, "");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function externalIssueProviderConfig(provider, env = process.env) {
  const id = String(provider ?? "").toLowerCase();
  if (id === "gitlab") return {
    id,
    baseUrl: cleanBase(env.MYAGENTTOOL_GITLAB_BASE_URL || "https://gitlab.com"),
    token: String(env.MYAGENTTOOL_GITLAB_TOKEN ?? ""),
    webhookSecret: String(env.MYAGENTTOOL_GITLAB_WEBHOOK_SECRET ?? ""),
  };
  if (id === "gitea") return {
    id,
    baseUrl: cleanBase(env.MYAGENTTOOL_GITEA_BASE_URL),
    token: String(env.MYAGENTTOOL_GITEA_TOKEN ?? ""),
    webhookSecret: String(env.MYAGENTTOOL_GITEA_WEBHOOK_SECRET ?? ""),
  };
  return null;
}

export function externalIssueProviderReadiness(provider, env = process.env) {
  const config = externalIssueProviderConfig(provider, env);
  return {
    configured: Boolean(config?.baseUrl && config?.token),
    webhookConfigured: Boolean(config?.webhookSecret),
  };
}

function endpoint(config, repository, issueNumber) {
  const repo = String(repository ?? "").trim();
  const number = Number(issueNumber);
  if (!repo || !Number.isInteger(number) || number <= 0) return null;
  if (config.id === "gitlab") {
    return `${config.baseUrl}/api/v4/projects/${encodeURIComponent(repo)}/issues/${number}`;
  }
  if (config.id === "gitea" && repo.split("/").length === 2) {
    const [owner, name] = repo.split("/").map(encodeURIComponent);
    return `${config.baseUrl}/api/v1/repos/${owner}/${name}/issues/${number}`;
  }
  return null;
}

function headers(config) {
  return config.id === "gitlab"
    ? { "private-token": config.token, "content-type": "application/json" }
    : { authorization: `token ${config.token}`, "content-type": "application/json" };
}

async function requestJson(url, options, { fetchImpl, sleep, attempts }) {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, options);
      lastStatus = response.status;
      if (response.ok) return { ok: true, json: await response.json(), attempts: attempt };
      if (!RETRYABLE.has(response.status) || attempt === attempts) {
        return { ok: false, error: `provider_http_${response.status}`, status: response.status, attempts: attempt };
      }
      const retryAfter = Number(response.headers?.get?.("retry-after"));
      await sleep(Number.isFinite(retryAfter) ? Math.min(retryAfter * 1_000, 5_000) : 100 * (2 ** (attempt - 1)));
    } catch {
      if (attempt === attempts) return { ok: false, error: "provider_network_error", status: lastStatus, attempts: attempt };
      await sleep(100 * (2 ** (attempt - 1)));
    }
  }
  return { ok: false, error: "provider_request_failed", status: lastStatus, attempts };
}

function snapshot(provider, repository, issue) {
  return {
    number: Number(issue.iid ?? issue.number),
    title: String(issue.title ?? ""),
    body: String(issue.description ?? issue.body ?? ""),
    state: issue.state === "closed" ? "closed" : "open",
    labels: (issue.labels ?? []).map((label) => typeof label === "string" ? label : label?.name).filter(Boolean),
    milestone: issue.milestone?.title ?? "",
    assigneeIds: (issue.assignees ?? (issue.assignee ? [issue.assignee] : []))
      .map((assignee) => assignee?.username ?? assignee?.login).filter(Boolean),
    url: issue.web_url ?? issue.html_url ?? null,
    repository,
    updatedAt: issue.updated_at,
    provider,
  };
}

export function createExternalIssueProviderClient({
  provider, env = process.env, fetchImpl = globalThis.fetch, sleep = wait, attempts = 3,
} = {}) {
  const config = externalIssueProviderConfig(provider, env);
  const readiness = externalIssueProviderReadiness(provider, env);

  async function fetchIssue({ repository, issueNumber }) {
    const url = config && endpoint(config, repository, issueNumber);
    if (!config || !readiness.configured) return { ok: false, error: "provider_credentials_not_configured" };
    if (!url) return { ok: false, error: "invalid_provider_repository_or_issue" };
    const result = await requestJson(url, { headers: headers(config) }, { fetchImpl, sleep, attempts });
    return result.ok ? { ...result, issue: snapshot(config.id, repository, result.json) } : result;
  }

  async function updateIssue({ repository, issueNumber, payload }) {
    const url = config && endpoint(config, repository, issueNumber);
    if (!config || !readiness.configured) return { ok: false, error: "provider_credentials_not_configured" };
    if (!url) return { ok: false, error: "invalid_provider_repository_or_issue" };
    const body = config.id === "gitlab" ? {
      title: payload.title, description: payload.body, state_event: payload.state === "closed" ? "close" : "reopen",
      labels: (payload.labels ?? []).join(","), milestone_id: payload.milestone || undefined,
    } : {
      title: payload.title, body: payload.body, state: payload.state,
      labels: payload.labels, milestone: payload.milestone || undefined,
    };
    const result = await requestJson(url, {
      method: config.id === "gitlab" ? "PUT" : "PATCH",
      headers: headers(config), body: JSON.stringify(body),
    }, { fetchImpl, sleep, attempts });
    return result.ok ? { ...result, issue: snapshot(config.id, repository, result.json) } : result;
  }

  return { provider: config?.id ?? provider, readiness, fetchIssue, updateIssue };
}
