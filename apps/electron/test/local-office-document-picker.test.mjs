import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { copySelectedOfficeDocument, describeLocalOfficeDocument, registerContainedAssetOpen, registerContainedAssetReveal, registerContainedOfficeDocumentOpen, registerLocalOfficeDocumentPicker, registerWorkflowSourceFolderPicker, resolveContainedAsset, resolveContainedOfficeDocument } from "../src/local-office-document-picker.mjs";

test("describes only a selected regular Office document", () => {
  const root = mkdtempSync(join(tmpdir(), "office-picker-"));
  const file = join(root, "Report.DOCX");
  writeFileSync(file, "PK");
  assert.deepEqual(describeLocalOfficeDocument(file), { absolutePath: realpathSync(file), name: "Report.DOCX", type: "docx", size: 2 });
  const text = join(root, "notes.txt");
  writeFileSync(text, "no");
  assert.throws(() => describeLocalOfficeDocument(text), /docx/);
});

test("the picker grant is single-use and cancellation creates no selection", async () => {
  const root = mkdtempSync(join(tmpdir(), "office-grant-"));
  const source = join(root, "source.xlsx");
  const worktree = join(root, "worktree");
  mkdirSync(worktree);
  writeFileSync(source, "PK-sheet");
  const handlers = new Map();
  const ipcMain = { removeHandler: (name) => handlers.delete(name), handle: (name, handler) => handlers.set(name, handler) };
  let canceled = false;
  const dialog = { showOpenDialog: async () => canceled ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [source] } };
  registerLocalOfficeDocumentPicker({ ipcMain, dialog, getWindow: () => null, getWorktrees: async () => [{ id: "wt", path: worktree }] });
  const selection = await handlers.get("documents:pick-local-office")();
  await handlers.get("documents:copy-selected-office")(null, { selectionId: selection.selectionId, worktreeId: "wt", destination: "data.xlsx" });
  await assert.rejects(() => handlers.get("documents:copy-selected-office")(null, { selectionId: selection.selectionId, worktreeId: "wt", destination: "again.xlsx" }), /expired/);
  canceled = true;
  assert.equal(await handlers.get("documents:pick-local-office")(), null);
});

test("workflow memory folder picker returns only an explicitly selected real directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "workflow-source-picker-"));
  const handlers = new Map();
  const ipcMain = { removeHandler: (name) => handlers.delete(name), handle: (name, handler) => handlers.set(name, handler) };
  let canceled = false;
  const dialog = {
    showOpenDialog: async () => canceled
      ? { canceled: true, filePaths: [] }
      : { canceled: false, filePaths: [root] },
  };
  registerWorkflowSourceFolderPicker({ ipcMain, dialog, getWindow: () => null });
  assert.deepEqual(await handlers.get("workflow-memory:pick-source-folder")(), {
    absolutePath: realpathSync(root),
    name: root.split(/[\\/]/).at(-1),
  });
  canceled = true;
  assert.equal(await handlers.get("workflow-memory:pick-source-folder")(), null);
});

test("workflow memory folder picker preserves a real Windows-style employee folder name with Chinese and spaces", async () => {
  const root = mkdtempSync(join(tmpdir(), "workflow-source-picker-i18n-"));
  const selectedFolder = join(root, "销售部 历史工作 2026");
  mkdirSync(selectedFolder);
  const handlers = new Map();
  const ipcMain = {
    removeHandler: (name) => handlers.delete(name),
    handle: (name, handler) => handlers.set(name, handler),
  };
  let receivedOptions = null;
  registerWorkflowSourceFolderPicker({
    ipcMain,
    dialog: {
      showOpenDialog: async (_window, options) => {
        receivedOptions = options;
        return { canceled: false, filePaths: [selectedFolder] };
      },
    },
    getWindow: () => null,
  });

  assert.deepEqual(await handlers.get("workflow-memory:pick-source-folder")(), {
    absolutePath: realpathSync(selectedFolder),
    name: "销售部 历史工作 2026",
  });
  assert.deepEqual(receivedOptions.properties, ["openDirectory"]);
});

test("copies a selected Office document only into a confined Worktree destination", () => {
  const root = mkdtempSync(join(tmpdir(), "office-copy-"));
  const source = join(root, "source.docx");
  const worktree = join(root, "worktree");
  mkdirSync(worktree);
  writeFileSync(source, "PK-office");
  assert.deepEqual(copySelectedOfficeDocument(source, worktree, "docs/report.docx"), { path: "docs/report.docx", bytes: 9, type: "docx" });
  assert.equal(readFileSync(join(worktree, "docs", "report.docx"), "utf8"), "PK-office");
  assert.throws(() => copySelectedOfficeDocument(source, worktree, "../escape.docx"), /relative/);
  assert.throws(() => copySelectedOfficeDocument(source, worktree, "docs/report.xlsx"), /keep/);
  assert.throws(() => copySelectedOfficeDocument(source, worktree, "docs/report.docx"), /already exists/);
  assert.deepEqual(copySelectedOfficeDocument(source, worktree, "docs/report.docx", { onConflict: "rename" }), { path: "docs/report (1).docx", bytes: 9, type: "docx" });
  const outside = mkdtempSync(join(tmpdir(), "office-copy-outside-"));
  symlinkSync(outside, join(worktree, "linked"));
  assert.throws(() => copySelectedOfficeDocument(source, worktree, "linked/secret.docx"), /symlink/);
  assert.equal(existsSync(join(outside, "secret.docx")), false);
});

