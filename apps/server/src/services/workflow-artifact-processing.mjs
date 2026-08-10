import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export function createWorkflowArtifactProcessor({
  access,
  activeOcrActions,
  classifyWorkflowFile,
  extractionText,
  files,
  maxOcrCharacters: MAX_OCR_CHARACTERS,
  maxOcrLinesPerPage: MAX_OCR_LINES_PER_PAGE,
  ocrActionCapacity,
  ocrAdapter,
  ocrExtensions: OCR_EXTENSIONS,
  parseWorkflowDocument,
  parserVersion: WORKFLOW_DOCUMENT_PARSER_VERSION,
  runtime,
}) {
  const { actorCanAccessProject, findArtifact, findSource } = access;
  const {
    containedRealDirectory,
    currentArtifactFingerprint,
    safeTextContent,
  } = files;
  const { appendEvent, errorResult, now, runTx, state } = runtime;

  async function retryArtifactExtraction({
    artifactId,
    expectedRevision,
  } = {}, actor = null) {
    const artifact = findArtifact(artifactId, actor);
    if (!artifact) return { status: 404, body: { error: "workflow_artifact_not_found" } };
    if (expectedRevision !== artifact.revision) {
      return {
        status: 409,
        body: { error: "workflow_artifact_revision_conflict", currentRevision: artifact.revision },
      };
    }
    if (artifact.availability !== "available") {
      return { status: 409, body: { error: "workflow_artifact_not_available" } };
    }
    const source = findSource(artifact.sourceId, actor);
    const project = state.projects.find((item) => item.id === artifact.projectId);
    if (!source || source.state !== "active" || !project) {
      return { status: 409, body: { error: "workflow_source_revoked" } };
    }
    const fingerprint = currentArtifactFingerprint(state, source, artifact);
    if (!fingerprint || fingerprint !== artifact.fingerprint) {
      return { status: 409, body: { error: "workflow_artifact_changed_rescan_required" } };
    }
    try {
      const { actual } = containedRealDirectory(project.path, source.relativePath);
      const target = resolve(actual, artifact.relativePath);
      const lexical = relative(actual, target);
      if (lexical === ".." || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) {
        return { status: 409, body: { error: "workflow_artifact_changed_rescan_required" } };
      }
      const extraction = await parseWorkflowDocument({
        path: target,
        extension: `.${artifact.extension}`,
        readMode: source.readMode,
        size: artifact.size,
      });
      const previousExtraction = JSON.stringify(artifact.extraction ?? null);
      const nativeText = safeTextContent(
        target,
        `.${artifact.extension}`,
        source.readMode,
        artifact.size,
      );
      const inference = classifyWorkflowFile({
        relativePath: artifact.relativePath,
        content: extractionText(extraction) || nativeText,
      });
      const timestamp = now();
      runTx(() => {
        artifact.extraction = extraction;
        artifact.roleInference = inference;
        if (
          artifact.confirmationState === "confirmed"
          && previousExtraction !== JSON.stringify(extraction)
        ) {
          artifact.confirmationState = "changed";
        }
        if (artifact.confirmationState !== "confirmed") artifact.role = inference.role;
        artifact.revision += 1;
        artifact.updatedAt = timestamp;
        appendEvent({
          invocationId: null,
          type: "workflow_artifact_extraction_retried",
          level: extraction.state === "failed" ? "warning" : "info",
          message: "Workflow artifact extraction retried.",
          data: {
            artifactId: artifact.id,
            sourceId: source.id,
            extractionState: extraction.state,
            errorCode: extraction.errorCode ?? null,
          },
        });
      });
      return { status: 200, body: { artifact } };
    } catch (error) {
      return errorResult(error);
    }
  }

  function getOcrReadiness(_input = {}, _actor = null) {
    const readiness = ocrAdapter?.readiness?.() ?? {
      state: "unavailable",
      providerId: null,
      reason: "workflow_ocr_provider_unavailable",
    };
    return {
      status: 200,
      body: {
        state: readiness.state === "ready" ? "ready" : "unavailable",
        providerId: readiness.providerId ?? null,
        reason: readiness.reason ?? null,
        localOnly: true,
        supportedExtensions: readiness.supportedExtensions
          ?? [...OCR_EXTENSIONS].map((extension) => `.${extension}`),
      },
    };
  }

  async function ocrArtifact({
    artifactId,
    expectedRevision,
    confirmed,
  } = {}, actor = null) {
    if (confirmed !== true) {
      return { status: 400, body: { error: "workflow_ocr_confirmation_required" } };
    }
    const artifact = findArtifact(artifactId, actor);
    if (!artifact) return { status: 404, body: { error: "workflow_artifact_not_found" } };
    if (artifact.extraction?.state === "ready" && artifact.extraction?.ocr?.providerId) {
      return { status: 200, body: { artifact, replayed: true } };
    }
    if (artifact.revision !== expectedRevision) {
      return {
        status: 409,
        body: { error: "workflow_artifact_revision_conflict", currentRevision: artifact.revision },
      };
    }
    if (!OCR_EXTENSIONS.has(artifact.extension) || artifact.extraction?.state !== "needs_ocr") {
      return { status: 409, body: { error: "workflow_artifact_ocr_not_applicable" } };
    }
    if (artifact.availability !== "available" || artifact.exclusion) {
      return { status: 409, body: { error: "workflow_artifact_not_available" } };
    }
    const source = findSource(artifact.sourceId, actor);
    const project = state.projects.find((item) =>
      item.id === artifact.projectId && actorCanAccessProject(state, actor, item.id));
    if (!source || source.state !== "active" || source.readMode !== "supported_text" || !project) {
      return { status: 409, body: { error: "workflow_source_revoked" } };
    }
    const readiness = getOcrReadiness().body;
    if (readiness.state !== "ready") {
      return {
        status: 409,
        body: {
          error: readiness.reason ?? "workflow_ocr_provider_unavailable",
          readiness,
        },
      };
    }
    const active = activeOcrActions.get(artifact.id);
    if (active) return active.promise;
    if (activeOcrActions.size >= ocrActionCapacity) {
      return {
        status: 429,
        body: {
          error: "workflow_ocr_capacity_reached",
          retryable: true,
          capacity: ocrActionCapacity,
        },
      };
    }

    const controller = new AbortController();
    const action = {
      controller,
      promise: null,
      progress: {
        completedPages: 0,
        totalPages: artifact.extraction?.pageCount ?? null,
      },
    };
    const operation = (async () => {
      const beforeFingerprint = currentArtifactFingerprint(state, source, artifact);
      if (!beforeFingerprint || beforeFingerprint !== artifact.fingerprint) {
        return { status: 409, body: { error: "workflow_artifact_changed_rescan_required" } };
      }
      try {
        const { actual } = containedRealDirectory(project.path, source.relativePath);
        const requested = resolve(actual, artifact.relativePath);
        const lexical = relative(actual, requested);
        if (lexical === ".." || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) {
          return { status: 409, body: { error: "workflow_artifact_changed_rescan_required" } };
        }
        const target = realpathSync(requested);
        const confined = relative(actual, target);
        if (confined === ".." || confined.startsWith(`..${sep}`) || isAbsolute(confined)) {
          return { status: 409, body: { error: "workflow_artifact_changed_rescan_required" } };
        }
        const recognize = ocrAdapter.recognize?.bind(ocrAdapter)
          ?? ocrAdapter.recognizePdf?.bind(ocrAdapter);
        if (!recognize) {
          return { status: 409, body: { error: "workflow_ocr_provider_unavailable" } };
        }
        const result = await recognize({
          path: target,
          signal: controller.signal,
          onProgress: (progress) => {
            action.progress = {
              completedPages: progress.completedPages,
              totalPages: progress.totalPages,
            };
          },
        });
        if (controller.signal.aborted) {
          return { status: 409, body: { error: "workflow_ocr_cancelled" } };
        }
        const afterFingerprint = currentArtifactFingerprint(state, source, artifact);
        if (!afterFingerprint || afterFingerprint !== beforeFingerprint) {
          return { status: 409, body: { error: "workflow_artifact_changed_rescan_required" } };
        }
        let remainingCharacters = MAX_OCR_CHARACTERS;
        const blocks = result.pages.map((page) => {
          const text = String(page.text ?? "").slice(0, remainingCharacters);
          remainingCharacters -= text.length;
          return {
            kind: result.inputKind === "image" ? "image" : "page",
            text,
            location: {
              kind: result.inputKind === "image" ? "image" : "page",
              index: page.index,
              ...(page.width ? { width: page.width } : {}),
              ...(page.height ? { height: page.height } : {}),
            },
            confidence: page.confidence,
            evidence: page.evidence.slice(0, MAX_OCR_LINES_PER_PAGE),
          };
        }).filter((block) => block.text);
        const characterCount = blocks.reduce((sum, block) => sum + block.text.length, 0);
        if (characterCount < 20) {
          return {
            status: 422,
            body: { error: "workflow_ocr_no_text_detected", pageCount: result.pageCount },
          };
        }
        const extraction = {
          state: "ready",
          parserVersion: WORKFLOW_DOCUMENT_PARSER_VERSION,
          blocks,
          characterCount,
          truncated: remainingCharacters <= 0,
          pageCount: result.pageCount,
          cellCount: null,
          needsOcr: false,
          truncatedPages: false,
          ocr: {
            providerId: result.providerId,
            providerVersion: result.providerVersion,
            inputKind: result.inputKind === "image" ? "image" : "pdf",
            localOnly: true,
            completedAt: now(),
            averageConfidence: Number((
              result.pages.reduce((sum, page) => sum + page.confidence, 0)
              / result.pages.length
            ).toFixed(4)),
          },
        };
        const inference = classifyWorkflowFile({
          relativePath: artifact.relativePath,
          content: extractionText(extraction),
        });
        const timestamp = now();
        runTx(() => {
          artifact.extraction = extraction;
          artifact.roleInference = inference;
          if (artifact.confirmationState === "confirmed") artifact.confirmationState = "changed";
          if (artifact.confirmationState !== "confirmed") artifact.role = inference.role;
          artifact.revision = Number(artifact.revision ?? 0) + 1;
          artifact.updatedAt = timestamp;
          appendEvent({
            invocationId: null,
            type: "workflow_artifact_ocr_completed",
            level: "info",
            message: "A scanned PDF was recognized by a local OCR provider.",
            data: {
              artifactId: artifact.id,
              sourceId: source.id,
              providerId: result.providerId,
              pageCount: result.pageCount,
              characterCount,
            },
          });
        });
        return { status: 200, body: { artifact, replayed: false } };
      } catch (error) {
        return errorResult(Object.assign(error instanceof Error ? error : new Error(String(error)), {
          status: Number(error?.status) || (
            error?.code === "workflow_ocr_timeout" ? 504
              : error?.code === "workflow_ocr_cancelled" ? 409
              : error?.code === "workflow_ocr_provider_unavailable" ? 409
                : 422
          ),
        }));
      }
    })();
    action.promise = operation;
    activeOcrActions.set(artifact.id, action);
    try {
      return await operation;
    } finally {
      activeOcrActions.delete(artifact.id);
    }
  }

  function getOcrStatus({ artifactId } = {}, actor = null) {
    const artifact = findArtifact(artifactId, actor);
    if (!artifact) return { status: 404, body: { error: "workflow_artifact_not_found" } };
    const action = activeOcrActions.get(artifact.id);
    if (action) {
      return {
        status: 200,
        body: { state: "running", ...action.progress },
      };
    }
    if (artifact.extraction?.state === "ready" && artifact.extraction?.ocr?.providerId) {
      return {
        status: 200,
        body: {
          state: "completed",
          completedPages: artifact.extraction.pageCount ?? 0,
          totalPages: artifact.extraction.pageCount ?? 0,
        },
      };
    }
    return {
      status: 200,
      body: {
        state: "idle",
        completedPages: 0,
        totalPages: artifact.extraction?.pageCount ?? null,
      },
    };
  }

  function cancelOcrArtifact({ artifactId } = {}, actor = null) {
    const artifact = findArtifact(artifactId, actor);
    if (!artifact) return { status: 404, body: { error: "workflow_artifact_not_found" } };
    const action = activeOcrActions.get(artifact.id);
    if (!action) return { status: 409, body: { error: "workflow_ocr_not_running" } };
    action.controller.abort();
    return { status: 202, body: { artifactId: artifact.id, cancellationRequested: true } };
  }


  return {
    cancelOcrArtifact,
    getOcrReadiness,
    getOcrStatus,
    ocrArtifact,
    retryArtifactExtraction,
  };
}
