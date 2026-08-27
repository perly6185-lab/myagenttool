import { createHash } from "node:crypto";
import { privateTutorPackageRegistryFromState } from "./private-tutor-package-registry.mjs";

export const PRIVATE_TUTOR_CONTENT_MIGRATION_SCHEMA_VERSION = 1;

const DECISIONS = new Set(["transfer", "provisional", "archive"]);
const MAX_MAPPINGS = 500;

export function listPrivateTutorContentMigrationCandidates(state, learner, actorId) {
  ensureCollections(state);
  const packages = exactPackages(state)
    .filter((pkg) => packageVisible(pkg, actorId))
    .map((pkg) => {
      const sourceState = packageStateFor(state, learner, pkg.id, pkg.version);
      const attempts = matchingRows(state.privateTutorAttempts, learner.id, pkg.id, pkg.version);
      return {
        packageId: pkg.id,
        packageVersion: pkg.version,
        packageName: pkg.name,
        sourceType: pkg.sourceType,
        status: pkg.status ?? "published",
        contentChecksum: pkg.contentChecksum ?? null,
        knowledgeCount: pkg.knowledgeComponents?.length ?? 0,
        hasLearningState: Boolean(sourceState),
        evidenceCount: sourceState?.knowledge?.reduce((sum, item) => sum + Number(item.evidenceCount ?? 0), 0)
          ?? attempts.filter((item) => item.evidenceEligible !== false).length,
      };
    });
  return packages.sort((left, right) => left.packageName.localeCompare(right.packageName)
    || compareVersions(right.packageVersion, left.packageVersion));
}

export function createPrivateTutorContentMigrationPreview(state, learner, actorId, input, {
  now,
  nextId,
} = {}) {
  ensureCollections(state);
  const idempotencyKey = normalizedIdempotencyKey(input?.idempotencyKey);
  if (!idempotencyKey) return failure(400, "invalid_private_tutor_content_migration_idempotency_key");
  const source = exactPackage(state, input?.sourcePackageId, input?.sourcePackageVersion);
  const target = exactPackage(state, input?.targetPackageId, input?.targetPackageVersion);
  const availability = validatePackagePair(source, target, actorId);
  if (availability) return availability;
  const requestHash = hash({
    sourcePackageId: source.id,
    sourcePackageVersion: source.version,
    targetPackageId: target.id,
    targetPackageVersion: target.version,
  });
  const existing = state.privateTutorContentMigrationPreviews.find((item) =>
    item.learnerId === learner.id && item.actorId === actorId && item.idempotencyKey === idempotencyKey);
  if (existing) {
    if (existing.requestHash !== requestHash) return failure(409, "private_tutor_content_migration_idempotency_conflict");
    return { ok: true, status: 200, preview: migrationPreviewView(existing), replayed: true };
  }
  const sourceState = packageStateFor(state, learner, source.id, source.version);
  if (!sourceState) return failure(409, "private_tutor_content_migration_source_state_required");
  const preview = {
    id: nextId("ptcmp"),
    schemaVersion: PRIVATE_TUTOR_CONTENT_MIGRATION_SCHEMA_VERSION,
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    actorId,
    idempotencyKey,
    requestHash,
    source: packageIdentity(source),
    target: packageIdentity(target),
    revision: 1,
    status: "draft",
    mappings: buildMappings(source, target, sourceState, null),
    targetAdditions: [],
    impact: null,
    previewFingerprint: null,
    confirmation: null,
    createdAt: now(),
    updatedAt: null,
  };
  recomputePreview(preview, state, learner, source, target);
  preview.updatedAt = preview.createdAt;
  state.privateTutorContentMigrationPreviews.unshift(preview);
  return { ok: true, status: 201, preview: migrationPreviewView(preview), replayed: false };
}

