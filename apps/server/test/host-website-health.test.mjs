import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { createPinnedWebsiteHealthChecker } from "../src/services/host-website-health.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");

function fakeHttps({ body = Buffer.from("managed homepage"), certificate = Buffer.from("certificate"), statusCode = 200, error = null, capture = null } = {}) {
  return (options, callback) => {
    capture?.(options);
    const request = new EventEmitter();
    request.destroy = (reason) => queueMicrotask(() => request.emit("error", reason));
    request.end = () => queueMicrotask(() => {
      if (error) {
        request.emit("error", error);
        return;
      }
      const response = new PassThrough();
      response.statusCode = statusCode;
      response.headers = { "content-length": String(body.length) };
      response.socket = { getPeerCertificate: () => ({ raw: certificate }) };
      callback(response);
      response.end(body);
    });
    return request;
  };
}

function target(body = Buffer.from("managed homepage"), certificate = Buffer.from("certificate")) {
  return {
    address: "10.10.10.222",
    hostname: "site.example.com",
    certificateFingerprint: hash(certificate),
    certificateEnvironment: "production",
    expectedContentHash: hash(body),
    expectedContentBytes: body.length,
  };
}

test("checks one pinned HTTPS address, certificate, and active homepage receipt", async () => {
  let options;
  const check = createPinnedWebsiteHealthChecker({
    httpsRequestImpl: fakeHttps({ capture: (value) => { options = value; } }),
    now: () => "2026-08-29T00:00:00.000Z",
  });

  const result = await check(target());

  assert.deepEqual(result, { status: "healthy", reason: "website_healthy", statusCodeClass: 2, contentMatched: true, checkedAt: "2026-08-29T00:00:00.000Z" });
  assert.equal(options.hostname, "10.10.10.222");
  assert.equal(options.servername, "site.example.com");
  assert.equal(options.headers.Host, "site.example.com");
  assert.equal(options.rejectUnauthorized, true);
});

test("does not report success when HTTPS serves a different page", async () => {
  const expected = Buffer.from("managed homepage");
  const actual = Buffer.from("default homepage");
  const check = createPinnedWebsiteHealthChecker({ httpsRequestImpl: fakeHttps({ body: actual }) });

  const result = await check(target(expected));

  assert.equal(result.status, "unhealthy");
  assert.equal(result.reason, "website_content_mismatch");
  assert.equal(result.contentMatched, false);
});

test("turns a refused pinned connection into a structured unhealthy result", async () => {
  const error = Object.assign(new Error("private network detail"), { code: "ECONNREFUSED" });
  const check = createPinnedWebsiteHealthChecker({ httpsRequestImpl: fakeHttps({ error }) });

  const result = await check(target());

  assert.equal(result.status, "unhealthy");
  assert.equal(result.reason, "website_unreachable");
  assert.equal(JSON.stringify(result).includes("private network detail"), false);
});

test("requires an explicit trust anchor for a staging certificate", async () => {
  const check = createPinnedWebsiteHealthChecker({ httpsRequestImpl: fakeHttps() });
  await assert.rejects(check({ ...target(), certificateEnvironment: "staging" }), { code: "host_website_staging_ca_unavailable" });
});
