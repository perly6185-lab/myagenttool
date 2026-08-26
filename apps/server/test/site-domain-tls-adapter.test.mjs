import assert from "node:assert/strict";
import { test } from "node:test";
import { createSiteDomainTlsAdapter, LETS_ENCRYPT_STAGING_DIRECTORY, SiteDomainTlsAdapterError } from "../src/services/site-domain-tls-adapter.mjs";

const CREDENTIAL = { accessKeyId: "LTAI5dnsExampleKey", accessKeySecret: "never-log-this" };
const CERTIFICATE_SUMMARY = {
  fingerprint: "a".repeat(64),
  issuer: "CN=Fake LE Intermediate X1",
  sans: ["lan.example.co.uk"],
  notBefore: "2026-08-26T00:00:00.000Z",
  notAfter: "2026-11-24T00:00:00.000Z",
};

function noData() {
  return Object.assign(new Error("no records"), { code: "ENODATA" });
}

function harness({ deleteFails = false, autoFails = false } = {}) {
  const calls = [];
  const dns = {
    request: async (action, params, options) => {
      calls.push({ action, params, options });
      if (action === "DescribeDomainRecords") return { TotalCount: 0 };
      if (action === "AddDomainRecord") return { RecordId: "record-secret-id" };
      if (action === "DeleteDomainRecord" && deleteFails) throw Object.assign(new Error("denied"), { code: "Forbidden.RAM" });
      if (action === "DeleteDomainRecord") return { RequestId: "request-id" };
      throw new Error(`unexpected action ${action}`);
    },
  };
  const adapter = createSiteDomainTlsAdapter({
    dnsClientFactory: async () => dns,
    cryptoProvider: {
      createPrivateKey: async () => Buffer.from("account-private-key"),
      createCsr: async () => [Buffer.from("certificate-private-key"), Buffer.from("csr")],
    },
    acmeClientFactory: async ({ directoryUrl }) => ({
      auto: async ({ challengeCreateFn, challengeRemoveFn }) => {
        assert.equal(directoryUrl, LETS_ENCRYPT_STAGING_DIRECTORY);
        const authorization = { identifier: { value: "lan.example.co.uk" } };
        const challenge = { type: "dns-01", token: "challenge-token" };
        await challengeCreateFn(authorization, challenge, "dns-value");
        if (autoFails) throw new Error("ACME failed with sensitive response");
        await challengeRemoveFn(authorization, challenge, "dns-value");
        return Buffer.from("certificate-pem");
      },
    }),
    resolveTxt: async (name) => {
      assert.equal(name, "_acme-challenge.lan.example.co.uk");
      return [["dns-", "value"]];
    },
    resolveCaa: async () => { throw noData(); },
    summarizeCertificate: () => CERTIFICATE_SUMMARY,
    propagationChecks: 1,
  });
  return { adapter, calls };
}

test("verifies the registrable AliDNS zone with a read-only API call", async () => {
  const { adapter, calls } = harness();
  assert.deepEqual(await adapter.verifyDns({ hostname: "lan.example.co.uk", credential: CREDENTIAL }), {
    provider: "alidns", zone: "example.co.uk",
  });
  assert.deepEqual(calls, [{
    action: "DescribeDomainRecords",
    params: { DomainName: "example.co.uk", PageNumber: 1, PageSize: 1 },
    options: { method: "POST" },
  }]);
});

test("issues only through staging, waits for DNS, and deletes the exact TXT record", async () => {
  const { adapter, calls } = harness();
  const result = await adapter.issueStaging({
    bindingId: "stb_1", hostname: "lan.example.co.uk", contactEmail: "owner@example.com", credential: CREDENTIAL,
  });
  assert.equal(result.environment, "staging");
  assert.deepEqual(result.cleanup, { ok: true });
  assert.equal(adapter.hasStagingArtifact("stb_1", CERTIFICATE_SUMMARY.fingerprint), true);
  assert.deepEqual(calls.map(({ action }) => action), ["DescribeDomainRecords", "AddDomainRecord", "DeleteDomainRecord"]);
  assert.deepEqual(calls[1].params, {
    DomainName: "example.co.uk", RR: "_acme-challenge.lan", Type: "TXT", Value: "dns-value", TTL: 600, Line: "default",
  });
  assert.deepEqual(calls[2].params, { RecordId: "record-secret-id" });
  assert.equal(JSON.stringify(result).includes("dns-value"), false);
  assert.equal(JSON.stringify(result).includes("record-secret-id"), false);
  assert.equal(JSON.stringify(result).includes(CREDENTIAL.accessKeySecret), false);
  adapter.discardStagingArtifact("stb_1");
  assert.equal(adapter.hasStagingArtifact("stb_1"), false);
});

test("keeps an issued staging certificate but reports a digested TXT cleanup failure", async () => {
  const { adapter, calls } = harness({ deleteFails: true });
  const result = await adapter.issueStaging({
    bindingId: "stb_1", hostname: "lan.example.co.uk", contactEmail: "owner@example.com", credential: CREDENTIAL,
  });
  assert.equal(result.cleanup.ok, false);
  assert.match(result.cleanup.recordDigest, /^[a-f0-9]{64}$/);
  assert.equal(result.cleanup.recordDigest.includes("record-secret-id"), false);
  assert.equal(calls.filter(({ action }) => action === "DeleteDomainRecord").length, 2);
  assert.equal(adapter.hasStagingArtifact("stb_1"), true);
});

test("cleans up TXT after ACME failure and returns a fixed sanitized error", async () => {
  const { adapter, calls } = harness({ autoFails: true });
  await assert.rejects(
    adapter.issueStaging({ bindingId: "stb_1", hostname: "lan.example.co.uk", contactEmail: "owner@example.com", credential: CREDENTIAL }),
    (error) => error instanceof SiteDomainTlsAdapterError && error.code === "site_domain_acme_staging_failed" && !error.message.includes("sensitive"),
  );
  assert.equal(calls.filter(({ action }) => action === "DeleteDomainRecord").length, 1);
  assert.equal(adapter.hasStagingArtifact("stb_1"), false);
});

test("refuses issuance when CAA does not allow Let's Encrypt", async () => {
  const { adapter, calls } = harness();
  const blocked = createSiteDomainTlsAdapter({
    dnsClientFactory: async () => ({ request: async (action, params, options) => {
      calls.push({ action, params, options });
      return { TotalCount: 0 };
    } }),
    resolveCaa: async () => [{ critical: 0, issue: "other-ca.example" }],
  });
  await assert.rejects(
    blocked.issueStaging({ bindingId: "stb_1", hostname: "lan.example.co.uk", contactEmail: "owner@example.com", credential: CREDENTIAL }),
    (error) => error instanceof SiteDomainTlsAdapterError && error.code === "site_domain_caa_not_allowed",
  );
  assert.deepEqual(calls.map(({ action }) => action), ["DescribeDomainRecords"]);
});