export function updatePrivateTutorContentMigrationMapping(state, learner, actorId, previewId, input, { now } = {}) {
  ensureCollections(state);
  const preview = ownedPreview(state, learner, actorId, previewId);
  if (!preview) return failure(404, "private_tutor_content_migration_not_found");
  if (preview.status !== "draft") return failure(409, "private_tutor_content_migration_not_editable");
  if (Number(input?.expectedRevision) !== preview.revision) return failure(409, "private_tutor_content_migration_revision_conflict");
  const source = exactPackage(state, preview.source.packageId, preview.source.packageVersion);
  const target = exactPackage(state, preview.target.packageId, preview.target.packageVersion);
  if (!packagesStillMatch(preview, source, target)) return failure(409, "private_tutor_content_migration_preview_stale");
  const normalized = normalizeMappingInput(input?.mappings, source, target);
  if (!normalized.ok) return normalized;
  const sourceState = packageStateFor(state, learner, source.id, source.version);
  const mappings = buildMappings(source, target, sourceState, normalized.mappings);
  const invalidDecision = invalidMappingDecision(mappings);
  if (invalidDecision) return failure(400, invalidDecision);
  preview.mappings = mappings;
  preview.revision += 1;
  preview.confirmation = null;
  recomputePreview(preview, state, learner, source, target);
  preview.updatedAt = now();
  return { ok: true, status: 200, preview: migrationPreviewView(preview) };
}

export function confirmPrivateTutorContentMigration(state, learner, actorId, previewId, input, { now } = {}) {
  ensureCollections(state);
  const preview = ownedPreview(state, learner, actorId, previewId);
  if (!preview) return failure(404, "private_tutor_content_migration_not_found");
  if (preview.status !== "draft") return failure(409, "private_tutor_content_migration_not_confirmable");
  if (Number(input?.expectedRevision) !== preview.revision
    || String(input?.previewFingerprint ?? "") !== preview.previewFingerprint) {
    return failure(409, "private_tutor_content_migration_revision_conflict");
  }
  const source = exactPackage(state, preview.source.packageId, preview.source.packageVersion);
  const target = exactPackage(state, preview.target.packageId, preview.target.packageVersion);
  if (!packagesStillMatch(preview, source, target)) return failure(409, "private_tutor_content_migration_preview_stale");
  if (input?.acknowledgeHistoricalPreservation !== true) {
    return failure(400, "private_tutor_content_migration_history_acknowledgement_required");
  }
  if (preview.impact.requiresExplicitConfirmation && input?.acknowledgeRiskyMappings !== true) {
    return failure(400, "private_tutor_content_migration_risk_acknowledgement_required");
  }
  const confirmedAt = now();
  preview.status = "confirmed";
  preview.confirmation = {
    actorId,
    revision: preview.revision,
    fingerprint: preview.previewFingerprint,
    acknowledgeHistoricalPreservation: true,
    acknowledgeRiskyMappings: input?.acknowledgeRiskyMappings === true,
    confirmedAt,
  };
  preview.updatedAt = confirmedAt;
  return { ok: true, status: 200, preview: migrationPreviewView(preview) };
}

