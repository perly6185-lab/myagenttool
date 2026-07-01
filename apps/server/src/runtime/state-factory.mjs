import { basename } from "node:path";
import {
  claudeCliArgs,
  claudeRegistrationNotes,
  claudeRiskTags,
  codexCliArgs,
  codexRegistrationNotes,
  codexRiskTags,
} from "../services/agents.mjs";
import { createProjectRecord } from "../services/projects.mjs";
import { createTerminalRuntimeCapability } from "../services/terminal.mjs";

const defaultAgentIds = [
  "agt_demo_cli",
  "agt_codex_cli",
  "agt_claude_acceptEdits",
  "agt_platform_troubleshooter",
  "agt_platform_integration_builder",
];
const envMaxConcurrency = Math.floor(Number(process.env.BRIDGE_MAX_CONCURRENT));
const defaultMaxConcurrency = Number.isFinite(envMaxConcurrency) && envMaxConcurrency > 0
  ? Math.min(16, envMaxConcurrency)
  : 3;

export function createServerState({ defaultProjectPath, now }) {
  const defaultProject = createProjectRecord({
    id: "prj_myagenttool",
    name: basename(defaultProjectPath) || "myagenttool",
    path: defaultProjectPath,
    source: "default"
  });
  const state = {
    device: createDefaultDevice(now),
    users: createDefaultUsers(now),
    teams: createDefaultTeams(now),
    tokens: [],
    projects: [defaultProject],
    currentProjectId: defaultProject.id,
    projectTargets: [createProjectTargetRecord(defaultProject, now)],
    worktrees: [],
    agents: createDefaultAgents(now),
    invocations: [],
    compareRuns: [],
    events: [],
    traces: [],
    spans: [],
    auditSummaries: [],
    healthChecks: [],
    lifecycleAuditRecords: [],
    lifecycleRecipes: [],
    lifecyclePolicyDecisions: [],
    lifecycleLocalApprovals: [],
    lifecycleQueuedActions: [],
    lifecycleRollbackRequests: [],
    privateCatalogEntries: [],
    signedBundleManifests: [],
    discoveryRuns: [],
    integrationArtifacts: [],
    integrationProbeRuns: [],
    quotaDecisionRecords: [],
    quotaPolicies: [],
    aiUsageRecords: [],
    ledgerEntries: [],
    budgets: [],
    automations: createDefaultAutomations(defaultProject.id, now),
    agentSkills: createDefaultAgentSkills(now),
    privateDeploymentConfig: createDefaultPrivateDeploymentConfig(now),
    auditExportRequests: [],
    retentionSettings: createDefaultRetentionSettings(now),
    approvalRequests: [],
    policyDecisionRecords: [],
    troubleshootingReports: [],
    agentUsageSummaries: [],
    codexSessions: [],
    codexWorkspaces: [],
    codexEvidenceRecords: [],
    codexChangeReviews: [],
    codexHookEvents: [],
    codexApprovalBrokerRequests: [],
    codexImportedEvidenceRecords: [],
    terminalRuntimeCapability: createTerminalRuntimeCapability(),
    terminalSessions: [],
    terminalEvidenceRecords: [],
    terminalBridgeActions: [],
    sshTargets: [],
    sshConnectionTests: []
  };
  return { defaultProject, state };
}

