export const PM_BRIEF_SCHEMA = {
  name: "myagenttool_pm_brief",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["outcome", "primaryUser", "problem", "userStory", "nonGoals", "acceptanceCriteria", "riskFlags", "projectFields", "openQuestions"],
    properties: {
      outcome: { type: "string" },
      primaryUser: { type: "string" },
      problem: { type: "string" },
      userStory: { type: "string" },
      nonGoals: { type: "array", items: { type: "string" } },
      acceptanceCriteria: { type: "array", items: { type: "string" } },
      riskFlags: { type: "array", items: { type: "string" } },
      projectFields: {
        type: "object",
        additionalProperties: false,
        required: ["milestone", "area", "type", "status", "risk", "acceptance", "platform", "agentTarget", "priority", "sourceDoc"],
        properties: {
          milestone: { type: "string" },
          area: { type: "string" },
          type: { type: "string" },
          status: { type: "string" },
          risk: { type: "string" },
          acceptance: { type: "string" },
          platform: { type: "string" },
          agentTarget: { type: "string" },
          priority: { type: "string" },
          sourceDoc: { type: "string" },
        },
      },
      productFlow: {
        type: "object",
        additionalProperties: false,
        required: ["roleFlow", "scenario", "frequency", "ownerSurface", "usabilityTask", "whatNotToShow", "partialAcceptanceOrFollowUp"],
        properties: {
          roleFlow: { type: "string" },
          scenario: { type: "string" },
          frequency: { type: "string" },
          ownerSurface: { type: "string" },
          usabilityTask: { type: "string" },
          whatNotToShow: { type: "string" },
          partialAcceptanceOrFollowUp: { type: "string" },
        },
      },
      issueTitle: { type: "string" },
      suggestedLabels: { type: "array", items: { type: "string" } },
      openQuestions: { type: "array", items: { type: "string" } },
    },
  },
};

export const CODE_PLAN_SCHEMA = {
  name: "myagenttool_code_plan",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "branch",
      "summary",
      "productFlow",
      "affectedSurfaces",
      "prototypeStates",
      "acceptanceSignals",
      "whatNotToShow",
      "visualQaTasks",
      "filesToTouch",
      "steps",
      "commands",
      "risks",
      "followUpIssues",
      "prSummary",
    ],
    properties: {
      branch: { type: "string" },
      summary: { type: "string" },
      productFlow: {
        type: "object",
        additionalProperties: false,
        required: ["roleFlow", "scenario", "frequency", "ownerSurface", "usabilityTask", "whatNotToShow", "partialAcceptanceOrFollowUp"],
        properties: {
          roleFlow: { type: "string" },
          scenario: { type: "string" },
          frequency: { type: "string" },
          ownerSurface: { type: "string" },
          usabilityTask: { type: "string" },
          whatNotToShow: { type: "string" },
          partialAcceptanceOrFollowUp: { type: "string" },
        },
      },
      affectedSurfaces: { type: "array", items: { type: "string" } },
      prototypeStates: { type: "array", items: { type: "string" } },
      acceptanceSignals: { type: "array", items: { type: "string" } },
      whatNotToShow: { type: "array", items: { type: "string" } },
      visualQaTasks: { type: "array", items: { type: "string" } },
      filesToTouch: { type: "array", items: { type: "string" } },
      steps: { type: "array", items: { type: "string" } },
      commands: { type: "array", items: { type: "string" } },
      risks: { type: "array", items: { type: "string" } },
      followUpIssues: { type: "array", items: { type: "string" } },
      prSummary: { type: "string" },
    },
  },
};

export const REVIEW_SCHEMA = {
  name: "myagenttool_review",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "findings", "verificationGaps", "riskGates", "approve"],
    properties: {
      summary: { type: "string" },
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["severity", "file", "line", "title", "rationale", "recommendation"],
          properties: {
            severity: { type: "string" },
            file: { type: "string" },
            line: { type: "integer" },
            title: { type: "string" },
            rationale: { type: "string" },
            recommendation: { type: "string" },
          },
        },
      },
      verificationGaps: { type: "array", items: { type: "string" } },
      riskGates: { type: "array", items: { type: "string" } },
      approve: { type: "boolean" },
    },
  },
};

export const CODING_ADAPTER_CONTRACT_VERSION = "2026-06-19";

export const CODING_ADAPTERS = {
  mock: {
    name: "mock",
    kind: "internal",
    label: "Mock coding adapter",
    description: "Deterministic local adapter for contract checks and workflow demos.",
    commandEnv: null,
  },
  codex: {
    name: "codex",
    kind: "cli",
    label: "Codex CLI adapter",
    description: "Adapter slot for Codex-style CLI coding agents.",
    commandEnv: "MYAGENTTOOL_CODEX_COMMAND_JSON",
  },
  claude: {
    name: "claude",
    kind: "cli",
    label: "Claude CLI adapter",
    description: "Adapter slot for Claude-style CLI coding agents.",
    commandEnv: "MYAGENTTOOL_CLAUDE_COMMAND_JSON",
  },
  "qwen-code": {
    name: "qwen-code",
    kind: "cli",
    label: "Qwen Code CLI adapter",
    description: "Adapter slot for Qwen Code-style CLI coding agents.",
    commandEnv: "MYAGENTTOOL_QWEN_CODE_COMMAND_JSON",
  },
  openclaw: {
    name: "openclaw",
    kind: "cli",
    label: "OpenClaw-like CLI adapter",
    description: "Adapter slot for OpenClaw-like local coding agents exposed as a command.",
    commandEnv: "MYAGENTTOOL_OPENCLAW_COMMAND_JSON",
  },
  qclaw: {
    name: "qclaw",
    kind: "cli",
    label: "QClaw-like CLI adapter",
    description: "Adapter slot for QClaw-like local coding agents exposed as a command.",
    commandEnv: "MYAGENTTOOL_QCLAW_COMMAND_JSON",
  },
  command: {
    name: "command",
    kind: "cli",
    label: "Generic trusted command adapter",
    description: "Adapter slot for an explicitly configured internal wrapper command.",
    commandEnv: "MYAGENTTOOL_CODING_ADAPTER_COMMAND_JSON",
  },
};

export const STANDARD_VERIFICATION_COMMANDS = [
  ["pnpm", ["docs:check"]],
  ["pnpm", ["repo:check"]],
  ["pnpm", ["ai:check"]],
  ["pnpm", ["release:check"]],
  ["pnpm", ["deploy:check"]],
  ["pnpm", ["typecheck"]],
  ["pnpm", ["test"]],
];
