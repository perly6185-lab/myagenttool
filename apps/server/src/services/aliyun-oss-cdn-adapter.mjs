import { createHash } from "node:crypto";
import { extname } from "node:path";
import OSS from "ali-oss";
import RPCClient from "@alicloud/pop-core";
import { validateExternalWebhookTarget } from "./auto-run-alerts.mjs";
import { SiteDeploymentAdapterError } from "./site-deployment-adapters.mjs";

const CDN_ENDPOINT = "https://cdn.aliyuncs.com";
const CDN_API_VERSION = "2018-05-10";
const BUCKET_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const OSS_REGION = /^oss-[a-z0-9]+(?:-[a-z0-9]+)+$/;
const TERMINAL_REFRESH = new Set(["Failed", "Timeout", "Canceled"]);
const RELEASE_ROOT = "_myagenttool/releases";

function contentType(path) {
  return ({
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
  })[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function headersFor(path, { immutable = false } = {}) {
  return {
    "Content-Type": contentType(path),
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache, no-store, must-revalidate",
    "x-oss-meta-myagenttool": "managed-site-release",
  };
}

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function publicPath(path) {
  if (path === "index.html") return "/";
  if (path.endsWith("/index.html")) return `/${path.slice(0, -"index.html".length)}`;
  return `/${path}`;
}

function releasePrefix(publicationId) {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(String(publicationId ?? ""))) {
    throw new SiteDeploymentAdapterError("site_deployment_publication_invalid", "Publication identifier is invalid.");
  }
  return `${RELEASE_ROOT}/${publicationId}`;
}

function releaseFiles(bundle, prefix) {
  const entries = Object.entries(bundle?.files ?? {});
  if (!entries.length || typeof bundle.files["index.html"] !== "string") {
    throw new SiteDeploymentAdapterError("site_deployment_bundle_invalid", "Static site bundle is invalid.");
  }
  const pathMap = new Map(entries.map(([path]) => [publicPath(path), `/${prefix}/${path}`]));
  return entries.map(([path, originalBody]) => {
    let body = Buffer.isBuffer(originalBody) ? originalBody : Buffer.from(originalBody, "utf8");
    if (typeof originalBody === "string" && extname(path).toLowerCase() === ".html") {
      let html = originalBody;
      for (const [from, to] of [...pathMap].sort(([a], [b]) => b.length - a.length)) {
        html = html.replaceAll(`href="${from}"`, `href="${to}"`).replaceAll(`src="${from}"`, `src="${to}"`);
      }
      body = Buffer.from(html, "utf8");
    }
    return { path, key: `${prefix}/${path}`, body, contentType: contentType(path) };
  });
}

function activationFiles(files) {
  return files.filter((file) => [".html", ".xml", ".txt"].includes(extname(file.path).toLowerCase()));
}

function normalizeTaskList(value) {
  const tasks = value?.Tasks?.CDNTask ?? value?.Tasks ?? [];
  return Array.isArray(tasks) ? tasks : tasks ? [tasks] : [];
}

function normalizeSourceList(value) {
  const sources = value?.SourceModels?.SourceModel ?? value?.SourceModels ?? [];
  return Array.isArray(sources) ? sources : sources ? [sources] : [];
}

function providerError(error, fallback = "site_deployment_provider_failed") {
  if (error instanceof SiteDeploymentAdapterError) return error;
  const code = String(error?.code ?? error?.name ?? "");
  const status = Number(error?.status ?? error?.statusCode ?? 0);
  if (status === 401 || status === 403 || /AccessDenied|InvalidAccessKey|SignatureDoesNotMatch|Forbidden/i.test(code)) {
    return new SiteDeploymentAdapterError("site_deployment_auth_failed", "Alibaba Cloud credentials or permissions were rejected.");
  }
  if (status === 404 || /NoSuchBucket|DomainNotExist|NoSuchKey/i.test(code)) {
    return new SiteDeploymentAdapterError("site_deployment_target_not_found", "Alibaba Cloud deployment target was not found.");
  }
  return new SiteDeploymentAdapterError(fallback, "Alibaba Cloud deployment request failed.", { retryable: status === 0 || status === 429 || status >= 500 });
}

function validateInputs(target, credential) {
  const bucket = String(target?.remoteProjectRef ?? "").trim().toLowerCase();
  const region = String(target?.region ?? "").trim().toLowerCase();
  const domain = String(target?.customDomain ?? "").trim().toLowerCase();
  const accessKeyId = String(credential?.accessKeyId ?? "").trim();
  const accessKeySecret = String(credential?.accessKeySecret ?? "").trim();
  const securityToken = String(credential?.securityToken ?? credential?.stsToken ?? "").trim() || undefined;
  if (!BUCKET_NAME.test(bucket)) throw new SiteDeploymentAdapterError("site_deployment_bucket_invalid", "OSS Bucket name is invalid.");
  if (!OSS_REGION.test(region) || region.includes("internal")) throw new SiteDeploymentAdapterError("site_deployment_region_invalid", "OSS region is invalid.");
  if (!domain) throw new SiteDeploymentAdapterError("site_deployment_domain_required", "A CDN domain is required for Alibaba Cloud publishing.");
  if (!/^[A-Za-z0-9]{8,128}$/.test(accessKeyId) || !accessKeySecret || accessKeySecret.length > 4096) {
    throw new SiteDeploymentAdapterError("site_deployment_credential_invalid", "Alibaba Cloud credential is invalid.");
  }
  return { bucket, region, domain, accessKeyId, accessKeySecret, securityToken };
}

function defaultOssClient(config) {
  return new OSS({
    region: config.region,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    ...(config.securityToken ? { stsToken: config.securityToken } : {}),
    authorizationV4: true,
    secure: true,
    timeout: 30_000,
  });
}

function defaultCdnClient(config) {
  return new RPCClient({
    endpoint: CDN_ENDPOINT,
    apiVersion: CDN_API_VERSION,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    ...(config.securityToken ? { securityToken: config.securityToken } : {}),
    opts: { timeout: 30_000 },
  });
}

export function createAliyunOssCdnAdapter({
  ossClientFactory = defaultOssClient,
  cdnClientFactory = defaultCdnClient,
  fetchImpl = globalThis.fetch,
  resolveHostname,
  // Directory refreshes can take several minutes. Keep the publish request
  // pending until Alibaba Cloud reports a terminal task instead of treating a
  // successfully submitted refresh as a completed deployment.
  maxRefreshChecks = 90,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");

  async function clients(target, credential) {
    const config = validateInputs(target, credential);
    return { config, oss: await ossClientFactory(config), cdn: await cdnClientFactory(config) };
  }

  async function validatePublicDomain(domain) {
    const result = await validateExternalWebhookTarget(`https://${domain}/`, resolveHostname ? { resolveHostname } : {});
    if (!result.ok) throw new SiteDeploymentAdapterError("site_deployment_domain_unsafe", "CDN domain does not resolve to a public address.");
  }

  async function verifyConnection({ target, credential }) {
    try {
      const { config, oss, cdn } = await clients(target, credential);
      const [info, versioning, website, domainResult] = await Promise.all([
        oss.getBucketInfo(config.bucket),
        oss.getBucketVersioning(config.bucket),
        oss.getBucketWebsite(config.bucket),
        cdn.request("DescribeCdnDomainDetail", { DomainName: config.domain }, { method: "POST" }),
      ]);
      const actualRegion = String(info?.bucket?.Location ?? info?.bucket?.location ?? "").toLowerCase();
      if (actualRegion && actualRegion !== config.region) throw new SiteDeploymentAdapterError("site_deployment_region_mismatch", "OSS Bucket region does not match the configured region.");
      if (versioning?.versionStatus !== "Enabled") throw new SiteDeploymentAdapterError("site_deployment_versioning_required", "OSS Bucket versioning must be enabled before publishing.");
      if (website?.index !== "index.html" || website?.error !== "404.html") {
        throw new SiteDeploymentAdapterError("site_deployment_website_configuration_required", "OSS static website must use index.html and 404.html.");
      }
      const detail = domainResult?.GetDomainDetailModel ?? {};
      if (detail.DomainStatus !== "online") throw new SiteDeploymentAdapterError("site_deployment_cdn_domain_not_ready", "Alibaba Cloud CDN domain is not online.");
      if (detail.ServerCertificateStatus !== "on") throw new SiteDeploymentAdapterError("site_deployment_https_not_ready", "Alibaba Cloud CDN HTTPS certificate is not enabled.");
      const sources = normalizeSourceList(detail);
      if (!sources.some((source) => String(source?.Content ?? "").toLowerCase().includes(config.bucket))) {
        throw new SiteDeploymentAdapterError("site_deployment_cdn_origin_mismatch", "CDN origin does not point to the configured OSS Bucket.");
      }
      await validatePublicDomain(config.domain);
      return {
        provider: "aliyun_oss_cdn", bucket: config.bucket, region: config.region, domain: config.domain,
        cdnStatus: detail.DomainStatus, https: true, cname: detail.Cname ?? null,
        versioning: "Enabled", website: { index: website.index, error: website.error },
      };
    } catch (error) {
      throw providerError(error, "site_deployment_verification_failed");
    }
  }

  async function refresh(cdn, domain) {
    const submitted = await cdn.request("RefreshObjectCaches", { ObjectPath: `https://${domain}/`, ObjectType: "Directory" }, { method: "POST" });
    const taskId = String(submitted?.RefreshTaskId ?? submitted?.TaskId ?? "").trim();
    if (!taskId) throw new SiteDeploymentAdapterError("site_deployment_refresh_response_invalid", "Alibaba Cloud CDN did not return a refresh task.");
    for (let attempt = 0; attempt < maxRefreshChecks; attempt += 1) {
      const status = await cdn.request("DescribeRefreshTaskById", { TaskId: taskId }, { method: "POST" });
      const tasks = normalizeTaskList(status);
      if (tasks.length && tasks.every((task) => task.Status === "Complete")) return { taskId, status: "Complete" };
      if (tasks.some((task) => TERMINAL_REFRESH.has(task.Status))) {
        throw new SiteDeploymentAdapterError("site_deployment_refresh_failed", "Alibaba Cloud CDN cache refresh failed.", { retryable: true });
      }
      if (attempt < maxRefreshChecks - 1) await sleep(Math.min(1_000 + attempt * 500, 5_000));
    }
    throw new SiteDeploymentAdapterError("site_deployment_refresh_timeout", "Alibaba Cloud CDN cache refresh did not complete in time.", { retryable: true });
  }

  async function verifyPublic(domain, expectedBody) {
    await validatePublicDomain(domain);
    const url = new URL(`https://${domain}/`);
    url.searchParams.set("myagenttool_verify", Date.now().toString(36));
    const response = await fetchImpl(url, { headers: { Accept: "text/html", "Cache-Control": "no-cache" }, redirect: "error" });
    if (!response.ok) throw new SiteDeploymentAdapterError("site_deployment_healthcheck_failed", `Published site health check failed (${response.status}).`, { retryable: true });
    const body = await response.text();
    const actualHash = sha256(body);
    const expectedHash = sha256(expectedBody);
    if (actualHash !== expectedHash) throw new SiteDeploymentAdapterError("site_deployment_content_mismatch", "Published homepage does not match the confirmed release.");
    return { checkedAt: new Date().toISOString(), contentHash: actualHash };
  }

  async function putActivation(oss, files) {
    const versions = {};
    const ordered = [...files].sort((a, b) => (a.path === "index.html" ? 1 : 0) - (b.path === "index.html" ? 1 : 0));
    for (const file of ordered) {
      const result = await oss.put(file.path, file.body, { mime: file.contentType, headers: headersFor(file.path) });
      versions[file.path] = result?.res?.headers?.["x-oss-version-id"] ?? null;
    }
    return versions;
  }

  async function restoreRelease(oss, remoteDeployment) {
    const paths = Array.isArray(remoteDeployment?.activationPaths) ? remoteDeployment.activationPaths : [];
    const prefix = String(remoteDeployment?.releasePrefix ?? "");
    if (!prefix || !paths.includes("index.html")) throw new SiteDeploymentAdapterError("site_deployment_rollback_unavailable", "The target release has no restorable OSS entry object.");
    const files = [];
    for (const path of paths) {
      const result = await oss.get(`${prefix}/${path}`);
      files.push({ path, body: Buffer.from(result.content), contentType: contentType(path) });
    }
    return { files, versions: await putActivation(oss, files) };
  }

  async function deploy({ target, credential, bundle, publicationId, previousPublication = null, onProgress = async () => {} }) {
    let runtime;
    let activated = false;
    try {
      await onProgress({ stage: "validating_target", completed: 0, total: 4 });
      runtime = await clients(target, credential);
      await validatePublicDomain(runtime.config.domain);
      const prefix = releasePrefix(publicationId);
      const files = releaseFiles(bundle, prefix);
      await onProgress({ stage: "uploading", completed: 1, total: 4, itemsCompleted: 0, itemsTotal: files.length });
      const reportEvery = Math.max(1, Math.ceil(files.length / 20));
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        await runtime.oss.put(file.key, file.body, { mime: file.contentType, headers: headersFor(file.path, { immutable: true }) });
        if ((index + 1) % reportEvery === 0 || index === files.length - 1) {
          await onProgress({ stage: "uploading", completed: 1, total: 4, itemsCompleted: index + 1, itemsTotal: files.length });
        }
      }
      const activeFiles = activationFiles(files);
      await onProgress({ stage: "activating", completed: 2, total: 4, itemsCompleted: 0, itemsTotal: activeFiles.length });
      activated = true;
      const activationVersions = await putActivation(runtime.oss, activeFiles);
      await onProgress({ stage: "refreshing_cdn", completed: 3, total: 4 });
      const refreshed = await refresh(runtime.cdn, runtime.config.domain);
      const homepage = activeFiles.find((file) => file.path === "index.html")?.body;
      await onProgress({ stage: "verifying_publication", completed: 3, total: 4 });
      const verification = await verifyPublic(runtime.config.domain, homepage);
      await onProgress({ stage: "completed", completed: 4, total: 4 });
      return {
        provider: "aliyun_oss_cdn", bucket: runtime.config.bucket, region: runtime.config.region,
        domain: runtime.config.domain, releasePrefix: prefix, activationPaths: activeFiles.map((file) => file.path),
        activationVersions, refreshTaskId: refreshed.taskId, url: `https://${runtime.config.domain}/`, verification,
      };
    } catch (error) {
      const previous = previousPublication?.remoteDeployment;
      if (activated && runtime && previous?.provider === "aliyun_oss_cdn") {
        try {
          await onProgress({ stage: "recovering_previous", completed: 3, total: 4 });
          const restored = await restoreRelease(runtime.oss, previous);
          await refresh(runtime.cdn, runtime.config.domain);
          const homepage = restored.files.find((file) => file.path === "index.html")?.body;
          await verifyPublic(runtime.config.domain, homepage);
        } catch {
          throw new SiteDeploymentAdapterError("site_deployment_recovery_failed", "Alibaba Cloud deployment failed and the prior release could not be restored.", { retryable: true });
        }
      }
      throw providerError(error);
    }
  }

  async function rollback({ target, credential, publication }) {
    try {
      const runtime = await clients(target, credential);
      await validatePublicDomain(runtime.config.domain);
      const restored = await restoreRelease(runtime.oss, publication?.remoteDeployment);
      const refreshed = await refresh(runtime.cdn, runtime.config.domain);
      const homepage = restored.files.find((file) => file.path === "index.html")?.body;
      const verification = await verifyPublic(runtime.config.domain, homepage);
      return {
        provider: "aliyun_oss_cdn", bucket: runtime.config.bucket, region: runtime.config.region,
        domain: runtime.config.domain, releasePrefix: publication.remoteDeployment.releasePrefix,
        activationVersions: restored.versions, refreshTaskId: refreshed.taskId,
        url: `https://${runtime.config.domain}/`, verification,
      };
    } catch (error) {
      throw providerError(error, "site_deployment_rollback_failed");
    }
  }

  return { kind: "aliyun_oss_cdn", verifyConnection, deploy, rollback };
}
