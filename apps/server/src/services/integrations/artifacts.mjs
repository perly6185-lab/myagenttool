import {
  codexCliArgs,
  isCodexCliCommand,
  normalizeCliOutputFormat,
  normalizeStringArray,
} from "../agents.mjs";
import {
  adapterGuidance,
  buildAdapterConfig,
  cancellationNotesForIntegration,
  costNotesForIntegration,
  dataNotesForIntegration,
  guessAdapterType,
  integrationArtifactSummary,
  normalizeCancellation,
  normalizeIntegrationArtifactType,
  normalizeIntegrationReviewState,
  normalizeTargetType,
  riskNotesForIntegration,
} from "./helpers.mjs";
import { makeRunTx } from "../../runtime/store/run-tx.mjs";

export function createIntegrationArtifactRuntime({
  state,
  now,
  nextId,
  appendEvent,
  buildIntegrationGovernance,
  recordQuotaDecision,
  persistStateSoon = () => {},
  store,
}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  function createIntegrationArtifact(body = {}) {
    const targetType = normalizeTargetType(body.targetType ?? body.adapterType ?? guessAdapterType(body));
    const artifactType = normalizeIntegrationArtifactType(body.artifactType ?? "integration_plan");
    const reviewState = normalizeIntegrationReviewState(body.reviewState ?? (artifactType === "integration_plan" ? "draft" : "generated"), artifactType === "integration_plan" ? "draft" : "generated");
    const createdAt = now();
    const payload = buildIntegrationArtifactPayload({
      ...body,
      targetType,
      artifactType,
    });
    const artifact = {
      id: nextId("itg_demo"),
      requestedBy: body.requestedBy ?? "usr_local",
      targetType,
      artifactType,
      reviewState,
      generatedByAi: Boolean(body.generatedByAi ?? artifactType !== "integration_plan"),
      summary: String(body.summary ?? integrationArtifactSummary(artifactType, targetType, payload)),
      sourceArtifactId: body.sourceArtifactId ?? null,
      payload,
      governance: buildIntegrationGovernance(body, payload),
      createdAt,
      updatedAt: createdAt,
    };
    runTx(() => {
      state.integrationArtifacts.unshift(artifact);
      state.integrationArtifacts = state.integrationArtifacts.slice(0, 100);
      recordQuotaDecision(artifact, "create_artifact");
      appendEvent({
        invocationId: null,
        type: artifactType === "integration_plan" ? "artifact_created" : "integration_generated",
        level: "info",
        message: `${artifact.summary} It is reviewable and not enabled.`,
        data: { artifactId: artifact.id, artifactType: artifact.artifactType, reviewState: artifact.reviewState },
      });
    });
    return artifact;
  }

  function buildIntegrationArtifactPayload(body) {
    const targetType = body.targetType;
    const description = String(body.description ?? body.intent ?? "").trim();
    const command = String(body.command ?? body.adapter?.command ?? "").trim();
    const baseUrl = String(body.baseUrl ?? body.url ?? body.adapter?.baseUrl ?? "").trim();
    const requestPath = String(body.requestPath ?? body.adapter?.requestPath ?? "/invoke").trim() || "/invoke";
    const healthPath = String(body.healthPath ?? body.adapter?.healthPath ?? "/health").trim() || "/health";
    const args = normalizeStringArray(body.args).length > 0
      ? normalizeStringArray(body.args)
      : isCodexCliCommand(command)
        ? codexCliArgs()
        : command
          ? ["{{payloadJson}}"]
          : [];
    const payload = {
      title: String(body.title ?? body.name ?? "Unsupported agent integration"),
      description: description || "User described an unsupported agent for integration.",
      adapterGuidance: adapterGuidance(targetType),
      structuredHints: {
        command,
        baseUrl,
        requestPath,
        healthPath,
        workingDirectory: String(body.workingDirectory ?? "").trim(),
        environmentNeeds: String(body.environmentNeeds ?? "").trim(),
        outputFormat: normalizeCliOutputFormat(body.outputFormat ?? body.adapter?.outputFormat, command),
        sandbox: body.sandbox ?? body.adapter?.sandbox ?? null,
        streaming: Boolean(body.streaming ?? false),
        cancellation: normalizeCancellation(body.cancellation),
        args,
      },
      adapterConfig: buildAdapterConfig(targetType, {
        command,
        args,
        workingDirectory: String(body.workingDirectory ?? "").trim(),
        baseUrl,
        requestPath,
        healthPath,
        streaming: Boolean(body.streaming ?? false),
        cancellation: normalizeCancellation(body.cancellation),
        timeoutSeconds: body.timeoutSeconds === undefined ? undefined : Number(body.timeoutSeconds),
        outputFormat: body.outputFormat ?? body.adapter?.outputFormat,
        sandbox: body.sandbox ?? body.adapter?.sandbox,
      }),
      riskNotes: riskNotesForIntegration(targetType, body),
      dataNotes: dataNotesForIntegration(targetType),
      costNotes: costNotesForIntegration(body),
      cancellationNotes: cancellationNotesForIntegration(body),
      probe: {
        explicitUserActionRequired: true,
        installScriptsAllowed: false,
        broadScanningAllowed: false,
        summary: "Probe can be run only after explicit review action.",
      },
    };
    if (body.artifactType === "schema") {
      payload.schema = {
        input: { task: "string" },
        output: { summary: "string", touchedUserFiles: "boolean", cost: "object?" },
      };
    }
    if (body.artifactType === "redaction_policy") {
      payload.redactionPolicy = {
        redactPatterns: ["api_key", "authorization", "password", "secret", "token"],
        appliesTo: ["logs", "prompts", "responses", "generated_artifacts"],
      };
    }
    if (body.artifactType === "test_case") {
      payload.testCase = {
        name: "basic safe task",
        input: { task: "Say hello and report readiness." },
        expected: ["non-empty summary", "no install scripts", "no automatic enablement"],
      };
    }
    if (body.artifactType === "health_check") {
      payload.healthCheck = targetType === "http"
        ? { method: "GET", path: healthPath, timeoutSeconds: Number(body.timeoutSeconds ?? 30) }
        : { command, args: ["--version"], timeoutSeconds: Number(body.timeoutSeconds ?? 30), shell: false };
    }
    return payload;
  }

  function generateIntegrationArtifacts(sourceArtifact) {
    if (!sourceArtifact || sourceArtifact.artifactType !== "integration_plan") {
      throw new Error("Only integration plan drafts can generate artifact sets.");
    }
    if (sourceArtifact.reviewState === "archived" || sourceArtifact.reviewState === "rejected") {
      throw new Error("Archived or rejected plans cannot generate artifacts.");
    }
    const hints = sourceArtifact.payload?.structuredHints ?? {};
    const generatedSpecs = [
      ["adapter_config", "needs_review"],
      ["health_check", "needs_review"],
      ["schema", "needs_review"],
      ["redaction_policy", "needs_review"],
      ["test_case", "needs_review"],
    ];
    const generated = generatedSpecs.map(([artifactType, reviewState]) => createIntegrationArtifact({
      artifactType,
      reviewState,
      targetType: sourceArtifact.targetType,
      generatedByAi: true,
      sourceArtifactId: sourceArtifact.id,
      title: sourceArtifact.payload?.title,
      description: sourceArtifact.payload?.description,
      command: hints.command,
      args: hints.args,
      baseUrl: hints.baseUrl,
      requestPath: hints.requestPath,
      healthPath: hints.healthPath,
      workingDirectory: hints.workingDirectory,
      environmentNeeds: hints.environmentNeeds,
      streaming: hints.streaming,
      cancellation: hints.cancellation,
      economicModel: sourceArtifact.governance?.economics?.model,
      costOwner: sourceArtifact.governance?.economics?.costOwner,
      unknownCostPolicy: sourceArtifact.governance?.economics?.unknownCostPolicy,
    }));
    runTx(() => {
      sourceArtifact.reviewState = "generated";
      sourceArtifact.updatedAt = now();
      appendEvent({
        invocationId: null,
        type: "integration_generated",
        level: "info",
        message: `Generated ${generated.length} reviewable integration artifact(s) from ${sourceArtifact.id}.`,
        data: { sourceArtifactId: sourceArtifact.id, artifactIds: generated.map((item) => item.id) },
      });
    });
    return generated;
  }

  function transitionIntegrationArtifact(artifact, action) {
    const nextState = {
      approve: "approved",
      reject: "rejected",
      archive: "archived",
      review: "needs_review",
    }[action];
    if (!nextState) {
      throw new Error(`Unsupported artifact action: ${action}`);
    }
    return runTx(() => {
      artifact.reviewState = nextState;
      artifact.updatedAt = now();
      appendEvent({
        invocationId: null,
        type: "integration_reviewed",
        level: nextState === "rejected" ? "warn" : "info",
        message: `${artifact.summary} moved to ${nextState}. No integration was enabled automatically.`,
        data: { artifactId: artifact.id, reviewState: nextState },
      });
      return artifact;
    });
  }

  function findIntegrationArtifact(id) {
    return state.integrationArtifacts.find((item) => item.id === id);
  }

  return {
    createIntegrationArtifact,
    findIntegrationArtifact,
    generateIntegrationArtifacts,
    transitionIntegrationArtifact,
  };
}