export function resetStateForSelfCheck({ state, now }) {
  state.device.status = "offline";
  state.device.unlinkState = "linked";
  state.device.credentialRevokedAt = null;
  state.device.maxConcurrency = defaultMaxConcurrency;
  state.tokens = [];
  state.agents = state.agents.filter((agent) => defaultAgentIds.includes(agent.id));
  const demoAgent = state.agents.find((agent) => agent.id === "agt_demo_cli") ?? null;
  if (demoAgent) {
    demoAgent.status = "unavailable";
    demoAgent.updatedAt = now();
  }
  const codexAgent = state.agents.find((agent) => agent.id === "agt_codex_cli") ?? null;
  if (codexAgent) {
    codexAgent.lifecycle = { ...codexAgent.lifecycle, state: "enabled" };
    codexAgent.status = "unavailable";
    codexAgent.health = {
      status: "unknown",
      checkedAt: null,
      message: "Codex CLI setup has not been checked yet.",
      nextAction: "Run a health check before the first Codex task."
    };
    codexAgent.updatedAt = now();
  }
  const claudeAgent = state.agents.find((agent) => agent.id === "agt_claude_acceptEdits") ?? null;
  if (claudeAgent) {
    claudeAgent.lifecycle = { ...claudeAgent.lifecycle, state: "enabled" };
    claudeAgent.status = "unavailable";
    claudeAgent.health = {
      status: "unknown",
      checkedAt: null,
      message: "Claude Code setup has not been checked yet.",
      nextAction: "Run a health check before the first Claude task."
    };
    claudeAgent.updatedAt = now();
  }
  state.invocations = [];
  state.events = [];
  state.traces = [];
  state.spans = [];
  state.auditSummaries = [];
  state.healthChecks = [];
  state.lifecycleAuditRecords = [];
  state.lifecycleRecipes = [];
  state.lifecyclePolicyDecisions = [];
  state.lifecycleLocalApprovals = [];
  state.lifecycleQueuedActions = [];
  state.lifecycleRollbackRequests = [];
  state.privateCatalogEntries = [];
  state.signedBundleManifests = [];
  state.discoveryRuns = [];
  state.integrationArtifacts = [];
  state.integrationProbeRuns = [];
  state.quotaDecisionRecords = [];
  state.quotaPolicies = [];
  state.aiUsageRecords = [];
  state.ledgerEntries = [];
  state.budgets = [];
  state.automations = createDefaultAutomations(state.currentProjectId ?? state.projects[0]?.id ?? "prj_myagenttool", now);
  state.privateDeploymentConfig = createDefaultPrivateDeploymentConfig(now);
  state.auditExportRequests = [];
  state.retentionSettings = {
    ...state.retentionSettings,
    logsDays: 14,
    promptsDays: 30,
    responsesDays: 30,
    artifactsDays: 90,
    updatedAt: now()
  };
  state.approvalRequests = [];
  state.policyDecisionRecords = [];
  state.troubleshootingReports = [];
  state.agentUsageSummaries = [];
  state.codexSessions = [];
  state.codexWorkspaces = [];
  state.codexEvidenceRecords = [];
  state.codexChangeReviews = [];
  state.codexHookEvents = [];
  state.codexApprovalBrokerRequests = [];
  state.codexImportedEvidenceRecords = [];
  state.terminalSessions = [];
  state.terminalEvidenceRecords = [];
  state.terminalBridgeActions = [];
  state.sshTargets = [];
  state.sshConnectionTests = [];
  state.terminalRuntimeCapability = createTerminalRuntimeCapability();
}

function createDefaultDevice(now) {
  return {
    id: "dev_local_001",
    ownerUserId: "usr_local",
    name: "Local Demo Device",
    platform: process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux",
    architecture: process.arch === "arm64" ? "arm64" : "x64",
    defaultShell: process.platform === "win32" ? "powershell" : "bash",
    pathFormat: process.platform === "win32" ? "windows" : "posix",
    bridgeVersion: "0.0.0",
    status: "offline",
    unlinkState: "linked",
    lastSeenAt: null,
    registeredCapabilities: [],
    credentialRevokedAt: null,
    maxConcurrency: defaultMaxConcurrency,
    createdAt: now()
  };
}

function createDefaultUsers(now) {
  const createdAt = now();
  return [
    {
      id: "usr_local",
      name: "Local User",
      email: null,
      teamId: "team_local",
      role: "owner",
      createdAt,
    },
  ];
}

function createDefaultTeams(now) {
  const createdAt = now();
  return [
    {
      id: "team_local",
      name: "Local Team",
      slug: "local",
      createdAt,
    },
  ];
}

