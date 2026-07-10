import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createLocalExecutionPolicyManifest } from "../../apps/desktop/src/local-execution-policy.mjs";
import { runMcpInvocation } from "../../apps/desktop/src/mcp-invocation-runner.mjs";
import { createServerRuntimeServices } from "../../apps/server/src/runtime/service-composer.mjs";
import { createServerState } from "../../apps/server/src/runtime/state-factory.mjs";

const now = () => "2026-07-08T02:00:00.000Z";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const defaultDoocsPath = resolve(repoRoot, "doocs-md");
const doocsPath = resolve(process.argv[2] ?? process.env.DOOCS_MD_PATH ?? defaultDoocsPath);
const tempRoot = mkdtempSync(join(tmpdir(), "myagenttool-doocs-md-e2e-"));
const actor = { userId: "usr_local", teamId: "team_local" };
let passed = 0;

const ok = (message) => {
  passed += 1;
  console.log(`  ok - ${message}`);
};

try {
  assert(existsSync(doocsPath), `doocs/md checkout not found: ${doocsPath}`);
  assert(existsSync(join(doocsPath, ".vscode", "mcp.json")), "doocs/md .vscode/mcp.json should exist");
  assert(existsSync(join(doocsPath, "packages", "mcp-server", "src", "index.ts")), "doocs/md MCP source should exist");

  const stateStorePath = join(tempRoot, "state", "doocs-md-state.json");
  const runtime = createRuntime({ defaultProjectPath: repoRoot, stateStorePath, persistenceEnabled: true });
  const api = runtime.api;

  const registered = api.registerApplication({
    id: "app_doocs_md_rehearsal",
    name: "doocs/md",
    source: { type: "local", path: doocsPath },
    integrationBrief: {
      intendedUsers: "Operators who want to render and inspect WeChat-ready Markdown through doocs/md MCP.",
      problem: "Register a local doocs/md checkout as a governed Application and expose its MCP tools without leaking local startup details.",
      successCriteria: [
        "MCP config is detected from the local checkout.",
        "Shared tools are registered under a stable namespace.",
        "Public read models redact command, argv, cwd, and token-like details.",
      ],
      fixedCommands: ["render_markdown", "list_themes"],
      knownRisks: ["local_stdio_process", "markdown_rendering"],
    },
  }, actor);

  assert.equal(registered.id, "app_doocs_md_rehearsal");
  assert.equal(registered.status, "active");
  assert.equal(registered.lifecycle?.state, "registered");
  assert(registered.projectId, "local Application registration should create a project link");
  assert.equal(registered.mcpAgent, null);
  ok("registered doocs/md local Application with integration brief");

  const probed = api.probeApplication(registered.id, actor);
  assert.equal(probed.probe?.status, "completed");
  assert.equal(probed.probe?.package?.name, "md");
  assert.equal(probed.probe?.mcpServers?.length >= 1, true);
  const candidate = probed.probe.mcpServers.find((item) => item.serverName === "md" && item.transport === "stdio");
  assert(candidate, "expected stdio MCP candidate named md");
  assert.equal(candidate.source, "mcp_config");
  assert.equal(candidate.sourcePath, ".vscode/mcp.json");
  assert.equal(candidate.autoRegister, true);
  assert.equal(candidate.autoRegisterReason, "node_entrypoint_inside_application_root");
  assert.equal(candidate.review?.dataBoundary, "local_stdio_process");
  assert.equal(candidate.review?.filePolicy, "read_only");
  assert.equal(candidate.review?.networkPolicy, "forbidden");
  assert(candidate.allowedTools.includes("render_markdown"), "render_markdown should be detected");
  assert(candidate.allowedTools.includes("list_themes"), "list_themes should be detected");
  assert(candidate.allowedTools.includes("get_renderer_options"), "get_renderer_options should be detected");
  assert.equal(probed.probe.autoRegisteredMcpAgentId, "agt_app_doocs_md_rehearsal_mcp");
  ok(`probed real doocs/md MCP config and detected ${candidate.allowedTools.length} tool(s)`);

  assert(probed.mcpAgent, "probe should auto-adopt the trusted stdio MCP candidate");
  assert.equal(probed.mcpAgent.agentId, "agt_app_doocs_md_rehearsal_mcp");
  assert.equal(probed.mcpAgent.toolNamespace, "doocs_md");
  assert.equal(probed.mcpAgent.discovery?.autoRegistered, true);
  assert.equal(probed.mcpAgent.adapter?.transport, "stdio");
  assert.equal(probed.mcpAgent.adapter?.filePolicy, "read_only");
  assert.equal(probed.mcpAgent.adapter?.networkPolicy, "forbidden");
  assert(probed.mcpAgent.allowedTools.includes("render_markdown"));
  assert(probed.mcpAgent.allowedTools.includes("list_themes"));
  assert(probed.mcpAgent.sharedToolNames.includes("doocs_md.render_markdown"));
  assert(probed.mcpAgent.sharedToolNames.includes("doocs_md.list_themes"));
  ok("auto-registered MCP agent and shared tool names");

  const capabilityNames = api.listApplicationCapabilities(probed.id).map((capability) => capability.name);
  assert(capabilityNames.includes("app.app_doocs_md_rehearsal.inspect"));
  assert(capabilityNames.includes("app.app_doocs_md_rehearsal.generate_orchestration"));
  assert(capabilityNames.includes("doocs_md.render_markdown"));
  assert(capabilityNames.includes("doocs_md.list_themes"));
  ok("managed lifecycle and MCP Application capabilities are present");

  const renderTool = api.getTool("doocs_md.render_markdown", actor);
  assert(renderTool, "render_markdown tool should be visible");
  assert.equal(renderTool.source, "mcp_agent");
  assert.equal(renderTool.mcp?.agentId, "agt_app_doocs_md_rehearsal_mcp");
  assert.equal(renderTool.mcp?.toolName, "render_markdown");
  const listThemesTool = api.getTool("doocs_md.list_themes", actor);
  assert(listThemesTool, "list_themes tool should be visible");
  assert.equal(listThemesTool.outputCollection, "applicationResultArtifacts");
  const rendererOptionsTool = api.getTool("doocs_md.get_renderer_options", actor);
  assert(rendererOptionsTool, "get_renderer_options tool should be visible");
  assert.equal(rendererOptionsTool.outputCollection, "applicationResultArtifacts");
  ok("shared MCP tools are visible in the governed tool registry");

  const invocation = api.createToolInvocation("doocs_md.render_markdown", {
    projectId: probed.projectId,
    markdown: "# doocs/md rehearsal\n\nThis invocation validates the governed MCP dispatch contract.",
    theme: "default",
  }, actor);
  assert.equal(invocation.status, 201);
  assert.equal(invocation.body.tool, "doocs_md.render_markdown");
  assert.equal(invocation.body.agentId, "agt_app_doocs_md_rehearsal_mcp");
  assert.equal(invocation.body.invocation.options?.toolName, "render_markdown");
  assert.deepEqual(invocation.body.invocation.options?.toolArguments, {
    markdown: "# doocs/md rehearsal\n\nThis invocation validates the governed MCP dispatch contract.",
    theme: "default",
  });
  assert.equal(invocation.body.invocation.options?.metadata?.applicationId, probed.id);
  assert.equal(invocation.body.invocation.options?.metadata?.providerType, "mcp");
  ok("created governed render_markdown invocation with scoped tool arguments");

  const renderInvocation = api.findInvocation(invocation.body.invocationId);
  assert(renderInvocation, "render invocation should exist before bridge execution");
  const renderAgent = api.findAgent(renderInvocation.agentId);
  assert.equal(renderAgent?.adapter?.type, "mcp");
  const timeoutMs = Number(process.env.DOOCS_MD_MCP_TIMEOUT_MS ?? 180_000);
  renderAgent.adapter.timeoutMs = Number.isFinite(timeoutMs) ? timeoutMs : 180_000;
  renderAgent.adapter.startupTimeoutMs = Number.isFinite(timeoutMs) ? timeoutMs : 180_000;
  api.markDispatched(renderInvocation);
  api.acknowledgeInvocation(renderInvocation);
  await runMcpInvocation({
    namespace: "doocs-md-rehearsal",
    protocolVersion: "0.0.0",
    invocationId: renderInvocation.id,
    agentId: renderInvocation.agentId,
    adapter: renderAgent.adapter,
    input: renderInvocation.input,
    options: renderInvocation.options,
    project: api.projectForInvocation(renderInvocation),
  }, {
    request: bridgeRequest(api),
    manifest: createLocalExecutionPolicyManifest(),
  });
  assert.equal(renderInvocation.status, "succeeded");
  assert.equal(renderInvocation.result?.touchedUserFiles, false);
  assert.equal(renderInvocation.options?.metadata?.outputCollection, "applicationRenderResults");
  assert.equal(renderInvocation.result?.renderMarkdown?.resultRef?.type, "application_render_result");
  assert.equal(JSON.stringify(renderInvocation.result).includes("<html"), false);
  const renderResultRef = renderInvocation.result.renderMarkdown.resultRef;
  const privateRender = api.getApplicationRenderResult(probed.id, renderResultRef.id);
  assert(privateRender?.html, "private render result should retain full HTML");
  assert.equal(privateRender.htmlHash?.length, 64);
  assert.equal(privateRender.markdownHash?.length, 64);
  assert(privateRender.htmlByteLength > 0, "private render result should record HTML byte length");
  let newestRenderResultRef = renderResultRef;
  ok("bridge executed real MCP render_markdown and imported render result");

  const blockedInvocation = api.createToolInvocation("doocs_md.not_declared", {
    projectId: probed.projectId,
    toolArguments: {},
  }, actor);
  assert.equal(blockedInvocation.status, 404);
  assert.equal(blockedInvocation.body.error, "tool_not_found");
  ok("blocked undeclared MCP tool lookup");

  const publicState = api.publicState(actor);
  const publicApp = publicState.applications.find((item) => item.id === probed.id);
  assert(publicApp, "public read model should include doocs/md app");
  assert.equal(publicApp.mcpAgent?.agentId, "agt_app_doocs_md_rehearsal_mcp");
  assert.equal(publicApp.mcpAgent?.adapter, undefined);
  const publicSnapshot = JSON.stringify({
    app: publicApp,
    tools: publicState.tools?.filter?.((tool) => tool.name?.startsWith?.("doocs_md.")) ?? [],
  });
  assert.equal(publicSnapshot.includes("run.mjs"), false);
  assert.equal(publicSnapshot.includes("--import"), false);
  assert.equal(publicSnapshot.includes("tsx/esm"), false);
  assert.equal(publicSnapshot.includes("packages\\\\mcp-server"), false);
  assert.equal(publicSnapshot.includes("packages/mcp-server"), false);
  ok("public read model redacts local adapter command, argv, and cwd details");

  const publicRender = publicState.applicationRenderResults.find((item) => item.id === renderResultRef.id);
  assert(publicRender, "public state should include render result summary");
  assert.equal(publicRender.html, undefined);
  assert.equal(publicRender.resultRef?.id, renderResultRef.id);
  assert(publicApp.latestResult?.resultRef?.id === renderResultRef.id, "Application latest result should point to render result");
  assert.equal(publicApp.latestResult?.outputCollection, "applicationRenderResults");
  const renderEvidence = publicState.evidenceCenterRecords.find((item) =>
    item.source === "application_render_result" && String(item.detail ?? "").includes(`resultRef=${renderResultRef.id}`));
  assert(renderEvidence, "Evidence Center should expose a rendered markdown record");
  ok("public Application and Evidence Center can replay the latest render result reference");

  const evidenceDraft = buildEvidenceDraft({
    application: publicApp,
    candidate,
    renderTool,
    invocation: { ...invocation.body, status: renderInvocation.status, invocation: renderInvocation },
    renderResult: publicRender,
    renderEvidence,
  });
  assert.equal(evidenceDraft.applicationId, probed.id);
  assert.equal(evidenceDraft.checks.every((check) => check.status === "passed"), true);
  assert(evidenceDraft.sharedTools.includes("doocs_md.render_markdown"));
  ok("generated local smoke evidence draft shape");

  const governedEvidenceResult = api.recordApplicationSmokeEvidence(probed.id, {
    repoPath: doocsPath,
    summary: `doocs/md MCP rehearsal passed ${evidenceDraft.checks.length} checks and imported ${renderResultRef.id}.`,
    descriptorOperationAt: publicApp.lifecycle?.lastOperationAt ?? null,
    steps: evidenceDraft.checks.map((check, index) => ({
      index: index + 1,
      step: check.name,
      completed: check.status === "passed",
      note: check.detail ?? null,
    })),
  }, actor);
  assert.equal(governedEvidenceResult.status, 201);
  const governedEvidence = governedEvidenceResult.evidence;
  assert.equal(governedEvidence.source, "application_smoke_evidence");
  assert.equal(governedEvidence.status, "recorded");
  assert.equal(governedEvidence.repoPath, doocsPath);
  const governedEvidenceRecord = api.publicState(actor).evidenceCenterRecords.find((item) =>
    item.id === governedEvidence.id && item.source === "application_smoke_evidence");
  assert(governedEvidenceRecord, "Evidence Center should include saved governed smoke evidence");
  ok("saved governed smoke evidence record");

  const listThemesInvocation = api.createToolInvocation("doocs_md.list_themes", {
    projectId: probed.projectId,
  }, actor);
  assert.equal(listThemesInvocation.status, 201);
  assert.equal(listThemesInvocation.body.invocation.options?.toolName, "list_themes");
  assert.deepEqual(listThemesInvocation.body.invocation.options?.toolArguments, {});
  const listThemesRun = api.findInvocation(listThemesInvocation.body.invocationId);
  assert(listThemesRun, "list_themes invocation should exist before bridge execution");
  api.markDispatched(listThemesRun);
  api.acknowledgeInvocation(listThemesRun);
  await runMcpInvocation({
    namespace: "doocs-md-rehearsal",
    protocolVersion: "0.0.0",
    invocationId: listThemesRun.id,
    agentId: listThemesRun.agentId,
    adapter: renderAgent.adapter,
    input: listThemesRun.input,
    options: listThemesRun.options,
    project: api.projectForInvocation(listThemesRun),
  }, {
    request: bridgeRequest(api),
    manifest: createLocalExecutionPolicyManifest(),
  });
  assert.equal(listThemesRun.status, "succeeded", listThemesRun.result?.summary ?? JSON.stringify(listThemesRun.result));
  assert.equal(listThemesRun.options?.metadata?.mcpToolName, "list_themes");
  assert.equal(listThemesRun.options?.metadata?.outputCollection, "applicationResultArtifacts");
  assert.equal(listThemesRun.result?.applicationArtifact?.resultRef?.type, "application_result_artifact");
  const listThemesArtifactRef = listThemesRun.result.applicationArtifact.resultRef;
  const listThemesArtifact = api.getApplicationResultArtifact(probed.id, listThemesArtifactRef.id);
  assert(listThemesArtifact?.payload?.themes?.length > 0, "list_themes artifact should retain private payload");
  assert.equal(listThemesArtifact.dataShape?.catalogKey, "themes");
  const listThemesPublicState = api.publicState(actor);
  assert(listThemesPublicState.applicationResultArtifacts.some((item) =>
    item.id === listThemesArtifactRef.id && item.resultRef?.type === "application_result_artifact"));
  assert(listThemesPublicState.evidenceCenterRecords.some((item) =>
    item.source === "application_result_artifact" && String(item.detail ?? "").includes(`resultRef=${listThemesArtifactRef.id}`)));
  assert.match(String(listThemesRun.result?.output ?? ""), /theme/i);
  ok("schema-style no-argument MCP tool list_themes executes and imports an option catalog artifact");

  const rendererOptionsInvocation = api.createToolInvocation("doocs_md.get_renderer_options", {
    projectId: probed.projectId,
  }, actor);
  assert.equal(rendererOptionsInvocation.status, 201);
  assert.equal(rendererOptionsInvocation.body.invocation.options?.toolName, "get_renderer_options");
  assert.deepEqual(rendererOptionsInvocation.body.invocation.options?.toolArguments, {});
  const rendererOptionsRun = api.findInvocation(rendererOptionsInvocation.body.invocationId);
  assert(rendererOptionsRun, "get_renderer_options invocation should exist before bridge execution");
  api.markDispatched(rendererOptionsRun);
  api.acknowledgeInvocation(rendererOptionsRun);
  await runMcpInvocation({
    namespace: "doocs-md-rehearsal",
    protocolVersion: "0.0.0",
    invocationId: rendererOptionsRun.id,
    agentId: rendererOptionsRun.agentId,
    adapter: renderAgent.adapter,
    input: rendererOptionsRun.input,
    options: rendererOptionsRun.options,
    project: api.projectForInvocation(rendererOptionsRun),
  }, {
    request: bridgeRequest(api),
    manifest: createLocalExecutionPolicyManifest(),
  });
  assert.equal(rendererOptionsRun.status, "succeeded", rendererOptionsRun.result?.summary ?? JSON.stringify(rendererOptionsRun.result));
  assert.equal(rendererOptionsRun.options?.metadata?.mcpToolName, "get_renderer_options");
  assert.equal(rendererOptionsRun.options?.metadata?.outputCollection, "applicationResultArtifacts");
  assert.equal(rendererOptionsRun.result?.applicationArtifact?.artifactType, "json_summary");
  const rendererOptionsArtifactRef = rendererOptionsRun.result.applicationArtifact.resultRef;
  const rendererOptionsArtifact = api.getApplicationResultArtifact(probed.id, rendererOptionsArtifactRef.id);
  assert(rendererOptionsArtifact?.payload?.options?.length > 0, "get_renderer_options artifact should retain private payload");
  assert.equal(rendererOptionsArtifact.dataShape?.catalogKey, "options");
  assert.equal(api.findApplication(probed.id)?.latestResult?.resultRef?.id, rendererOptionsArtifactRef.id);
  ok("get_renderer_options imports a JSON summary artifact and updates latest result");

  const secondInvocation = api.createToolInvocation("doocs_md.render_markdown", {
    projectId: probed.projectId,
    markdown: "# doocs/md second rehearsal\n\nThis invocation validates recent render result replay.",
    theme: "default",
  }, actor);
  assert.equal(secondInvocation.status, 201);
  const secondRenderInvocation = api.findInvocation(secondInvocation.body.invocationId);
  assert(secondRenderInvocation, "second render invocation should exist before bridge execution");
  api.markDispatched(secondRenderInvocation);
  api.acknowledgeInvocation(secondRenderInvocation);
  await runMcpInvocation({
    namespace: "doocs-md-rehearsal",
    protocolVersion: "0.0.0",
    invocationId: secondRenderInvocation.id,
    agentId: secondRenderInvocation.agentId,
    adapter: renderAgent.adapter,
    input: secondRenderInvocation.input,
    options: secondRenderInvocation.options,
    project: api.projectForInvocation(secondRenderInvocation),
  }, {
    request: bridgeRequest(api),
    manifest: createLocalExecutionPolicyManifest(),
  });
  assert.equal(
    secondRenderInvocation.status,
    "succeeded",
    secondRenderInvocation.result?.error ?? secondRenderInvocation.result?.summary ?? JSON.stringify(secondRenderInvocation.result),
  );
  const secondRenderResultRef = secondRenderInvocation.result.renderMarkdown.resultRef;
  const recentResults = api.listApplicationRenderResults(probed.id, { toolName: "render_markdown", limit: "5" });
  assert(recentResults.length >= 2, "recent results should include multiple render artifacts");
  assert.equal(recentResults[0].id, secondRenderResultRef.id);
  assert(recentResults.some((item) => item.id === renderResultRef.id));
  assert.equal(api.findApplication(probed.id)?.latestResult?.resultRef?.id, secondRenderResultRef.id);
  newestRenderResultRef = secondRenderResultRef;
  ok("second real MCP render is listed as the latest replayable Application result");

  const retentionApp = api.updateApplicationResultRetention(probed.id, { enabled: true, keepLatest: 1 }, actor);
  assert.equal(retentionApp?.resultRetention?.enabled, true);
  const retentionRun = api.runApplicationResultRetention(probed.id, actor, { reason: "smoke" });
  assert.equal(retentionRun.status, 200);
  assert(retentionRun.body.summary.archivedCount >= 3, "retention should archive superseded render/artifact results");
  assert(retentionRun.body.summary.archivedResultIds.includes(renderResultRef.id));
  assert.equal(api.getApplicationRenderResult(probed.id, renderResultRef.id)?.governance?.archived, true);
  const activeRenderResults = api.listApplicationRenderResults(probed.id, { toolName: "render_markdown", limit: "5" });
  assert.deepEqual(activeRenderResults.map((item) => item.id), [secondRenderResultRef.id]);
  ok("Result Center retention archives superseded Application results while preserving latest replay");

  runtime.savePersistentState();
  const restarted = createRuntime({
    defaultProjectPath: repoRoot,
    stateStorePath,
    persistenceEnabled: true,
  });
  const restoredApp = restarted.api.publicState(actor).applications.find((item) => item.id === probed.id);
  assert.equal(restoredApp?.probe?.status, "completed");
  assert.equal(restarted.api.getTool("doocs_md.render_markdown", actor)?.mcp?.agentId, "agt_app_doocs_md_rehearsal_mcp");
  assert.equal(restarted.api.getTool("doocs_md.list_themes", actor)?.mcp?.agentId, "agt_app_doocs_md_rehearsal_mcp");
  assert.equal(restoredApp?.latestResult?.resultRef?.id, newestRenderResultRef.id);
  assert.equal(restoredApp?.mcpAgent?.recovery?.reason, "latest_mcp_invocation_succeeded");
  assert((restoredApp?.resultRetention?.lastSummary?.archivedCount ?? 0) >= 3);
  assert(restarted.api.latestApplicationRenderResult(probed.id)?.id === newestRenderResultRef.id);
  assert(restarted.api.getApplicationResultArtifact(probed.id, listThemesArtifactRef.id)?.payload?.themes?.length > 0);
  assert(restarted.api.getApplicationResultArtifact(probed.id, rendererOptionsArtifactRef.id)?.payload?.options?.length > 0);
  assert(restarted.api.publicState(actor).evidenceCenterRecords.some((item) => item.id === governedEvidence.id));
  ok("restart restores probe evidence, MCP shared tools, latest result, imported artifacts, and saved evidence");

  console.log(`\ndoocs-md-application-rehearsal: ${passed} checks passed`);
  console.log(JSON.stringify(evidenceDraft, null, 2));
} finally {
  if (resolve(tempRoot).startsWith(resolve(tmpdir()))) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function createRuntime({ defaultProjectPath, stateStorePath, persistenceEnabled }) {
  const { defaultProject, state } = createServerState({ defaultProjectPath, now });
  const { httpDependencies, savePersistentState } = createServerRuntimeServices({
    namespace: "doocs-md-rehearsal",
    protocolVersion: "0.0.0",
    state,
    defaultProject,
    defaultProjectPath,
    persistenceEnabled,
    stateStorePath,
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });
  return { state, api: httpDependencies, savePersistentState };
}

function bridgeRequest(api) {
  return async function request(method, path, body = null) {
    if (method === "GET" && path.startsWith("/api/bridge/cancel-status")) {
      return { cancelRequested: false };
    }
    if (method === "POST" && path === "/api/bridge/events") {
      const invocation = api.findInvocation(body?.invocationId);
      assert(invocation, `bridge event invocation not found: ${body?.invocationId}`);
      api.appendEvent({
        invocationId: invocation.id,
        type: body.type ?? "log",
        level: body.level ?? "info",
        message: body.message ?? "",
        data: body.data,
      });
      return { ok: true };
    }
    if (method === "POST" && path === "/api/bridge/complete") {
      const invocation = api.findInvocation(body?.invocationId);
      assert(invocation, `bridge complete invocation not found: ${body?.invocationId}`);
      api.completeInvocation(invocation, body);
      return { ok: true, invocation };
    }
    throw new Error(`Unexpected bridge request in rehearsal: ${method} ${path}`);
  };
}

function buildEvidenceDraft({ application, candidate, renderTool, invocation, renderResult, renderEvidence }) {
  return {
    version: "application_smoke_evidence_draft.v1",
    generatedAt: now(),
    applicationId: application.id,
    applicationName: application.name,
    sourceType: application.source?.type ?? null,
    lifecycleState: application.lifecycle?.state ?? null,
    mcp: {
      candidateId: candidate.id,
      sourcePath: candidate.sourcePath,
      transport: candidate.transport,
      dataBoundary: candidate.review?.dataBoundary ?? null,
      filePolicy: candidate.review?.filePolicy ?? null,
      networkPolicy: candidate.review?.networkPolicy ?? null,
      autoRegisterReason: candidate.autoRegisterReason,
      allowedTools: candidate.allowedTools,
    },
    sharedTools: application.mcpAgent?.sharedToolNames ?? [],
    invocation: {
      tool: invocation.tool,
      invocationId: invocation.invocationId,
      agentId: invocation.agentId,
      status: invocation.invocation?.status ?? invocation.status,
      mcpToolName: invocation.invocation?.options?.toolName ?? renderTool?.mcp?.toolName ?? null,
    },
    renderResult: {
      resultRef: renderResult?.resultRef ?? null,
      htmlSummary: renderResult?.htmlSummary ?? null,
      htmlByteLength: renderResult?.htmlByteLength ?? null,
      markdownHash: renderResult?.markdownHash ?? null,
      evidenceRecordId: renderEvidence?.id ?? null,
    },
    checks: [
      { id: "registered", status: application.lifecycle?.state === "registered" ? "passed" : "failed" },
      { id: "probe_completed", status: application.probe?.status === "completed" ? "passed" : "failed" },
      { id: "mcp_auto_registered", status: application.mcpAgent?.agentId ? "passed" : "failed" },
      { id: "render_tool_visible", status: renderTool?.name === "doocs_md.render_markdown" ? "passed" : "failed" },
      { id: "dispatch_contract_created", status: invocation.invocationId && invocation.agentId ? "passed" : "failed" },
      { id: "bridge_execution_succeeded", status: application.latestResult?.status === "succeeded" ? "passed" : "failed" },
      { id: "render_result_imported", status: renderResult?.resultRef?.type === "application_render_result" ? "passed" : "failed" },
      { id: "evidence_center_render_recorded", status: renderEvidence?.source === "application_render_result" ? "passed" : "failed" },
      { id: "adapter_redacted", status: application.mcpAgent?.adapter === undefined ? "passed" : "failed" },
    ],
  };
}
