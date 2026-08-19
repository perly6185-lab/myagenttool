export function createWorkflowCaseManager({
  access,
  caseView,
  effectiveRole,
  normalizeIdList,
  runtime,
  scoreWorkflowPair,
}) {
  const { actorUser, findArtifact, findSource, visible } = access;
  const { appendEvent, nextId, now, runTx, state } = runtime;

  function pairProposals({ sourceId } = {}, actor = null) {
    const source = findSource(sourceId, actor);
    if (!source) return { status: 404, body: { error: "workflow_source_not_found" } };
    const available = state.workflowArtifacts.filter((item) =>
      item.sourceId === source.id && item.availability === "available" && !item.exclusion);
    const requirements = available.filter((item) => effectiveRole(item) === "requirement");
    const deliveries = available.filter((item) => effectiveRole(item) === "delivery");
    const proposals = requirements.map((requirement) => {
      const candidates = deliveries
        .map((delivery) => ({ delivery, ...scoreWorkflowPair(requirement, delivery) }))
        .filter((candidate) => candidate.score >= 0.2)
        .sort((left, right) => right.score - left.score)
        .slice(0, 5);
      return { requirement, candidates };
    });
    return { status: 200, body: { sourceId: source.id, proposals } };
  }

  function listCases({ sourceId = null } = {}, actor = null) {
    const cases = state.deliveryCases.filter((item) =>
      visible(item, actor) && (!sourceId || item.sourceId === sourceId))
      .map(caseView);
    return { status: 200, body: { cases, count: cases.length } };
  }

  function createCase(input = {}, actor = null) {
    const source = findSource(input.sourceId, actor);
    if (!source) return { status: 404, body: { error: "workflow_source_not_found" } };
    const lists = {
      requirementArtifactIds: normalizeIdList(input.requirementArtifactIds),
      deliveryArtifactIds: normalizeIdList(input.deliveryArtifactIds),
      referenceArtifactIds: normalizeIdList(input.referenceArtifactIds ?? []),
      draftArtifactIds: normalizeIdList(input.draftArtifactIds ?? []),
    };
    if (
      !lists.requirementArtifactIds?.length
      || !lists.deliveryArtifactIds?.length
      || Object.values(lists).some((value) => value == null)
    ) {
      return { status: 400, body: { error: "invalid_delivery_case_assets" } };
    }
    const allIds = Object.values(lists).flat();
    const artifacts = allIds.map((id) => findArtifact(id, actor));
    if (
      artifacts.some((item) =>
        !item || item.sourceId !== source.id || item.availability !== "available" || item.exclusion)
      || new Set(allIds).size !== allIds.length
    ) {
      return { status: 400, body: { error: "invalid_delivery_case_assets" } };
    }
    const workflowProfile = input.workflowProfileId == null
      ? null
      : state.workflowProfiles.find((item) =>
          item.id === input.workflowProfileId && visible(item, actor));
    if (input.workflowProfileId != null && !workflowProfile) {
      return { status: 400, body: { error: "invalid_delivery_case_workflow_profile" } };
    }
    const timestamp = now();
    const roleById = new Map([
      ...lists.requirementArtifactIds.map((id) => [id, "requirement"]),
      ...lists.deliveryArtifactIds.map((id) => [id, "delivery"]),
      ...lists.referenceArtifactIds.map((id) => [id, "reference"]),
      ...lists.draftArtifactIds.map((id) => [id, "draft"]),
    ]);
    const deliveryCase = {
      id: nextId("wdc"),
      ownerTeamId: source.ownerTeamId,
      projectId: source.projectId,
      sourceId: source.id,
      ...lists,
      note: String(input.note ?? "").trim().slice(0, 5_000),
      satisfaction: "accepted",
      state: "confirmed",
      evidenceSnapshots: artifacts.map((artifact) => ({
        artifactId: artifact.id,
        role: roleById.get(artifact.id),
        relativePath: artifact.relativePath,
        fingerprint: artifact.fingerprint,
        modifiedAt: artifact.modifiedAt,
        size: artifact.size,
      })),
      workflowProfileId: workflowProfile?.id ?? null,
      workflowProfileVersion: workflowProfile?.profileVersion ?? null,
      revision: 1,
      confirmedBy: actorUser(actor),
      confirmedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    runTx(() => {
      state.deliveryCases.push(deliveryCase);
      for (const artifact of artifacts) {
        artifact.role = roleById.get(artifact.id);
        artifact.confirmationState = "confirmed";
        artifact.confirmedBy = actorUser(actor);
        artifact.confirmedAt = timestamp;
        artifact.revision += 1;
        artifact.updatedAt = timestamp;
      }
      appendEvent({
        invocationId: null,
        type: "delivery_case_confirmed",
        level: "info",
        message: "Requirement-delivery case confirmed.",
        data: { deliveryCaseId: deliveryCase.id, sourceId: source.id },
      });
    });
    return { status: 201, body: { deliveryCase: caseView(deliveryCase) } };
  }

  function changeCaseState({
    caseId,
    expectedRevision,
    action,
    reason = "",
  } = {}, actor = null) {
    const deliveryCase = state.deliveryCases.find((item) =>
      item.id === caseId && visible(item, actor));
    if (!deliveryCase) return { status: 404, body: { error: "delivery_case_not_found" } };
    if (expectedRevision !== deliveryCase.revision) {
      return {
        status: 409,
        body: { error: "delivery_case_revision_conflict", currentRevision: deliveryCase.revision },
      };
    }
    if (!["archive", "restore"].includes(action)) {
      return { status: 400, body: { error: "invalid_delivery_case_action" } };
    }
    const targetState = action === "archive" ? "archived" : "confirmed";
    if (deliveryCase.state === targetState) {
      return { status: 200, body: { deliveryCase: caseView(deliveryCase), replayed: true } };
    }
    if (action === "restore") {
      const stale = (deliveryCase.evidenceSnapshots ?? []).some((snapshot) => {
        const artifact = findArtifact(snapshot.artifactId, actor);
        return !artifact
          || artifact.availability !== "available"
          || artifact.fingerprint !== snapshot.fingerprint;
      });
      if (stale) {
        return { status: 409, body: { error: "delivery_case_evidence_changed" } };
      }
    }
    const note = String(reason ?? "").trim().slice(0, 2_000);
    if (action === "archive" && !note) {
      return { status: 400, body: { error: "delivery_case_archive_reason_required" } };
    }
    const timestamp = now();
    runTx(() => {
      deliveryCase.state = targetState;
      deliveryCase.revision += 1;
      deliveryCase.updatedAt = timestamp;
      deliveryCase.correctionHistory = [
        ...(deliveryCase.correctionHistory ?? []),
        {
          action,
          reason: note,
          recordedAt: timestamp,
          recordedBy: actorUser(actor),
        },
      ].slice(-50);
      if (action === "archive") {
        deliveryCase.archivedAt = timestamp;
        deliveryCase.archivedBy = actorUser(actor);
        deliveryCase.archiveReason = note;
      } else {
        delete deliveryCase.archivedAt;
        delete deliveryCase.archivedBy;
        delete deliveryCase.archiveReason;
      }
      appendEvent({
        invocationId: null,
        type: `delivery_case_${action === "archive" ? "archived" : "restored"}`,
        level: action === "archive" ? "warning" : "info",
        message: `Requirement-delivery case ${action === "archive" ? "archived" : "restored"}.`,
        data: { deliveryCaseId: deliveryCase.id, sourceId: deliveryCase.sourceId, reason: note },
      });
    });
    return { status: 200, body: { deliveryCase: caseView(deliveryCase), replayed: false } };
  }


  return { changeCaseState, createCase, listCases, pairProposals };
}