export function applyPrivateTutorContentMigration(state, learner, actorId, previewId, input, {
  now,
  nextId,
} = {}) {
  ensureCollections(state);
  const preview = ownedPreview(state, learner, actorId, previewId);
  if (!preview) return failure(404, "private_tutor_content_migration_not_found");
  const idempotencyKey = normalizedIdempotencyKey(input?.idempotencyKey);
  if (!idempotencyKey) return failure(400, "invalid_private_tutor_content_migration_idempotency_key");
  const existing = state.privateTutorContentMigrationApplications.find((item) =>
    item.learnerId === learner.id && item.actorId === actorId && item.idempotencyKey === idempotencyKey);
  if (existing) {
    if (existing.previewId !== preview.id || existing.previewFingerprint !== input?.previewFingerprint) {
      return failure(409, "private_tutor_content_migration_idempotency_conflict");
    }
    return { ok: true, status: 200, application: migrationApplicationView(existing), replayed: true };
  }
  if (preview.status !== "confirmed"
    || preview.confirmation?.fingerprint !== preview.previewFingerprint
    || String(input?.previewFingerprint ?? "") !== preview.previewFingerprint) {
    return failure(409, "private_tutor_content_migration_confirmation_required");
  }
  const source = exactPackage(state, preview.source.packageId, preview.source.packageVersion);
  const target = exactPackage(state, preview.target.packageId, preview.target.packageVersion);
  if (!packagesStillMatch(preview, source, target)) return failure(409, "private_tutor_content_migration_preview_stale");
  if (packageStateFor(state, learner, target.id, target.version)) {
    return failure(409, "private_tutor_content_migration_target_state_exists");
  }
  const sourceState = packageStateFor(state, learner, source.id, source.version);
  if (!sourceState) return failure(409, "private_tutor_content_migration_source_state_required");
  const sourceFactsBefore = matchingRows(state.privateTutorAttempts, learner.id, source.id, source.version).length;
  const targetState = buildTargetPackageState(preview, sourceState, target, now());
  const snapshot = state.privateTutorSnapshots.find((item) => item.learnerId === learner.id);
  snapshot.packageStates ??= [];
  snapshot.packageStates.push(targetState);
  snapshot.revision += 1;
  snapshot.updatedAt = targetState.updatedAt;
  const targetStateFingerprint = hash(targetState);
  const application = {
    id: nextId("ptcma"),
    schemaVersion: PRIVATE_TUTOR_CONTENT_MIGRATION_SCHEMA_VERSION,
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    actorId,
    previewId: preview.id,
    previewFingerprint: preview.previewFingerprint,
    idempotencyKey,
    source: structuredClone(preview.source),
    target: structuredClone(preview.target),
    status: "applied",
    transferredKnowledgeCount: preview.mappings.filter((item) => item.decision === "transfer").length,
    provisionalKnowledgeCount: new Set(preview.mappings.filter((item) => item.decision === "provisional").flatMap((item) => item.targetKnowledgeIds)).size,
    archivedKnowledgeCount: preview.mappings.filter((item) => item.decision === "archive").length,
    targetStateFingerprint,
    appliedAt: targetState.updatedAt,
    rolledBackAt: null,
    rollbackReceipt: {
      sourceFactCountBefore: sourceFactsBefore,
      sourceFactCountAfter: matchingRows(state.privateTutorAttempts, learner.id, source.id, source.version).length,
      sourceFactsRewritten: 0,
      targetStateFingerprint,
      targetPackageWasActivated: false,
    },
  };
  state.privateTutorContentMigrationApplications.unshift(application);
  preview.status = "applied";
  preview.applicationId = application.id;
  preview.updatedAt = application.appliedAt;
  return { ok: true, status: 200, application: migrationApplicationView(application), replayed: false };
}

export function rollbackPrivateTutorContentMigration(state, learner, actorId, applicationId, input, { now } = {}) {
  ensureCollections(state);
  const application = state.privateTutorContentMigrationApplications.find((item) =>
    item.id === applicationId && item.learnerId === learner.id && item.actorId === actorId);
  if (!application) return failure(404, "private_tutor_content_migration_application_not_found");
  if (application.status === "rolled_back") return { ok: true, status: 200, application: migrationApplicationView(application), replayed: true };
  if (application.status !== "applied" || input?.confirmRollback !== true) {
    return failure(400, "private_tutor_content_migration_rollback_confirmation_required");
  }
  const snapshot = state.privateTutorSnapshots.find((item) => item.learnerId === learner.id);
  if (snapshot.contentPackageId === application.target.packageId
    && snapshot.contentPackageVersion === application.target.packageVersion) {
    return failure(409, "private_tutor_content_migration_target_is_active");
  }
  const index = snapshot.packageStates?.findIndex((item) => samePackageVersion(item, application.target)) ?? -1;
  const targetState = index >= 0 ? snapshot.packageStates[index] : null;
  if (!targetState || hash(targetState) !== application.targetStateFingerprint) {
    return failure(409, "private_tutor_content_migration_rollback_state_changed");
  }
  snapshot.packageStates.splice(index, 1);
  snapshot.revision += 1;
  snapshot.updatedAt = now();
  application.status = "rolled_back";
  application.rolledBackAt = snapshot.updatedAt;
  application.rollbackVerification = {
    targetStatePresent: snapshot.packageStates.some((item) => samePackageVersion(item, application.target)),
    sourceFactsRewritten: 0,
  };
  const preview = state.privateTutorContentMigrationPreviews.find((item) => item.id === application.previewId);
  if (preview) {
    preview.status = "rolled_back";
    preview.updatedAt = snapshot.updatedAt;
  }
  return { ok: true, status: 200, application: migrationApplicationView(application), replayed: false };
}

