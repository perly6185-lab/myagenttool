export function createWorkflowSourceScanner({
  access,
  activeIntakeScans,
  activeScans,
  cancelledScans,
  runtime,
  scanDirectory,
}) {
  const { actorCanAccessProject, findSource } = access;
  const { appendEvent, errorResult, nextId, now, runTx, state } = runtime;
  async function scanSource({ sourceId } = {}, actor = null) {
    const source = findSource(sourceId, actor);
    if (!source) return { status: 404, body: { error: "workflow_source_not_found" } };
    if (source.state !== "active") {
      return { status: 409, body: { error: "workflow_source_revoked" } };
    }
    const project = state.projects.find((item) => item.id === source.projectId);
    if (!project || !actorCanAccessProject(state, actor, source.projectId)) {
      return { status: 404, body: { error: "workflow_source_not_found" } };
    }
    if (activeScans.has(source.id)) {
      return activeScans.get(source.id);
    }
    if (activeIntakeScans.has(source.id)) {
      return {
        status: 409,
        body: { error: "workflow_source_scan_active", retryable: true },
      };
    }
    if (activeScans.size + activeIntakeScans.size >= 2) {
      return {
        status: 429,
        body: { error: "workflow_scan_capacity_reached", retryable: true },
      };
    }

    const operation = (async () => {
      const scanStartedAt = now();
      const targetScanRevision = source.scanRevision + 1;
      let scanJob = state.workflowScanJobs
        .filter((item) =>
          item.sourceId === source.id
          && item.ownerTeamId === source.ownerTeamId
          && item.status === "recoverable")
        .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0];
      runTx(() => {
        if (scanJob) {
          Object.assign(scanJob, {
            status: "running",
            scanRevision: targetScanRevision,
            resumedAt: scanStartedAt,
            lastError: null,
            revision: Number(scanJob.revision ?? 0) + 1,
            updatedAt: scanStartedAt,
          });
        } else {
          scanJob = {
            id: nextId("wsj"),
            ownerTeamId: source.ownerTeamId,
            projectId: source.projectId,
            sourceId: source.id,
            status: "running",
            scanRevision: targetScanRevision,
            processedCount: 0,
            scannedEntries: 0,
            parsed: 0,
            parseFailed: 0,
            reused: 0,
            lastRelativePath: null,
            lastError: null,
            revision: 1,
            createdAt: scanStartedAt,
            startedAt: scanStartedAt,
            updatedAt: scanStartedAt,
          };
          state.workflowScanJobs.push(scanJob);
        }
        source.scanState = "scanning";
        source.currentScanJobId = scanJob.id;
        source.recoveryAvailable = false;
        source.scanProgress = {
          scannedEntries: 0,
          discovered: 0,
          skipped: 0,
          parsed: 0,
          parseFailed: 0,
          reused: 0,
        };
        source.lastError = null;
        source.revision += 1;
        source.updatedAt = now();
      });

      try {
        const existingByPath = new Map(
          state.workflowArtifacts
            .filter((item) => item.sourceId === source.id)
            .map((item) => [item.relativePath, item]),
        );
        const checkpointArtifact = (result, progress) => {
          runTx(() => {
            const checkpointAt = now();
            const existing = existingByPath.get(result.relativePath);
            if (existing) {
              const changed = existing.fingerprint !== result.fingerprint
                || existing.extraction?.parserVersion !== result.extraction?.parserVersion;
              Object.assign(existing, {
                name: result.name,
                extension: result.extension,
                family: result.family,
                size: result.size,
                modifiedAt: result.modifiedAt,
                fingerprint: result.fingerprint,
                contentIdentity: result.contentIdentity,
                identityMode: result.identityMode,
                roleInference: result.inference,
                extraction: result.extraction,
                availability: existing.availability === "checkpointed" ? "checkpointed" : "available",
                scanRevision: targetScanRevision,
                updatedAt: checkpointAt,
                revision: existing.revision + 1,
              });
              if (changed && existing.confirmationState === "confirmed") {
                existing.confirmationState = "changed";
              }
              if (existing.confirmationState !== "confirmed") existing.role = result.inference.role;
            } else {
              const artifact = {
                id: nextId("wfa"),
                ownerTeamId: source.ownerTeamId,
                projectId: source.projectId,
                sourceId: source.id,
                relativePath: result.relativePath,
                name: result.name,
                extension: result.extension,
                family: result.family,
                size: result.size,
                modifiedAt: result.modifiedAt,
                fingerprint: result.fingerprint,
                contentIdentity: result.contentIdentity,
                identityMode: result.identityMode,
                role: result.inference.role,
                roleInference: result.inference,
                extraction: result.extraction,
                confirmationState: "proposed",
                availability: "checkpointed",
                scanRevision: targetScanRevision,
                revision: 1,
                createdAt: checkpointAt,
                updatedAt: checkpointAt,
              };
              state.workflowArtifacts.push(artifact);
              existingByPath.set(result.relativePath, artifact);
            }
            Object.assign(scanJob, {
              processedCount: progress.discovered,
              scannedEntries: progress.scannedEntries,
              parsed: progress.parsed,
              parseFailed: progress.parseFailed,
              reused: progress.reused,
              lastRelativePath: result.relativePath,
              updatedAt: checkpointAt,
              revision: Number(scanJob.revision ?? 0) + 1,
            });
          });
        };
        const scan = await scanDirectory(source, project, {
          shouldCancel: () => cancelledScans.has(source.id) || source.state !== "active",
          existingByPath,
          onArtifact: checkpointArtifact,
          onProgress: (progress) => {
            source.scanProgress = progress;
            source.updatedAt = now();
          },
        });
        if (scan.cancelled) {
          runTx(() => {
            source.scanState = "idle";
            source.scanProgress = null;
            source.lastError = null;
            source.lastScanCancelledAt = now();
            source.revision += 1;
            source.updatedAt = now();
            Object.assign(scanJob, {
              status: "cancelled",
              processedCount: scan.artifacts.length,
              scannedEntries: scan.scannedEntries,
              parsed: scan.parsed,
              parseFailed: scan.parseFailed,
              reused: scan.reused,
              completedAt: now(),
              updatedAt: now(),
              revision: Number(scanJob.revision ?? 0) + 1,
            });
            appendEvent({
              invocationId: null,
              type: "workflow_source_scan_cancelled",
              level: "info",
              message: "Workflow memory source scan cancelled.",
              data: { sourceId: source.id, projectId: source.projectId },
            });
          });
          return {
            status: 200,
            body: {
              source,
              scan: {
                discovered: scan.artifacts.length,
                scannedEntries: scan.scannedEntries,
                skipped: scan.skipped,
                parsed: scan.parsed,
                parseFailed: scan.parseFailed,
                reused: scan.reused,
                truncated: scan.truncated,
                cancelled: true,
              },
            },
          };
        }
        const timestamp = now();
        const scanRevision = targetScanRevision;
        const seen = new Set();
        runTx(() => {
          for (const result of scan.artifacts) {
            seen.add(result.relativePath);
            const existing = existingByPath.get(result.relativePath);
            if (existing?.scanRevision === scanRevision && existing.fingerprint === result.fingerprint) {
              existing.availability = "available";
              existing.updatedAt = timestamp;
              continue;
            }
            if (existing) {
              const changed = existing.fingerprint !== result.fingerprint
                || existing.extraction?.parserVersion !== result.extraction?.parserVersion;
              Object.assign(existing, {
                name: result.name,
                extension: result.extension,
                family: result.family,
                size: result.size,
                modifiedAt: result.modifiedAt,
                fingerprint: result.fingerprint,
                contentIdentity: result.contentIdentity,
                identityMode: result.identityMode,
                roleInference: result.inference,
                extraction: result.extraction,
                availability: "available",
                scanRevision,
                updatedAt: timestamp,
                revision: existing.revision + 1,
              });
              if (changed && existing.confirmationState === "confirmed") {
                existing.confirmationState = "changed";
              }
              if (existing.confirmationState !== "confirmed") existing.role = result.inference.role;
            } else {
              state.workflowArtifacts.push({
                id: nextId("wfa"),
                ownerTeamId: source.ownerTeamId,
                projectId: source.projectId,
                sourceId: source.id,
                relativePath: result.relativePath,
                name: result.name,
                extension: result.extension,
                family: result.family,
                size: result.size,
                modifiedAt: result.modifiedAt,
                fingerprint: result.fingerprint,
                contentIdentity: result.contentIdentity,
                identityMode: result.identityMode,
                role: result.inference.role,
                roleInference: result.inference,
                extraction: result.extraction,
                confirmationState: "proposed",
                availability: "available",
                scanRevision,
                revision: 1,
                createdAt: timestamp,
                updatedAt: timestamp,
              });
            }
          }
          for (const artifact of state.workflowArtifacts.filter((item) => item.sourceId === source.id)) {
            if (!seen.has(artifact.relativePath)) {
              artifact.availability = "missing";
              artifact.scanRevision = scanRevision;
              artifact.revision += 1;
              artifact.updatedAt = timestamp;
            }
          }
          Object.assign(source, {
            scanState: "ready",
            scanProgress: null,
            scanRevision,
            fileCount: scan.artifacts.length,
            skippedCount: scan.skipped,
            parsedCount: scan.parsed,
            parseFailedCount: scan.parseFailed,
            reusedCount: scan.reused,
            truncated: scan.truncated,
            lastScanAt: timestamp,
            lastError: null,
            recoveryAvailable: false,
            revision: source.revision + 1,
            updatedAt: timestamp,
          });
          Object.assign(scanJob, {
            status: "completed",
            processedCount: scan.artifacts.length,
            scannedEntries: scan.scannedEntries,
            parsed: scan.parsed,
            parseFailed: scan.parseFailed,
            reused: scan.reused,
            completedAt: timestamp,
            updatedAt: timestamp,
            revision: Number(scanJob.revision ?? 0) + 1,
          });
          appendEvent({
            invocationId: null,
            type: "workflow_source_scanned",
            level: "info",
            message: "Workflow memory source scanned.",
            data: {
              sourceId: source.id,
              projectId: source.projectId,
              fileCount: scan.artifacts.length,
              skippedCount: scan.skipped,
              parsedCount: scan.parsed,
              parseFailedCount: scan.parseFailed,
              reusedCount: scan.reused,
              truncated: scan.truncated,
            },
          });
        });
        return {
          status: 200,
          body: {
            source,
            scan: {
              discovered: scan.artifacts.length,
              scannedEntries: scan.scannedEntries,
              skipped: scan.skipped,
              parsed: scan.parsed,
              parseFailed: scan.parseFailed,
              reused: scan.reused,
              truncated: scan.truncated,
              cancelled: false,
            },
          },
        };
      } catch (error) {
        runTx(() => {
          source.scanState = "failed";
          source.scanProgress = null;
          source.lastError = error?.code ?? error?.message ?? "scan_failed";
          source.recoveryAvailable = true;
          source.revision += 1;
          source.updatedAt = now();
          Object.assign(scanJob, {
            status: "recoverable",
            lastError: source.lastError,
            updatedAt: now(),
            revision: Number(scanJob.revision ?? 0) + 1,
          });
        });
        return errorResult(error);
      } finally {
        cancelledScans.delete(source.id);
      }
    })();
    activeScans.set(source.id, operation);
    try {
      return await operation;
    } finally {
      activeScans.delete(source.id);
    }
  }

  function cancelScan({ sourceId } = {}, actor = null) {
    const source = findSource(sourceId, actor);
    if (!source) return { status: 404, body: { error: "workflow_source_not_found" } };
    if (!activeScans.has(source.id)) {
      return { status: 409, body: { error: "workflow_source_scan_not_active" } };
    }
    cancelledScans.add(source.id);
    return { status: 202, body: { sourceId: source.id, cancellationRequested: true } };
  }


  return { cancelScan, scanSource };
}
