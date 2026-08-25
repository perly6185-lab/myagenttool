import assert from "node:assert/strict";
import { test } from "node:test";
import { createAliyunOssCdnAdapter } from "../src/services/aliyun-oss-cdn-adapter.mjs";

const TARGET = {
  remoteProjectRef: "luna-site",
  region: "oss-cn-hangzhou",
  customDomain: "www.example.com",
};
const CREDENTIAL = {
  accessKeyId: "LTAI5exampleKey",
  accessKeySecret: "never-persist-this-secret",
};
const PUBLIC_DNS = async () => [{ address: "8.8.8.8", family: 4 }];

function verifiedOss(overrides = {}) {
  return {
    getBucketInfo: async () => ({ bucket: { Location: "oss-cn-hangzhou" } }),
    getBucketVersioning: async () => ({ versionStatus: "Enabled" }),
    getBucketWebsite: async () => ({ index: "index.html", error: "404.html" }),
    ...overrides,
  };
}

function verifiedCdn(overrides = {}) {
  return {
    request: async (action) => {
      if (action === "DescribeCdnDomainDetail") return { GetDomainDetailModel: {
        DomainStatus: "online",
        ServerCertificateStatus: "on",
        Cname: "www.example.com.w.kunluncan.com",
        SourceModels: { SourceModel: [{ Content: "luna-site.oss-cn-hangzhou.aliyuncs.com" }] },
      } };
      throw new Error(`Unexpected CDN action: ${action}`);
    },
    ...overrides,
  };
}

test("verifies OSS versioning, website hosting, CDN origin, HTTPS, and public DNS", async () => {
  const actions = [];
  const cdn = verifiedCdn({ request: async (action, params, options) => {
    actions.push({ action, params, options });
    return verifiedCdn().request(action, params, options);
  } });
  const adapter = createAliyunOssCdnAdapter({
    ossClientFactory: async () => verifiedOss(),
    cdnClientFactory: async () => cdn,
    resolveHostname: PUBLIC_DNS,
  });

  const result = await adapter.verifyConnection({ target: TARGET, credential: CREDENTIAL });

  assert.equal(result.provider, "aliyun_oss_cdn");
  assert.equal(result.versioning, "Enabled");
  assert.equal(result.https, true);
  assert.equal(actions[0].action, "DescribeCdnDomainDetail");
  assert.equal(JSON.stringify(result).includes(CREDENTIAL.accessKeySecret), false);
});

test("rejects unsafe or non-restorable Alibaba Cloud targets", async () => {
  const disabled = createAliyunOssCdnAdapter({
    ossClientFactory: async () => verifiedOss({ getBucketVersioning: async () => ({ versionStatus: "Suspended" }) }),
    cdnClientFactory: async () => verifiedCdn(),
    resolveHostname: PUBLIC_DNS,
  });
  await assert.rejects(
    disabled.verifyConnection({ target: TARGET, credential: CREDENTIAL }),
    (error) => error.code === "site_deployment_versioning_required",
  );

  const privateDomain = createAliyunOssCdnAdapter({
    ossClientFactory: async () => verifiedOss(),
    cdnClientFactory: async () => verifiedCdn(),
    resolveHostname: async () => [{ address: "192.168.1.10", family: 4 }],
  });
  await assert.rejects(
    privateDomain.verifyConnection({ target: TARGET, credential: CREDENTIAL }),
    (error) => error.code === "site_deployment_domain_unsafe",
  );
});

test("uploads an immutable release, activates entry objects last, refreshes CDN, and verifies content", async () => {
  const puts = [];
  let activeHomepage = Buffer.alloc(0);
  const oss = verifiedOss({
    put: async (key, body, options) => {
      const bytes = Buffer.from(body);
      puts.push({ key, body: bytes.toString("utf8"), options });
      if (key === "index.html") activeHomepage = bytes;
      return { res: { headers: { "x-oss-version-id": `version-${puts.length}` } } };
    },
  });
  const cdnActions = [];
  const cdn = verifiedCdn({ request: async (action, params) => {
    cdnActions.push({ action, params });
    if (action === "RefreshObjectCaches") return { RefreshTaskId: "refresh-1" };
    if (action === "DescribeRefreshTaskById") return { Tasks: { CDNTask: [{ Status: "Complete" }] } };
    return verifiedCdn().request(action, params);
  } });
  const adapter = createAliyunOssCdnAdapter({
    ossClientFactory: async () => oss,
    cdnClientFactory: async () => cdn,
    resolveHostname: PUBLIC_DNS,
    sleep: async () => {},
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => activeHomepage.toString("utf8") }),
  });
  const bundle = { files: {
    "index.html": '<a href="/about/">About</a><link href="/assets/site.css">',
    "about/index.html": '<a href="/">Home</a>',
    "404.html": "Not found",
    "assets/site.css": "body{color:#123}",
    "robots.txt": "User-agent: *",
  } };
  const progress = [];

  const result = await adapter.deploy({ target: TARGET, credential: CREDENTIAL, bundle, publicationId: "spb_0001", onProgress: async (value) => progress.push(value.stage) });

  const releasePuts = puts.filter((item) => item.key.startsWith("_myagenttool/releases/spb_0001/"));
  const activationPuts = puts.slice(releasePuts.length);
  assert.equal(releasePuts.length, Object.keys(bundle.files).length);
  assert.equal(activationPuts.at(-1).key, "index.html", "the public entry object switches last");
  assert.match(activationPuts.at(-1).body, /\/_myagenttool\/releases\/spb_0001\/about\/index\.html/);
  assert.match(activationPuts.at(-1).body, /\/_myagenttool\/releases\/spb_0001\/assets\/site\.css/);
  assert.equal(releasePuts[0].options.headers["Cache-Control"], "public, max-age=31536000, immutable");
  assert.equal(activationPuts.at(-1).options.headers["Cache-Control"], "no-cache, no-store, must-revalidate");
  assert.deepEqual(cdnActions.map(({ action }) => action), ["RefreshObjectCaches", "DescribeRefreshTaskById"]);
  assert.equal(result.releasePrefix, "_myagenttool/releases/spb_0001");
  assert.equal(result.url, "https://www.example.com/");
  assert.equal(result.refreshTaskId, "refresh-1");
  assert.deepEqual([...new Set(progress)], ["validating_target", "uploading", "activating", "refreshing_cdn", "verifying_publication", "completed"]);
  assert.equal(JSON.stringify(result).includes(CREDENTIAL.accessKeySecret), false);
});

