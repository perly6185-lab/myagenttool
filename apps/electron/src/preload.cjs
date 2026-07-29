// Preload bridge (sandboxed, CommonJS — ESM preload is unavailable under
// sandbox: true). Exposes a minimal, one-way channel the web console uses to
// keep the native window chrome in sync with the active skin. See
// docs/design/SKIN_SYSTEM.md.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("myagenttoolDesktop", {
  applyChrome: (chrome) => {
    ipcRenderer.send("skin:apply-chrome", chrome);
  },
  pickLocalOfficeDocument: () => ipcRenderer.invoke("documents:pick-local-office"),
  pickWorkflowSourceFolder: () => ipcRenderer.invoke("workflow-memory:pick-source-folder"),
  copySelectedOfficeDocument: (input) => ipcRenderer.invoke("documents:copy-selected-office", input),
  openContainedOfficeDocument: (input) => ipcRenderer.invoke("documents:open-contained-office", input),
  openContainedAsset: (input) => ipcRenderer.invoke("assets:open-contained", input),
});
