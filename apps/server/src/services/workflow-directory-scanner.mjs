import { createHash } from "node:crypto";
import { readdirSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

export function createWorkflowDirectoryScanner({
  classifyFile,
  containedDirectory,
  extractText,
  fileFamily,
  identifyFile,
  maxDepth,
  maxFiles,
  parseDocument,
  parserVersion,
  readTextContent,
  shouldIgnore,
  supportedExtensions,
}) {
  async function scanDirectory(
    source,
    project,
    {
      shouldCancel = () => false,
      onProgress = () => {},
      onArtifact = () => {},
      existingByPath = new Map(),
    } = {},
  ) {
    const { actual } = containedDirectory(project.path, source.relativePath);
    const artifacts = [];
    const pending = [{ directory: actual, depth: 0 }];
    let scannedEntries = 0;
    let skipped = 0;
    let parsed = 0;
    let parseFailed = 0;
    let reused = 0;
    let truncated = false;

    while (pending.length && artifacts.length < maxFiles) {
      const { directory, depth } = pending.pop();
      let entries;
      try {
        entries = readdirSync(directory, { withFileTypes: true });
      } catch {
        skipped += 1;
        continue;
      }
      for (const entry of entries) {
        if (shouldCancel()) {
          return {
            artifacts,
            scannedEntries,
            skipped,
            parsed,
            parseFailed,
            reused,
            truncated,
            cancelled: true,
          };
        }
        scannedEntries += 1;
        if (scannedEntries % 100 === 0) {
          onProgress({
            scannedEntries,
            discovered: artifacts.length,
            skipped,
            parsed,
            parseFailed,
            reused,
          });
          await new Promise((resolvePromise) => setImmediate(resolvePromise));
        }
        if (artifacts.length >= maxFiles) {
          truncated = true;
          break;
        }
        if (entry.isSymbolicLink() || shouldIgnore(entry.name, entry.isDirectory())) {
          skipped += 1;
          continue;
        }
        const fullPath = resolve(directory, entry.name);
        const relativePath = relative(actual, fullPath).replaceAll("\\", "/");
        if (entry.isDirectory()) {
          if (depth >= maxDepth) {
            skipped += 1;
            truncated = true;
            continue;
          }
          pending.push({ directory: fullPath, depth: depth + 1 });
          continue;
        }
        if (!entry.isFile()) {
          skipped += 1;
          continue;
        }
        const extension = extname(entry.name).toLowerCase();
        if (!supportedExtensions.has(extension)) {
          skipped += 1;
          continue;
        }
        let stat;
        try {
          stat = statSync(fullPath);
        } catch {
          skipped += 1;
          continue;
        }
        const content = readTextContent(fullPath, extension, source.readMode, stat.size);
        const fingerprint = createHash("sha256")
          .update(`${relativePath}\0${stat.size}\0${Math.trunc(stat.mtimeMs)}\0`)
          .update(content)
          .digest("hex");
        const existing = existingByPath.get(relativePath);
        let extraction;
        if (
          existing?.fingerprint === fingerprint
          && existing.extraction?.parserVersion === parserVersion
        ) {
          extraction = existing.extraction;
          reused += 1;
        } else {
          extraction = await parseDocument({
            path: fullPath,
            extension,
            readMode: source.readMode,
            size: stat.size,
          });
          if (["ready", "needs_ocr"].includes(extraction.state)) parsed += 1;
          else if (extraction.state === "failed") parseFailed += 1;
        }
        const learningText = extractText(extraction) || content;
        const inference = classifyFile({ relativePath, content: learningText });
        const identity = identifyFile(fullPath, source, stat);
        const artifact = {
          relativePath,
          name: entry.name,
          extension: extension.slice(1),
          family: fileFamily(extension),
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          fingerprint,
          ...identity,
          inference,
          extraction,
        };
        artifacts.push(artifact);
        onArtifact(artifact, {
          scannedEntries,
          discovered: artifacts.length,
          skipped,
          parsed,
          parseFailed,
          reused,
        });
      }
    }

    onProgress({
      scannedEntries,
      discovered: artifacts.length,
      skipped,
      parsed,
      parseFailed,
      reused,
    });
    return {
      artifacts,
      scannedEntries,
      skipped,
      parsed,
      parseFailed,
      reused,
      truncated,
      cancelled: false,
    };
  }

  function collectIntakeCandidates(source, project) {
    const { actual } = containedDirectory(project.path, source.relativePath);
    const candidates = [];
    const pending = [{ directory: actual, depth: 0 }];
    let scannedEntries = 0;
    let skipped = 0;
    let truncated = false;

    while (pending.length && candidates.length < maxFiles) {
      const { directory, depth } = pending.pop();
      let entries;
      try {
        entries = readdirSync(directory, { withFileTypes: true })
          .sort((left, right) => left.name.localeCompare(right.name));
      } catch {
        skipped += 1;
        continue;
      }
      for (const entry of entries) {
        scannedEntries += 1;
        if (candidates.length >= maxFiles) {
          truncated = true;
          break;
        }
        if (entry.isSymbolicLink() || shouldIgnore(entry.name, entry.isDirectory())) {
          skipped += 1;
          continue;
        }
        const fullPath = resolve(directory, entry.name);
        const relativePath = relative(actual, fullPath).replaceAll("\\", "/");
        if (entry.isDirectory()) {
          if (depth >= maxDepth) {
            skipped += 1;
            truncated = true;
          } else {
            pending.push({ directory: fullPath, depth: depth + 1 });
          }
          continue;
        }
        if (!entry.isFile()) {
          skipped += 1;
          continue;
        }
        const extension = extname(entry.name).toLowerCase();
        if (!supportedExtensions.has(extension)) {
          skipped += 1;
          continue;
        }
        try {
          const real = realpathSync(fullPath);
          const confined = relative(actual, real);
          if (confined === ".." || confined.startsWith(`..${sep}`) || isAbsolute(confined)) {
            skipped += 1;
            continue;
          }
          const stat = statSync(real);
          if (!stat.isFile()) {
            skipped += 1;
            continue;
          }
          candidates.push({
            fullPath: real,
            relativePath,
            name: entry.name,
            extension,
            stat,
            signature: `${stat.size}:${Math.trunc(stat.mtimeMs)}:${Math.trunc(stat.ctimeMs)}`,
          });
        } catch {
          skipped += 1;
        }
      }
    }
    return {
      actual,
      candidates,
      scannedEntries,
      skipped,
      truncated,
    };
  }

  return { collectIntakeCandidates, scanDirectory };
}