test("rollback restores the selected immutable release and verifies the public homepage", async () => {
  const stored = new Map([
    ["_myagenttool/releases/spb_old/index.html", Buffer.from("old homepage")],
    ["_myagenttool/releases/spb_old/404.html", Buffer.from("old 404")],
  ]);
  let activeHomepage = Buffer.alloc(0);
  const restored = [];
  const oss = verifiedOss({
    get: async (key) => ({ content: stored.get(key) }),
    put: async (key, body) => {
      restored.push(key);
      if (key === "index.html") activeHomepage = Buffer.from(body);
      return { res: { headers: { "x-oss-version-id": `restored-${key}` } } };
    },
  });
  const cdn = verifiedCdn({ request: async (action) => {
    if (action === "RefreshObjectCaches") return { RefreshTaskId: "refresh-old" };
    if (action === "DescribeRefreshTaskById") return { Tasks: { CDNTask: [{ Status: "Complete" }] } };
    return verifiedCdn().request(action);
  } });
  const adapter = createAliyunOssCdnAdapter({
    ossClientFactory: async () => oss,
    cdnClientFactory: async () => cdn,
    resolveHostname: PUBLIC_DNS,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => activeHomepage.toString("utf8") }),
    sleep: async () => {},
  });

  const result = await adapter.rollback({
    target: TARGET,
    credential: CREDENTIAL,
    publication: { remoteDeployment: {
      provider: "aliyun_oss_cdn",
      releasePrefix: "_myagenttool/releases/spb_old",
      activationPaths: ["index.html", "404.html"],
    } },
  });

  assert.deepEqual(restored, ["404.html", "index.html"]);
  assert.equal(result.releasePrefix, "_myagenttool/releases/spb_old");
  assert.equal(result.refreshTaskId, "refresh-old");
});

test("restores and verifies the previous release when post-activation verification fails", async () => {
  const oldHomepage = Buffer.from("old homepage");
  let activeHomepage = oldHomepage;
  let healthChecks = 0;
  const puts = [];
  const oss = verifiedOss({
    get: async (key) => ({ content: key.endsWith("index.html") ? oldHomepage : Buffer.from("old 404") }),
    put: async (key, body) => {
      puts.push(key);
      if (key === "index.html") activeHomepage = Buffer.from(body);
      return { res: { headers: { "x-oss-version-id": `version-${puts.length}` } } };
    },
  });
  const cdn = verifiedCdn({ request: async (action) => {
    if (action === "RefreshObjectCaches") return { RefreshTaskId: `refresh-${puts.length}` };
    if (action === "DescribeRefreshTaskById") return { Tasks: { CDNTask: [{ Status: "Complete" }] } };
    return verifiedCdn().request(action);
  } });
  const adapter = createAliyunOssCdnAdapter({
    ossClientFactory: async () => oss,
    cdnClientFactory: async () => cdn,
    resolveHostname: PUBLIC_DNS,
    sleep: async () => {},
    fetchImpl: async () => {
      healthChecks += 1;
      return { ok: true, status: 200, text: async () => healthChecks === 1 ? "stale CDN body" : activeHomepage.toString("utf8") };
    },
  });

  await assert.rejects(adapter.deploy({
    target: TARGET,
    credential: CREDENTIAL,
    publicationId: "spb_new",
    bundle: { files: { "index.html": "new homepage", "404.html": "new 404" } },
    previousPublication: { remoteDeployment: {
      provider: "aliyun_oss_cdn",
      releasePrefix: "_myagenttool/releases/spb_old",
      activationPaths: ["index.html", "404.html"],
    } },
  }), (error) => error.code === "site_deployment_content_mismatch");

  assert.equal(activeHomepage.toString("utf8"), "old homepage");
  assert.equal(healthChecks, 2, "the recovered homepage is independently verified");
});
