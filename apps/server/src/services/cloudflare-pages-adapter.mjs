import { createHash } from "node:crypto";
import { extname } from "node:path";
import { blake3 } from "@noble/hashes/blake3.js";
import { SiteDeploymentAdapterError } from "./site-deployment-adapters.mjs";

export { SiteDeploymentAdapterError } from "./site-deployment-adapters.mjs";

const API_BASE = "https://api.cloudflare.com/client/v4";
const MAX_FILE_COUNT = 20_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_BUCKET_BYTES = 40 * 1024 * 1024;
const MAX_BUCKET_FILES = 2_000;
const PROJECT_NAME = /^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/;
const ACCOUNT_ID = /^[a-f0-9]{32}$/i;

function contentType(path) {
  const extension = extname(path).toLowerCase();
  return ({
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
  })[extension] ?? "application/octet-stream";
}

export function cloudflarePagesAssetHash(path, body) {
  const base64 = Buffer.from(body).toString("base64");
  const extension = extname(path).slice(1);
  return Buffer.from(blake3(new TextEncoder().encode(`${base64}${extension}`))).toString("hex").slice(0, 32);
}

function validateInputs(target, credential) {
  const projectName = String(target?.remoteProjectRef ?? "").trim().toLowerCase();
  const accountId = String(credential?.accountId ?? "").trim();
  const apiToken = String(credential?.apiToken ?? "").trim();
  if (!PROJECT_NAME.test(projectName)) throw new SiteDeploymentAdapterError("site_deployment_project_invalid", "Cloudflare Pages project name is invalid.");
  if (!ACCOUNT_ID.test(accountId)) throw new SiteDeploymentAdapterError("site_deployment_account_invalid", "Cloudflare account ID is invalid.");
  if (!apiToken || apiToken.length > 4096) throw new SiteDeploymentAdapterError("site_deployment_credential_invalid", "Cloudflare API token is invalid.");
  return { projectName, accountId, apiToken };
}

function publicPagesUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "pages.dev" || url.hostname.endsWith(".pages.dev")) ? url : null;
  } catch {
    return null;
  }
}

function assetBuckets(assets) {
  const buckets = [];
  let current = [];
  let bytes = 0;
  for (const asset of assets) {
    if (current.length && (current.length >= MAX_BUCKET_FILES || bytes + asset.bytes > MAX_BUCKET_BYTES)) {
      buckets.push(current);
      current = [];
      bytes = 0;
    }
    current.push(asset);
    bytes += asset.bytes;
  }
  if (current.length) buckets.push(current);
  return buckets;
}

