import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createExternalIssueProviderClient,
  externalIssueProviderReadiness,
} from "../src/services/external-issue-provider.mjs";

function response(status, json, headers = {}) {
  return {
    status, ok: status >= 200 && status < 300,
    json: async () => json,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  };
}

test("GitLab client uses scoped env credential, encoded project path, and normalizes issues", async () => {
  const calls = [];
  const client = createExternalIssueProviderClient({
    provider: "gitlab",
    env: {
      MYAGENTTOOL_GITLAB_BASE_URL: "https://gitlab.example/",
      MYAGENTTOOL_GITLAB_TOKEN: "private-value",
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(200, {
        iid: 7, title: "Remote", description: "Body", state: "opened", labels: ["p1"],
        assignees: [{ username: "alice" }], web_url: "https://gitlab.example/a/b/-/issues/7",
        updated_at: "2026-07-24T00:00:00.000Z",
      });
    },
  });
  const result = await client.fetchIssue({ repository: "a/b", issueNumber: 7 });
  assert.equal(result.issue.number, 7);
  assert.equal(result.issue.repository, "a/b");
  assert.equal(calls[0].url, "https://gitlab.example/api/v4/projects/a%2Fb/issues/7");
  assert.equal(calls[0].options.headers["private-token"], "private-value");
  assert.equal(JSON.stringify(result).includes("private-value"), false);
});

test("Gitea client retries transient failures and updates via PATCH", async () => {
  const calls = [];
  const replies = [
    response(503, {}),
    response(200, {
      number: 9, title: "Updated", body: "", state: "open", labels: [],
      html_url: "https://gitea.example/a/b/issues/9", updated_at: "2026-07-24T01:00:00.000Z",
    }),
  ];
  const client = createExternalIssueProviderClient({
    provider: "gitea",
    env: {
      MYAGENTTOOL_GITEA_BASE_URL: "https://gitea.example",
      MYAGENTTOOL_GITEA_TOKEN: "token-value",
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return replies.shift();
    },
    sleep: async () => {},
  });
  const result = await client.updateIssue({
    repository: "a/b", issueNumber: 9,
    payload: { title: "Updated", body: "", state: "open", labels: [] },
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(calls[0].options.method, "PATCH");
  assert.equal(calls[0].url, "https://gitea.example/api/v1/repos/a/b/issues/9");
});

test("provider readiness exposes booleans and never credential values", () => {
  const readiness = externalIssueProviderReadiness("gitlab", {
    MYAGENTTOOL_GITLAB_TOKEN: "secret", MYAGENTTOOL_GITLAB_WEBHOOK_SECRET: "hook",
  });
  assert.deepEqual(readiness, { configured: true, webhookConfigured: true });
  assert.equal(JSON.stringify(readiness).includes("secret"), false);
});

test("GitLab client exhausts bounded retries on network failure without leaking credentials", async () => {
  let calls = 0;
  const client = createExternalIssueProviderClient({
    provider: "gitlab",
    attempts: 3,
    env: {
      MYAGENTTOOL_GITLAB_BASE_URL: "https://gitlab.example",
      MYAGENTTOOL_GITLAB_TOKEN: "never-expose",
    },
    fetchImpl: async () => {
      calls += 1;
      throw new Error("socket reset");
    },
    sleep: async () => {},
  });
  const result = await client.fetchIssue({ repository: "a/b", issueNumber: 7 });
  assert.equal(result.ok, false);
  assert.equal(result.error, "provider_network_error");
  assert.equal(result.attempts, 3);
  assert.equal(calls, 3);
  assert.equal(JSON.stringify(result).includes("never-expose"), false);
});

test("Gitea client honors Retry-After on rate limiting before recovery", async () => {
  const waits = [];
  const replies = [
    response(429, {}, { "retry-after": "2" }),
    response(200, { number: 9, title: "Recovered", state: "open", labels: [] }),
  ];
  const client = createExternalIssueProviderClient({
    provider: "gitea",
    env: { MYAGENTTOOL_GITEA_BASE_URL: "https://gitea.example", MYAGENTTOOL_GITEA_TOKEN: "token" },
    fetchImpl: async () => replies.shift(),
    sleep: async (ms) => waits.push(ms),
  });
  const result = await client.fetchIssue({ repository: "a/b", issueNumber: 9 });
  assert.equal(result.ok, true);
  assert.deepEqual(waits, [2_000]);
});

for (const provider of ["gitlab", "gitea"]) {
  test(`${provider} client treats an expired credential as non-retryable and redacts it`, async () => {
    let calls = 0;
    const token = `${provider}-expired-secret`;
    const client = createExternalIssueProviderClient({
      provider,
      attempts: 4,
      env: {
        [`MYAGENTTOOL_${provider.toUpperCase()}_BASE_URL`]: `https://${provider}.example`,
        [`MYAGENTTOOL_${provider.toUpperCase()}_TOKEN`]: token,
      },
      fetchImpl: async () => {
        calls += 1;
        return response(401, { message: `credential ${token} expired` });
      },
      sleep: async () => assert.fail("authentication failures must not be retried"),
    });
    const result = await client.fetchIssue({ repository: "a/b", issueNumber: 12 });
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.equal(result.error, "provider_http_401");
    assert.equal(result.attempts, 1);
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(result).includes(token), false);
  });
}
