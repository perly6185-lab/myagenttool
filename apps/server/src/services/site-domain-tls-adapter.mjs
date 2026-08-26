import { createHash, X509Certificate } from "node:crypto";
import { resolveCaa as defaultResolveCaa, resolveTxt as defaultResolveTxt } from "node:dns/promises";
import RPCClient from "@alicloud/pop-core";
import * as acme from "acme-client";
import { getDomain } from "tldts";

const ALIDNS_ENDPOINT = "https://alidns.aliyuncs.com";
const ALIDNS_API_VERSION = "2015-01-09";
export const LETS_ENCRYPT_STAGING_DIRECTORY = "https://acme-staging-v02.api.letsencrypt.org/directory";

export class SiteDomainTlsAdapterError extends Error {
  constructor(code, message, { retryable = false, cleanupRecordDigest = null } = {}) {
    super(message);
    this.name = "SiteDomainTlsAdapterError";
    this.code = code;
    this.retryable = retryable;
    this.cleanupRecordDigest = cleanupRecordDigest;
  }
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function dnsZoneFor(hostname) {
  const zone = getDomain(String(hostname ?? "").toLowerCase(), { allowPrivateDomains: true });
  if (!zone) throw new SiteDomainTlsAdapterError("site_domain_dns_zone_invalid", "The managed DNS zone could not be determined.");
  return zone;
}

function challengeRecordFor(hostname, zone) {
  const name = `_acme-challenge.${hostname}`;
  const suffix = `.${zone}`;
  if (!name.endsWith(suffix)) throw new SiteDomainTlsAdapterError("site_domain_dns_zone_invalid", "The challenge name is outside the managed DNS zone.");
  return { name, rr: name.slice(0, -suffix.length) || "@" };
}

function defaultDnsClientFactory(credential) {
  return new RPCClient({
    endpoint: ALIDNS_ENDPOINT,
    apiVersion: ALIDNS_API_VERSION,
    accessKeyId: credential.accessKeyId,
    accessKeySecret: credential.accessKeySecret,
    ...(credential.securityToken ? { securityToken: credential.securityToken } : {}),
    opts: { timeout: 30_000 },
  });
}

function defaultAcmeClientFactory({ accountKey }) {
  acme.axios.defaults.timeout = 30_000;
  return new acme.Client({ directoryUrl: LETS_ENCRYPT_STAGING_DIRECTORY, accountKey });
}

function dnsError(error, fallbackCode = "site_domain_dns_unavailable") {
  const code = String(error?.code ?? error?.name ?? "");
  if (/InvalidAccessKeyId|SignatureDoesNotMatch|InvalidSecurityToken|MissingSecurityToken/i.test(code)) {
    return new SiteDomainTlsAdapterError("site_domain_dns_auth_failed", "AliDNS rejected the configured credential.");
  }
  if (/Forbidden|NoPermission|Unauthorized|AccessDenied/i.test(code)) {
    return new SiteDomainTlsAdapterError("site_domain_dns_permission_denied", "The AliDNS credential does not have the required permission for this domain.");
  }
  if (/InvalidDomainName|DomainRecordNotBelongToUser|DomainNotExist/i.test(code)) {
    return new SiteDomainTlsAdapterError("site_domain_dns_zone_not_managed", "The domain is not managed by the connected AliDNS account.");
  }
  return new SiteDomainTlsAdapterError(fallbackCode, "AliDNS could not complete the domain operation.", { retryable: true });
}

function firstCertificate(pem) {
  const match = String(pem ?? "").match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
  if (!match) throw new SiteDomainTlsAdapterError("site_domain_acme_certificate_invalid", "The ACME server returned an invalid certificate.");
  return new X509Certificate(match[0]);
}

function certificateSummary(pem, hostname) {
  const certificate = firstCertificate(pem);
  const sans = certificate.subjectAltName
    ?.split(/,\s*/)
    .map((entry) => entry.startsWith("DNS:") ? entry.slice(4).toLowerCase() : null)
    .filter(Boolean) ?? [];
  if (!sans.includes(hostname.toLowerCase())) {
    throw new SiteDomainTlsAdapterError("site_domain_acme_certificate_mismatch", "The issued certificate does not contain the requested hostname.");
  }
  return {
    fingerprint: certificate.fingerprint256.replaceAll(":", "").toLowerCase(),
    issuer: certificate.issuer.slice(0, 300),
    sans,
    notBefore: new Date(certificate.validFrom).toISOString(),
    notAfter: new Date(certificate.validTo).toISOString(),
  };
}

function dnsValues(answer) {
  return (answer ?? []).map((chunks) => Array.isArray(chunks) ? chunks.join("") : String(chunks));
}

function noDnsData(error) {
  return ["ENODATA", "ENOTFOUND", "NXDOMAIN", "NOTFOUND"].includes(String(error?.code ?? "").toUpperCase());
}

async function checkCaa({ hostname, zone, resolveCaa }) {
  const labels = hostname.split(".");
  const zoneLabels = zone.split(".").length;
  for (let offset = 0; offset <= labels.length - zoneLabels; offset += 1) {
    const name = labels.slice(offset).join(".");
    let records;
    try {
      records = await resolveCaa(name);
    } catch (error) {
      if (noDnsData(error)) continue;
      throw new SiteDomainTlsAdapterError("site_domain_caa_check_failed", "CAA records could not be checked safely.", { retryable: true });
    }
    if (!records?.length) continue;
    const issuers = records
      .filter((record) => typeof record?.issue === "string")
      .map((record) => record.issue.split(";")[0].trim().toLowerCase());
    if (!issuers.length || issuers.includes("letsencrypt.org")) return;
    throw new SiteDomainTlsAdapterError("site_domain_caa_not_allowed", "CAA policy does not allow Let's Encrypt to issue this certificate.");
  }
}

export function createSiteDomainTlsAdapter({
  dnsClientFactory = defaultDnsClientFactory,
  acmeClientFactory = defaultAcmeClientFactory,
  cryptoProvider = acme.crypto,
  resolveTxt = defaultResolveTxt,
  resolveCaa = defaultResolveCaa,
  summarizeCertificate = certificateSummary,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  propagationChecks = 60,
  propagationDelayMs = 5_000,
} = {}) {
  const stagingArtifacts = new Map();
  const accountKeyPromises = new Map();

  async function dnsClient(credential) {
    if (!credential?.accessKeyId || !credential?.accessKeySecret) {
      throw new SiteDomainTlsAdapterError("site_domain_dns_credential_invalid", "The AliDNS credential is invalid.");
    }
    return dnsClientFactory(credential);
  }

  async function verifyDns({ hostname, credential }) {
    const zone = dnsZoneFor(hostname);
    const client = await dnsClient(credential);
    try {
      await client.request("DescribeDomainRecords", { DomainName: zone, PageNumber: 1, PageSize: 1 }, { method: "POST" });
      return { provider: "alidns", zone };
    } catch (error) {
      throw dnsError(error);
    }
  }

  async function waitForTxt(name, value) {
    for (let attempt = 0; attempt < propagationChecks; attempt += 1) {
      try {
        if (dnsValues(await resolveTxt(name)).includes(value)) return;
      } catch (error) {
        if (!noDnsData(error)) throw new SiteDomainTlsAdapterError("site_domain_dns_propagation_failed", "The DNS challenge could not be resolved.", { retryable: true });
      }
      if (attempt + 1 < propagationChecks) await sleep(propagationDelayMs);
    }
    throw new SiteDomainTlsAdapterError("site_domain_dns_propagation_timeout", "The DNS challenge did not become visible in time.", { retryable: true });
  }

  async function issueStaging({ bindingId, hostname, contactEmail, credential }) {
    const { zone } = await verifyDns({ hostname, credential });
    await checkCaa({ hostname, zone, resolveCaa });
    const client = await dnsClient(credential);
    const challengeRecords = new Map();
    const cleanupFailures = new Map();
    if (!accountKeyPromises.has(bindingId)) accountKeyPromises.set(bindingId, cryptoProvider.createPrivateKey());
    const accountKey = await accountKeyPromises.get(bindingId);
    const acmeClient = await acmeClientFactory({ accountKey, directoryUrl: LETS_ENCRYPT_STAGING_DIRECTORY });
    const [privateKey, csr] = await cryptoProvider.createCsr({ altNames: [hostname] });

    async function removeRecord(key, record) {
      try {
        await client.request("DeleteDomainRecord", { RecordId: record.recordId }, { method: "POST" });
        challengeRecords.delete(key);
        cleanupFailures.delete(key);
      } catch (error) {
        cleanupFailures.set(key, dnsError(error, "site_domain_txt_cleanup_failed"));
      }
    }

    let certificatePem;
    let issuanceFailure = null;
    try {
      certificatePem = await acmeClient.auto({
        csr,
        email: contactEmail,
        termsOfServiceAgreed: true,
        challengePriority: ["dns-01"],
        skipChallengeVerification: true,
        challengeCreateFn: async (authorization, challenge, keyAuthorization) => {
          if (challenge.type !== "dns-01") throw new SiteDomainTlsAdapterError("site_domain_acme_challenge_invalid", "Only DNS-01 challenges are allowed.");
          const { name, rr } = challengeRecordFor(String(authorization?.identifier?.value ?? hostname).replace(/^\*\./, ""), zone);
          let response;
          try {
            response = await client.request("AddDomainRecord", { DomainName: zone, RR: rr, Type: "TXT", Value: keyAuthorization, TTL: 600, Line: "default" }, { method: "POST" });
          } catch (error) {
            throw dnsError(error);
          }
          const recordId = String(response?.RecordId ?? "");
          if (!recordId) throw new SiteDomainTlsAdapterError("site_domain_dns_record_invalid", "AliDNS did not return a challenge record identifier.");
          const key = `${authorization?.identifier?.value ?? hostname}:${challenge.token}`;
          challengeRecords.set(key, { recordId });
          await waitForTxt(name, keyAuthorization);
        },
        challengeRemoveFn: async (authorization, challenge) => {
          const key = `${authorization?.identifier?.value ?? hostname}:${challenge.token}`;
          const record = challengeRecords.get(key);
          if (record) await removeRecord(key, record);
        },
      });
    } catch (error) {
      issuanceFailure = error instanceof SiteDomainTlsAdapterError
        ? error
        : new SiteDomainTlsAdapterError("site_domain_acme_staging_failed", "The staging certificate could not be issued.", { retryable: true });
    } finally {
      for (const [key, record] of [...challengeRecords]) await removeRecord(key, record);
    }

    const remainingRecordId = [...challengeRecords.values()][0]?.recordId ?? null;
    const cleanupRecordDigest = remainingRecordId ? digest(remainingRecordId) : null;
    if (issuanceFailure) {
      if (cleanupRecordDigest) issuanceFailure.cleanupRecordDigest = cleanupRecordDigest;
      throw issuanceFailure;
    }
    let summary;
    try {
      summary = summarizeCertificate(certificatePem, hostname);
    } catch (error) {
      if (cleanupRecordDigest && error instanceof SiteDomainTlsAdapterError) error.cleanupRecordDigest = cleanupRecordDigest;
      throw error;
    }
    const previousArtifact = stagingArtifacts.get(bindingId);
    if (previousArtifact?.privateKey) previousArtifact.privateKey.fill(0);
    stagingArtifacts.set(bindingId, {
      privateKey: Buffer.from(privateKey),
      certificate: Buffer.from(certificatePem),
      hostname,
      fingerprint: summary.fingerprint,
    });
    return {
      environment: "staging",
      ...summary,
      cleanup: cleanupRecordDigest
        ? { ok: false, recordDigest: cleanupRecordDigest, error: cleanupFailures.values().next().value?.code ?? "site_domain_txt_cleanup_failed" }
        : { ok: true },
    };
  }

  function hasStagingArtifact(bindingId, fingerprint = null) {
    const artifact = stagingArtifacts.get(bindingId);
    return Boolean(artifact && (!fingerprint || artifact.fingerprint === fingerprint));
  }

  async function withStagingArtifact(bindingId, fingerprint, operation) {
    const artifact = stagingArtifacts.get(bindingId);
    if (!artifact || artifact.fingerprint !== fingerprint || typeof operation !== "function") {
      throw new SiteDomainTlsAdapterError("site_domain_staging_artifact_unavailable", "The in-memory staging certificate is unavailable. Request a new test certificate.");
    }
    return operation({
      privateKey: artifact.privateKey,
      certificate: artifact.certificate,
      hostname: artifact.hostname,
      fingerprint: artifact.fingerprint,
    });
  }

  function discardStagingArtifact(bindingId) {
    const artifact = stagingArtifacts.get(bindingId);
    if (artifact?.privateKey) artifact.privateKey.fill(0);
    stagingArtifacts.delete(bindingId);
    const accountKeyPromise = accountKeyPromises.get(bindingId);
    if (accountKeyPromise) void accountKeyPromise.then((key) => { if (Buffer.isBuffer(key)) key.fill(0); }).catch(() => {});
    accountKeyPromises.delete(bindingId);
  }

  return { verifyDns, issueStaging, hasStagingArtifact, withStagingArtifact, discardStagingArtifact };
}
