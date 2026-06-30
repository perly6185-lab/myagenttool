import { basename } from "node:path";
import {
  codexCliArgs,
  codexRegistrationNotes,
  codexRiskTags,
} from "../services/agents.mjs";
import { createProjectRecord } from "../services/projects.mjs";
import { createTerminalRuntimeCapability } from "../services/terminal.mjs";

const defaultAgentIds = [
  "agt_demo_cli",
  "agt_codex_cli",
  "agt_platform_troubleshooter",
  "agt_platform_integration_builder",
];

export function createServerState({ defaultProjectPath, now }) {
  const defaultProject = createProjectRecord({
    id: "prj_myagenttool",
    name: basename(defaultProjectPath) || "myagenttool",
    path: defaultProjectPath,
    source: "default"
  });
  const state = {
    device: createDefaultDevice(now),
    projects: [defaultProject],
    currentProjectId: defaultProject.id,
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
    discoveryRuns: [],
    integrationArtifacts: [],
    integrationProbeRuns: [],
    quotaDecisionRecords: [],
    quotaPolicies: [],
    aiUsageRecords: [],
    ledgerEntries: [],
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
  state.discoveryRuns = [];
  state.integrationArtifacts = [];
  state.integrationProbeRuns = [];
  state.quotaDecisionRecords = [];
  state.quotaPolicies = [];
  state.aiUsageRecords = [];
  state.ledgerEntries = [];
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
    createdAt: now()
  };
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
