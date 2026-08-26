import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, relative, resolve, sep } from "node:path";

const MAX_TEXT_BYTES = 512 * 1024;
const TEXT_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".json", ".yaml", ".yml", ".csv"]);
const MEDIA_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".mp4", ".mov", ".webm", ".mkv"]);
const require = createRequire(import.meta.url);

function probeCommands() {
  const configured = String(process.env.MYAGENTTOOL_FFPROBE_PATH ?? "").trim();
  const commands = configured ? [configured] : ["ffprobe"];
  try {
    const bundled = require("@ffprobe-installer/ffprobe").path;
    if (bundled && !commands.includes(bundled)) commands.push(bundled);
  } catch {
    // The platform package is optional on unsupported platforms. The system
    // binary remains the only candidate there.
  }
  return commands;
}

function confinedFile(projectRoot, assetPath) {
  if (!projectRoot || !assetPath || isAbsolute(assetPath)) return null;
  try {
    const root = realpathSync(resolve(projectRoot));
    const lexical = resolve(root, assetPath);
    const lexicalRelative = relative(root, lexical);
    if (lexicalRelative === ".." || lexicalRelative.startsWith(`..${sep}`) || isAbsolute(lexicalRelative)) return null;
    const real = realpathSync(lexical);
    const realRelative = relative(root, real);
    if (realRelative === ".." || realRelative.startsWith(`..${sep}`) || isAbsolute(realRelative)) return null;
    return real;
  } catch {
    return null;
  }
}

function mergeMetrics(existing, derived) {
  const merged = { ...derived, ...(existing ?? {}) };
  if (Array.isArray(existing?.headings) && existing.headings.length) merged.headings = existing.headings;
  return Object.keys(merged).length ? merged : null;
}

function textMetrics(text) {
  const headings = [...text.matchAll(/^(?:#{1,6}\s+|(?:section|章节)[:：]\s*)(.+)$/gim)]
    .map((match) => match[1].trim())
    .filter(Boolean)
    .slice(0, 100);
  return {
    charCount: Array.from(text).length,
    sectionCount: headings.length,
    ...(headings.length ? { headings } : {}),
    source: "local_file",
  };
}

function pdfMetrics(buffer) {
  const pageCount = (buffer.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
  return pageCount > 0 ? { pageCount, source: "local_file" } : {};
}

function defaultProbeMediaFile(file) {
  for (const command of probeCommands()) {
    try {
      const output = execFileSync(command, [
        "-v", "error",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        file,
      ], {
        encoding: "utf8",
        timeout: 5_000,
        maxBuffer: 128 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
      return JSON.parse(output);
    } catch {
      // Try the bundled platform binary when the system binary is absent or
      // cannot inspect this file. Never turn a failed probe into acceptance.
    }
  }
  return null;
}

function mediaMetrics(probe) {
  if (!probe || typeof probe !== "object") return {};
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const formatDuration = Number(probe.format?.duration);
  const streamDuration = streams.map((stream) => Number(stream?.duration)).find(Number.isFinite);
  const durationSeconds = Number.isFinite(formatDuration) && formatDuration >= 0
    ? formatDuration
    : Number.isFinite(streamDuration) && streamDuration >= 0 ? streamDuration : null;
  const video = streams.find((stream) => stream?.codec_type === "video") ?? null;
  const audio = streams.find((stream) => stream?.codec_type === "audio") ?? null;
  const metrics = { source: "media_probe" };
  if (durationSeconds != null) metrics.durationSeconds = durationSeconds;
  if (video && Number.isSafeInteger(Number(video.width)) && Number(video.width) > 0) metrics.width = Number(video.width);
  if (video && Number.isSafeInteger(Number(video.height)) && Number(video.height) > 0) metrics.height = Number(video.height);
  const codec = video?.codec_name ?? audio?.codec_name ?? probe.format?.format_name;
  if (codec) metrics.codec = String(codec).slice(0, 40);
  if (audio && Number.isSafeInteger(Number(audio.sample_rate)) && Number(audio.sample_rate) > 0) metrics.sampleRate = Number(audio.sample_rate);
  if (audio && Number.isSafeInteger(Number(audio.channels)) && Number(audio.channels) > 0) metrics.channels = Number(audio.channels);
  return Object.keys(metrics).length > 1 ? metrics : {};
}

export function deriveWorkItemOutputMetrics(asset, { projectRoot = null, probeMedia = defaultProbeMediaFile } = {}) {
  if (!asset?.path || asset.contentMetrics?.source === "media_probe") return asset;
  const file = confinedFile(projectRoot, asset.path);
  if (!file || !existsSync(file)) return asset;
  let stat;
  try {
    stat = statSync(file);
    if (!stat.isFile() || stat.size <= 0) return asset;
  } catch {
    return asset;
  }
  const extension = String(asset.path).toLowerCase().slice(String(asset.path).lastIndexOf("."));
  let derived = {};
  try {
    if (TEXT_EXTENSIONS.has(extension)) {
      derived = textMetrics(readFileSync(file, { encoding: "utf8", flag: "r" }).slice(0, MAX_TEXT_BYTES));
    } else if (extension === ".pdf") {
      derived = pdfMetrics(readFileSync(file).subarray(0, MAX_TEXT_BYTES));
    } else if (MEDIA_EXTENSIONS.has(extension) && typeof probeMedia === "function") {
      derived = mediaMetrics(probeMedia(file));
    }
  } catch {
    return asset;
  }
  const contentMetrics = mergeMetrics(asset.contentMetrics, derived);
  return contentMetrics ? { ...asset, contentMetrics } : asset;
}

export function deriveWorkItemOutputMetricsForAssets(assets, options = {}) {
  return (Array.isArray(assets) ? assets : []).map((asset) => deriveWorkItemOutputMetrics(asset, options));
}
