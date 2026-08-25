import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cloudflarePagesAssetHash,
  createCloudflarePagesAdapter,
  SiteDeploymentAdapterError,
} from "../src/services/cloudflare-pages-adapter.mjs";

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
const TARGET = { remoteProjectRef: "example-site" };
const CREDENTIAL = { accountId: ACCOUNT_ID, apiToken: "scoped-pages-token" };

function envelope(result, init = {}) {
  return Response.json({ success: true, errors: [], messages: [], result }, init);
}

test("Cloudflare Pages hashing matches Wrangler's official upload vector", () => {
  assert.equal(cloudflarePagesAssetHash("logo.png", "foobar"), "2082190357cfd3617ccfe04f340c6247");
});

test("Cloudflare Pages adapter uploads missing assets, deploys, polls, and verifies the homepage", async () => {
  const index = "<!doctype html><title>Published</title>";
  const files = { "index.html": index, "assets/site.css": "body{color:#123}" };
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/upload-token")) return envelope({ jwt: "short-lived-upload-jwt" });
    if (url.endsWith("/pages/assets/check-missing")) {
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer short-lived-upload-jwt");
      return envelope(JSON.parse(init.body).hashes);
    }
    if (url.endsWith("/pages/assets/upload")) {
      const payload = JSON.parse(init.body);
      assert.equal(payload.length, 2);
      assert.equal(payload.every((item) => item.base64 === true), true);
      return envelope(null);
    }
    if (url.endsWith("/pages/assets/upsert-hashes")) return envelope(null);
    if (url.endsWith("/deployments") && init.method === "POST") {
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer scoped-pages-token");
      assert.match(String(init.body.get("manifest")), /"\/index.html"/);
      return envelope({ id: "deployment-123", url: "https://deployment.example-site.pages.dev/", latest_stage: { status: "queued" } });
    }
    if (url.endsWith("/deployments/deployment-123")) {
      return envelope({ id: "deployment-123", environment: "production", aliases: ["https://example-site.pages.dev"], latest_stage: { name: "deploy", status: "success" } });
    }
    if (url.startsWith("https://deployment.example-site.pages.dev/")) return new Response(index, { status: 200, headers: { "content-type": "text/html" } });
    throw new Error(`Unexpected request: ${url}`);
  };
  const adapter = createCloudflarePagesAdapter({ fetchImpl, sleep: async () => {} });
  const result = await adapter.deploy({ target: TARGET, credential: CREDENTIAL, bundle: { files }, publicationId: "spb_0001" });
  assert.equal(result.deploymentId, "deployment-123");
  assert.equal(result.url, "https://deployment.example-site.pages.dev/");
  assert.equal(result.verification.contentHash.length, 64);
  assert.equal(calls.some((call) => call.url.endsWith("/pages/assets/upload")), true);
});

test("Cloudflare Pages adapter rejects a deployment URL serving different content", async () => {
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/upload-token")) return envelope({ jwt: "jwt" });
    if (url.endsWith("/pages/assets/check-missing")) return envelope([]);
    if (url.endsWith("/pages/assets/upsert-hashes")) return envelope(null);
    if (url.endsWith("/deployments") && init.method === "POST") {
      return envelope({ id: "deployment-bad", url: "https://bad.example-site.pages.dev/", latest_stage: { status: "success" } });
    }
    if (url.startsWith("https://bad.example-site.pages.dev/")) return new Response("stale release", { status: 200 });
    throw new Error(`Unexpected request: ${url}`);
  };
  const adapter = createCloudflarePagesAdapter({ fetchImpl, sleep: async () => {} });
  await assert.rejects(
    adapter.deploy({ target: TARGET, credential: CREDENTIAL, bundle: { files: { "index.html": "expected release" } }, publicationId: "spb_0002" }),
    (error) => error instanceof SiteDeploymentAdapterError && error.code === "site_deployment_content_mismatch",
  );
});

test("Cloudflare Pages rollback verifies the canonical production deployment and homepage", async () => {
  const homepage = "restored homepage";
  const expectedHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(homepage));
  const contentHash = Buffer.from(expectedHash).toString("hex");
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/deployments/deployment-old/rollback") && init.method === "POST") return envelope({ id: "rollback-action" });
    if (url.endsWith("/pages/projects/example-site")) {
      return envelope({ subdomain: "example-site.pages.dev", canonical_deployment: { id: "deployment-old" } });
    }
    if (url.startsWith("https://example-site.pages.dev/")) return new Response(homepage, { status: 200 });
    throw new Error(`Unexpected request: ${url}`);
  };
  const adapter = createCloudflarePagesAdapter({ fetchImpl, sleep: async () => {} });
  const result = await adapter.rollback({
    target: TARGET,
    credential: CREDENTIAL,
    publication: { remoteDeployment: { deploymentId: "deployment-old", url: "https://old.example-site.pages.dev/", verification: { contentHash } } },
  });
  assert.equal(result.deploymentId, "deployment-old");
  assert.equal(result.url, "https://example-site.pages.dev");
});