function recomputePreview(preview, state, learner, source, target) {
  preview.targetAdditions = target.knowledgeComponents
    .filter((item) => !preview.mappings.some((mapping) => mapping.targetKnowledgeIds.includes(item.id)))
    .map((item) => ({ knowledgeId: item.id, name: item.name, status: "added" }));
  const sourcePlans = matchingRows(state.privateTutorLearningPlans, learner.id, source.id, source.version);
  const sourceSessions = matchingRows(state.privateTutorSessions, learner.id, source.id, source.version);
  preview.impact = {
    sourceKnowledgeCount: source.knowledgeComponents.length,
    targetKnowledgeCount: target.knowledgeComponents.length,
    transferableKnowledgeCount: preview.mappings.filter((item) => item.decision === "transfer").length,
    provisionalKnowledgeCount: preview.mappings.filter((item) => item.decision === "provisional").length,
    archivedKnowledgeCount: preview.mappings.filter((item) => item.decision === "archive").length,
    addedKnowledgeCount: preview.targetAdditions.length,
    transferableEvidenceCount: preview.mappings.filter((item) => item.decision === "transfer").reduce((sum, item) => sum + item.sourceEvidenceCount, 0),
    provisionalEvidenceCount: preview.mappings.filter((item) => item.decision === "provisional").reduce((sum, item) => sum + item.sourceEvidenceCount, 0),
    archivedEvidenceCount: preview.mappings.filter((item) => item.decision === "archive").reduce((sum, item) => sum + item.sourceEvidenceCount, 0),
    affectedActivePlanCount: sourcePlans.filter((item) => item.status === "active").length,
    affectedOpenSessionCount: sourceSessions.filter((item) => ["active", "paused"].includes(item.status)).length,
    activeRuntimeWillChange: false,
    targetActivationRequired: true,
    targetStateExists: Boolean(packageStateFor(state, learner, target.id, target.version)),
    requiresExplicitConfirmation: preview.mappings.some((item) => item.compatibility !== "safe" || item.decision !== "transfer"),
  };
  preview.previewFingerprint = hash(previewFingerprintPayload(preview));
}

function buildMappings(source, target, sourceState, overrides) {
  const targetById = new Map(target.knowledgeComponents.map((item) => [item.id, item]));
  const overrideBySource = new Map((overrides ?? []).map((item) => [item.sourceKnowledgeId, item]));
  const autoTargets = automaticTargetCandidates(source, target);
  const raw = source.knowledgeComponents.map((sourceKnowledge) => {
    const override = overrideBySource.get(sourceKnowledge.id);
    const targetKnowledgeIds = override?.targetKnowledgeIds ?? autoTargets.get(sourceKnowledge.id) ?? [];
    const sourceEvidenceCount = sourceState?.knowledge?.find((item) => item.id === sourceKnowledge.id)?.evidenceCount ?? 0;
    return {
      sourceKnowledgeId: sourceKnowledge.id,
      sourceName: sourceKnowledge.name ?? sourceKnowledge.id,
      targetKnowledgeIds,
      targetNames: targetKnowledgeIds.map((id) => targetById.get(id)?.name ?? id),
      sourceEvidenceCount,
      requestedDecision: override?.decision ?? null,
    };
  });
  const targetUse = new Map();
  for (const item of raw) for (const targetId of item.targetKnowledgeIds) {
    targetUse.set(targetId, (targetUse.get(targetId) ?? 0) + 1);
  }
  return raw.map((item) => {
    const sourceKnowledge = source.knowledgeComponents.find((knowledge) => knowledge.id === item.sourceKnowledgeId);
    const targetKnowledge = item.targetKnowledgeIds.length === 1 ? targetById.get(item.targetKnowledgeIds[0]) : null;
    const merged = item.targetKnowledgeIds.some((id) => targetUse.get(id) > 1);
    const relation = item.targetKnowledgeIds.length === 0
      ? "removed"
      : item.targetKnowledgeIds.length > 1 ? "split"
        : merged ? "merged"
          : knowledgeRelation(sourceKnowledge, targetKnowledge);
    const compatibility = relation === "unchanged" || relation === "renamed" ? "safe"
      : relation === "removed" ? "archive_only" : "review_required";
    const defaultDecision = compatibility === "safe" ? "transfer"
      : compatibility === "archive_only" ? "archive" : "provisional";
    return {
      sourceKnowledgeId: item.sourceKnowledgeId,
      sourceName: item.sourceName,
      targetKnowledgeIds: [...item.targetKnowledgeIds],
      targetNames: item.targetNames,
      relation,
      compatibility,
      decision: item.requestedDecision ?? defaultDecision,
      sourceEvidenceCount: item.sourceEvidenceCount,
      changes: knowledgeChanges(sourceKnowledge, targetKnowledge, relation),
    };
  });
}

