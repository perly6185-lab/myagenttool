import { randomUUID } from "node:crypto";
import { closeSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

const OFFICE_TYPES = new Map([[".docx", "docx"], [".xlsx", "xlsx"], [".pptx", "pptx"]]);
const ASSET_TYPES = new Set([
  ...OFFICE_TYPES.keys(),
  ".pdf", ".md", ".mdx", ".canvas", ".excalidraw",
  ".dxf", ".dwg",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg",
  ".mp4", ".webm", ".mov",
]);

export function registerLocalOfficeDocumentPicker({ ipcMain, dialog, getWindow, getWorktrees }) {
  const selections = new Map();
  ipcMain.removeHandler("documents:pick-local-office");
  ipcMain.handle("documents:pick-local-office", async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: "Open local Office document",
      properties: ["openFile"],
      filters: [{ name: "Office documents", extensions: ["docx", "xlsx", "pptx"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const selection = { ...describeLocalOfficeDocument(result.filePaths[0]), selectionId: randomUUID() };
    selections.set(selection.selectionId, { path: selection.absolutePath, expiresAt: Date.now() + 5 * 60_000 });
    return selection;
  });
  ipcMain.removeHandler("documents:copy-selected-office");
  ipcMain.handle("documents:copy-selected-office", async (_event, input) => {
    const grant = selections.get(String(input?.selectionId ?? ""));
    if (!grant || grant.expiresAt < Date.now()) throw new Error("The local file selection has expired. Select the file again.");
    if (describeLocalOfficeDocument(grant.path).absolutePath !== grant.path) throw new Error("The selected local file changed after authorization.");
    const worktree = (await getWorktrees()).find((item) => item.id === input?.worktreeId);
    if (!worktree?.path) throw new Error("Selected Worktree is unavailable.");
    const result = copySelectedOfficeDocument(grant.path, worktree.path, input?.destination, { onConflict: input?.onConflict });
    selections.delete(String(input.selectionId));
    return result;
  });
}

/** Explicit, one-shot folder selection for the workflow-memory onboarding flow. */
export function registerWorkflowSourceFolderPicker({ ipcMain, dialog, getWindow }) {
  ipcMain.removeHandler("workflow-memory:pick-source-folder");
  ipcMain.handle("workflow-memory:pick-source-folder", async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: "选择授权工作目录",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const absolutePath = realpathSync(result.filePaths[0]);
    if (!statSync(absolutePath).isDirectory()) throw new Error("Select a folder.");
    return {
      absolutePath,
      name: absolutePath.split(/[\\/]/).filter(Boolean).at(-1) ?? "Workflow source",
    };
  });
}

export function registerContainedOfficeDocumentOpen({ ipcMain, getState, openPath }) {
  ipcMain.removeHandler("documents:open-contained-office");
  ipcMain.handle("documents:open-contained-office", async (_event, input) => {
    let target;
    try {
      target = resolveContainedOfficeDocument(await getState(), input);
    } catch {
      // Never let native filesystem errors (which can contain absolute paths)
      // cross the renderer boundary.
      throw new Error("The requested Office document could not be opened safely.");
    }
    try {
      const failure = await openPath(target);
      if (failure) throw new Error("open failed");
    } catch {
      throw new Error("The system application could not open this Office document.");
    }
    return { opened: true };
  });
}

export function registerContainedAssetOpen({ ipcMain, getState, openPath }) {
  ipcMain.removeHandler("assets:open-contained");
  ipcMain.handle("assets:open-contained", async (_event, input) => {
    let target;
    try {
      target = resolveContainedAsset(await getState(), input);
    } catch {
      throw new Error("The requested asset could not be opened safely.");
    }
    try {
      const failure = await openPath(target);
      if (failure) throw new Error("open failed");
    } catch {
      throw new Error("The system application could not open this asset.");
    }
    return { opened: true };
  });
}

export function registerContainedAssetReveal({ ipcMain, getState, revealPath }) {
  ipcMain.removeHandler("assets:reveal-contained");
  ipcMain.handle("assets:reveal-contained", async (_event, input) => {
    let target;
    try {
      target = resolveContainedAsset(await getState(), input);
    } catch {
      throw new Error("The requested asset could not be located safely.");
    }
    try {
      await revealPath(target);
    } catch {
      throw new Error("The system file manager could not locate this asset.");
    }
    return { revealed: true };
  });
}

export function resolveContainedOfficeDocument(state, input) {
  const requestedExtension = extname(String(input?.relativePath ?? "")).toLowerCase();
  if (!OFFICE_TYPES.has(requestedExtension)) throw new Error("Only .docx, .xlsx, and .pptx documents can be opened.");
  const target = resolveContainedAsset(state, input);
  return target;
}

export function resolveContainedAsset(state, input) {
  const projectId = String(input?.projectId ?? "").trim();
  const worktreeId = String(input?.worktreeId ?? "").trim();
  const relativePath = String(input?.relativePath ?? "").trim().replaceAll("\\", "/");
  if (!projectId || !relativePath || relativePath.startsWith("/") || relativePath.startsWith("~") || relativePath.split("/").includes("..")) {
    throw new Error("A contained project-relative Office document path is required.");
  }
  const project = (state?.projects ?? []).find((item) => item.id === projectId);
  if (!project?.path) throw new Error("Selected project is unavailable.");
  const worktree = worktreeId ? (state?.worktrees ?? []).find((item) => item.id === worktreeId && item.projectId === projectId) : null;
  if (worktreeId && !worktree) throw new Error("Selected Worktree is unavailable.");
  const configuredRoot = worktree ? (worktree.path ?? worktree.worktreePath) : project.path;
  if (!configuredRoot) throw new Error("Selected document root is unavailable.");
  const root = realpathSync(configuredRoot);
  const candidate = resolve(root, relativePath);
  const rel = relative(root, candidate);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Requested document escapes its project root.");
  const target = realpathSync(candidate);
  const realRel = relative(root, target);
  if (!realRel || realRel === ".." || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) throw new Error("Requested document escapes its project root.");
  const stat = statSync(target);
  if (!stat.isFile()) throw new Error("Requested document is not a regular file.");
  if (!ASSET_TYPES.has(extname(target).toLowerCase())) throw new Error("This asset type cannot be opened.");
  return target;
}

export function describeLocalOfficeDocument(inputPath) {
  const absolutePath = realpathSync(inputPath);
  const stat = statSync(absolutePath);
  if (!stat.isFile()) throw new Error("Selected path is not a regular file.");
  const type = OFFICE_TYPES.get(extname(absolutePath).toLowerCase());
  if (!type) throw new Error("Select a .docx, .xlsx, or .pptx file.");
  return { absolutePath, name: absolutePath.split(/[\\/]/).at(-1), type, size: stat.size };
}

export function copySelectedOfficeDocument(sourcePath, worktreePath, destinationInput, { onConflict = "reject" } = {}) {
  const source = describeLocalOfficeDocument(sourcePath);
  const signature = Buffer.alloc(2);
  const descriptor = openSync(source.absolutePath, "r");
  try { readSync(descriptor, signature, 0, 2, 0); } finally { closeSync(descriptor); }
  if (signature[0] !== 0x50 || signature[1] !== 0x4b) throw new Error("The selected file is not an OOXML package.");
  const destination = String(destinationInput ?? "").trim().replaceAll("\\", "/");
  if (!destination || destination.startsWith("/") || destination.startsWith("~") || destination.split("/").includes("..")) throw new Error("Destination must be relative to the Worktree.");
  if (extname(destination).toLowerCase() !== `.${source.type}`) throw new Error("Destination must keep the source document type.");
  const root = realpathSync(worktreePath);
  let target = resolve(root, destination);
  const rel = relative(root, target);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Destination escapes the Worktree.");
  const parent = dirname(target);
  let cursor = root;
  for (const part of relative(root, parent).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error("Destination escapes the Worktree through a symlink.");
  }
  mkdirSync(parent, { recursive: true });
  let finalDestination = destination;
  if (existsSync(target)) {
    if (onConflict !== "rename") throw new Error("A document already exists at the destination.");
    const extension = extname(destination);
    const stem = destination.slice(0, -extension.length);
    let found = false;
    for (let index = 1; index <= 100; index += 1) {
      finalDestination = `${stem} (${index})${extension}`;
      target = resolve(root, finalDestination);
      if (!existsSync(target)) { found = true; break; }
    }
    if (!found) throw new Error("Could not find an available destination name.");
  }
  copyFileSync(source.absolutePath, target, constants.COPYFILE_EXCL);
  return { path: finalDestination, bytes: source.size, type: source.type };
}
