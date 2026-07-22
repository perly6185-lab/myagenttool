import crypto from "node:crypto";

const VERSION = "0.12.1";
const RELEASE_ROOT = `https://github.com/pdfcpu/pdfcpu/releases/download/v${VERSION}/`;
const ALLOWLIST = new Map([
  ["macos/arm64", ["pdfcpu_0.12.1_Darwin_arm64.tar.xz", "6f1a0aef381da9568a521d144001d12de063f234141747d0fa2da948d7b8cb84"]],
  ["macos/x64", ["pdfcpu_0.12.1_Darwin_x86_64.tar.xz", "bb064cdd206da33e198717af272173899f6f2c13a1e1e7c851aac8baf0551031"]],
  ["linux/arm64", ["pdfcpu_0.12.1_Linux_arm64.tar.xz", "8ab8f8a309110fde449eb190e220703d9239da7c9311074444711569ad8a85cf"]],
  ["linux/arm", ["pdfcpu_0.12.1_Linux_armv7.tar.xz", "29abc731a63be1025a5d327b467c88463d5e1e5391a50125162f451783cdf6b7"]],
  ["linux/ia32", ["pdfcpu_0.12.1_Linux_i386.tar.xz", "5dd3b009974013a86136acad39ae12e14692d4bfc1f691889ecba9187bff8b38"]],
  ["linux/x64", ["pdfcpu_0.12.1_Linux_x86_64.tar.xz", "8f6304e6d39493cace031f9b8d82829a794f5f691ea092d6169596f8a14eeeb8"]],
  ["windows/ia32", ["pdfcpu_0.12.1_Windows_i386.zip", "c224d8c4e422d7e9c2b7b7c3a3bc4bb69fb4870d5785df1bc7bacb1004acfc55"]],
  ["windows/x64", ["pdfcpu_0.12.1_Windows_x86_64.zip", "025dd555d4942e2730e67c2655886c81635198551e70bf64b9bd3bcf170c863b"]],
]);

export function resolveAllowedPdfcpuArtifact(platform, architecture) {
  const os = platform === "darwin" ? "macos" : platform === "win32" ? "windows" : platform;
  const arch = architecture === "x86_64" ? "x64" : architecture === "aarch64" ? "arm64" : architecture === "x86" ? "ia32" : architecture;
  const row = ALLOWLIST.get(`${os}/${arch}`);
  if (!row) return null;
  return { version: VERSION, filename: row[0], url: `${RELEASE_ROOT}${row[0]}`, sha256: row[1] };
}

export function pdfcpuArtifactChecksumMatches(bytes, expectedSha256) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) return false;
  if (!/^[a-f0-9]{64}$/.test(String(expectedSha256 ?? ""))) return false;
  const actual = crypto.createHash("sha256").update(bytes).digest();
  const expected = Buffer.from(expectedSha256, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
