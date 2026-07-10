import type { ApplicationIntegrationBrief, ApplicationSnapshot } from "@/lib/console-state";

export interface ApplicationIntegrationDrafts {
  available: boolean;
  summary: string;
  notes: string[];
  reviewChecklist: string[];
  smokePlan: string[];
  mcpDescriptor: Record<string, unknown> | null;
  npmWrapper: Record<string, unknown> | null;
  manualManifest: Record<string, unknown> | null;
}

export function generateApplicationIntegrationDrafts(application: ApplicationSnapshot): ApplicationIntegrationDrafts {
  const brief = application.integrationBrief;
  if (!brief) {
    return {
      available: false,
      summary: "Add an integration brief before generating descriptor drafts.",
      notes: ["The draft generator only uses saved application-intake.v1 input."],
      reviewChecklist: [],
      smokePlan: [],
      mcpDescriptor: null,
      npmWrapper: null,
      manualManifest: null,
    };
  }

  const sourceType = brief.sourceType ?? application.source.type;
  const capabilities = uniqueStrings([
    ...(brief.invokableCapabilities ?? []),
    ...(brief.discoverableCapabilities ?? []),
  ]);
  const commands = uniqueStrings([
    ...(brief.fixedCommands ?? []),
    ...(brief.invokableCapabilities ?? []),
  ]);
  const allowedTools = uniqueStrings(commands.map(toolName).filter(Boolean));
  const notes = [
    "Drafts are review material only; applying one fills the editor but does not save automatically.",
    "Every generated executable command starts as draft or approval-required.",
    ...(brief.smokeTests?.length ? [`Smoke tests requested: ${brief.smokeTests.join(", ")}`] : []),
  ];
  const reviewChecklist = buildReviewChecklist({ application, brief, sourceType });
  const smokePlan = buildSmokePlan({ brief, sourceType });

  return {
    available: true,
    summary: brief.intent ?? "Codex can draft descriptors from the saved integration brief.",
    notes,
    reviewChecklist,
    smokePlan,
    mcpDescriptor: shouldDraftMcp(sourceType)
      ? {
          name: `${application.name} MCP`,
          description: brief.intent ?? `MCP descriptor draft for ${application.name}.`,
          transport: "stdio",
          command: "node",
          args: ["server.mjs"],
          allowedTools: allowedTools.length ? allowedTools : ["review_tool_name"],
          toolNamespace: namespace(application.name),
          riskLevel: riskFromBrief(brief),
          riskTags: ["mcp", "draft", "operator_review_required"],
          filePolicy: filePolicyFromBrief(brief),
          networkPolicy: networkPolicyFromBrief(brief),
        }
      : null,
    npmWrapper: shouldDraftNpmWrapper(application, sourceType)
      ? {
          mode: "installed-wrapper",
          installState: "unknown",
          packageManager: "npm",
          commands: (commands.length ? commands : capabilities.length ? capabilities : ["review-command"]).slice(0, 6).map((command, index) => ({
            id: slug(command || `command-${index + 1}`),
            displayName: titleFromText(command || `Review command ${index + 1}`),
            description: brief.intent ?? `Draft wrapper command for ${application.name}.`,
            commandType: "npm_script",
            command: scriptName(command || `command-${index + 1}`),
            status: "draft",
            riskLevel: riskFromBrief(brief),
            riskTags: ["draft", "operator_review_required"],
            requiresApproval: true,
            filePolicy: filePolicyFromBrief(brief),
            networkPolicy: networkPolicyFromBrief(brief),
          })),
        }
      : null,
    manualManifest: shouldDraftManualManifest(application, sourceType)
      ? {
          capabilities: (capabilities.length ? capabilities : ["review capability"]).slice(0, 12).map((capability, index) => ({
            id: slug(capability || `capability-${index + 1}`),
            displayName: titleFromText(capability || `Review capability ${index + 1}`),
            description: brief.intent ?? `Declared capability draft for ${application.name}.`,
            kind: "declared",
            riskLevel: riskFromBrief(brief),
            riskTags: ["draft", "operator_review_required"],
            requiresApproval: (brief.invokableCapabilities ?? []).some((item) => sameMeaning(item, capability)),
            metadata: {
              integrationBriefVersion: brief.version ?? "application-intake.v1",
              generatedBy: "codex_draft_generator",
              resultImport: brief.resultImport ?? null,
            },
          })),
        }
      : null,
  };
}