export function createCloudflarePagesAdapter({
  fetchImpl = globalThis.fetch,
  apiBase = API_BASE,
  timeoutMs = 30_000,
  maxStatusChecks = 6,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");

  async function rawFetch(url, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      const timeout = error?.name === "AbortError";
      throw new SiteDeploymentAdapterError(
        timeout ? "site_deployment_timeout" : "site_deployment_network_failed",
        timeout ? "Cloud deployment timed out." : "Cloud deployment network request failed.",
        { retryable: true },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async function api(path, { token, ...init } = {}) {
    const headers = new Headers(init.headers ?? {});
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const response = await rawFetch(`${apiBase}${path}`, { ...init, headers });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // The API always returns JSON; retain a stable error if an intermediary does not.
    }
    if (!response.ok || payload?.success === false) {
      const apiCode = payload?.errors?.[0]?.code;
      const retryable = response.status === 429 || response.status >= 500;
      throw new SiteDeploymentAdapterError(
        response.status === 401 || response.status === 403 ? "site_deployment_auth_failed" : "site_deployment_provider_failed",
        apiCode ? `Cloudflare request failed (${apiCode}).` : `Cloudflare request failed (${response.status}).`,
        { retryable },
      );
    }
    return payload?.result;
  }

  async function waitForDeployment({ accountId, projectName, deploymentId, apiToken }) {
    let deployment = null;
    for (let attempt = 0; attempt < maxStatusChecks; attempt += 1) {
      deployment = await api(`/accounts/${accountId}/pages/projects/${encodeURIComponent(projectName)}/deployments/${encodeURIComponent(deploymentId)}`, { token: apiToken });
      const status = deployment?.latest_stage?.status;
      if (status === "success") return deployment;
      if (status === "failure") throw new SiteDeploymentAdapterError("site_deployment_build_failed", "Cloudflare Pages deployment failed.");
      if (attempt < maxStatusChecks - 1) await sleep(Math.min(2 ** attempt * 500, 4_000));
    }
    throw new SiteDeploymentAdapterError("site_deployment_status_unknown", "Cloudflare Pages did not report a final deployment status.", { retryable: true });
  }

  async function verifyPublicHash(urlValue, expectedHash) {
    const url = publicPagesUrl(urlValue);
    if (!url) throw new SiteDeploymentAdapterError("site_deployment_url_invalid", "Cloudflare returned an invalid Pages deployment URL.");
    url.pathname = "/";
    url.searchParams.set("myagenttool_verify", Date.now().toString(36));
    const response = await rawFetch(url, { headers: { Accept: "text/html", "Cache-Control": "no-cache" }, redirect: "error" });
    if (!response.ok) throw new SiteDeploymentAdapterError("site_deployment_healthcheck_failed", `Published site health check failed (${response.status}).`, { retryable: true });
    const actual = await response.text();
    const actualHash = createHash("sha256").update(actual).digest("hex");
    if (actualHash !== expectedHash) throw new SiteDeploymentAdapterError("site_deployment_content_mismatch", "Published homepage does not match the confirmed release.");
    return { url: urlValue, checkedAt: new Date().toISOString(), contentHash: actualHash };
  }

  async function verifyPublicAsset(urlValue, expectedIndex) {
    return verifyPublicHash(urlValue, createHash("sha256").update(expectedIndex).digest("hex"));
  }

  async function verifyConnection({ target, credential }) {
    const { accountId, projectName, apiToken } = validateInputs(target, credential);
    const project = await api(`/accounts/${accountId}/pages/projects/${encodeURIComponent(projectName)}`, { token: apiToken });
    return {
      provider: "cloudflare_pages",
      accountIdSuffix: accountId.slice(-6),
      projectName: project?.name ?? projectName,
      productionBranch: project?.production_branch ?? null,
      publicUrl: project?.subdomain ? `https://${project.subdomain}` : null,
    };
  }

  async function deploy({ target, credential, bundle, publicationId, onProgress = async () => {} }) {
    await onProgress({ stage: "validating_target", completed: 0, total: 4 });
    const { accountId, projectName, apiToken } = validateInputs(target, credential);
    const entries = Object.entries(bundle?.files ?? {});
    if (!entries.length || entries.length > MAX_FILE_COUNT || typeof bundle.files["index.html"] !== "string") {
      throw new SiteDeploymentAdapterError("site_deployment_bundle_invalid", "Static site bundle is invalid or exceeds the Pages file limit.");
    }
    const assets = entries.map(([path, body]) => {
      const buffer = Buffer.from(body);
      if (buffer.byteLength > MAX_FILE_BYTES) throw new SiteDeploymentAdapterError("site_deployment_asset_too_large", `Static asset is too large: ${path}`);
      return { path, body: buffer, bytes: buffer.byteLength, hash: cloudflarePagesAssetHash(path, buffer), contentType: contentType(path) };
    });
    const manifest = Object.fromEntries(assets.map((asset) => [`/${asset.path.replace(/^\/+/, "")}`, asset.hash]));
    await onProgress({ stage: "uploading", completed: 1, total: 4, itemsCompleted: 0, itemsTotal: assets.length });
    const uploadToken = await api(`/accounts/${accountId}/pages/projects/${encodeURIComponent(projectName)}/upload-token`, { token: apiToken });
    if (!uploadToken?.jwt) throw new SiteDeploymentAdapterError("site_deployment_upload_token_invalid", "Cloudflare did not return a Pages upload token.");
    const missing = await api("/pages/assets/check-missing", {
      token: uploadToken.jwt,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hashes: assets.map((asset) => asset.hash) }),
    });
    const missingSet = new Set(Array.isArray(missing) ? missing : []);
    for (const bucket of assetBuckets(assets.filter((asset) => missingSet.has(asset.hash)).sort((a, b) => b.bytes - a.bytes))) {
      await api("/pages/assets/upload", {
        token: uploadToken.jwt,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bucket.map((asset) => ({
          key: asset.hash,
          value: asset.body.toString("base64"),
          metadata: { contentType: asset.contentType },
          base64: true,
        }))),
      });
    }
    await onProgress({ stage: "uploading", completed: 1, total: 4, itemsCompleted: assets.length, itemsTotal: assets.length });
    try {
      await api("/pages/assets/upsert-hashes", {
        token: uploadToken.jwt,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hashes: assets.map((asset) => asset.hash) }),
      });
    } catch {
      // Cache bookkeeping is advisory and does not invalidate uploaded assets.
    }
    const form = new FormData();
    await onProgress({ stage: "activating", completed: 2, total: 4 });
    form.append("manifest", JSON.stringify(manifest));
    form.append("commit_message", `My Site release ${publicationId}`.slice(0, 384));
    const created = await api(`/accounts/${accountId}/pages/projects/${encodeURIComponent(projectName)}/deployments`, {
      token: apiToken,
      method: "POST",
      body: form,
    });
    if (!created?.id || !created?.url) throw new SiteDeploymentAdapterError("site_deployment_response_invalid", "Cloudflare returned an invalid deployment response.");
    const deployed = created.latest_stage?.status === "success"
      ? created
      : await waitForDeployment({ accountId, projectName, deploymentId: created.id, apiToken });
    await onProgress({ stage: "verifying_publication", completed: 3, total: 4 });
    const publicCheck = await verifyPublicAsset(created.url, bundle.files["index.html"]);
    await onProgress({ stage: "completed", completed: 4, total: 4 });
    return {
      provider: "cloudflare_pages",
      deploymentId: created.id,
      projectName,
      url: created.url,
      aliases: Array.isArray(deployed?.aliases) ? deployed.aliases.filter((value) => publicPagesUrl(value)).slice(0, 10) : [],
      environment: deployed?.environment ?? created.environment ?? "production",
      verification: publicCheck,
    };
  }

  async function rollback({ target, credential, publication }) {
    const { accountId, projectName, apiToken } = validateInputs(target, credential);
    const deploymentId = publication?.remoteDeployment?.deploymentId;
    if (!deploymentId) throw new SiteDeploymentAdapterError("site_deployment_rollback_unavailable", "The target release has no remote deployment ID.");
    const rolledBack = await api(`/accounts/${accountId}/pages/projects/${encodeURIComponent(projectName)}/deployments/${encodeURIComponent(deploymentId)}/rollback`, {
      token: apiToken,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    let project = null;
    for (let attempt = 0; attempt < maxStatusChecks; attempt += 1) {
      project = await api(`/accounts/${accountId}/pages/projects/${encodeURIComponent(projectName)}`, { token: apiToken });
      if (project?.canonical_deployment?.id === deploymentId) break;
      if (attempt < maxStatusChecks - 1) await sleep(Math.min(2 ** attempt * 500, 4_000));
    }
    if (project?.canonical_deployment?.id !== deploymentId) {
      throw new SiteDeploymentAdapterError("site_deployment_rollback_unverified", "Cloudflare did not confirm the requested production rollback.", { retryable: true });
    }
    const expectedHash = publication?.remoteDeployment?.verification?.contentHash;
    const productionUrl = project?.subdomain ? `https://${project.subdomain}` : publication.remoteDeployment.url;
    if (expectedHash) await verifyPublicHash(productionUrl, expectedHash);
    return {
      provider: "cloudflare_pages",
      deploymentId,
      url: productionUrl,
      rollbackDeploymentId: rolledBack?.id ?? deploymentId,
    };
  }

  return { kind: "cloudflare_pages", verifyConnection, deploy, rollback };
}
