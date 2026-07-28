import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFCPU_RELEASE_VERSION, resolvePdfcpuReleaseArtifact } from "../src/services/pdfcpu-release.mjs";

test("pdfcpu release artifacts are exact-version official URLs with SHA-256", () => {
  for (const [platform, architecture] of [["macos", "arm64"], ["macos", "x64"], ["linux", "arm64"], ["linux", "x64"], ["windows", "ia32"], ["windows", "x64"]]) {
    const artifact = resolvePdfcpuReleaseArtifact(platform, architecture);
    assert.equal(artifact.version, PDFCPU_RELEASE_VERSION);
    assert.match(artifact.url, /^https:\/\/github\.com\/pdfcpu\/pdfcpu\/releases\/download\/v0\.12\.1\//);
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
    assert.equal(artifact.filename.includes("0.12.1"), true);
  }
});

test("pdfcpu release selection normalizes known architecture aliases and fails closed", () => {
  assert.deepEqual(resolvePdfcpuReleaseArtifact("linux", "aarch64"), resolvePdfcpuReleaseArtifact("linux", "arm64"));
  assert.deepEqual(resolvePdfcpuReleaseArtifact("windows", "x86"), resolvePdfcpuReleaseArtifact("windows", "ia32"));
  assert.equal(resolvePdfcpuReleaseArtifact("macos", "ia32"), null);
  assert.equal(resolvePdfcpuReleaseArtifact("freebsd", "x64"), null);
  assert.equal(resolvePdfcpuReleaseArtifact("linux", "mips"), null);
});