function buildReviewChecklist({
  application,
  brief,
  sourceType,
}: {
  application: ApplicationSnapshot;
  brief: ApplicationIntegrationBrief;
  sourceType: string | null | undefined;
}): string[] {
  return [
    `Confirm ${sourceType ?? application.source.type} is the correct runtime surface for ${application.name}.`,
    "Replace placeholder commands, args, cwd, URLs, and tool names before saving.",
    `Verify file policy is ${filePolicyFromBrief(brief)} and network policy is ${networkPolicyFromBrief(brief)}.`,
    "Keep commands as draft until static review and local probe evidence are complete.",
    brief.userInputs
      ? "Map every user-controlled input to a schema or argInputs entry."
      : "Add schema or argInputs before accepting per-run user input.",
    brief.resultImport
      ? "Confirm resultImport points to the expected collection, evidence, or report reference."
      : "Decide where invocation results should be imported or linked.",
    brief.approvalsAndRecovery
      ? "Check the declared approval and recovery path against actual operator workflow."
      : "Define approval, consent, retry, and recovery behavior before enabling execution.",
  ];
}

function buildSmokePlan({
  brief,
  sourceType,
}: {
  brief: ApplicationIntegrationBrief;
  sourceType: string | null | undefined;
}): string[] {
  const requested = uniqueStrings(brief.smokeTests ?? []);
  if (requested.length) return requested;
  return [
    "Register the Application with the saved integration brief.",
    "Save reviewed descriptors and run an Application probe.",
    "Inspect projected capabilities and confirm no raw command or adapter secret is exposed.",
    sourceType === "mcp" || sourceType === "mixed"
      ? "Probe or confirm MCP candidates before shared tools become available."
      : "Verify wrapper or manifest capabilities stay disabled until review is complete.",
    "Run one approved capability path and inspect invocation, result refs, timeline, and restart recovery.",
  ];
}

function shouldDraftMcp(sourceType: string | null | undefined): boolean {
  return sourceType === "mcp" || sourceType === "mixed";
}

function shouldDraftNpmWrapper(application: ApplicationSnapshot, sourceType: string | null | undefined): boolean {
  return application.source.type === "npm" || sourceType === "npm" || sourceType === "mixed";
}

function shouldDraftManualManifest(application: ApplicationSnapshot, sourceType: string | null | undefined): boolean {
  return application.source.type === "manual" || sourceType === "manual" || sourceType === "mixed" || sourceType === "unknown";
}

function riskFromBrief(brief: ApplicationIntegrationBrief): "low" | "medium" | "high" {
  const text = `${brief.dataBoundary ?? ""} ${brief.approvalsAndRecovery ?? ""}`.toLowerCase();
  if (/\b(write|network|deploy|delete|publish|external|send)\b/.test(text)) return "high";
  if (/\b(read|local|file|input)\b/.test(text)) return "medium";
  return "medium";
}

function filePolicyFromBrief(brief: ApplicationIntegrationBrief): "read_only" | "workspace_write" {
  const text = `${brief.dataBoundary ?? ""} ${brief.resultImport ?? ""}`.toLowerCase();
  return /\b(write|modify|create|delete|workspace)\b/.test(text) ? "workspace_write" : "read_only";
}

function networkPolicyFromBrief(brief: ApplicationIntegrationBrief): "forbidden" | "restricted" {
  const text = `${brief.dataBoundary ?? ""} ${brief.fixedCommands?.join(" ") ?? ""}`.toLowerCase();
  return /\b(network|http|https|api|send|external|endpoint)\b/.test(text) ? "restricted" : "forbidden";
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = String(value ?? "").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function namespace(value: string): string {
  return slug(value).replace(/-/g, "_") || "application";
}

function toolName(value: string): string {
  return namespace(value);
}

function scriptName(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "review-command";
}

function slug(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "draft";
}

function titleFromText(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    || "Review Draft";
}

function sameMeaning(left: string, right: string): boolean {
  return slug(left) === slug(right);
}