function createProjectTargetRecord(project, now) {
  const createdAt = now();
  return {
    id: `tgt_${project.id}`,
    projectId: project.id,
    deviceId: "dev_local_001",
    kind: project.source === "clone" ? "clone" : "local",
    remoteUrl: project.git?.remoteUrl ?? null,
    rootPath: project.path,
    defaultBranch: project.git?.defaultBranch ?? project.git?.currentBranch ?? null,
    state: "ready",
    progress: 100,
    message: "Local checkout is ready.",
    createdAt,
    updatedAt: createdAt,
  };
}

function createDefaultAutomations(projectId, now) {
  const createdAt = now();
  return [
    {
      id: "atm_demo_audit",
      name: "Weekday repo audit",
      enabled: false,
      projectId,
      branch: "main",
      schedule: { kind: "weekdays", time: "09:00", label: "Weekdays at 09:00" },
      nextRunAt: null,
      sessionMode: "fresh",
      graceHours: 12,
      precheck: "None",
      agentId: "agt_codex_cli",
      prompt: "Summarize repository health and identify risky open work.",
      lastRunAt: null,
      lastInvocationId: null,
      runCount: 0,
      tokens: 0,
      createdBy: "usr_local",
      createdAt,
    },
  ];
}

// Seed agent-skill: the image-edit capability, rendered into each matching
// agent's worktree (claude via MCP, codex via CLI). See services/agent-skills.mjs.
function createDefaultAgentSkills(now) {
  const createdAt = now();
  return [
    {
      id: "skl_image_edit",
      name: "Image Edit",
      slug: "image-edit",
      description: "Edit or generate images from a reference image and a text prompt.",
      body: [
        "Use this when the task asks to edit, retouch, restyle, or generate an image",
        "(改图 / 编辑图片 / 抠图 / 换背景 / 生成图片).",
        "",
        "- codex: prefer your built-in image_generation tool — it needs no extra setup.",
        "  Only fall back to the CLI below if the built-in tool is unavailable.",
        "- claude: call the `edit_image` tool exposed by the `image-tool` MCP server.",
        "  If MCP is unavailable, run the CLI:",
        "  `node packages/image-tool/cli.mjs --input <path> --prompt <text> --output <path>`.",
        "",
        "Always write to an explicit output path and report it back when done.",
      ].join("\n"),
      targets: ["claude", "codex"],
      tool: {
        cli: "node packages/image-tool/cli.mjs",
        mcp: { name: "image-tool", command: "node", args: ["packages/image-tool/mcp-server.mjs"] },
      },
      enabled: true,
      createdAt,
      updatedAt: createdAt,
    },
  ];
}

