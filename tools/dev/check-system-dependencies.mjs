import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const serverRequire = createRequire(resolve(repoRoot, "apps/server/package.json"));

function versionOf(command, args = ["-version"]) {
  try {
    const output = execFileSync(command, args, {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 32 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    return output.split(/\r?\n/, 1)[0].trim();
  } catch {
    return null;
  }
}

const systemCommand = String(process.env.MYAGENTTOOL_FFPROBE_PATH ?? "").trim() || "ffprobe";
const systemVersion = versionOf(systemCommand);
let bundledCommand = null;
let bundledVersion = null;
try {
  bundledCommand = serverRequire("@ffprobe-installer/ffprobe").path;
  bundledVersion = versionOf(bundledCommand);
} catch {
  // No compatible bundled binary is expected on unsupported platforms.
}

const ffprobeReady = Boolean(systemVersion || bundledVersion);
console.log(systemVersion
  ? `ffprobe: READY (system: ${systemVersion})`
  : bundledVersion
    ? `ffprobe: READY (project fallback: ${bundledVersion}; path: ${bundledCommand})`
    : "ffprobe: MISSING");

for (const dependency of [
  { name: "codex", command: "codex", args: ["--version"] },
  { name: "claude", command: "claude", args: ["--version"] },
  { name: "officecli", command: "officecli", args: ["--version"] },
]) {
  const version = versionOf(dependency.command, dependency.args);
  console.log(`${dependency.name}: ${version ? `AVAILABLE (${version})` : "NOT DETECTED (configure the matching Application before use)"}`);
}

console.log(`OpenAI credential: ${process.env.OPENAI_API_KEY ? "CONFIGURED (value hidden)" : "NOT DETECTED"}`);
console.log("image/speech/video providers: VERIFY IN APPLICATIONS (requires explicit capability contract + healthy provider)");
console.log("site publishing sessions: VERIFY IN WEBSITE LOGINS (a configured connector does not prove an active login)");

if (!ffprobeReady) {
  console.error("Install a system FFmpeg package (macOS: brew install ffmpeg; Debian/Ubuntu: sudo apt-get install ffmpeg; Windows: winget install Gyan.FFmpeg.Shared), or run pnpm install to obtain the project fallback.");
  process.exit(1);
}
