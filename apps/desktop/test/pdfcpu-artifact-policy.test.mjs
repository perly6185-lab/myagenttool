import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { pdfcpuArtifactChecksumMatches, resolveAllowedPdfcpuArtifact } from "../src/pdfcpu-artifact-policy.mjs";

test("device independently resolves the pinned pdfcpu artifact", () => {
  const artifact = resolveAllowedPdfcpuArtifact("darwin", "arm64");
  assert.equal(artifact.version, "0.12.1");
  assert.match(artifact.url, /\/v0\.12\.1\/pdfcpu_0\.12\.1_Darwin_arm64\.tar\.xz$/);
  assert.equal(resolveAllowedPdfcpuArtifact("freebsd", "x64"), null);
});

test("pdfcpu checksum comparison accepts exact bytes and rejects tampering", () => {
  const bytes = Buffer.from("verified release fixture");
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  assert.equal(pdfcpuArtifactChecksumMatches(bytes, digest), true);
  assert.equal(pdfcpuArtifactChecksumMatches(Buffer.from("tampered"), digest), false);
  assert.equal(pdfcpuArtifactChecksumMatches(bytes, "not-a-digest"), false);
});
