import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

export function createWorkflowIntakeScanner({
  access,
  activeScans,
  classifyWorkflowFile,
  collectIntakeCandidates,
  defaultStabilityWindowMs: DEFAULT_INTAKE_STABILITY_WINDOW_MS,
  effectiveRole,
  extractionText,
  fileFamily,
  files,
  intakeFileIdentity,
  intakeObservationStates,
  maxIdentityBytes: MAX_INTAKE_IDENTITY_BYTES,
  parseWorkflowDocument,
  runtime,
}) {
  const { actorCanAccessProject, findArtifact, findSource, visible } = access;
  const { safeTextContent } = files;
  const { appendEvent, nextId, now, runTx, state } = runtime;
  const activeIntakeScans = new Map();

  function intakeObservationView(observation) {
    const {
      signature: _signature,
      contentIdentity: _contentIdentity,
      ...view
    } = observation;
    const receipt = observation.receiptId
      ? state.workflowIntakeReceipts.find((row) =>
        row.id === observation.receiptId && row.ownerTeamId === observation.ownerTeamId)
      : null;
    const artifact = findArtifact(observation.artifactId, {
      teamId: observation.ownerTeamId,
    });
    return {
      ...view,
      artifactRevision: artifact?.revision ?? null,
      extraction: artifact?.extraction ? {
        state: artifact.extraction.state,
        pageCount: artifact.extraction.pageCount ?? null,
        characterCount: artifact.extraction.characterCount ?? 0,
        providerId: artifact.extraction.ocr?.providerId ?? null,
        localOnly: artifact.extraction.ocr?.localOnly ?? null,
      } : null,
      receipt: receipt ? {
        id: receipt.id,
        businessKey: receipt.businessKey,
        routineDefinitionId: receipt.routineDefinitionId,
        routineVersion: receipt.routineVersion,
        businessCaseId: receipt.businessCaseId,
        workItemId: receipt.workItemId,
        workItemLocalRef: receipt.workItemLocalRef,
        routineRunId: receipt.routineRunId,
        state: receipt.state,
        triggeredAt: receipt.triggeredAt,
      } : null,
    };
  }

  function listIntakeObservations(
    { sourceId = null, state: observationState = null } = {},
    actor = null,
  ) {
    const source = sourceId ? findSource(sourceId, actor) : null;
    if (sourceId && !source) {
      return { status: 404, body: { error: "workflow_source_not_found" } };
    }
    if (observationState && !intakeObservationStates.has(observationState)) {
      return { status: 400, body: { error: "invalid_workflow_intake_state" } };
    }
    const observations = state.workflowIntakeObservations
      .filter((observation) =>
        visible(observation, actor)
        && (!sourceId || observation.sourceId === sourceId)
        && (!observationState || observation.state === observationState))
      .sort((left, right) =>
        String(right.updatedAt).localeCompare(String(left.updatedAt))
        || left.relativePath.localeCompare(right.relativePath))
      .map(intakeObservationView);
    return { status: 200, body: { observations, count: observations.length } };
  }

  function listInbox({ sourceId = null } = {}, actor = null) {
    if (sourceId && !findSource(sourceId, actor)) {
      return { status: 404, body: { error: "workflow_source_not_found" } };
    }
    const assigned = new Set(
      state.deliveryCases
        .filter((item) => visible(item, actor) && item.state === "confirmed")
        .flatMap((item) => item.requirementArtifactIds),
    );
    const artifacts = state.workflowArtifacts.filter((item) =>
      visible(item, actor)
      && item.availability === "available"
      && !item.exclusion
      && (!sourceId || item.sourceId === sourceId)
      && effectiveRole(item) === "requirement"
      && !assigned.has(item.id)
      && (
        item.confirmationState === "confirmed"
        || Number(item.roleInference?.confidence ?? 0) >= 0.85
      ));
    return { status: 200, body: { artifacts, count: artifacts.length } };
  }

  function verifyIntakeEvidence({ observationId } = {}, actor = null) {
    const observation = state.workflowIntakeObservations.find((row) =>
      row.id === observationId && visible(row, actor));
    if (!observation) {
      return { status: 404, body: { error: "workflow_intake_observation_not_found" } };
    }
    const source = findSource(observation.sourceId, actor);
    const artifact = findArtifact(observation.canonicalArtifactId ?? observation.artifactId, actor);
    const project = state.projects.find((row) => row.id === observation.projectId);
    if (!source || source.state !== "active" || !artifact || !project) {
      return { status: 409, body: { error: "workflow_intake_evidence_not_current" } };
    }
    let candidate;
    try {
      candidate = collectIntakeCandidates(source, project).candidates.find((row) =>
        row.relativePath === observation.relativePath);
    } catch {
      candidate = null;
    }
    if (!candidate) {
      return { status: 409, body: { error: "workflow_intake_evidence_not_current" } };
    }
    try {
      const beforeSignature = candidate.signature;
      const identity = intakeFileIdentity(candidate.fullPath, source, candidate.stat);
      const after = statSync(candidate.fullPath);
      const afterSignature = `${after.size}:${Math.trunc(after.mtimeMs)}:${Math.trunc(after.ctimeMs)}`;
      if (beforeSignature !== afterSignature
        || observation.signature !== afterSignature
        || identity.contentIdentity !== observation.contentIdentity
        || artifact.contentIdentity !== observation.contentIdentity) {
        runTx(() => {
          observation.state = "waiting_stable";
          observation.reason = "workflow_intake_evidence_changed";
          observation.signature = afterSignature;
          observation.contentIdentity = null;
          observation.stableSince = now();
          observation.revision = Number(observation.revision ?? 0) + 1;
          observation.updatedAt = now();
        });
        return {
          status: 409,
          body: {
            error: "workflow_intake_evidence_changed",
            recovery: "Check for new inquiries again after the file stops changing.",
          },
        };
      }
      return { status: 200, body: { current: true } };
    } catch {
      return { status: 409, body: { error: "workflow_intake_evidence_not_current" } };
    }
  }

  async function scanIncrementalIntake({ sourceId } = {}, actor = null) {
    const source = findSource(sourceId, actor);
    if (!source) return { status: 404, body: { error: "workflow_source_not_found" } };
    if (source.state !== "active") {
      return { status: 409, body: { error: "workflow_source_revoked" } };
    }
    if (source.scanRevision < 1) {
      return {
        status: 409,
        body: {
          error: "workflow_intake_baseline_required",
          recovery: "Scan the authorized source once before checking for new inquiries.",
        },
      };
    }
    const project = state.projects.find((item) => item.id === source.projectId);
    if (!project || !actorCanAccessProject(state, actor, source.projectId)) {
      return { status: 404, body: { error: "workflow_source_not_found" } };
    }
    if (activeIntakeScans.has(source.id)) return activeIntakeScans.get(source.id);
    if (activeScans.has(source.id)) {
      return {
        status: 409,
        body: { error: "workflow_source_scan_active", retryable: true },
      };
    }
    if (activeIntakeScans.size + activeScans.size >= 2) {
      return {
        status: 429,
        body: { error: "workflow_intake_capacity_reached", retryable: true },
      };
    }

    const operation = (async () => {
      const observedAt = now();
      const targetRevision = Number(source.intakeScanRevision ?? 0) + 1;
      const snapshot = collectIntakeCandidates(source, project);
      const seenPaths = new Set();
      const touchedObservationIds = new Set();
      const observationsByPath = new Map(
        state.workflowIntakeObservations
          .filter((observation) => observation.sourceId === source.id)
          .map((observation) => [observation.relativePath, observation]),
      );
      const artifactsByPath = new Map(
        state.workflowArtifacts
          .filter((artifact) => artifact.sourceId === source.id)
          .map((artifact) => [artifact.relativePath, artifact]),
      );
      const counts = {
        observed: 0,
        waitingStable: 0,
        ready: 0,
        duplicate: 0,
        blocked: 0,
        unchanged: 0,
      };
      const saveObservation = (candidate, patch) => {
        let observation = observationsByPath.get(candidate.relativePath);
        runTx(() => {
          if (!observation) {
            observation = {
              id: nextId("wio"),
              ownerTeamId: source.ownerTeamId,
              projectId: source.projectId,
              sourceId: source.id,
              relativePath: candidate.relativePath,
              name: candidate.name,
              state: "observing",
              signature: candidate.signature,
              contentIdentity: null,
              identityMode: null,
              artifactId: null,
              canonicalArtifactId: null,
              reason: null,
              stableSince: observedAt,
              firstObservedAt: observedAt,
              lastObservedAt: observedAt,
              scanRevision: targetRevision,
              revision: 1,
              createdAt: observedAt,
              updatedAt: observedAt,
              ...patch,
            };
            state.workflowIntakeObservations.push(observation);
            observationsByPath.set(candidate.relativePath, observation);
          } else {
            Object.assign(observation, {
              name: candidate.name,
              lastObservedAt: observedAt,
              scanRevision: targetRevision,
              updatedAt: observedAt,
              revision: Number(observation.revision ?? 0) + 1,
              ...patch,
            });
          }
        });
        touchedObservationIds.add(observation.id);
        return observation;
      };

      for (const candidate of snapshot.candidates) {
        if (source.state !== "active") break;
        seenPaths.add(candidate.relativePath);
        const knownArtifact = artifactsByPath.get(candidate.relativePath);
        const previous = observationsByPath.get(candidate.relativePath);
        if (knownArtifact
          && knownArtifact.availability !== "missing"
          && knownArtifact.size === candidate.stat.size
          && knownArtifact.modifiedAt === candidate.stat.mtime.toISOString()) {
          if (previous && ["observing", "waiting_stable"].includes(previous.state)) {
            saveObservation(candidate, {
              state: "ready",
              signature: candidate.signature,
              contentIdentity: knownArtifact.contentIdentity,
              identityMode: knownArtifact.identityMode,
              artifactId: knownArtifact.id,
              canonicalArtifactId: knownArtifact.id,
              reason: null,
              stableAt: observedAt,
            });
            counts.ready += 1;
          } else {
            counts.unchanged += 1;
          }
          continue;
        }
        counts.observed += 1;
        if (!previous || previous.signature !== candidate.signature) {
          saveObservation(candidate, {
            state: "waiting_stable",
            signature: candidate.signature,
            contentIdentity: null,
            identityMode: null,
            artifactId: null,
            canonicalArtifactId: null,
            reason: "workflow_intake_waiting_for_stability",
            stableSince: observedAt,
          });
          counts.waitingStable += 1;
          continue;
        }
        if (previous.state === "duplicate") {
          saveObservation(candidate, {});
          counts.duplicate += 1;
          continue;
        }
        if (previous.state === "blocked" && previous.reason !== "workflow_intake_file_missing") {
          saveObservation(candidate, {});
          counts.blocked += 1;
          continue;
        }
        const stableForMs = Date.parse(observedAt) - Date.parse(previous.stableSince);
        if (!Number.isFinite(stableForMs)
          || stableForMs < Number(source.intakeStabilityWindowMs ?? DEFAULT_INTAKE_STABILITY_WINDOW_MS)) {
          saveObservation(candidate, {
            state: "waiting_stable",
            reason: "workflow_intake_waiting_for_stability",
          });
          counts.waitingStable += 1;
          continue;
        }
        if (source.readMode === "supported_text"
          && candidate.stat.size > MAX_INTAKE_IDENTITY_BYTES) {
          saveObservation(candidate, {
            state: "blocked",
            reason: "workflow_intake_file_too_large",
          });
          counts.blocked += 1;
          continue;
        }

        let before;
        let after;
        let content;
        let extraction;
        let identity;
        try {
          before = statSync(candidate.fullPath);
          const beforeSignature =
            `${before.size}:${Math.trunc(before.mtimeMs)}:${Math.trunc(before.ctimeMs)}`;
          if (beforeSignature !== candidate.signature) {
            saveObservation(candidate, {
              state: "waiting_stable",
              signature: beforeSignature,
              reason: "workflow_intake_waiting_for_stability",
              stableSince: observedAt,
            });
            counts.waitingStable += 1;
            continue;
          }
          content = safeTextContent(
            candidate.fullPath,
            candidate.extension,
            source.readMode,
            before.size,
          );
          extraction = await parseWorkflowDocument({
            path: candidate.fullPath,
            extension: candidate.extension,
            readMode: source.readMode,
            size: before.size,
          });
          identity = intakeFileIdentity(candidate.fullPath, source, before);
          after = statSync(candidate.fullPath);
        } catch {
          saveObservation(candidate, {
            state: "waiting_stable",
            reason: "workflow_intake_file_unavailable",
            stableSince: observedAt,
          });
          counts.waitingStable += 1;
          continue;
        }
        const afterSignature =
          `${after.size}:${Math.trunc(after.mtimeMs)}:${Math.trunc(after.ctimeMs)}`;
        if (candidate.signature !== afterSignature) {
          saveObservation(candidate, {
            state: "waiting_stable",
            signature: afterSignature,
            reason: "workflow_intake_waiting_for_stability",
            stableSince: observedAt,
          });
          counts.waitingStable += 1;
          continue;
        }
        if (source.state !== "active") break;

        const fingerprint = createHash("sha256")
          .update(`${candidate.relativePath}\0${after.size}\0${Math.trunc(after.mtimeMs)}\0`)
          .update(content)
          .digest("hex");
        const learningText = extractionText(extraction) || content;
        const inference = classifyWorkflowFile({
          relativePath: candidate.relativePath,
          content: learningText,
        });
        const matchingArtifact = state.workflowArtifacts.find((artifact) =>
          artifact.sourceId === source.id
          && artifact.relativePath !== candidate.relativePath
          && artifact.availability !== "missing"
          && artifact.contentIdentity === identity.contentIdentity
          && artifact.identityMode === identity.identityMode);
        const originalStillExists = matchingArtifact
          ? existsSync(resolve(snapshot.actual, matchingArtifact.relativePath))
          : false;
        if (matchingArtifact && originalStillExists) {
          saveObservation(candidate, {
            state: "duplicate",
            signature: candidate.signature,
            contentIdentity: identity.contentIdentity,
            identityMode: identity.identityMode,
            artifactId: null,
            canonicalArtifactId: matchingArtifact.id,
            reason: "workflow_intake_duplicate_content",
          });
          counts.duplicate += 1;
          continue;
        }

        const existingArtifact = knownArtifact ?? matchingArtifact ?? null;
        let artifact = existingArtifact;
        runTx(() => {
          if (artifact) {
            const contentChanged = artifact.contentIdentity
              && artifact.contentIdentity !== identity.contentIdentity;
            const previousPath = artifact.relativePath;
            Object.assign(artifact, {
              relativePath: candidate.relativePath,
              name: candidate.name,
              extension: candidate.extension.slice(1),
              family: fileFamily(candidate.extension),
              size: after.size,
              modifiedAt: after.mtime.toISOString(),
              fingerprint,
              contentIdentity: identity.contentIdentity,
              identityMode: identity.identityMode,
              roleInference: inference,
              extraction,
              availability: "available",
              scanRevision: source.scanRevision,
              updatedAt: observedAt,
              revision: Number(artifact.revision ?? 0) + 1,
            });
            if (contentChanged && artifact.confirmationState === "confirmed") {
              artifact.confirmationState = "changed";
            }
            if (artifact.confirmationState !== "confirmed") artifact.role = inference.role;
            if (previousPath !== candidate.relativePath) artifactsByPath.delete(previousPath);
          } else {
            artifact = {
              id: nextId("wfa"),
              ownerTeamId: source.ownerTeamId,
              projectId: source.projectId,
              sourceId: source.id,
              relativePath: candidate.relativePath,
              name: candidate.name,
              extension: candidate.extension.slice(1),
              family: fileFamily(candidate.extension),
              size: after.size,
              modifiedAt: after.mtime.toISOString(),
              fingerprint,
              contentIdentity: identity.contentIdentity,
              identityMode: identity.identityMode,
              role: inference.role,
              roleInference: inference,
              extraction,
              confirmationState: "proposed",
              availability: "available",
              scanRevision: source.scanRevision,
              revision: 1,
              createdAt: observedAt,
              updatedAt: observedAt,
            };
            state.workflowArtifacts.push(artifact);
          }
          artifactsByPath.set(candidate.relativePath, artifact);
        });
        saveObservation(candidate, {
          state: "ready",
          signature: candidate.signature,
          contentIdentity: identity.contentIdentity,
          identityMode: identity.identityMode,
          artifactId: artifact.id,
          canonicalArtifactId: artifact.id,
          reason: null,
          stableAt: observedAt,
        });
        counts.ready += 1;
      }

      runTx(() => {
        for (const observation of state.workflowIntakeObservations.filter((row) =>
          row.sourceId === source.id
          && ["observing", "waiting_stable"].includes(row.state)
          && !seenPaths.has(row.relativePath))) {
          observation.state = "blocked";
          observation.reason = "workflow_intake_file_missing";
          observation.scanRevision = targetRevision;
          observation.updatedAt = observedAt;
          observation.revision = Number(observation.revision ?? 0) + 1;
          touchedObservationIds.add(observation.id);
          counts.blocked += 1;
        }
        source.intakeScanRevision = targetRevision;
        source.intakeCursor = {
          revision: targetRevision,
          lastCompletedAt: observedAt,
          scannedEntries: snapshot.scannedEntries,
          candidateCount: snapshot.candidates.length,
          truncated: snapshot.truncated,
        };
        source.revision += 1;
        source.updatedAt = observedAt;
        appendEvent({
          invocationId: null,
          type: "workflow_incremental_intake_scanned",
          level: "info",
          message: "Authorized source checked for stable new work.",
          data: {
            sourceId: source.id,
            projectId: source.projectId,
            intakeScanRevision: targetRevision,
            ...counts,
            truncated: snapshot.truncated,
          },
        });
      });
      return {
        status: 200,
        body: {
          source,
          intake: {
            scanRevision: targetRevision,
            scannedEntries: snapshot.scannedEntries,
            skipped: snapshot.skipped,
            truncated: snapshot.truncated,
            ...counts,
          },
          observations: state.workflowIntakeObservations
            .filter((observation) => touchedObservationIds.has(observation.id))
            .map(intakeObservationView),
        },
      };
    })();
    activeIntakeScans.set(source.id, operation);
    try {
      return await operation;
    } finally {
      activeIntakeScans.delete(source.id);
    }
  }


  return {
    activeIntakeScans,
    listInbox,
    listIntakeObservations,
    scanIncrementalIntake,
    verifyIntakeEvidence,
  };
}