function automaticTargetCandidates(source, target) {
  const result = new Map();
  const targetById = new Map(target.knowledgeComponents.map((item) => [item.id, item]));
  const targetByName = groupBy(target.knowledgeComponents, (item) => normalized(item.name));
  for (const item of source.knowledgeComponents) {
    if (targetById.has(item.id)) {
      result.set(item.id, [item.id]);
      continue;
    }
    const sameName = targetByName.get(normalized(item.name)) ?? [];
    result.set(item.id, sameName.length === 1 ? [sameName[0].id] : []);
  }
  return result;
}

function knowledgeRelation(source, target) {
  if (!target) return "removed";
  const sameSemantics = knowledgeSemanticFingerprint(source) === knowledgeSemanticFingerprint(target);
  if (sameSemantics && normalized(source.name) === normalized(target.name)) return "unchanged";
  if (sameSemantics) return "renamed";
  return "changed";
}

function knowledgeChanges(source, target, relation) {
  if (!target) return ["knowledge_removed"];
  if (["split", "merged"].includes(relation)) return [`knowledge_${relation}`, "mastery_requires_reassessment"];
  const changes = [];
  if (normalized(source.name) !== normalized(target.name)) changes.push("name_changed");
  if (hash(source.learningObjectives ?? []) !== hash(target.learningObjectives ?? [])) changes.push("objectives_changed");
  if (hash(source.prerequisiteKnowledgeIds ?? []) !== hash(target.prerequisiteKnowledgeIds ?? [])) changes.push("prerequisites_changed");
  if (sourceGroundingFingerprint(source) !== sourceGroundingFingerprint(target)) changes.push("source_grounding_changed");
  if (questionFingerprint(source) !== questionFingerprint(target)) changes.push("questions_or_rubrics_changed");
  return changes;
}

function buildTargetPackageState(preview, sourceState, target, at) {
  const sourceById = new Map((sourceState.knowledge ?? []).map((item) => [item.id, item]));
  const knowledge = target.knowledgeComponents.map((item) => ({
    id: item.id,
    mastery: null,
    level: "unknown",
    evidenceCount: 0,
  }));
  const targetById = new Map(knowledge.map((item) => [item.id, item]));
  for (const mapping of preview.mappings) {
    const source = sourceById.get(mapping.sourceKnowledgeId);
    if (!source || mapping.decision === "archive") continue;
    for (const targetKnowledgeId of mapping.targetKnowledgeIds) {
      const targetKnowledge = targetById.get(targetKnowledgeId);
      if (!targetKnowledge) continue;
      if (mapping.decision === "transfer") {
        targetKnowledge.mastery = source.mastery ?? null;
        targetKnowledge.level = source.level ?? "unknown";
        targetKnowledge.evidenceCount = Number(source.evidenceCount ?? 0);
      } else {
        targetKnowledge.migratedEvidenceCount = (targetKnowledge.migratedEvidenceCount ?? 0) + Number(source.evidenceCount ?? 0);
        targetKnowledge.requiresReassessment = true;
      }
      targetKnowledge.migrationSources ??= [];
      targetKnowledge.migrationSources.push({
        packageId: preview.source.packageId,
        packageVersion: preview.source.packageVersion,
        knowledgeId: mapping.sourceKnowledgeId,
        relation: mapping.relation,
        decision: mapping.decision,
      });
    }
  }
  return {
    packageId: target.id,
    packageVersion: target.version,
    knowledge,
    diagnosticCompletedAt: null,
    latestAssessmentId: null,
    migratedByPreviewId: preview.id,
    migrationFingerprint: preview.previewFingerprint,
    updatedAt: at,
  };
}