test("resolves only regular Office documents contained by the selected project or worktree", () => {
  const root = mkdtempSync(join(tmpdir(), "office-open-"));
  const project = join(root, "project");
  const worktree = join(root, "worktree");
  mkdirSync(join(project, "docs"), { recursive: true });
  mkdirSync(worktree);
  writeFileSync(join(project, "docs", "report.docx"), "PK-office");
  writeFileSync(join(project, "notes.txt"), "no");
  writeFileSync(join(worktree, "deck.pptx"), "PK-office");
  const state = { projects: [{ id: "project", path: project }], worktrees: [{ id: "wt", projectId: "project", path: worktree }] };
  assert.equal(resolveContainedOfficeDocument(state, { projectId: "project", relativePath: "docs/report.docx" }), realpathSync(join(project, "docs", "report.docx")));
  assert.equal(resolveContainedOfficeDocument(state, { projectId: "project", worktreeId: "wt", relativePath: "deck.pptx" }), realpathSync(join(worktree, "deck.pptx")));
  assert.throws(() => resolveContainedOfficeDocument(state, { projectId: "project", relativePath: "../outside.docx" }), /contained/);
  assert.throws(() => resolveContainedOfficeDocument(state, { projectId: "project", relativePath: "notes.txt" }), /Only/);
  const outside = join(root, "outside.docx");
  writeFileSync(outside, "PK-office");
  symlinkSync(outside, join(project, "linked.docx"));
  assert.throws(() => resolveContainedOfficeDocument(state, { projectId: "project", relativePath: "linked.docx" }), /escapes/);
});

test("the contained-open IPC resolves identity in main and sanitizes system failures", async () => {
  const root = mkdtempSync(join(tmpdir(), "office-open-ipc-"));
  const file = join(root, "report.xlsx");
  writeFileSync(file, "PK-office");
  const handlers = new Map();
  const ipcMain = { removeHandler: (name) => handlers.delete(name), handle: (name, handler) => handlers.set(name, handler) };
  const opened = [];
  registerContainedOfficeDocumentOpen({
    ipcMain,
    getState: async () => ({ projects: [{ id: "project", path: root }], worktrees: [] }),
    openPath: async (path) => { opened.push(path); return ""; },
  });
  assert.deepEqual(await handlers.get("documents:open-contained-office")(null, { projectId: "project", relativePath: "report.xlsx" }), { opened: true });
  assert.deepEqual(opened, [realpathSync(file)]);
  await assert.rejects(() => handlers.get("documents:open-contained-office")(null, { projectId: "project", relativePath: "missing.xlsx" }), (error) => error.message === "The requested Office document could not be opened safely." && !error.message.includes(root));
  registerContainedOfficeDocumentOpen({ ipcMain, getState: async () => ({ projects: [{ id: "project", path: root }] }), openPath: async () => "sensitive OS detail" });
  await assert.rejects(() => handlers.get("documents:open-contained-office")(null, { projectId: "project", relativePath: "report.xlsx" }), (error) => error.message === "The system application could not open this Office document." && !error.message.includes("sensitive"));
});

test("opens only supported regular assets contained by the selected project", async () => {
  const root = mkdtempSync(join(tmpdir(), "asset-open-"));
  const image = join(root, "diagram.png");
  writeFileSync(image, "image");
  writeFileSync(join(root, "secret.env"), "secret");
  const state = { projects: [{ id: "project", path: root }], worktrees: [] };
  assert.equal(resolveContainedAsset(state, { projectId: "project", relativePath: "diagram.png" }), realpathSync(image));
  assert.throws(() => resolveContainedAsset(state, { projectId: "project", relativePath: "secret.env" }), /cannot be opened/);
  assert.throws(() => resolveContainedAsset(state, { projectId: "project", relativePath: "../diagram.png" }), /contained/);

  const handlers = new Map();
  const ipcMain = { removeHandler: (name) => handlers.delete(name), handle: (name, handler) => handlers.set(name, handler) };
  const opened = [];
  registerContainedAssetOpen({ ipcMain, getState: async () => state, openPath: async (path) => { opened.push(path); return ""; } });
  assert.deepEqual(await handlers.get("assets:open-contained")(null, { projectId: "project", relativePath: "diagram.png" }), { opened: true });
  assert.deepEqual(opened, [realpathSync(image)]);
  await assert.rejects(() => handlers.get("assets:open-contained")(null, { projectId: "project", relativePath: "secret.env" }), (error) => error.message === "The requested asset could not be opened safely." && !error.message.includes(root));
});

test("reveals only a supported asset contained by the selected project", async () => {
  const root = mkdtempSync(join(tmpdir(), "asset-reveal-"));
  const file = join(root, "report.xlsx");
  writeFileSync(file, "PK-sheet");
  const state = { projects: [{ id: "project", path: root }], worktrees: [] };
  const handlers = new Map();
  const ipcMain = { removeHandler: (name) => handlers.delete(name), handle: (name, handler) => handlers.set(name, handler) };
  const revealed = [];
  registerContainedAssetReveal({ ipcMain, getState: async () => state, revealPath: async (path) => { revealed.push(path); } });

  assert.deepEqual(await handlers.get("assets:reveal-contained")(null, { projectId: "project", relativePath: "report.xlsx" }), { revealed: true });
  assert.deepEqual(revealed, [realpathSync(file)]);
  await assert.rejects(
    () => handlers.get("assets:reveal-contained")(null, { projectId: "project", relativePath: "../report.xlsx" }),
    (error) => error.message === "The requested asset could not be located safely." && !error.message.includes(root),
  );
});
