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
  pickWorkflowCaseFiles: () => ipcRenderer.invoke("workflow-memory:pick-case-files"),
  importPrivateTutorLocalMaterial: (input) => ipcRenderer.invoke("private-tutor:import-local-material", input),
  stageWorkflowCase: (input) => ipcRenderer.invoke("workflow-memory:stage-case", input),
  copySelectedOfficeDocument: (input) => ipcRenderer.invoke("documents:copy-selected-office", input),
  openContainedOfficeDocument: (input) => ipcRenderer.invoke("documents:open-contained-office", input),
  openContainedAsset: (input) => ipcRenderer.invoke("assets:open-contained", input),
  revealContainedAsset: (input) => ipcRenderer.invoke("assets:reveal-contained", input),
  getMailConnectorStatus: () => ipcRenderer.invoke("mail:get-connector-status"),
  connect163Mail: (input) => ipcRenderer.invoke("mail:connect-163", input),
  connect163MailSend: () => ipcRenderer.invoke("mail:connect-163-send"),
  connect163MailOrganize: () => ipcRenderer.invoke("mail:connect-163-organize"),
  disconnect163Mail: () => ipcRenderer.invoke("mail:disconnect-163"),
  previewMailAttachment: (input) => ipcRenderer.invoke("mail:preview-attachment", input),
  downloadMailAttachment: (input) => ipcRenderer.invoke("mail:download-attachment", input),
  readMailAttachmentForTask: (input) => ipcRenderer.invoke("mail:read-attachment-for-task", input),
  pickOutboundMailAttachments: () => ipcRenderer.invoke("mail:pick-outbound-attachments"),
  stagePastedMailAttachments: (input) => ipcRenderer.invoke("mail:stage-pasted-attachments", input),
  stageTaskOutputMailAttachments: (input) => ipcRenderer.invoke("mail:stage-task-output-attachments", input),
  getAliyunOssCredentialStatus: () => ipcRenderer.invoke("site-cloud:get-aliyun-oss-credential-status"),
  saveAliyunOssCredential: (input) => ipcRenderer.invoke("site-cloud:save-aliyun-oss-credential", input),
  removeAliyunOssCredential: () => ipcRenderer.invoke("site-cloud:remove-aliyun-oss-credential"),
  getAliDnsCredentialStatus: () => ipcRenderer.invoke("site-cloud:get-alidns-credential-status"),
  saveAliDnsCredential: (input) => ipcRenderer.invoke("site-cloud:save-alidns-credential", input),
  removeAliDnsCredential: () => ipcRenderer.invoke("site-cloud:remove-alidns-credential"),
  getCloudflareSiteCredentialStatus: () => ipcRenderer.invoke("site-cloud:get-cloudflare-credential-status"),
  saveCloudflareSiteCredential: (input) => ipcRenderer.invoke("site-cloud:save-cloudflare-credential", input),
  removeCloudflareSiteCredential: () => ipcRenderer.invoke("site-cloud:remove-cloudflare-credential"),
  getSshHostCredentialStatus: (input) => ipcRenderer.invoke("ssh-host:get-credential-status", input),
  saveSshHostCredential: (input) => ipcRenderer.invoke("ssh-host:save-credential", input),
  removeSshHostCredential: (input) => ipcRenderer.invoke("ssh-host:remove-credential", input),
});