function createDefaultAgents(now) {
  return [
    {
      id: "agt_demo_cli",
      name: "Demo CLI Agent",
      description: "Safe local demo agent for M0 smoke tests.",
      ownerUserId: "usr_local",
      location: { type: "local_device", deviceId: "dev_local_001" },
      adapter: {
        type: "cli",
        command: "demo-agent",
        args: ["{{payloadJson}}"],
        workingDirectoryPolicy: "bridge_default",
        environmentPolicy: "inherit_safe",
        timeoutSeconds: 30,
        cancellation: "supported"
      },
      lifecycle: {
        state: "enabled",
        installState: "installed",
        version: "0.0.0",
        managedBy: "bridge"
      },
      economics: {
        model: "unknown",
        pricingDimensions: [],
        currency: "USD",
        costOwner: "usr_local",
        budgetPoolId: null,
        unknownCostPolicy: "warn"
      },
      capabilities: [
        {
          name: "demo_task",
          description: "Runs a harmless local demonstration task.",
          riskLevel: "low",
          riskTags: ["read_only"]
        }
      ],
      status: "unavailable",
      health: {
        status: "unknown",
        checkedAt: null,
        message: "Health has not been checked yet.",
        nextAction: "Run a health check before relying on this agent."
      },
      registrationNotes: {
        risk: "Low risk demo command. It does not read or write user files.",
        data: "Task text, logs, trace, and final result are stored in the local demo server.",
        cost: "Cost is unknown and no billing is performed.",
        cancellation: "The bridge forwards cancellation to the local demo process."
      },
      createdAt: now()
    },
    {
      id: "agt_codex_cli",
      name: "Codex CLI",
      description: "Runs Codex CLI non-interactively through a reviewed local adapter config.",
      ownerUserId: "usr_local",
      location: { type: "local_device", deviceId: "dev_local_001" },
      adapter: {
        type: "cli",
        command: "codex",
        args: codexCliArgs(),
        workingDirectoryPolicy: "bridge_default",
        environmentPolicy: "inherit_safe",
        timeoutSeconds: 120,
        cancellation: "supported",
        outputFormat: "codex_jsonl",
        sandbox: null
      },
      lifecycle: {
        state: "enabled",
        installState: "installed",
        version: "0.0.0",
        managedBy: "bridge"
      },
      economics: {
        model: "unknown",
        pricingDimensions: [],
        currency: "USD",
        costOwner: "usr_local",
        budgetPoolId: null,
        unknownCostPolicy: "warn"
      },
      capabilities: [
        {
          name: "codex_repo_task",
          description: "Runs Codex CLI repository tasks using Codex CLI native permissions.",
          riskLevel: "high",
          riskTags: codexRiskTags()
        }
      ],
      status: "unavailable",
      health: {
        status: "unknown",
        checkedAt: null,
        message: "Codex CLI setup has not been checked yet.",
        nextAction: "Run a health check before the first Codex task."
      },
      registrationNotes: codexRegistrationNotes(),
      discovery: {
        source: "default_registered",
        confidence: "high"
      },
      createdAt: now()
    },
    {
      id: "agt_claude_acceptEdits",
      name: "Claude Code CLI",
      description: "Runs Claude Code non-interactively (claude -p) through a reviewed local adapter config.",
      ownerUserId: "usr_local",
      location: { type: "local_device", deviceId: "dev_local_001" },
      adapter: {
        type: "cli",
        command: "claude",
        args: claudeCliArgs("acceptEdits"),
        workingDirectoryPolicy: "bridge_default",
        environmentPolicy: "inherit_safe",
        timeoutSeconds: 180,
        cancellation: "supported",
        outputFormat: "claude_jsonl",
        sandbox: null,
        permissionMode: "acceptEdits"
      },
      lifecycle: {
        state: "enabled",
        installState: "installed",
        version: "0.0.0",
        managedBy: "bridge"
      },
      economics: {
        model: "unknown",
        pricingDimensions: [],
        currency: "USD",
        costOwner: "usr_local",
        budgetPoolId: null,
        unknownCostPolicy: "warn"
      },
      capabilities: [
        {
          name: "claude_repo_task",
          description: "Runs Claude Code repository tasks using Claude Code native permission modes.",
          riskLevel: "high",
          riskTags: claudeRiskTags()
        }
      ],
      status: "unavailable",
      health: {
        status: "unknown",
        checkedAt: null,
        message: "Claude Code setup has not been checked yet.",
        nextAction: "Run a health check before the first Claude task."
      },
      registrationNotes: claudeRegistrationNotes(),
      discovery: {
        source: "default_registered",
        confidence: "high"
      },
      createdAt: now()
    },
    {
      id: "agt_platform_troubleshooter",
      name: "Invocation Troubleshooter",
      description: "Platform-owned agent that explains failed invocations and suggested fixes.",
      ownerUserId: "system",
      location: { type: "platform_agent" },
      adapter: { type: "platform", name: "invocation_troubleshooter_agent" },
      lifecycle: {
        state: "enabled",
        installState: "installed",
        version: "0.0.0",
        managedBy: "platform"
      },
      economics: {
        model: "free",
        pricingDimensions: ["per_invocation"],
        currency: "USD",
        costOwner: "usr_local",
        budgetPoolId: null,
        unknownCostPolicy: "warn"
      },
      capabilities: [
        {
          name: "troubleshoot_invocation",
          description: "Summarizes failed invocation state, logs, bridge status, adapter errors, and suggested fixes.",
          riskLevel: "low",
          riskTags: ["read_only"]
        }
      ],
      status: "available",
      health: {
        status: "healthy",
        checkedAt: now(),
        message: "Platform troubleshooting agent is available.",
        nextAction: null
      },
      registrationNotes: {
        risk: "Read-only platform agent. It explains recorded state and cannot remediate without approval.",
        data: "Reads invocation status, related events, bridge state, adapter metadata, trace, and audit records from the local demo server.",
        cost: "Free platform demo helper. No billing automation is performed.",
        cancellation: "Runs synchronously in the local demo server."
      },
      createdAt: now(),
      updatedAt: now()
    },
    {
      id: "agt_platform_integration_builder",
      name: "Integration Builder",
      description: "Platform-owned agent that drafts unsupported-agent integration plans for review.",
      ownerUserId: "system",
      location: { type: "platform_agent" },
      adapter: { type: "platform", name: "integration_builder_agent" },
      lifecycle: {
        state: "enabled",
        installState: "installed",
        version: "0.0.0",
        managedBy: "platform"
      },
      economics: {
        model: "free",
        pricingDimensions: ["per_artifact"],
        currency: "USD",
        costOwner: "usr_local",
        budgetPoolId: null,
        unknownCostPolicy: "warn"
      },
      capabilities: [
        {
          name: "draft_integration_plan",
          description: "Drafts reviewable integration plans without enabling adapters.",
          riskLevel: "low",
          riskTags: ["read_only", "generated_code"]
        }
      ],
      status: "available",
      health: {
        status: "healthy",
        checkedAt: now(),
        message: "Platform integration builder is available for advisory drafts.",
        nextAction: null
      },
      registrationNotes: {
        risk: "Advisory platform agent. It can draft plans and artifact suggestions but cannot approve, test, register, or enable integrations.",
        data: "Reads user-provided integration intent and writes reviewable draft artifacts.",
        cost: "Free platform demo helper. No billing automation is performed.",
        cancellation: "Runs synchronously in the local demo server."
      },
      createdAt: now(),
      updatedAt: now()
    }
  ];
}

