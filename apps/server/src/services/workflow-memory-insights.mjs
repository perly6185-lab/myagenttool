import { createHash } from "node:crypto";

const PATH_KINDS = ["entry", "reference", "intermediate", "final", "ledger"];
const CURRENT_CASE_STATES = new Set(["confirmed", "active", "completed"]);
const LEDGER_DOCUMENT_TYPES = new Set(["inquiry_ledger", "quotation_ledger", "order_ledger"]);
const REFERENCE_DOCUMENT_TYPES = new Set(["price_list", "customer_reference", "other_reference"]);
const OMITTED_DIFF_KEYS = new Set(["packageId", "contentHash", "generatedAt"]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function finiteRatio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function safePath(value) {
  const path = typeof value === "string" ? value.trim().replaceAll("\\", "/") : "";
  if (!path || path.startsWith("/") || /^[a-zA-Z]:\//.test(path)) return null;
  const parts = path.split("/").filter((part) => part && part !== ".");
  if (!parts.length || parts.includes("..") || parts.some((part) => part.includes("\0"))) return null;
  return parts.join("/");
}

function directoryOf(value) {
  const path = safePath(value);
  if (!path) return null;
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
}

function scopeFor(input = {}) {
  const state = input.state;
  const ownerTeamId = typeof input.ownerTeamId === "string" && input.ownerTeamId.trim()
    ? input.ownerTeamId.trim()
    : null;
  const projectId = typeof input.projectId === "string" && input.projectId.trim()
    ? input.projectId.trim()
    : null;
  const sourceId = typeof input.sourceId === "string" && input.sourceId.trim()
    ? input.sourceId.trim()
    : null;
  if (!state || typeof state !== "object" || !ownerTeamId || !projectId || !sourceId) {
    return { error: "workflow_memory_insights_scope_required" };
  }
  const source = (state.workflowSources ?? []).find((row) =>
    row?.id === sourceId && row.ownerTeamId === ownerTeamId && row.projectId === projectId) ?? null;
  if (!source) return { error: "workflow_memory_insights_source_not_found" };
  if (source.state !== "active") return { error: "workflow_memory_insights_source_not_active" };
  return { state, ownerTeamId, projectId, sourceId, source };
}

function scopedRows(scope, key) {
  return (scope.state[key] ?? []).filter((row) =>
    row?.ownerTeamId === scope.ownerTeamId
    && row.projectId === scope.projectId
    && row.sourceId === scope.sourceId);
}

function currentArtifact(scope, artifactId, expectedFingerprint = null) {
  const artifact = scopedRows(scope, "workflowArtifacts").find((row) => row.id === artifactId) ?? null;
  if (!artifact || artifact.availability === "missing" || artifact.exclusion) return null;
  if (expectedFingerprint && artifact.fingerprint !== expectedFingerprint) return null;
  return artifact;
}

function evidence(kind, id, extra = {}) {
  return { kind, id, ...extra };
}

function addPath(bucket, kind, path, itemEvidence) {
  const normalized = safePath(path) ?? (path === "." ? "." : null);
  if (!normalized || !PATH_KINDS.includes(kind) || !itemEvidence) return;
  const record = bucket.get(kind).get(normalized) ?? { path: normalized, evidence: [] };
  if (!record.evidence.some((row) => row.kind === itemEvidence.kind && row.id === itemEvidence.id)) {
    record.evidence.push(itemEvidence);
  }
  bucket.get(kind).set(normalized, record);
}

function evidenceBackedPaths(scope) {
  const bucket = new Map(PATH_KINDS.map((kind) => [kind, new Map()]));
  for (const deliveryCase of scopedRows(scope, "deliveryCases").filter((row) => row.state === "confirmed")) {
    const snapshots = new Map((deliveryCase.evidenceSnapshots ?? []).map((row) => [row.artifactId, row]));
    const bindings = [
      ["entry", deliveryCase.requirementArtifactIds ?? []],
      ["reference", deliveryCase.referenceArtifactIds ?? []],
      ["intermediate", deliveryCase.draftArtifactIds ?? []],
      ["final", deliveryCase.deliveryArtifactIds ?? []],
    ];
    for (const [kind, artifactIds] of bindings) {
      for (const artifactId of artifactIds) {
        const snapshot = snapshots.get(artifactId);
        const artifact = currentArtifact(scope, artifactId, snapshot?.fingerprint ?? null);
        if (!snapshot || !artifact) continue;
        addPath(bucket, kind, directoryOf(artifact.relativePath), evidence("delivery_case", deliveryCase.id, {
          artifactId,
          role: snapshot.role ?? kind,
          fingerprint: snapshot.fingerprint,
        }));
      }
    }
  }
  const cases = scopedRows(scope, "businessCases").filter((row) => CURRENT_CASE_STATES.has(row.state));
  for (const businessCase of cases) {
    for (const binding of businessCase.artifactBindings ?? []) {
      const artifact = currentArtifact(
        scope,
        binding.artifactId,
        businessCase.artifactFingerprints?.[binding.artifactId] ?? null,
      );
      if (!artifact) continue;
      const path = directoryOf(artifact.relativePath);
      const proof = evidence("business_case_binding", businessCase.id, {
        artifactId: artifact.id,
        documentType: binding.documentType,
        roles: [...new Set(binding.roles ?? [])].sort(),
      });
      if (binding.roles?.some((role) => role === "trigger" || role === "input")) {
        addPath(bucket, "entry", path, proof);
      }
      if (binding.roles?.includes("reference") || REFERENCE_DOCUMENT_TYPES.has(binding.documentType)) {
        addPath(bucket, "reference", path, proof);
      }
      if (binding.roles?.includes("output")) {
        addPath(bucket, LEDGER_DOCUMENT_TYPES.has(binding.documentType) ? "ledger" : "final", path, proof);
      }
    }
  }

  for (const definition of scopedRows(scope, "routineDefinitions").filter((row) => row.state === "published")) {
    for (const step of definition.steps ?? []) {
      const outputDirectory = safePath(step.configuration?.outputDirectory);
      if (step.kind === "generate" && outputDirectory
        && /(?:draft|草稿|临时|中间)/i.test(`${step.key ?? ""} ${step.label ?? ""}`)) {
        addPath(bucket, "intermediate", outputDirectory, evidence("routine_step", definition.id, {
          version: definition.version,
          stepKey: step.key,
        }));
      }
    }
  }

  for (const ledger of scopedRows(scope, "ledgerDefinitions")
    .filter((row) => ["active", "published"].includes(row.state))) {
    addPath(bucket, "ledger", directoryOf(ledger.relativePath), evidence("ledger_definition", ledger.id, {
      relativePath: safePath(ledger.relativePath),
      revision: ledger.revision ?? null,
    }));
  }

  for (const outcome of scopedRows(scope, "workflowAdaptiveOutcomes").filter((row) => row.status === "completed")) {
    const passed = (outcome.verification ?? []).some((row) => row.status === "passed");
    if (!passed) continue;
    for (const asset of outcome.outputAssets ?? []) {
      addPath(bucket, "final", directoryOf(asset.path), evidence("verified_outcome", outcome.id, {
        workItemId: outcome.workItemId ?? null,
        assetId: asset.id ?? null,
      }));
    }
  }
  return bucket;
}

export function deriveWorkflowPathGraph(input = {}) {
  const scope = scopeFor(input);
  if (scope.error) return { ok: false, error: scope.error };
  const paths = evidenceBackedPaths(scope);
  const nodes = PATH_KINDS.map((kind) => {
    const records = [...paths.get(kind).values()]
      .sort((left, right) => left.path.localeCompare(right.path));
    return {
      id: `path:${kind}`,
      kind,
      state: records.length ? "confirmed" : "unknown",
      paths: records,
    };
  });
  const requestedRoutineId = typeof input.routineDefinitionId === "string"
    ? input.routineDefinitionId.trim()
    : "";
  const published = scopedRows(scope, "routineDefinitions").filter((row) =>
    row.state === "published" && (!requestedRoutineId || row.id === requestedRoutineId));
  const edges = [];
  if (published.length === 1) {
    const proof = [evidence("routine_definition", published[0].id, { version: published[0].version })];
    const confirmedKinds = nodes.filter((node) => node.state === "confirmed").map((node) => node.kind);
    const ordered = PATH_KINDS.filter((kind) => confirmedKinds.includes(kind));
    for (let index = 1; index < ordered.length; index += 1) {
      edges.push({ from: `path:${ordered[index - 1]}`, to: `path:${ordered[index]}`, evidence: proof });
    }
  }
  const graph = {
    schemaVersion: 1,
    scope: { ownerTeamId: scope.ownerTeamId, projectId: scope.projectId, sourceId: scope.sourceId },
    nodes,
    edges,
    unknownKinds: nodes.filter((node) => node.state === "unknown").map((node) => node.kind),
  };
  return { ok: true, graph: { ...graph, contentHash: digest(graph) } };
}

function latestProfile(scope) {
  const latestByFamily = new Map();
  for (const profile of scopedRows(scope, "workflowProfiles")
    .filter((row) => ["established", "published", "active"].includes(row.state ?? "established"))) {
    const familyId = profile.familyId ?? profile.name ?? profile.id;
    const current = latestByFamily.get(familyId);
    if (!current || Number(profile.profileVersion ?? 0) > Number(current.profileVersion ?? 0)) {
      latestByFamily.set(familyId, profile);
    }
  }
  return latestByFamily.size === 1 ? [...latestByFamily.values()][0] : null;
}

function uniquePublishedRoutine(scope, requestedId = null) {
  const candidates = scopedRows(scope, "routineDefinitions")
    .filter((row) => requestedId
      ? row.id === requestedId && ["published", "superseded", "disabled"].includes(row.state)
      : row.state === "published");
  return candidates.length === 1 ? candidates[0] : null;
}

function documentTypesForRole(scope, role) {
  const types = new Set();
  const proofs = [];
  for (const businessCase of scopedRows(scope, "businessCases").filter((row) => CURRENT_CASE_STATES.has(row.state))) {
    for (const binding of businessCase.artifactBindings ?? []) {
      if (!binding.roles?.includes(role)) continue;
      const artifact = currentArtifact(scope, binding.artifactId, businessCase.artifactFingerprints?.[binding.artifactId]);
      if (!artifact) continue;
      types.add(binding.documentType);
      proofs.push(evidence("business_case_binding", businessCase.id, { artifactId: artifact.id }));
    }
  }
  return { values: [...types].sort(), evidence: proofs.slice(0, 100) };
}

function section(state, value, itemEvidence = []) {
  return { state, value, evidence: itemEvidence };
}

export function buildWorkflowMemoryPackage(input = {}) {
  const scope = scopeFor(input);
  if (scope.error) return { ok: false, error: scope.error };
  const version = Number(input.version);
  if (!Number.isInteger(version) || version < 1) {
    return { ok: false, error: "workflow_memory_package_version_required" };
  }
  const graphResult = deriveWorkflowPathGraph(input);
  if (!graphResult.ok) return graphResult;
  const routine = uniquePublishedRoutine(scope, input.routineDefinitionId ?? null);
  if (input.routineDefinitionId && !routine) {
    return { ok: false, error: "workflow_memory_package_routine_not_found" };
  }
  const profile = latestProfile(scope);
  const entryNode = graphResult.graph.nodes.find((row) => row.kind === "entry");
  const referenceNode = graphResult.graph.nodes.find((row) => row.kind === "reference");
  const finalNode = graphResult.graph.nodes.find((row) => row.kind === "final");
  const triggerTypes = routine?.triggerDocumentTypes?.length
    ? { values: [...new Set(routine.triggerDocumentTypes)].sort(), evidence: [evidence("routine_definition", routine.id, { version: routine.version })] }
    : documentTypesForRole(scope, "trigger");
  const referenceTypes = documentTypesForRole(scope, "reference");
  const outputDirectories = new Set(finalNode.paths.map((row) => row.path));
  for (const directory of profile?.outcomeSpec?.observedDirectories ?? []) {
    const path = safePath(directory) ?? (directory === "." ? "." : null);
    if (path) outputDirectories.add(path);
  }
  const outputEvidence = [
    ...finalNode.paths.flatMap((row) => row.evidence),
    ...(profile ? [evidence("workflow_profile", profile.id, { version: profile.profileVersion })] : []),
  ];
  const namingTemplate = safePath(profile?.outcomeSpec?.pathTemplate);
  const acceptance = [
    ...(routine?.steps ?? []).filter((step) => step.required).map((step) => ({
      key: step.key,
      label: step.label,
      source: "routine_step",
    })),
    ...(profile?.outcomeSpec?.requiredSections ?? []).filter((item) => item.required).map((item) => ({
      key: item.key,
      label: item.label,
      source: "profile_required_section",
    })),
    ...(profile?.outcomeSpec?.requiredFields ?? []).filter((item) => item.required).map((item) => ({
      key: item.key,
      label: item.label,
      source: "profile_required_field",
    })),
  ];
  const gates = (routine?.steps ?? []).filter((step) =>
    ["human_approval", "condition", "ledger_upsert"].includes(step.kind)).map((step) => ({
      key: step.key,
      kind: step.kind,
      label: step.label,
      evidence: [evidence("routine_step", routine.id, { version: routine.version, stepKey: step.key })],
    }));
  for (const step of (routine?.steps ?? []).filter((candidate) =>
    candidate.kind === "generate" && candidate.configuration?.requiredFields?.length)) {
    gates.push({
      key: `${step.key}:required_fields`,
      kind: "input_confirmation",
      label: step.label,
      requiredFields: [...new Set(step.configuration.requiredFields)].sort(),
      evidence: [evidence("routine_step", routine.id, { version: routine.version, stepKey: step.key })],
    });
  }
  const summary = {
    trigger: section(
      triggerTypes.values.length && entryNode.state === "confirmed" ? "confirmed" : "unknown",
      { documentTypes: triggerTypes.values, directories: entryNode.paths.map((row) => row.path) },
      [...triggerTypes.evidence, ...entryNode.paths.flatMap((row) => row.evidence)].slice(0, 100),
    ),
    reference: section(
      referenceTypes.values.length || referenceNode.state === "confirmed" ? "confirmed" : "unknown",
      { documentTypes: referenceTypes.values, directories: referenceNode.paths.map((row) => row.path) },
      [...referenceTypes.evidence, ...referenceNode.paths.flatMap((row) => row.evidence)].slice(0, 100),
    ),
    output: section(
      outputDirectories.size ? "confirmed" : "unknown",
      { directories: [...outputDirectories].sort(), overwritePolicy: profile?.outcomeSpec?.overwritePolicy ?? "never" },
      outputEvidence.slice(0, 100),
    ),
    naming: section(
      namingTemplate ? "confirmed" : "unknown",
      { pathTemplate: namingTemplate },
      namingTemplate && profile ? [evidence("workflow_profile", profile.id, { version: profile.profileVersion })] : [],
    ),
    acceptance: section(
      acceptance.length ? "confirmed" : "unknown",
      acceptance,
      [
        ...(routine ? [evidence("routine_definition", routine.id, { version: routine.version })] : []),
        ...(profile ? [evidence("workflow_profile", profile.id, { version: profile.profileVersion })] : []),
      ],
    ),
    humanGates: section(
      routine ? "confirmed" : "unknown",
      gates,
      routine ? [evidence("routine_definition", routine.id, { version: routine.version })] : [],
    ),
  };
  const core = {
    schemaVersion: 1,
    familyId: `wmp_${digest([scope.ownerTeamId, scope.projectId, scope.sourceId]).slice(0, 24)}`,
    version,
    scope: graphResult.graph.scope,
    basis: {
      sourceRevision: scope.source.revision ?? null,
      routineDefinitionId: routine?.id ?? null,
      routineVersion: routine?.version ?? null,
      profileId: profile?.id ?? null,
      profileVersion: profile?.profileVersion ?? null,
    },
    summary,
    pathGraph: graphResult.graph,
  };
  const contentHash = digest(core);
  return {
    ok: true,
    memoryPackage: {
      ...core,
      packageId: `${core.familyId}:v${version}:${contentHash.slice(0, 16)}`,
      contentHash,
      generatedAt: input.generatedAt ?? null,
    },
  };
}

function latestBySuggestion(rows) {
  const latest = new Map();
  for (const row of rows.slice().sort((left, right) =>
    String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")))) {
    latest.set(row.suggestionId ?? row.id, row);
  }
  return [...latest.values()];
}

function metricSnapshot(rows) {
  const observations = rows.observations;
  const feedback = latestBySuggestion(rows.feedback);
  const outcomes = rows.outcomes;
  const duplicates = observations.filter((row) => row.state === "duplicate").length;
  const adaptiveCorrections = feedback.filter((row) =>
    row.correctionConfirmed === true || row.correction?.confirmed === true).length;
  const caseCorrections = (rows.deliveryCases ?? []).filter((row) => (row.correctionHistory ?? []).length > 0).length;
  const runCorrections = (rows.runs ?? []).filter((row) =>
    row.feedback?.state === "accepted_with_edits"
    || Number(row.feedback?.outputDiff?.changedFileCount ?? 0) > 0).length;
  const corrections = adaptiveCorrections + caseCorrections + runCorrections;
  const correctionPopulation = feedback.length + (rows.deliveryCases ?? []).length + (rows.runs ?? []).length;
  const completed = outcomes.filter((row) => row.status === "completed").length;
  const verification = outcomes.flatMap((row) => row.verification ?? []);
  const passed = verification.filter((row) => row.status === "passed").length;
  const anomalies = observations.filter((row) => ["needs_review", "failed", "recoverable"].includes(row.state)).length
    + outcomes.filter((row) => ["blocked", "failed"].includes(row.status)).length;
  return {
    sampleCount: observations.length + feedback.length + outcomes.length
      + (rows.deliveryCases ?? []).length + (rows.runs ?? []).length,
    observationCount: observations.length,
    duplicateCount: duplicates,
    duplicateRate: finiteRatio(duplicates, observations.length),
    feedbackCount: feedback.length,
    correctionCount: corrections,
    manualCorrectionRate: finiteRatio(corrections, correctionPopulation),
    outcomeCount: outcomes.length,
    completedCount: completed,
    completionRate: finiteRatio(completed, outcomes.length),
    verificationCount: verification.length,
    verificationPassRate: finiteRatio(passed, verification.length),
    anomalyCount: anomalies,
    anomalyRate: finiteRatio(anomalies, observations.length + outcomes.length),
  };
}

function timestampOf(row) {
  const value = Date.parse(row.updatedAt ?? row.completedAt ?? row.createdAt ?? "");
  return Number.isFinite(value) ? value : null;
}

function trend(current, previous, key, lowerIsBetter = false) {
  const currentValue = current[key];
  const previousValue = previous[key];
  if (currentValue == null || previousValue == null) {
    return { current: currentValue, previous: previousValue, delta: null, direction: "unknown" };
  }
  const delta = currentValue - previousValue;
  const direction = Math.abs(delta) < 1e-9
    ? "stable"
    : (lowerIsBetter ? delta < 0 : delta > 0) ? "improving" : "worsening";
  return { current: currentValue, previous: previousValue, delta, direction };
}

export function calculateWorkflowMemoryHealth(input = {}) {
  const scope = scopeFor(input);
  if (scope.error) return { ok: false, error: scope.error };
  const rows = {
    observations: scopedRows(scope, "workflowIntakeObservations"),
    feedback: scopedRows(scope, "workflowAdaptiveFeedback"),
    outcomes: scopedRows(scope, "workflowAdaptiveOutcomes"),
    deliveryCases: scopedRows(scope, "deliveryCases"),
    runs: scopedRows(scope, "workflowRuns"),
  };
  const metrics = metricSnapshot(rows);
  const timestamps = Object.values(rows).flat().map(timestampOf).filter((value) => value != null).sort((a, b) => a - b);
  const midpoint = timestamps.length >= 2 ? timestamps[Math.floor(timestamps.length / 2)] : null;
  const partition = (values, current) => values.filter((row) => {
    const timestamp = timestampOf(row);
    return timestamp != null && (current ? timestamp >= midpoint : timestamp < midpoint);
  });
  const previous = midpoint == null ? metricSnapshot({
    observations: [], feedback: [], outcomes: [], deliveryCases: [], runs: [],
  }) : metricSnapshot({
    observations: partition(rows.observations, false),
    feedback: partition(rows.feedback, false),
    outcomes: partition(rows.outcomes, false),
    deliveryCases: partition(rows.deliveryCases, false),
    runs: partition(rows.runs, false),
  });
  const current = midpoint == null ? metrics : metricSnapshot({
    observations: partition(rows.observations, true),
    feedback: partition(rows.feedback, true),
    outcomes: partition(rows.outcomes, true),
    deliveryCases: partition(rows.deliveryCases, true),
    runs: partition(rows.runs, true),
  });
  const penalty = (metrics.duplicateRate ?? 0) * 15
    + (metrics.manualCorrectionRate ?? 0) * 25
    + (metrics.completionRate == null ? 0 : 1 - metrics.completionRate) * 30
    + (metrics.verificationPassRate == null ? 0 : 1 - metrics.verificationPassRate) * 20
    + (metrics.anomalyRate ?? 0) * 10;
  const representative = metrics.sampleCount >= 5;
  const score = representative ? Math.max(0, Math.min(100, Math.round(100 - penalty))) : null;
  const scoreBreakdown = {
    duplicatePenalty: (metrics.duplicateRate ?? 0) * 15,
    correctionPenalty: (metrics.manualCorrectionRate ?? 0) * 25,
    incompletePenalty: (metrics.completionRate == null ? 0 : 1 - metrics.completionRate) * 30,
    verificationPenalty: (metrics.verificationPassRate == null ? 0 : 1 - metrics.verificationPassRate) * 20,
    anomalyPenalty: (metrics.anomalyRate ?? 0) * 10,
    totalPenalty: penalty,
  };
  return {
    ok: true,
    health: {
      schemaVersion: 1,
      scope: { ownerTeamId: scope.ownerTeamId, projectId: scope.projectId, sourceId: scope.sourceId },
      representative,
      score,
      status: score == null ? "insufficient_data" : score >= 80 ? "healthy" : score >= 60 ? "watch" : "at_risk",
      metrics,
      scoreBreakdown,
      reasons: [
        ...(!representative ? ["insufficient_samples"] : []),
        ...((metrics.duplicateRate ?? 0) > 0.1 ? ["duplicate_rate_high"] : []),
        ...((metrics.manualCorrectionRate ?? 0) > 0.2 ? ["manual_correction_rate_high"] : []),
        ...(metrics.completionRate != null && metrics.completionRate < 0.8 ? ["completion_rate_low"] : []),
        ...(metrics.verificationPassRate != null && metrics.verificationPassRate < 0.9
          ? ["verification_pass_rate_low"] : []),
        ...((metrics.anomalyRate ?? 0) > 0.1 ? ["anomaly_rate_high"] : []),
      ],
      trends: {
        duplicateRate: trend(current, previous, "duplicateRate", true),
        manualCorrectionRate: trend(current, previous, "manualCorrectionRate", true),
        anomalyRate: trend(current, previous, "anomalyRate", true),
        completionRate: trend(current, previous, "completionRate"),
      },
    },
  };
}

function walkDiff(before, after, path, changes) {
  if (changes.length >= 500) return;
  if (JSON.stringify(stable(before)) === JSON.stringify(stable(after))) return;
  const beforeObject = before && typeof before === "object" && !Array.isArray(before);
  const afterObject = after && typeof after === "object" && !Array.isArray(after);
  if (beforeObject && afterObject) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((key) => !OMITTED_DIFF_KEYS.has(key))
      .sort();
    for (const key of keys) walkDiff(before[key], after[key], `${path}/${key}`, changes);
    return;
  }
  changes.push({
    path: path || "/",
    kind: before === undefined ? "added" : after === undefined ? "removed" : "changed",
    before: before === undefined ? null : before,
    after: after === undefined ? null : after,
  });
}

export function diffWorkflowMemoryPackages(before, after) {
  if (!before || !after
    || before.schemaVersion !== 1 || after.schemaVersion !== 1
    || !before.familyId || before.familyId !== after.familyId
    || !Number.isInteger(before.version) || !Number.isInteger(after.version)) {
    return { ok: false, error: "workflow_memory_package_diff_invalid" };
  }
  const changes = [];
  walkDiff(before, after, "", changes);
  const sections = {};
  for (const change of changes) {
    const name = change.path.split("/").filter(Boolean)[0] ?? "root";
    sections[name] = (sections[name] ?? 0) + 1;
  }
  return {
    ok: true,
    diff: {
      schemaVersion: 1,
      familyId: before.familyId,
      fromVersion: before.version,
      toVersion: after.version,
      changed: changes.length > 0,
      truncated: changes.length >= 500,
      sections,
      changes,
    },
  };
}

function latestLearningSuggestions(scope) {
  const draft = scopedRows(scope, "workflowAdaptiveLearningDrafts")
    .filter((row) => row.status === "shadow")
    .sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0))[0];
  if (!draft) return [];
  const active = scopedRows(scope, "workflowAdaptiveRules")
    .filter((row) => row.status === "active")
    .sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0))[0];
  const beforeByType = new Map((active?.configuration?.documentTypes ?? [])
    .map((row) => [row.documentType, row]));
  return (draft.configuration?.documentTypes ?? []).flatMap((candidate) => {
    const before = beforeByType.get(candidate.documentType);
    const added = (candidate.actions ?? []).filter((action) => !(before?.actions ?? []).includes(action));
    const removed = (before?.actions ?? []).filter((action) => !(candidate.actions ?? []).includes(action));
    const thresholdChanged = before
      && Number(before.confidenceThreshold) !== Number(candidate.confidenceThreshold);
    if (!added.length && !removed.length && !thresholdChanged) return [];
    return [{
      id: `${draft.id}:${candidate.documentType}`,
      draftId: draft.id,
      draftRevision: draft.revision,
      documentType: candidate.documentType,
      evidenceCount: candidate.evidenceCount ?? draft.evidenceIds?.length ?? 0,
      changes: { added, removed, thresholdChanged },
      evaluationPassed: draft.evaluation?.passed === true,
    }];
  }).slice(0, 20);
}