function normalizeMappingInput(input, source, target) {
  if (!Array.isArray(input) || input.length !== source.knowledgeComponents.length || input.length > MAX_MAPPINGS) {
    return failure(400, "invalid_private_tutor_content_migration_mapping");
  }
  const sourceIds = new Set(source.knowledgeComponents.map((item) => item.id));
  const targetIds = new Set(target.knowledgeComponents.map((item) => item.id));
  const seen = new Set();
  const mappings = [];
  for (const value of input) {
    const sourceKnowledgeId = String(value?.sourceKnowledgeId ?? "").trim();
    const targetKnowledgeIds = Array.isArray(value?.targetKnowledgeIds)
      ? [...new Set(value.targetKnowledgeIds.map((item) => String(item ?? "").trim()).filter(Boolean))]
      : [];
    const decision = String(value?.decision ?? "").trim();
    if (!sourceIds.has(sourceKnowledgeId) || seen.has(sourceKnowledgeId)
      || targetKnowledgeIds.length > 8 || targetKnowledgeIds.some((id) => !targetIds.has(id))
      || !DECISIONS.has(decision)) {
      return failure(400, "invalid_private_tutor_content_migration_mapping");
    }
    seen.add(sourceKnowledgeId);
    mappings.push({ sourceKnowledgeId, targetKnowledgeIds, decision });
  }
  return { ok: true, mappings };
}

function invalidMappingDecision(mappings) {
  for (const item of mappings) {
    if (item.decision === "transfer" && (item.targetKnowledgeIds.length !== 1 || ["split", "merged", "removed"].includes(item.relation))) {
      return "private_tutor_content_migration_unsafe_transfer";
    }
    if (item.decision === "provisional" && item.targetKnowledgeIds.length === 0) {
      return "private_tutor_content_migration_provisional_target_required";
    }
  }
  return null;
}

function exactPackages(state) {
  const values = new Map();
  for (const pkg of state.privateTutorContentPackages ?? []) values.set(`${pkg.id}@${pkg.version}`, structuredClone(pkg));
  const registry = privateTutorPackageRegistryFromState(state);
  for (const summary of registry.listPackages()) {
    const pkg = registry.getPackage(summary.id);
    if (pkg) values.set(`${pkg.id}@${pkg.version}`, pkg);
  }
  return [...values.values()];
}

function exactPackage(state, packageIdInput, packageVersionInput) {
  const packageId = String(packageIdInput ?? "").trim();
  const packageVersion = String(packageVersionInput ?? "").trim();
  return exactPackages(state).find((item) => item.id === packageId && item.version === packageVersion) ?? null;
}

function validatePackagePair(source, target, actorId) {
  if (!source || !target || !packageVisible(source, actorId) || !packageVisible(target, actorId)) {
    return failure(404, "private_tutor_content_migration_package_not_found");
  }
  if (source.id === target.id && source.version === target.version) return failure(400, "private_tutor_content_migration_same_version");
  if (target.status != null && target.status !== "published") return failure(409, "private_tutor_content_migration_target_unavailable");
  if (!source.knowledgeComponents?.length || !target.knowledgeComponents?.length) {
    return failure(409, "private_tutor_content_migration_knowledge_required");
  }
  return null;
}

function packagesStillMatch(preview, source, target) {
  return source && target
    && preview.source.contentChecksum === packageContentFingerprint(source)
    && preview.target.contentChecksum === packageContentFingerprint(target);
}

function packageVisible(pkg, actorId) {
  return pkg?.sourceType !== "user_material" || pkg.learningProfileId === actorId;
}

function packageIdentity(pkg) {
  return {
    packageId: pkg.id,
    packageVersion: pkg.version,
    packageName: pkg.name,
    contentChecksum: packageContentFingerprint(pkg),
    sourceHash: pkg.source?.sourceHash ?? null,
  };
}

function packageContentFingerprint(pkg) {
  return pkg.contentChecksum ?? hash({
    id: pkg.id,
    version: pkg.version,
    source: pkg.source ?? null,
    modules: pkg.modules ?? [],
    knowledgeComponents: pkg.knowledgeComponents ?? [],
  });
}

function packageStateFor(state, learner, packageId, packageVersion) {
  const snapshot = state.privateTutorSnapshots.find((item) => item.learnerId === learner.id);
  if (!snapshot) return null;
  if (snapshot.contentPackageId === packageId && snapshot.contentPackageVersion === packageVersion) {
    return { packageId, packageVersion, knowledge: snapshot.knowledge ?? [], diagnosticCompletedAt: snapshot.diagnosticCompletedAt ?? null, latestAssessmentId: snapshot.latestAssessmentId ?? null };
  }
  return snapshot.packageStates?.find((item) => item.packageId === packageId && item.packageVersion === packageVersion) ?? null;
}