function createDefaultRetentionSettings(now) {
  return {
    id: "ret_demo_integration_data",
    subjectType: "integration_data",
    logsDays: 14,
    promptsDays: 30,
    responsesDays: 30,
    artifactsDays: 90,
    updatedAt: now()
  };
}

function createDefaultPrivateDeploymentConfig(now) {
  const createdAt = now();
  return {
    id: "dep_demo_private",
    mode: "local_developer",
    ownerTeamId: null,
    auditExportEnabled: false,
    immutableAuditOption: "disabled",
    capabilities: {
      privateCatalog: false,
      signedBundles: false,
      auditExport: true,
      siemExport: false,
      immutableAudit: false,
      platformManagedAi: false,
    },
    auditSinks: [
      {
        id: "sink_local_file",
        type: "local_file",
        enabled: true,
        displayName: "Local audit export file",
        destinationRef: ".myagenttool/audit/export.jsonl",
        immutable: false,
        externalDeliveryEnabled: false,
        retentionDays: 365,
        metadata: {},
      },
    ],
    alertSinks: [
      {
        id: "alert_local_log",
        type: "local_log",
        enabled: true,
        destinationRef: ".myagenttool/audit/alerts.log",
        severityThreshold: "warn",
        externalDeliveryEnabled: false,
      },
    ],
    entitlementPolicy: {
      canBlockPaidFeatures: true,
      canBlockNewPlatformManagedAi: true,
      canBlockDataExport: false,
      canDeleteUserData: false,
      canRemoveLocalSoftware: false,
      canPreventDeviceUnlink: false,
    },
    createdAt,
    updatedAt: createdAt,
  };
}
