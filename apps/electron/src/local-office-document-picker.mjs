import { randomUUID } from "node:crypto";
import { closeSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

const OFFICE_TYPES = new Map([[".docx", "docx"], [".xlsx", "xlsx"], [".pptx", "pptx"]]);

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