function matchingRows(rows, learnerId, packageId, packageVersion) {
  return (rows ?? []).filter((item) => item.learnerId === learnerId
    && item.contentPackageId === packageId && item.contentPackageVersion === packageVersion);
}

function ownedPreview(state, learner, actorId, previewId) {
  return state.privateTutorContentMigrationPreviews.find((item) =>
    item.id === previewId && item.learnerId === learner.id && item.actorId === actorId) ?? null;
}

function migrationPreviewView(preview) {
  return structuredClone({
    id: preview.id,
    schemaVersion: preview.schemaVersion,
    learnerId: preview.learnerId,
    source: preview.source,
    target: preview.target,
    revision: preview.revision,
    status: preview.status,
    mappings: preview.mappings,
    targetAdditions: preview.targetAdditions,
    impact: preview.impact,
    previewFingerprint: preview.previewFingerprint,
    confirmation: preview.confirmation,
    applicationId: preview.applicationId ?? null,
    createdAt: preview.createdAt,
    updatedAt: preview.updatedAt,
  });
}

function migrationApplicationView(application) {
  return structuredClone({
    id: application.id,
    schemaVersion: application.schemaVersion,
    learnerId: application.learnerId,
    previewId: application.previewId,
    previewFingerprint: application.previewFingerprint,
    source: application.source,
    target: application.target,
    status: application.status,
    transferredKnowledgeCount: application.transferredKnowledgeCount,
    provisionalKnowledgeCount: application.provisionalKnowledgeCount,
    archivedKnowledgeCount: application.archivedKnowledgeCount,
    appliedAt: application.appliedAt,
    rolledBackAt: application.rolledBackAt,
    rollbackReceipt: application.rollbackReceipt,
    rollbackVerification: application.rollbackVerification ?? null,
  });
}

function previewFingerprintPayload(preview) {
  return {
    schemaVersion: preview.schemaVersion,
    source: preview.source,
    target: preview.target,
    revision: preview.revision,
    mappings: preview.mappings,
    targetAdditions: preview.targetAdditions,
    impact: preview.impact,
  };
}

function knowledgeSemanticFingerprint(item) {
  return hash({
    learningObjectives: item.learningObjectives ?? [],
    prerequisiteKnowledgeIds: item.prerequisiteKnowledgeIds ?? [],
    sourceGrounding: sourceGroundingFingerprint(item),
    questions: questionFingerprint(item),
  });
}

function sourceGroundingFingerprint(item) {
  return hash((item.sourceRefs ?? []).map((ref) => ({
    sourceHash: ref.sourceHash ?? null,
    sectionId: ref.sectionId ?? null,
    pageNumber: ref.pageNumber ?? null,
    excerpt: ref.excerpt ?? null,
  })));
}

function questionFingerprint(item) {
  return hash(["diagnosticQuestions", "tutoringQuestions", "dailyQuestions", "reviewQuestions"].flatMap((key) =>
    (item[key] ?? []).map((question) => ({
      context: key,
      prompt: question.prompt,
      kind: question.kind,
      referenceAnswer: question.referenceAnswer ?? null,
      expectedAnswer: question.expectedAnswer ?? null,
      expectedChoice: question.expectedChoice ?? null,
      rubric: question.rubric ?? null,
      requiredSourceRefs: question.requiredSourceRefs ?? [],
    }))));
}

function ensureCollections(state) {
  for (const key of ["privateTutorContentMigrationPreviews", "privateTutorContentMigrationApplications"]) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
}

function samePackageVersion(state, identity) {
  return state.packageId === identity.packageId && state.packageVersion === identity.packageVersion;
}

function normalized(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function normalizedIdempotencyKey(value) {
  const key = String(value ?? "").trim();
  return key && key.length <= 128 ? key : null;
}

function groupBy(values, keyFor) {
  const result = new Map();
  for (const value of values) {
    const key = keyFor(value);
    const rows = result.get(key) ?? [];
    rows.push(value);
    result.set(key, rows);
  }
  return result;
}

function compareVersions(left, right) {
  return String(left).localeCompare(String(right), undefined, { numeric: true });
}

function failure(status, error) {
  return { ok: false, status, error };
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
