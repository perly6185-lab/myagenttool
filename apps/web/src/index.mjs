import http from "node:http";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");
const vendorRoots = {
  "/vendor/xterm/": join(__dirname, "..", "node_modules", "@xterm", "xterm"),
  "/vendor/xterm-addon-fit/": join(__dirname, "..", "node_modules", "@xterm", "addon-fit")
};
const host = process.env.WEB_HOST ?? "127.0.0.1";
const port = Number(process.env.WEB_PORT ?? 5000);

if (process.argv.includes("--check")) {
  const required = ["index.html", "app.js", "styles.css"];
  const missing = required.filter((item) => !existsSync(join(publicDir, item)));
  if (missing.length > 0) {
    console.error(`[web:check] missing files: ${missing.join(", ")}`);
    process.exit(1);
  }

  const html = readFileSync(join(publicDir, "index.html"), "utf8");
  const css = readFileSync(join(publicDir, "styles.css"), "utf8");
  const js = readFileSync(join(publicDir, "app.js"), "utf8");
  const productFlowsPath = join(publicDir, "..", "..", "..", "docs", "design", "PRODUCT_FLOWS.md");
  const productFlows = existsSync(productFlowsPath) ? readFileSync(productFlowsPath, "utf8") : "";
  const expectations = [
    [html, "Codex conversation", "task composer"],
    [html, "id=\"runButton\"", "plain-language run action"],
    [html, "class=\"composer-card\"", "Codex-style composer card"],
    [html, "id=\"attachmentFileInput\"", "file attachment input"],
    [html, "id=\"attachmentTray\"", "attachment tray"],
    [html, "class=\"send-button\"", "Codex-style send action"],
    [html, "id=\"addContextMenu\"", "Codex-style add context menu"],
    [html, "id=\"permissionMenu\"", "Codex-style permission menu"],
    [html, "id=\"modelMenu\"", "Codex-style model menu"],
    [html, "id=\"agentSelect\"", "agent selector"],
    [html, "id=\"deviceSelectValue\"", "visible device selector value"],
    [html, "id=\"agentSelectValue\"", "visible agent selector value"],
    [html, "id=\"agentChoiceList\"", "scannable agent choice list"],
    [html, "id=\"codexSessionMode\"", "Codex session mode control"],
    [html, "id=\"codexWorkspacePolicy\"", "Codex workspace policy control"],
    [html, "id=\"compareAgentList\"", "compare agent selector"],
    [html, "id=\"comparePanel\"", "compare results panel"],
    [html, "id=\"taskListPanel\"", "routine run list panel"],
    [html, "Loop routine runs", "routine read model surface"],
    [html, "Routine runs", "routine run tab"],
    [html, "id=\"healthCheckButton\"", "agent health check action"],
    [html, "id=\"toggleAgentButton\"", "agent enable disable action"],
    [html, "id=\"agentHealth\"", "agent health state"],
    [html, "id=\"agentUsage\"", "agent usage count"],
    [html, "id=\"agentCostOwner\"", "agent cost owner"],
    [html, "id=\"troubleshootButton\"", "invocation troubleshooter action"],
    [html, "id=\"troubleshooterPanel\"", "invocation troubleshooter panel"],
    [html, "id=\"discoverButton\"", "agent discovery action"],
    [html, "id=\"addCodexButton\"", "guided Codex CLI discovery action"],
    [html, "id=\"discoveryPaths\"", "user-provided CLI discovery input"],
    [html, "id=\"discoveryEndpoints\"", "user-provided HTTP discovery input"],
    [html, "id=\"candidateList\"", "agent discovery candidates"],
    [html, "id=\"integrationIntent\"", "unsupported agent intent intake"],
    [html, "id=\"createIntegrationButton\"", "integration artifact draft action"],
    [html, "id=\"builderDraftButton\"", "integration builder platform draft action"],
    [html, "id=\"generateIntegrationButton\"", "integration artifact generation action"],
    [html, "id=\"artifactList\"", "integration artifact review list"],
    [html, "id=\"quotaSummary\"", "integration quota summary"],
    [html, "id=\"retentionSummary\"", "integration retention summary"],
    [html, "id=\"taskPreview\"", "task preview"],
    [html, "id=\"executionPreview\"", "execution preview"],
    [html, "id=\"sessionMode\"", "session mode detail"],
    [html, "id=\"managedSessionHistoryContext\"", "managed Codex session history context"],
    [html, "data-session-filter=\"needs_approval\"", "managed session approval filter"],
    [html, "id=\"managedSessionDetail\"", "managed session detail panel"],
    [html, "id=\"managedSessionDetailWorktree\"", "managed session worktree detail"],
    [html, "id=\"managedSessionDetailDirty\"", "managed session dirty state detail"],
    [html, "id=\"managedSessionDetailContinue\"", "managed session continuation guidance"],
    [html, "id=\"managedChangeReviewPanel\"", "managed change review panel"],
    [html, "id=\"managedChangeList\"", "managed change list"],
    [html, "id=\"managedChangeDiff\"", "managed diff preview"],
    [html, "id=\"managedChangeReviewComment\"", "managed change reviewer comment"],
    [html, "id=\"approveChangeButton\"", "managed change approval action"],
    [html, "id=\"rejectChangeButton\"", "managed change rejection action"],
    [html, "id=\"feedbackChangeButton\"", "managed change feedback action"],
    [html, "id=\"approvalAttentionSummary\"", "approval needs-attention summary"],
    [html, "id=\"approvalQueueList\"", "approval queue list"],
    [html, "id=\"terminalSurfaceContext\"", "managed terminal surface"],
    [html, "id=\"terminalRuntimeStatus\"", "terminal runtime status"],
    [html, "id=\"terminalSessionSummary\"", "terminal session summary"],
    [html, "id=\"terminalCodexSummary\"", "terminal Codex session summary"],
    [html, "id=\"terminalEvidenceSummary\"", "terminal evidence summary"],
    [html, "id=\"terminalSshSummary\"", "terminal SSH summary"],
    [html, "id=\"createTerminalSessionButton\"", "terminal runtime check action"],
    [html, "id=\"resizeTerminalButton\"", "terminal resize action"],
    [html, "id=\"terminalOutputPreview\"", "terminal output renderer"],
    [html, "/vendor/xterm/css/xterm.css", "xterm stylesheet"],
    [html, "id=\"evidenceCenterContext\"", "evidence center context"],
    [html, "id=\"evidenceTypeFilter\"", "evidence type filter"],
    [html, "id=\"evidenceSourceFilter\"", "evidence source filter"],
    [html, "id=\"evidenceRedactionFilter\"", "evidence redaction filter"],
    [html, "id=\"evidenceAgentFilter\"", "evidence agent filter"],
    [html, "id=\"evidenceSessionFilter\"", "evidence session filter"],
    [html, "id=\"evidenceInvocationFilter\"", "evidence invocation filter"],
    [html, "id=\"evidenceRepoFilter\"", "evidence repo filter"],
    [html, "id=\"evidenceCenterList\"", "evidence center list"],
    [html, "id=\"evidenceDetailBody\"", "evidence detail body"],
    [html, "id=\"exportEvidenceSummaryButton\"", "evidence export summary action"],
    [html, "id=\"approvalPanel\"", "local approval panel"],
    [html, "id=\"approveButton\"", "local approval approve action"],
    [html, "id=\"denyButton\"", "local approval deny action"],
    [html, "Safety", "safety review"],
    [html, "Data", "data review"],
    [html, "Cost", "cost review"],
    [html, "Cancellation", "cancellation review"],
    [html, "Technical details", "collapsed technical details"],
    [html, "id=\"eventList\"", "activity timeline"],
    [html, "Result", "result panel"],
    [html, "Audit", "audit panel"],
    [css, "@media (max-width: 760px)", "mobile layout guard"],
    [css, "overflow-wrap: anywhere", "long text overflow guard"],
    [css, ".select-value", "visible select value overlay"],
    [css, ".codex-chat-shell", "Codex conversation shell styling"],
    [css, ".chat-composer", "chat composer styling"],
    [css, ".composer-card", "Codex-style composer card styling"],
    [css, ".attachment-chip", "attachment chip styling"],
    [css, ".send-button", "Codex-style send action styling"],
    [css, ".composer-popover", "composer popover styling"],
    [css, ".permission-popover", "permission popover styling"],
    [css, ".inline-approval-actions", "inline approval action styling"],
    [js, "readableStatus", "plain-language state mapper"],
    [js, "loopRoutines", "routine read model state"],
    [js, "/api/loop-routines", "dedicated routine read model API"],
    [js, "renderRoutineRunDetail", "routine run detail renderer"],
    [js, "routineRunCommands", "routine run command list"],
    [js, "pnpm ai:loop-routine-show", "routine read-only inspection command"],
    [js, "readableEventType", "plain-language event mapper"],
    [js, "submitTaskFromComposer", "chat composer submit handler"],
    [js, "selectedPermissionMode", "composer permission mode state"],
    [js, "selectedReasoningMode", "composer reasoning mode state"],
    [js, "composerMetadata", "composer metadata payload"],
    [js, "attachmentBoundary", "composer attachment boundary metadata"],
    [js, "Composer image attachment", "composer image boundary prompt"],
    [js, "ingestFiles", "composer file ingestion"],
    [js, "buildTaskWithAttachments", "attachment task context builder"],
    [js, "Codex --image", "execution preview attachment renderer"],
    [js, "timelineRole", "conversation timeline role mapper"],
    [js, "codexApprovalActions", "inline Codex approval action renderer"],
    [js, "command_timeout", "Codex command timeout note renderer"],
    [js, "execution_preview", "execution preview event renderer"],
    [js, "sessionModeText", "session mode renderer"],
    [js, "latestExecutionPreview", "execution preview state lookup"],
    [js, "readableHealth", "plain-language health mapper"],
    [js, "readableHealthLabel", "agent list health label"],
    [js, "renderDiscovery", "conservative discovery renderer"],
    [js, "renderAgentChoices", "scannable agent selection renderer"],
    [js, "codexAgentInState", "default Codex agent lookup"],
    [js, "const previous = selectedAgentId || els.agentSelect.value", "agent card selection wins over stale native select value"],
    [js, "codexCandidateReview", "Codex candidate risk review renderer"],
    [js, "createDiscovery", "shared discovery API action"],
    [js, "resolveApiBase", "localhost-only API override for local visual QA"],
    [js, "renderIntegrationArtifacts", "integration artifact renderer"],
    [js, "/api/integration-artifacts", "integration artifact API action"],
    [js, "/api/integration-builder/draft", "integration builder platform agent API action"],
    [js, "integrationPayload", "unsupported agent structured intake"],
    [js, "selectedIntegrationArtifact", "integration artifact selection state"],
    [js, "quotaSummary", "quota decision display"],
    [js, "retentionSummary", "retention display"],
    [js, "renderApproval", "local approval renderer"],
    [js, "currentApproval", "local approval state lookup"],
    [js, "/api/approvals/", "local approval API action"],
    [js, "renderTroubleshooter", "invocation troubleshooter renderer"],
    [js, "agentUsageSummaries", "agent usage state"],
    [js, "/troubleshoot", "invocation troubleshooter API action"],
    [js, "costOwnerText", "cost owner display"],
    [js, "readableDiscoverySource", "plain-language discovery source"],
    [js, "readableAdapterType", "plain-language candidate adapter type"],
    [js, "runBlockReason", "run blocked explanation"],
    [js, "registrationNotes", "agent review notes"],
    [js, "selectedAgentId", "agent selection state"]
    ,
    [js, "renderManagedSessionHistory", "managed session history renderer"],
    [js, "sessionMatchesHistoryFilter", "managed session history filters"],
    [js, "managedSessionSummary", "managed session summary aggregation"],
    [js, "selectedManagedSessionId", "managed session detail selection"],
    [js, "managedWorkspaceForSession", "managed workspace lookup"],
    [js, "codexWorkspacePolicy", "Codex workspace policy option"],
    [js, "/api/compare-runs", "compare run API action"],
    [js, "renderComparePanel", "compare result renderer"],
    [js, "selectedCompareAgentIds", "compare agent selection state"],
    [js, "renderManagedChangeReview", "managed change review renderer"],
    [js, "/api/codex/change-reviews", "managed change review API action"],
    [js, "selectedManagedChangeEvidenceId", "managed change selection state"],
    [js, "renderApprovalQueue", "approval queue renderer"],
    [js, "codexApprovalQueue", "approval queue public state"],
    [js, "renderEvidenceCenter", "evidence center renderer"],
    [js, "renderTerminalSurface", "terminal surface renderer"],
    [js, "new Terminal", "xterm terminal emulator"],
    [js, "terminal.onData", "xterm direct input bridge"],
    [js, "/api/terminal/sessions", "terminal session registry API action"],
    [js, "/input", "terminal input API action"],
    [js, "/resize", "terminal resize API action"],
    [js, "terminalRuntimeCapability", "terminal runtime capability state"],
    [js, "terminalEvidenceRecords", "terminal evidence state"],
    [js, "ownerCodexSessionId", "terminal Codex session linkage"],
    [js, "latestCodexSession", "latest Codex session terminal helper"],
    [js, "renderSshTargets", "SSH target setup renderer"],
    [js, "/api/ssh-targets", "SSH target registry API action"],
    [js, "remoteRelayEnabled", "SSH remote relay disabled state"],
    [html, "id=\"sshTargetHost\"", "SSH host setup field"],
    [html, "id=\"sshTargetCredentialRef\"", "SSH credential reference field"],
    [html, "id=\"sshTargetKnownHostPolicy\"", "SSH known host policy field"],
    [html, "id=\"sshTargetTestReport\"", "SSH preflight report"],
    [js, "evidenceCenterRecords", "evidence center public state"],
    [js, "renderEvidenceFilterOptions", "evidence center dynamic filters"],
    [js, "codexSessionRegistryId", "evidence session filter field"],
    [js, "invocationId", "evidence invocation filter field"],
    [js, "repoPath", "evidence repo filter field"],
    [js, "imported_after_the_fact", "imported evidence marker"],
    [css, ".diff-preview", "managed diff preview styling"],
    [css, ".approval-queue-item", "approval queue styling"],
    [css, ".evidence-record-item", "evidence center styling"],
    [productFlows, "ordinary developer", "ordinary developer product flow"],
    [productFlows, "advanced developer", "advanced developer product flow"],
    [productFlows, "team administrator", "team administrator product flow"],
    [productFlows, "auditor", "auditor product flow"],
    [productFlows, "Usability test tasks", "role-based usability tasks"],
    [productFlows, "What not to show", "role-based exclusion rules"]
  ];

  const failed = expectations
    .filter(([content, needle]) => !content.includes(needle))
    .map(([, , label]) => label);

  if (failed.length > 0) {
    console.error(`[web:check] missing UX/visual QA expectations: ${failed.join(", ")}`);
    process.exit(1);
  }

  const commandPanel = htmlBetween(html, '<section id="commandPanel" class="command-panel codex-chat-shell"', '<section id="runPanel" class="run-panel"');
  const workspaceNav = htmlBetween(html, '<aside class="workspace-nav"', "</aside>");
  const contextPanel = htmlBetween(html, '<aside class="context-panel"', "</aside>");
  const misplacedCommandPanelMarkers = [
    ["mode-tabs", "advanced navigation"],
    ["connectAgentPanel", "connect agent management panel"],
    ["sshTargetHost", "SSH setup field"],
    ["Evidence center", "evidence center management action"],
    ["Import evidence", "import evidence management action"],
    ["Managed sessions", "managed session history"]
  ].filter(([marker]) => commandPanel.includes(marker));
  const missingWorkspaceSurfaceMarkers = [
    ["data-workspace-mode=\"run_task\"", "Run workspace surface"],
    ["data-workspace-mode=\"session\"", "Session workspace surface"],
    ["data-workspace-mode=\"diff\"", "Diff workspace surface"],
    ["data-workspace-mode=\"terminal\"", "Terminal workspace surface"],
    ["data-workspace-mode=\"evidence_center\"", "Evidence workspace surface"],
    ["data-workspace-mode=\"approval\"", "Approval workspace surface"],
    ["data-workspace-mode=\"setup\"", "Setup workspace surface"],
    ["data-workspace-mode=\"import_session\"", "Import evidence workspace surface"]
  ].filter(([marker]) => !workspaceNav.includes(marker));
  const missingContextPanelMarkers = [
    ["connectAgentPanel", "setup-owned connect agent panel"],
    ["SSH target", "setup-owned SSH target panel"],
    ["Evidence center", "evidence-owned center"],
    ["Import evidence", "evidence-owned import boundary"],
    ["Managed sessions", "session-owned history"],
    ["Managed terminal", "terminal-owned runtime surface"]
  ].filter(([marker]) => !contextPanel.includes(marker));

  if (misplacedCommandPanelMarkers.length > 0 || missingWorkspaceSurfaceMarkers.length > 0 || missingContextPanelMarkers.length > 0) {
    const misplaced = misplacedCommandPanelMarkers.map(([, label]) => label);
    const missingSurface = missingWorkspaceSurfaceMarkers.map(([, label]) => label);
    const missing = missingContextPanelMarkers.map(([, label]) => label);
    console.error(`[web:check] IA ownership violations: ${[
      misplaced.length ? `task composer contains ${misplaced.join(", ")}` : null,
      missingSurface.length ? `workspace nav missing ${missingSurface.join(", ")}` : null,
      missing.length ? `context rail missing ${missing.join(", ")}` : null
    ].filter(Boolean).join("; ")}`);
    process.exit(1);
  }

  const forbiddenPrivateCodexReads = ["auth.json", ".codex/sessions", ".codex\\\\sessions"];
  const privateReadHits = forbiddenPrivateCodexReads.filter((marker) => js.includes(marker) || html.includes(marker));
  if (privateReadHits.length > 0) {
    console.error(`[web:check] private Codex session/auth reads must not be part of Web Console IA: ${privateReadHits.join(", ")}`);
    process.exit(1);
  }

  console.log("[web:check] local demo web console check OK");
  process.exit(0);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${host}:${port}`);
  const vendorPath = resolveVendorPath(url.pathname);
  if (vendorPath) {
    res.writeHead(200, {
      "Content-Type": contentType(vendorPath),
      "Cache-Control": "no-store"
    });
    createReadStream(vendorPath).pipe(res);
    return;
  }

  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = pathname.replace(/^\/+/, "");
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  res.writeHead(200, {
    "Content-Type": contentType(filePath),
    "Cache-Control": "no-store"
  });
  createReadStream(filePath).pipe(res);
});

function resolveVendorPath(pathname) {
  for (const [prefix, root] of Object.entries(vendorRoots)) {
    if (!pathname.startsWith(prefix)) continue;
    const relativePath = pathname.slice(prefix.length);
    if (!/^(?:lib|css)\//.test(relativePath)) return null;
    const filePath = normalize(join(root, relativePath));
    if (!filePath.startsWith(root) || !existsSync(filePath)) return null;
    return filePath;
  }
  return null;
}

server.listen(port, host, () => {
  console.log(`[web] http://${host}:${port}`);
});

function contentType(filePath) {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function htmlBetween(html, start, end) {
  const startIndex = html.indexOf(start);
  if (startIndex < 0) {
    return "";
  }
  const endIndex = html.indexOf(end, startIndex + start.length);
  if (endIndex < 0) {
    return html.slice(startIndex);
  }
  return html.slice(startIndex, endIndex);
}
