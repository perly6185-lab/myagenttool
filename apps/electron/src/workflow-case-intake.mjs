import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

const MAX_FILES = 12;
const MAX_FILE_BYTES = 24 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_PASTED_BYTES = 96 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  ".docx", ".xlsx", ".txt", ".md", ".pdf",
  ".png", ".jpg", ".jpeg", ".webp",
]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const AUTHORIZATION_MODES = new Set(["authorized", "deidentified"]);
const SAFE_REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

function safeName(value, fallback = "case") {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return normalized || fallback;
}

function contained(root, target) {
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function selectedFile(path) {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("Select regular local files.");
  const extension = extname(path).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error("One selected file type is not supported.");
  if (stats.size <= 0 || stats.size > MAX_FILE_BYTES) {
    throw new Error("Each selected file must be between 1 byte and 24 MiB.");
  }
  return {
    path: realpathSync(path),
    name: basename(path),
    extension: extension.slice(1),
    size: stats.size,
    modifiedAtMs: stats.mtimeMs,
    device: stats.dev,
    inode: stats.ino,
    readiness: IMAGE_EXTENSIONS.has(extension) ? "needs_ocr" : extension === ".pdf" ? "inspect" : "ready",
  };
}

function resolveSourceRoot(state, sourceId) {
  const source = (state.workflowSources ?? []).find((row) =>
    row.id === sourceId && row.state === "active");
  const project = source
    ? (state.projects ?? []).find((row) => row.id === source.projectId)
    : null;
  if (!source || !project?.path || source.readMode !== "supported_text") {
    throw new Error("The selected Workflow Memory folder is unavailable.");
  }
  const projectRoot = realpathSync(resolve(project.path));
  const requested = resolve(projectRoot, String(source.relativePath ?? ""));
  if (!contained(projectRoot, requested)) throw new Error("The selected folder escapes its project.");
  const sourceRoot = realpathSync(requested);
  if (!contained(projectRoot, sourceRoot) || !statSync(sourceRoot).isDirectory()) {
    throw new Error("The selected Workflow Memory folder is unavailable.");
  }
  return sourceRoot;
}

function createCaseDirectory(sourceRoot, caseName) {
  const inbox = join(sourceRoot, "incoming");
  if (existsSync(inbox) && lstatSync(inbox).isSymbolicLink()) {
    throw new Error("The intake destination is not safe.");
  }
  mkdirSync(inbox, { recursive: true });
  const realInbox = realpathSync(inbox);
  if (!contained(sourceRoot, realInbox)) throw new Error("The intake destination escapes the selected folder.");
  const folderName = `${new Date().toISOString().slice(0, 10)}-${safeName(caseName)}-${randomUUID().slice(0, 8)}`;
  const destination = join(realInbox, folderName);
  mkdirSync(destination, { recursive: false });
  return { destination, relativeDirectory: relative(sourceRoot, destination).split(sep).join("/") };
}

function uniqueDestinationName(destination, declaredName, used) {
  const extension = extname(declaredName).toLowerCase();
  const stem = safeName(basename(declaredName, extension), "file");
  let candidate = `${stem}${extension}`;
  let suffix = 2;
  while (used.has(candidate.toLowerCase()) || existsSync(join(destination, candidate))) {
    candidate = `${stem}-${suffix}${extension}`;
    suffix += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export function registerWorkflowCaseIntake({
  ipcMain,
  dialog,
  getWindow,
  getState,
  now = () => new Date().toISOString(),
} = {}) {
  const selections = new Map();
  const receipts = new Map();

  ipcMain.removeHandler("workflow-memory:pick-case-files");
  ipcMain.handle("workflow-memory:pick-case-files", async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: "Choose files for one business case",
      properties: ["openFile", "multiSelections"],
      filters: [{
        name: "Business case files",
        extensions: ["docx", "xlsx", "txt", "md", "pdf", "png", "jpg", "jpeg", "webp"],
      }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    if (result.filePaths.length > MAX_FILES) throw new Error(`Select at most ${MAX_FILES} files.`);
    const files = result.filePaths.map(selectedFile);
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) {
      throw new Error("The selected files exceed the 64 MiB case limit.");
    }
    const selectionId = randomUUID();
    selections.set(selectionId, { files, expiresAt: Date.now() + 5 * 60_000 });
    return {
      selectionId,
      files: files.map(({ name, extension, size, readiness }) => ({
        name, extension, size, readiness,
      })),
    };
  });

  ipcMain.removeHandler("workflow-memory:stage-case");
  ipcMain.handle("workflow-memory:stage-case", async (_event, input) => {
    const requestId = String(input?.requestId ?? "");
    if (!SAFE_REQUEST_ID_RE.test(requestId)) throw new Error("A safe intake request ID is required.");
    const requestHash = createHash("sha256").update(JSON.stringify({
      sourceId: input?.sourceId,
      selectionId: input?.selectionId ?? null,
      pastedText: input?.pastedText ?? "",
      primaryKey: input?.primaryKey,
      caseName: input?.caseName ?? "",
      authorizationMode: input?.authorizationMode,
      confirmed: input?.confirmed,
    })).digest("hex");
    const prior = receipts.get(requestId);
    if (prior) {
      if (prior.requestHash !== requestHash) throw new Error("The intake request ID was reused with different data.");
      return prior.receipt;
    }
    if (input?.confirmed !== true || !AUTHORIZATION_MODES.has(input?.authorizationMode)) {
      throw new Error("Confirm authorization or de-identification before adding this case.");
    }
    const pastedText = String(input?.pastedText ?? "");
    if (Buffer.byteLength(pastedText) > MAX_PASTED_BYTES || pastedText.includes("\0")) {
      throw new Error("Pasted text must be at most 96 KiB and contain no binary data.");
    }
    const grant = input?.selectionId ? selections.get(String(input.selectionId)) : null;
    if (input?.selectionId && (!grant || grant.expiresAt < Date.now())) {
      throw new Error("The selected files expired. Select them again.");
    }
    const files = grant?.files ?? [];
    if (!files.length && !pastedText.trim()) throw new Error("Choose files or paste text first.");
    const primaryKey = String(input?.primaryKey ?? "");
    const allowedPrimaryKeys = new Set([
      ...files.map((_file, index) => `file:${index}`),
      ...(pastedText.trim() ? ["text"] : []),
    ]);
    if (!allowedPrimaryKeys.has(primaryKey)) throw new Error("Choose one primary inquiry.");
    const primaryFile = primaryKey.startsWith("file:")
      ? files[Number(primaryKey.slice(5))]
      : null;
    if (primaryFile?.readiness === "needs_ocr") {
      throw new Error("An image needs OCR and cannot be the primary inquiry yet.");
    }

    const sourceRoot = resolveSourceRoot(await getState(), String(input?.sourceId ?? ""));
    const { destination, relativeDirectory } = createCaseDirectory(sourceRoot, input?.caseName);
    try {
      const used = new Set();
      const staged = [];
      for (const [index, file] of files.entries()) {
        const before = lstatSync(file.path);
        if (before.isSymbolicLink() || !before.isFile()
          || before.size !== file.size
          || before.mtimeMs !== file.modifiedAtMs
          || before.dev !== file.device
          || before.ino !== file.inode) {
          throw new Error("A selected file changed after authorization. Select it again.");
        }
        const name = uniqueDestinationName(destination, file.name, used);
        copyFileSync(file.path, join(destination, name), constants.COPYFILE_EXCL);
        const after = statSync(file.path);
        if (after.size !== before.size || after.mtimeMs !== before.mtimeMs
          || after.dev !== before.dev || after.ino !== before.ino) {
          throw new Error("A selected file changed while it was being copied.");
        }
        staged.push({
          key: `file:${index}`,
          name,
          relativePath: `${relativeDirectory}/${name}`,
          extension: file.extension,
          size: file.size,
          readiness: file.readiness,
        });
      }
      if (pastedText.trim()) {
        const name = uniqueDestinationName(destination, "pasted-inquiry.txt", used);
        writeFileSync(join(destination, name), pastedText, { flag: "wx", mode: 0o600 });
        staged.push({
          key: "text",
          name,
          relativePath: `${relativeDirectory}/${name}`,
          extension: "txt",
          size: Buffer.byteLength(pastedText),
          readiness: "ready",
        });
      }
      const primary = staged.find((file) => file.key === primaryKey);
      const receipt = {
        requestId,
        caseDirectory: relativeDirectory,
        primaryRelativePath: primary.relativePath,
        supportingRelativePaths: staged.filter((file) => file.key !== primaryKey).map((file) => file.relativePath),
        files: staged,
        authorizationMode: input.authorizationMode,
        recordedAt: now(),
      };
      writeFileSync(join(destination, ".case.json"), JSON.stringify({
        schemaVersion: 1,
        authorizationMode: receipt.authorizationMode,
        recordedAt: receipt.recordedAt,
        primaryFile: primary.name,
        supportingFiles: staged.filter((file) => file.key !== primaryKey).map((file) => file.name),
      }, null, 2), { flag: "wx", mode: 0o600 });
      if (grant) selections.delete(String(input.selectionId));
      receipts.set(receipt.requestId, { requestHash, receipt });
      while (receipts.size > 100) receipts.delete(receipts.keys().next().value);
      return receipt;
    } catch (error) {
      rmSync(destination, { recursive: true, force: true });
      throw error;
    }
  });
}
