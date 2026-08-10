import { dirname } from "node:path";

export function createWorkflowProfileManager({
  access,
  assessDeliveryCaseQuality,
  boundedObject,
  commonPathPrefix,
  deriveFieldSpec,
  deriveProfileSpecs,
  listInbox,
  maxProfileCases: MAX_PROFILE_CASES,
  normalizeIdList,
  profileChangeSummary,
  profileStates: PROFILE_STATES,
  profileView,
  qualityForCase,
  runtime,
  summarizeDeliveryCaseQualities,
}) {
  const { actorUser, findSource, visible } = access;
  const { appendEvent, errorResult, nextId, now, runTx, state } = runtime;

  function deriveProfile(input = {}, actor = null) {
    const caseIds = normalizeIdList(input.caseIds, MAX_PROFILE_CASES);
    if (!caseIds?.length) return { status: 400, body: { error: "workflow_profile_cases_required" } };
    const cases = caseIds.map((id) =>
      state.deliveryCases.find((item) => item.id === id && visible(item, actor)));
    if (cases.some((item) => !item || item.state !== "confirmed")) {
      return { status: 400, body: { error: "invalid_workflow_profile_cases" } };
    }
    const sourceIds = new Set(cases.map((item) => item.sourceId));
    if (sourceIds.size !== 1) {
      return { status: 400, body: { error: "workflow_profile_cases_must_share_source" } };
    }
    const artifactById = new Map(
      state.workflowArtifacts
        .filter((item) => visible(item, actor))
        .map((item) => [item.id, item]),
    );
    const caseQuality = cases.map((deliveryCase) =>
      assessDeliveryCaseQuality(deliveryCase, artifactById));
    const staleCase = cases.find((deliveryCase) =>
      !(deliveryCase.evidenceSnapshots ?? []).length
      || deliveryCase.evidenceSnapshots.some((snapshot) => {
        const current = artifactById.get(snapshot.artifactId);
        return !current
          || current.availability !== "available"
          || current.exclusion
          || current.fingerprint !== snapshot.fingerprint;
      }));
    if (staleCase) {
      return {
        status: 409,
        body: {
          error: "workflow_profile_case_evidence_changed",
          deliveryCaseId: staleCase.id,
        },
      };
    }
    const requirementArtifacts = cases.flatMap((item) =>
      item.requirementArtifactIds.map((id) => artifactById.get(id)).filter(Boolean));
    const deliveryArtifacts = cases.flatMap((item) =>
      item.deliveryArtifactIds.map((id) => artifactById.get(id)).filter(Boolean));
    const requirementExtensions = [...new Set(requirementArtifacts.map((item) => item.extension))].sort();
    const source = findSource(cases[0].sourceId, actor);
    if (!source) return { status: 404, body: { error: "workflow_source_not_found" } };
    const requirementFields = deriveFieldSpec(
      cases,
      artifactById,
      source,
      state,
      "requirementArtifactIds",
    );
    const deliveryFields = deriveFieldSpec(
      cases,
      artifactById,
      source,
      state,
      "deliveryArtifactIds",
    );
    const deliverySections = deliveryFields
      .filter((field) => field.kind === "section")
      .map((field) => ({
        key: field.key,
        label: field.label,
        required: field.required,
        coverage: field.coverage,
        evidenceArtifactIds: field.evidenceArtifactIds,
      }));
    const deliveryRequiredFields = deliveryFields
      .filter((field) => field.kind !== "section")
      .map((field) => ({
        key: field.key,
        label: field.label,
        required: field.required,
        coverage: field.coverage,
        evidenceArtifactIds: field.evidenceArtifactIds,
      }));
    const deliveryFieldKeys = new Set(deliveryFields.map((field) => field.key));
    const inferredMappings = requirementFields
      .filter((field) => deliveryFieldKeys.has(field.key))
      .map((field) => ({
        requirementField: field.key,
        outcomeField: field.key,
        mode: "copy_with_context",
        confidence: Math.min(
          field.coverage,
          deliveryFields.find((candidate) => candidate.key === field.key)?.coverage ?? 0,
        ),
        evidenceArtifactIds: field.evidenceArtifactIds,
      }));
    const deliveryGroups = new Map();
    for (const artifact of deliveryArtifacts) {
      const key = `${artifact.family}:${artifact.extension}`;
      const group = deliveryGroups.get(key) ?? {
        role: "delivery",
        family: artifact.family,
        extension: artifact.extension,
        examples: [],
      };
      group.examples.push(artifact.id);
      deliveryGroups.set(key, group);
    }
    const outputDirectories = [...new Set(deliveryArtifacts.map((item) => dirname(item.relativePath)))].sort();
    const pathPrefix = commonPathPrefix(outputDirectories);
    const timestamp = now();
    const profileId = nextId("wfp");
    const learningQuality = summarizeDeliveryCaseQualities(caseQuality);
    const profile = {
      id: profileId,
      familyId: profileId,
      ownerTeamId: cases[0].ownerTeamId,
      projectId: cases[0].projectId,
      sourceId: cases[0].sourceId,
      name: String(input.name ?? "").trim().slice(0, 200) || "Requirement delivery workflow",
      profileVersion: 1,
      revision: 1,
      state: learningQuality.trustedCaseCount >= 3 ? "established" : "trial",
      evidenceCaseIds: caseIds,
      learningQuality,
      requirementSpec: {
        acceptedExtensions: requirementExtensions,
        fields: requirementFields,
        unresolved: requirementFields.length
          ? []
          : ["No common structured requirement fields were found; configure them before autonomous drafting."],
      },
      outcomeSpec: {
        outputs: [...deliveryGroups.values()].map((group) => ({
          ...group,
          examples: group.examples.slice(0, 10),
          minimumCount: 1,
        })),
        observedDirectories: outputDirectories.slice(0, 20),
        pathTemplate: pathPrefix
          ? `${pathPrefix}/{requirement-stem}`
          : "{requirement-directory}/delivery/{requirement-stem}",
        overwritePolicy: "never",
        requiredSections: deliverySections,
        requiredFields: deliveryRequiredFields,
      },
      transformationMap: {
        mappings: inferredMappings,
        unresolved: inferredMappings.length
          ? []
          : ["No evidence-backed content mapping was found; confirm mappings before autonomous drafting."],
      },
      taskRecipe: {
        steps: [
          "Extract and review requirement facts.",
          "Resolve every critical missing input.",
          "Create outputs from the confirmed OutcomeSpec.",
          "Run structural validators and attach output evidence.",
          "Request final user acceptance.",
        ],
        requiresPlanConfirmation: true,
        requiresHumanAcceptance: true,
      },
      classifierVersion: 1,
      createdAt: timestamp,
      createdBy: actorUser(actor),
      updatedAt: timestamp,
    };
    if (!PROFILE_STATES.has(profile.state)) {
      return { status: 400, body: { error: "invalid_workflow_profile_state" } };
    }
    runTx(() => {
      state.workflowProfiles.push(profile);
      appendEvent({
        invocationId: null,
        type: "workflow_profile_created",
        level: "info",
        message: "Workflow memory profile derived.",
        data: {
          workflowProfileId: profile.id,
          sourceId: profile.sourceId,
          state: profile.state,
          caseCount: caseIds.length,
        },
      });
    });
    return { status: 201, body: { profile } };
  }

  function listProfiles(actor = null) {
    const profiles = state.workflowProfiles
      .filter((item) => visible(item, actor))
      .map(profileView)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    return { status: 200, body: { profiles, count: profiles.length } };
  }

  function reviseProfile(input = {}, actor = null) {
    try {
      const current = state.workflowProfiles.find((item) =>
        item.id === input.profileId && visible(item, actor));
      if (!current) return { status: 404, body: { error: "workflow_profile_not_found" } };
      if (input.expectedRevision !== current.revision) {
        return {
          status: 409,
          body: { error: "workflow_profile_revision_conflict", currentRevision: current.revision },
        };
      }
      if (current.supersededByProfileId) {
        return {
          status: 409,
          body: { error: "workflow_profile_already_superseded", currentProfileId: current.supersededByProfileId },
        };
      }
      const nextState = input.state == null ? current.state : String(input.state);
      if (!PROFILE_STATES.has(nextState) || nextState === "archived") {
        return { status: 400, body: { error: "invalid_workflow_profile_state" } };
      }
      const nextEvidenceCaseIds = input.evidenceCaseIds == null
        ? [...(current.evidenceCaseIds ?? [])]
        : normalizeIdList(input.evidenceCaseIds, MAX_PROFILE_CASES);
      if (!nextEvidenceCaseIds?.length) {
        return { status: 400, body: { error: "invalid_workflow_profile_cases" } };
      }
      const invalidEvidence = nextEvidenceCaseIds.some((caseId) => {
        const deliveryCase = state.deliveryCases.find((item) =>
          item.id === caseId && visible(item, actor));
        return !deliveryCase
          || deliveryCase.state !== "confirmed"
          || deliveryCase.sourceId !== current.sourceId;
      });
      if (invalidEvidence) {
        return { status: 400, body: { error: "invalid_workflow_profile_cases" } };
      }
      const nextCaseQualities = nextEvidenceCaseIds.map((caseId) =>
        qualityForCase(state.deliveryCases.find((item) => item.id === caseId)));
      const nextLearningQuality = summarizeDeliveryCaseQualities(nextCaseQualities);
      if (nextState === "established" && nextLearningQuality.trustedCaseCount < 3) {
        return {
          status: 409,
          body: {
            error: "workflow_profile_requires_three_trusted_cases",
            learningQuality: nextLearningQuality,
          },
        };
      }
      const timestamp = now();
      const next = {
        ...current,
        id: nextId("wfp"),
        familyId: current.familyId ?? current.id,
        name: input.name == null
          ? current.name
          : String(input.name).trim().slice(0, 200) || current.name,
        profileVersion: current.profileVersion + 1,
        revision: 1,
        state: nextState,
        evidenceCaseIds: nextEvidenceCaseIds,
        learningQuality: nextLearningQuality,
        requirementSpec: input.requirementSpec == null
          ? current.requirementSpec
          : boundedObject(input.requirementSpec, "requirementSpec"),
        outcomeSpec: input.outcomeSpec == null
          ? current.outcomeSpec
          : boundedObject(input.outcomeSpec, "outcomeSpec"),
        transformationMap: input.transformationMap == null
          ? current.transformationMap
          : boundedObject(input.transformationMap, "transformationMap"),
        taskRecipe: input.taskRecipe == null
          ? current.taskRecipe
          : boundedObject(input.taskRecipe, "taskRecipe"),
        supersedesProfileId: current.id,
        supersededByProfileId: null,
        createdAt: timestamp,
        createdBy: actorUser(actor),
        updatedAt: timestamp,
      };
      delete next.supersededAt;
      runTx(() => {
        current.supersededByProfileId = next.id;
        current.supersededAt = timestamp;
        current.state = "archived";
        current.revision += 1;
        current.updatedAt = timestamp;
        state.workflowProfiles.push(next);
        appendEvent({
          invocationId: null,
          type: "workflow_profile_revised",
          level: "info",
          message: "Workflow memory profile revision created.",
          data: {
            workflowProfileId: next.id,
            supersedesProfileId: current.id,
            familyId: next.familyId,
            profileVersion: next.profileVersion,
          },
        });
      });
      return {
        status: 201,
        body: { profile: profileView(next), previousProfile: profileView(current) },
      };
    } catch (error) {
      return errorResult(error);
    }
  }

  function listProfileDrafts({ profileId = null } = {}, actor = null) {
    const drafts = state.workflowProfileDrafts
      .filter((item) =>
        visible(item, actor)
        && (!profileId || item.baseProfileId === profileId || item.familyId === profileId))
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    return { status: 200, body: { drafts, count: drafts.length } };
  }

  function createProfileDraft({
    profileId,
    expectedRevision,
    name,
  } = {}, actor = null) {
    try {
      const current = state.workflowProfiles.find((item) =>
        item.id === profileId && visible(item, actor));
      if (!current) return { status: 404, body: { error: "workflow_profile_not_found" } };
      if (expectedRevision !== current.revision) {
        return {
          status: 409,
          body: { error: "workflow_profile_revision_conflict", currentRevision: current.revision },
        };
      }
      if (current.supersededByProfileId || ["archived", "disabled"].includes(current.state)) {
        return { status: 409, body: { error: "workflow_profile_not_draftable" } };
      }
      const familyId = current.familyId ?? current.id;
      const familyProfileIds = new Set(
        state.workflowProfiles
          .filter((item) => (item.familyId ?? item.id) === familyId && visible(item, actor))
          .map((item) => item.id),
      );
      const evidenceCases = state.deliveryCases.filter((item) =>
        item.state === "confirmed"
        && item.sourceId === current.sourceId
        && visible(item, actor)
        && (
          (current.evidenceCaseIds ?? []).includes(item.id)
          || familyProfileIds.has(item.workflowProfileId)
        ));
      if (!evidenceCases.length) {
        return { status: 409, body: { error: "workflow_profile_has_no_active_cases" } };
      }
      const evidenceCaseIds = evidenceCases.map((item) => item.id).sort();
      const replay = state.workflowProfileDrafts.find((item) =>
        item.baseProfileId === current.id
        && item.baseProfileRevision === current.revision
        && item.state === "draft"
        && visible(item, actor)
        && JSON.stringify([...(item.proposedProfile?.evidenceCaseIds ?? [])].sort())
          === JSON.stringify(evidenceCaseIds));
      if (replay) return { status: 200, body: { draft: replay, replayed: true } };
      const artifactById = new Map(
        state.workflowArtifacts
          .filter((item) => visible(item, actor))
          .map((item) => [item.id, item]),
      );
      const staleCase = evidenceCases.find((deliveryCase) =>
        !(deliveryCase.evidenceSnapshots ?? []).length
        || deliveryCase.evidenceSnapshots.some((snapshot) => {
          const artifact = artifactById.get(snapshot.artifactId);
          return !artifact
            || artifact.availability !== "available"
            || artifact.exclusion
            || artifact.fingerprint !== snapshot.fingerprint;
        }));
      if (staleCase) {
        return {
          status: 409,
          body: {
            error: "workflow_profile_case_evidence_changed",
            deliveryCaseId: staleCase.id,
          },
        };
      }
      const source = findSource(current.sourceId, actor);
      if (!source) return { status: 404, body: { error: "workflow_source_not_found" } };
      const proposedSpecs = deriveProfileSpecs(evidenceCases, artifactById, source, state);
      const learningQuality = summarizeDeliveryCaseQualities(
        evidenceCases.map((deliveryCase) =>
          assessDeliveryCaseQuality(deliveryCase, artifactById)),
      );
      const proposedProfile = {
        name: String(name ?? "").trim().slice(0, 200) || current.name,
        state: learningQuality.trustedCaseCount >= 3 ? "established" : "trial",
        evidenceCaseIds,
        learningQuality,
        ...proposedSpecs,
        taskRecipe: current.taskRecipe,
      };
      const timestamp = now();
      const draft = {
        id: nextId("wfd"),
        ownerTeamId: current.ownerTeamId,
        projectId: current.projectId,
        sourceId: current.sourceId,
        familyId,
        baseProfileId: current.id,
        baseProfileVersion: current.profileVersion,
        baseProfileRevision: current.revision,
        state: "draft",
        proposedProfile,
        changes: profileChangeSummary(current, proposedProfile),
        impact: {
          activeCaseCount: evidenceCases.length,
          archivedCaseCount: state.deliveryCases.filter((item) =>
            item.sourceId === current.sourceId
            && item.state === "archived"
            && visible(item, actor)).length,
          pendingRequirementCount: listInbox({ sourceId: current.sourceId }, actor).body.count ?? 0,
        },
        revision: 1,
        createdAt: timestamp,
        createdBy: actorUser(actor),
        updatedAt: timestamp,
      };
      runTx(() => {
        state.workflowProfileDrafts.push(draft);
        appendEvent({
          invocationId: null,
          type: "workflow_profile_draft_created",
          level: "info",
          message: "Workflow profile draft created from active evidence.",
          data: {
            workflowProfileDraftId: draft.id,
            baseProfileId: current.id,
            activeCaseCount: evidenceCases.length,
          },
        });
      });
      return { status: 201, body: { draft, replayed: false } };
    } catch (error) {
      return errorResult(error);
    }
  }

  function publishProfileDraft({
    draftId,
    expectedRevision,
  } = {}, actor = null) {
    const draft = state.workflowProfileDrafts.find((item) =>
      item.id === draftId && visible(item, actor));
    if (!draft) return { status: 404, body: { error: "workflow_profile_draft_not_found" } };
    if (expectedRevision !== draft.revision) {
      return {
        status: 409,
        body: { error: "workflow_profile_draft_revision_conflict", currentRevision: draft.revision },
      };
    }
    if (draft.state === "published") {
      const profile = state.workflowProfiles.find((item) => item.id === draft.publishedProfileId);
      return { status: 200, body: { draft, profile, replayed: true } };
    }
    if (draft.state !== "draft") {
      return { status: 409, body: { error: "workflow_profile_draft_not_publishable" } };
    }
    const current = state.workflowProfiles.find((item) =>
      item.id === draft.baseProfileId && visible(item, actor));
    if (!current || current.revision !== draft.baseProfileRevision || current.supersededByProfileId) {
      return { status: 409, body: { error: "workflow_profile_draft_base_changed" } };
    }
    const proposed = draft.proposedProfile;
    const published = reviseProfile({
      profileId: current.id,
      expectedRevision: current.revision,
      name: proposed.name,
      state: proposed.state,
      requirementSpec: proposed.requirementSpec,
      outcomeSpec: proposed.outcomeSpec,
      transformationMap: proposed.transformationMap,
      taskRecipe: proposed.taskRecipe,
      evidenceCaseIds: proposed.evidenceCaseIds,
    }, actor);
    if (published.status !== 201) return published;
    const timestamp = now();
    runTx(() => {
      draft.state = "published";
      draft.publishedProfileId = published.body.profile.id;
      draft.publishedAt = timestamp;
      draft.publishedBy = actorUser(actor);
      draft.revision += 1;
      draft.updatedAt = timestamp;
      appendEvent({
        invocationId: null,
        type: "workflow_profile_draft_published",
        level: "info",
        message: "Workflow profile draft published.",
        data: {
          workflowProfileDraftId: draft.id,
          workflowProfileId: published.body.profile.id,
        },
      });
    });
    return {
      status: 201,
      body: { draft, profile: published.body.profile, previousProfile: current, replayed: false },
    };
  }


  return {
    createProfileDraft,
    deriveProfile,
    listProfileDrafts,
    listProfiles,
    publishProfileDraft,
    reviseProfile,
  };
}