export function createWorkflowMemoryInsightsService({ state } = {}) {
  return {
    getOverview(input = {}, actor = null) {
      const scopeInput = {
        state,
        ownerTeamId: actor?.teamId,
        projectId: input.projectId,
        sourceId: input.sourceId,
        routineDefinitionId: input.routineDefinitionId,
      };
      const scope = scopeFor(scopeInput);
      if (scope.error) {
        const status = scope.error.endsWith("_required") ? 400 : 404;
        return { status, body: { error: scope.error } };
      }
      const path = deriveWorkflowPathGraph(scopeInput);
      const health = calculateWorkflowMemoryHealth(scopeInput);
      const published = scopedRows(scope, "routineDefinitions")
        .filter((row) => row.state === "published")
        .sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0));
      const requestedRoutineId = typeof input.routineDefinitionId === "string"
        ? input.routineDefinitionId.trim()
        : "";
      const matchingPublished = requestedRoutineId
        ? published.filter((row) => row.id === requestedRoutineId)
        : published;
      const currentRoutine = matchingPublished.length === 1 ? matchingPublished[0] : null;
      const current = currentRoutine
        ? buildWorkflowMemoryPackage({
            ...scopeInput,
            version: Math.max(1, Number(currentRoutine.version) || 1),
            routineDefinitionId: currentRoutine.id,
            generatedAt: currentRoutine.publishedAt ?? currentRoutine.updatedAt ?? null,
          })
        : null;
      const previousRoutine = currentRoutine
        ? scopedRows(scope, "routineDefinitions")
          .filter((row) => row.familyId === currentRoutine.familyId
            && row.id !== currentRoutine.id
            && Number(row.version ?? 0) < Number(currentRoutine.version ?? 0)
            && ["superseded", "disabled", "published"].includes(row.state))
          .sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0))[0] ?? null
        : null;
      const previous = previousRoutine
        ? buildWorkflowMemoryPackage({
            ...scopeInput,
            version: Math.max(1, Number(previousRoutine.version) || 1),
            routineDefinitionId: previousRoutine.id,
            generatedAt: previousRoutine.publishedAt ?? previousRoutine.updatedAt ?? null,
          })
        : null;
      const activeRule = scopedRows(scope, "workflowAdaptiveRules")
        .filter((row) => row.status === "active" && row.previousRuleId)
        .sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0))[0] ?? null;
      return {
        status: 200,
        body: {
          pathGraph: path.ok ? path.graph : null,
          health: health.ok ? health.health : null,
          memoryPackage: current?.ok ? current.memoryPackage : null,
          previousMemoryPackage: previous?.ok ? previous.memoryPackage : null,
          packageDiff: current?.ok && previous?.ok
            ? diffWorkflowMemoryPackages(previous.memoryPackage, current.memoryPackage).diff ?? null
            : null,
          routineSelection: currentRoutine
            ? { state: "matched", routineDefinitionId: currentRoutine.id, count: 1 }
            : { state: matchingPublished.length ? "conflict" : "missing", routineDefinitionId: null, count: matchingPublished.length },
          resultSuggestions: latestLearningSuggestions(scope),
          rollback: activeRule
            ? { available: true, ruleId: activeRule.id, expectedRevision: activeRule.revision }
            : { available: false, ruleId: null, expectedRevision: null },
        },
      };
    },
  };
}
