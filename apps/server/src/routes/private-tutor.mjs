import { timingSafeEqual } from "node:crypto";
import { hashPassword, verifyPassword } from "../runtime/auth.mjs";
import {
  applyPrivateTutorAttemptToSnapshot as applyAttemptToSnapshot,
  createInitialPrivateTutorSnapshot as createInitialSnapshot,
  ensurePrivateTutorCollections as ensureCollections,
  findAuthorizedPrivateTutorLearner as findAuthorizedLearner,
  listAuthorizedPrivateTutorLearners as listAuthorizedLearners,
  privateTutorChildModeView as childModeView,
  privateTutorLearnerNotFound as learnerNotFound,
  privateTutorLearnerView as learnerView,
  privateTutorSnapshotView as snapshotView,
  recordPrivateTutorAudit as recordAudit,
  recordPrivateTutorDeniedAccess as recordDeniedAccess,
  recordPrivateTutorSessionEvent as recordTutoringSessionEvent,
  switchPrivateTutorSnapshotPackage as switchSnapshotPackage,
  stablePrivateTutorHash as stableHash,
  validatePrivateTutorAttemptInput as validateAttemptInput,
  validatePrivateTutorLearnerInput as validateLearnerInput,
} from "./private-tutor-support.mjs";
import {
  buildDiagnosticResult,
  DIAGNOSTIC_MAX_QUESTIONS,
  DIAGNOSTIC_MIN_QUESTIONS,
  DIAGNOSTIC_TARGET_SECONDS,
  initialDiagnosticQuestion,
  initialQuickDiagnosticQuestion,
  judgePrivateTutorAnswer,
  privateTutorDiagnosticConfig,
  privateTutorQuickDiagnosticConfig,
  privateTutorQuestion,
  publicQuestion,
  selectNextDiagnosticQuestion,
  selectNextQuickDiagnosticQuestion,
} from "../services/private-tutor-assessment.mjs";
import {
  applyPrivateTutorCatchUpPlan,
  buildPrivateTutorCatchUpPlanPreview,
  buildPrivateTutorGoalForecast,
  buildPrivateTutorSevenDayPlan,
  decidePrivateTutorStrategy,
  derivePrivateTutorPlanProgress,
  derivePrivateTutorLearnerModel,
  rollPrivateTutorFuturePlan,
  resolvePrivateTutorGoalScopeKnowledgeIds,
} from "../services/private-tutor-learning-model.mjs";
import { buildPrivateTutorLearningHistory } from "../services/private-tutor-learning-history.mjs";
import {
  buildPrivateTutorRoadmapLedgerView,
  recordPrivateTutorRoadmapSnapshot,
} from "../services/private-tutor-roadmap-ledger.mjs";
import {
  buildPrivateTutorExperienceReport,
  buildPrivateTutorTeachingPolicy,
  recordPrivateTutorExperienceEvent,
  recordPrivateTutorSuggestionAdoption,
  recordPrivateTutorTeachingStrategyDecision,
} from "../services/private-tutor-teaching-strategy.mjs";
import {
  completeExpiredPrivateTutorLearningTrials,
  latestPrivateTutorLearningTrialView,
  recordPrivateTutorFollowUpResolution,
  startPrivateTutorLearningTrial,
  stopPrivateTutorLearningTrial,
} from "../services/private-tutor-learning-trial.mjs";
import {
  answerPrivateTutorFollowUp,
  completePrivateTutorActivity,
  completePrivateTutorPlanDay,
  createPrivateTutorSession,
  currentPrivateTutorActivity,
  pausePrivateTutorSession,
  PRIVATE_TUTOR_SESSION_PACES,
  privateTutorSessionView,
  recordPrivateTutorSessionAnswer,
  resumePrivateTutorSession,
  revealPrivateTutorHint,
} from "../services/private-tutor-session.mjs";
import {
  activatePrivateTutorPackageRuntime,
  deactivateMaterialDerivedLearning,
  isPrivateTutorPackageLearningAvailable,
  privateTutorRuntimeValidation,
  validatePrivateTutorPackageRuntime,
} from "../services/private-tutor-adaptive-runtime.mjs";
import {
  normalizePrivateTutorSpeech,
  privateTutorVoiceTurnView,
} from "../services/private-tutor-voice.mjs";
import {
  correctPrivateTutorDiagnosis,
  currentPrivateTutorReviewQuestion,
  privateTutorReviewBook,
  privateTutorReviewScheduleView,
  recordPrivateTutorErrorEvidence,
  recordPrivateTutorReviewResult,
} from "../services/private-tutor-review.mjs";
import {
  buildPrivateTutorWeeklyReport,
  createPrivateTutorPilotCohort,
  enforcePrivateTutorReleaseGates,
  privateTutorGuardianPreferences,
  privateTutorReleaseReadiness,
  recordPrivateTutorReleaseEvaluation,
  updatePrivateTutorGuardianPreferences,
} from "../services/private-tutor-family.mjs";
import {
  createPrivateTutorQuestionRevision,
  disablePrivateTutorQuestionRevision,
  listPrivateTutorQuestionRevisions,
  publishPrivateTutorQuestionRevision,
  reviewPrivateTutorQuestionRevision,
  rollbackPrivateTutorQuestion,
  submitPrivateTutorQuestionRevision,
} from "../services/private-tutor-content.mjs";
import {
  PRIVATE_TUTOR_LEARNER_COLLECTION_KEYS,
  acceptPrivateTutorGuardianInvitation,
  applyPrivateTutorDataRetention,
  buildPrivateTutorLearnerExport,
  createPrivateTutorGuardianInvitation,
  erasePrivateTutorLearnerData,
  listPrivateTutorGuardianInvitations,
  previewPrivateTutorLearnerDeletion,
  preparePrivateTutorLearnerDeletion,
  privateTutorDataPolicy,
  updatePrivateTutorDataPolicy,
} from "../services/private-tutor-governance.mjs";
import {
  acceptPrivateTutorPilotConsent,
  applyPrivateTutorPilotLifecycle,
  pausePrivateTutorPilotCohort,
  privateTutorPilotGuardianStatus,
  privateTutorPilotOperations,
  privateTutorPilotPauseForLearner,
  recordPrivateTutorPilotCheckIn,
  reportPrivateTutorPilotIncident,
  resumePrivateTutorPilotCohort,
  updatePrivateTutorPilotIncident,
  withdrawPrivateTutorPilotParticipation,
} from "../services/private-tutor-pilot.mjs";
import {
  buildPrivateTutorProfileMigrationReport,
  mergeOwnedPrivateTutorProfiles,
} from "../services/private-tutor-migration.mjs";
import {
  privateTutorPackageRegistryFromState,
} from "../services/private-tutor-package-registry.mjs";
import {
  parseUploadedMaterialDocument,
} from "../services/private-tutor-material-parser.mjs";
import {
  confirmKnowledgeMapDraft,
  generateKnowledgeMapDraft,
  publishKnowledgeMapDraft,
  updateKnowledgeMapDraft,
} from "../services/private-tutor-graph-extractor.mjs";
import {
  confirmAuthoredContentVersion,
  generateAuthoredContentVersion,
  updateAuthoredContentVersion,
} from "../services/private-tutor-content-authoring.mjs";
import {
  privateTutorLearningPreferences,
  sanitizePrivateTutorLearningGoal,
  setPrivateTutorPackageDeactivated,
  updatePrivateTutorLearningPreferences,
} from "../services/private-tutor-learning-preferences.mjs";
import {
  listPrivateTutorEvaluationReviewQueue,
  privateTutorEvaluationReviewQueueItem,
  recomputePrivateTutorMasteryEvidence,
  resolvePrivateTutorEvaluationReview,
} from "../services/private-tutor-evaluation-review.mjs";
import {
  createPrivateTutorGoldenCandidate,
  linkPrivateTutorGoldenCandidateMigration,
  listPrivateTutorGoldenCandidates,
  reviewPrivateTutorGoldenCandidate,
} from "../services/private-tutor-golden-candidates.mjs";
import {
  applyPrivateTutorContentMigration,
  confirmPrivateTutorContentMigration,
  createPrivateTutorContentMigrationPreview,
  listPrivateTutorContentMigrationCandidates,
  rollbackPrivateTutorContentMigration,
  updatePrivateTutorContentMigrationMapping,
} from "../services/private-tutor-content-migration.mjs";

const LOCAL_TEAM_ID = "team_local";
const LOCAL_USER_ID = "usr_local";
const MAX_NAME_LENGTH = 40;
const MAX_GRADE_LENGTH = 40;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const KNOWLEDGE_IDS = new Set(["integer", "equation-meaning", "balance", "word-problem"]);
const ATTEMPT_SOURCES = new Set(["screen", "voice_confirmed", "visual"]);
const EXIT_PIN_PATTERN = /^\d{6,12}$/;
const EXIT_FAILURE_LIMIT = 5;
const EXIT_LOCK_MS = 5 * 60 * 1000;
const VOICE_MODES = new Set(["push_to_talk", "hands_free"]);
const VOICE_EVENT_TYPES = new Set([
  "recognition_started",
  "recognition_stopped",
  "recognition_error",
  "playback_started",
  "playback_completed",
  "playback_interrupted",
  "mode_changed",
]);

export async function handlePrivateTutorRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  state,
  actor,
  now,
  nextId,
  persistStateSoon,
  persistStateNow,
  finalizePrivateTutorLearnerDeletion,
  privateTutorReleaseBuildId = "development-unversioned",
  privateTutorMaterialOcrService = null,
  desktopToken = "",
}) {
  if (!url.pathname.startsWith("/api/private-tutor/")) return false;
  ensureCollections(state);
  if (url.pathname === "/api/private-tutor/internal/local-materials") {
    const actualToken = Buffer.from(String(req.headers["x-desktop-credential-token"] ?? ""));
    const expectedToken = Buffer.from(String(desktopToken ?? ""));
    if (!expectedToken.length || actualToken.length !== expectedToken.length || !timingSafeEqual(actualToken, expectedToken)) {
      sendJson(res, 404, { error: "not_found" });
      return true;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const learnerId = actor?.privateTutorLearnerId || actor?.userId;
    if (!learnerId || !privateTutorMaterialOcrService) {
      sendJson(res, 503, { error: "private_tutor_local_import_unavailable" });
      return true;
    }
    const body = await readJson(req).catch(() => ({}));
    try {
      const result = await privateTutorMaterialOcrService.importLocalPath(body.path, learnerId, {
        startOcr: body.startOcr === true,
        cloudAllowed: body.cloudAllowed === true,
      });
      sendJson(res, result.replayed ? 200 : 201, result);
    } catch (error) {
      sendJson(res, Number(error?.status) || 400, {
        error: String(error?.code ?? error?.message ?? "private_tutor_local_import_failed"),
        message: String(error?.message ?? "Local import failed.").slice(0, 500),
      });
    }
    return true;
  }
  const pilotLifecycle = applyPrivateTutorPilotLifecycle(state, now());
  if (pilotLifecycle.completed > 0) (persistStateNow ?? persistStateSoon)();
  const initialReadiness = privateTutorReleaseReadiness(state, privateTutorReleaseBuildId, now());
  const releaseEnforcement = enforcePrivateTutorReleaseGates(state, initialReadiness, now());
  if (releaseEnforcement.paused > 0) (persistStateNow ?? persistStateSoon)();
  const retention = applyPrivateTutorDataRetention(state, { now, nextId });
  if (retention.reaped > 0) persistStateSoon();

  if (url.pathname === "/api/private-tutor/guardian-invitations/accept") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    if (actor?.privateTutorLearnerId || !actor?.userId) {
      sendJson(res, 403, { error: "private_tutor_child_mode_restricted" });
      return true;
    }
    const body = await readJson(req).catch(() => ({}));
    const result = acceptPrivateTutorGuardianInvitation(state, body?.invitationToken, { actor, now, nextId });
    if (!result.ok) {
      if (result.changed) (persistStateNow ?? persistStateSoon)();
      sendJson(res, result.status, { error: result.error });
      return true;
    }
    recordAudit(state, { learner: result.learner, actor, action: "guardian_invitation_accepted", details: { invitationId: result.invitation.id, guardianLinkId: result.guardianLink.id }, now, nextId });
    (persistStateNow ?? persistStateSoon)();
    sendJson(res, 200, { learner: learnerView(result.learner), guardianLink: result.guardianLink, invitation: result.invitation });
    return true;
  }

  if (url.pathname === "/api/private-tutor/deletions") {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    if (actor?.privateTutorLearnerId || !actor?.userId) {
      sendJson(res, 403, { error: "private_tutor_child_mode_restricted" });
      return true;
    }
    const deletions = state.privateTutorDeletionJobs
      .filter((job) => job.requestedBy === actor.userId && job.status !== "completed")
      .map((job) => {
        const report = state.privateTutorDeletionReports.find((row) => row.id === job.reportId && row.actorId === actor.userId);
        if (!report) return null;
        return {
          reportId: report.id,
          status: job.status,
          attempts: Number(job.attempts ?? 0),
          requestedAt: report.requestedAt,
          lastAttemptAt: job.lastAttemptAt,
          verificationOk: report.durableVerification?.ok === true,
        };
      })
      .filter(Boolean)
      .sort((left, right) => String(right.requestedAt).localeCompare(String(left.requestedAt)));
    sendJson(res, 200, { deletions });
    return true;
  }

  const deletionRetryMatch = url.pathname.match(/^\/api\/private-tutor\/deletions\/([^/]+)\/retry$/);
  if (deletionRetryMatch) {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    if (actor?.privateTutorLearnerId || !actor?.userId) {
      sendJson(res, 403, { error: "private_tutor_child_mode_restricted" });
      return true;
    }
    const reportId = decodeURIComponent(deletionRetryMatch[1]);
    const report = state.privateTutorDeletionReports.find((row) => row.id === reportId);
    const job = state.privateTutorDeletionJobs.find((row) => row.reportId === reportId && row.requestedBy === actor.userId);
    if (!report || !job) {
      sendJson(res, 404, { error: "private_tutor_deletion_job_not_found" });
      return true;
    }
    if (job.status === "completed") {
      sendJson(res, 200, { deletedId: null, deletionReport: report, replayed: true });
      return true;
    }
    if (!job.subjectId || !finalizePrivateTutorLearnerDeletion) {
      sendJson(res, 409, { error: "private_tutor_deletion_job_not_retryable" });
      return true;
    }
    erasePrivateTutorLearnerData(state, job.subjectId, report, now());
    const durableVerification = finalizePrivateTutorLearnerDeletion({
      learnerId: job.subjectId,
      collectionKeys: PRIVATE_TUTOR_LEARNER_COLLECTION_KEYS,
      report,
      job,
    });
    if (report.liveStateResidualCount !== 0 || durableVerification?.ok !== true) {
      sendJson(res, 503, {
        error: "private_tutor_deletion_verification_failed",
        message: "删除仍未通过完整介质验证，系统会保留任务以便安全重试。",
        deletionReport: { ...report, durableVerification },
      });
      return true;
    }
    sendJson(res, 200, { deletedId: null, deletionReport: { ...report, durableVerification }, replayed: false });
    return true;
  }

  if (url.pathname === "/api/private-tutor/content-packages") {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const registry = privateTutorPackageRegistryFromState(state);
    const sourceType = url.searchParams.get("sourceType") || undefined;
    const domain = url.searchParams.get("domain") || undefined;
    const packages = registry.listPackages({
      sourceType,
      domain,
      learningProfileId: actor?.userId ?? LOCAL_USER_ID,
    });
    sendJson(res, 200, { packages });
    return true;
  }

  const contentPackageGraphMatch = url.pathname.match(/^\/api\/private-tutor\/content-packages\/([^/]+)\/knowledge-graph$/);
  if (contentPackageGraphMatch) {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const packageId = decodeURIComponent(contentPackageGraphMatch[1]);
    const registry = privateTutorPackageRegistryFromState(state);
    const pkg = registry.getPackage(packageId);
    if (!privateTutorPackageVisibleToActor(pkg, actor)) {
      sendJson(res, 404, { error: "private_tutor_content_package_not_found" });
      return true;
    }
    const graph = registry.knowledgeGraph(packageId);
    if (!graph) {
      sendJson(res, 404, { error: "private_tutor_content_package_not_found" });
      return true;
    }
    sendJson(res, 200, { knowledgeGraph: graph });
    return true;
  }

  const contentPackageDetailMatch = url.pathname.match(/^\/api\/private-tutor\/content-packages\/([^/]+)$/);
  if (contentPackageDetailMatch) {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const packageId = decodeURIComponent(contentPackageDetailMatch[1]);
    const registry = privateTutorPackageRegistryFromState(state);
    const pkg = registry.getPackage(packageId);
    if (!privateTutorPackageVisibleToActor(pkg, actor)) {
      sendJson(res, 404, { error: "private_tutor_content_package_not_found" });
      return true;
    }
    sendJson(res, 200, { package: pkg });
    return true;
  }

  // Material Import & Knowledge Map Drafts
  if (url.pathname === "/api/private-tutor/materials") {
    const learnerId = actor?.privateTutorLearnerId || actor?.userId;
    if (!learnerId) {
      sendJson(res, 403, { error: "private_tutor_learner_required" });
      return true;
    }
    if (req.method === "GET") {
      const materials = state.privateTutorMaterialDocuments.filter(
        (doc) => doc.learningProfileId === learnerId
      );
      sendJson(res, 200, { materials });
      return true;
    }
    if (req.method === "POST") {
      const body = await readJson(req).catch(() => ({}));
      if (!body.fileName || !body.fileContent) {
        sendJson(res, 400, { error: "missing_required_fields" });
        return true;
      }
      try {
        const doc = await parseUploadedMaterialDocument({
          learningProfileId: learnerId,
          fileName: body.fileName,
          fileType: body.fileType,
          fileContent: body.fileContent,
          fileEncoding: body.fileEncoding,
          fileSize: body.fileSize,
        }, {
          sourceStore: privateTutorMaterialOcrService?.storeSource ?? null,
        });
        const existingIndex = state.privateTutorMaterialDocuments.findIndex((item) =>
          item.learningProfileId === learnerId && item.sourceHash === doc.sourceHash);
        if (existingIndex >= 0) state.privateTutorMaterialDocuments[existingIndex] = doc;
        else state.privateTutorMaterialDocuments.push(doc);
        persistStateSoon();
        sendJson(res, existingIndex >= 0 ? 200 : 201, { material: doc, replayed: existingIndex >= 0 });
      } catch (err) {
        const error = String(err?.code ?? err?.message ?? "private_tutor_material_parse_failed");
        sendJson(res, error === "file_size_exceeds_limit" ? 413 : 400, {
          error,
          message: String(err?.message ?? error).slice(0, 500),
        });
      }
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  const materialOcrJobsMatch = url.pathname.match(/^\/api\/private-tutor\/materials\/([^/]+)\/ocr-jobs$/);
  if (materialOcrJobsMatch) {
    const learnerId = actor?.privateTutorLearnerId || actor?.userId;
    if (!learnerId) {
      sendJson(res, 403, { error: "private_tutor_learner_required" });
      return true;
    }
    if (!privateTutorMaterialOcrService) {
      sendJson(res, 503, { error: "private_tutor_ocr_service_unavailable" });
      return true;
    }
    const materialId = decodeURIComponent(materialOcrJobsMatch[1]);
    const material = state.privateTutorMaterialDocuments.find((item) => item.id === materialId && item.learningProfileId === learnerId);
    if (!material) {
      sendJson(res, 404, { error: "material_not_found" });
      return true;
    }
    if (req.method === "GET") {
      sendJson(res, 200, { jobs: privateTutorMaterialOcrService.listJobs(learnerId, material.id) });
      return true;
    }
    if (req.method === "POST") {
      const body = await readJson(req).catch(() => ({}));
      try {
        const result = privateTutorMaterialOcrService.start(material, learnerId, {
          cloudAllowed: body.cloudAllowed === true,
        });
        sendJson(res, result.replayed ? 200 : 202, result);
      } catch (error) {
        sendJson(res, Number(error?.status) || 400, { error: String(error?.code ?? error?.message ?? "private_tutor_ocr_start_failed") });
      }
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  const ocrJobMatch = url.pathname.match(/^\/api\/private-tutor\/ocr-jobs\/([^/]+)(?:\/(retry|cancel))?$/);
  if (ocrJobMatch) {
    const learnerId = actor?.privateTutorLearnerId || actor?.userId;
    if (!learnerId) {
      sendJson(res, 403, { error: "private_tutor_learner_required" });
      return true;
    }
    if (!privateTutorMaterialOcrService) {
      sendJson(res, 503, { error: "private_tutor_ocr_service_unavailable" });
      return true;
    }
    const job = privateTutorMaterialOcrService.getJob(decodeURIComponent(ocrJobMatch[1]), learnerId);
    if (!job) {
      sendJson(res, 404, { error: "private_tutor_ocr_job_not_found" });
      return true;
    }
    const action = ocrJobMatch[2] ?? null;
    if (!action && req.method === "GET") {
      const material = state.privateTutorMaterialDocuments.find((item) => item.id === job.materialId && item.learningProfileId === learnerId) ?? null;
      sendJson(res, 200, { job, material });
      return true;
    }
    if (req.method === "POST" && action) {
      const body = await readJson(req).catch(() => ({}));
      try {
        const updated = action === "retry"
          ? privateTutorMaterialOcrService.retry(job, learnerId, { cloudAllowed: body.cloudAllowed })
          : privateTutorMaterialOcrService.cancel(job, learnerId);
        sendJson(res, 200, { job: updated });
      } catch (error) {
        sendJson(res, Number(error?.status) || 400, { error: String(error?.code ?? error?.message ?? "private_tutor_ocr_job_operation_failed") });
      }
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  const materialOcrPageImageMatch = url.pathname.match(/^\/api\/private-tutor\/materials\/([^/]+)\/ocr-pages\/(\d+)\/image$/);
  if (materialOcrPageImageMatch) {
    const learnerId = actor?.privateTutorLearnerId || actor?.userId;
    if (!learnerId) {
      sendJson(res, 403, { error: "private_tutor_learner_required" });
      return true;
    }
    if (!privateTutorMaterialOcrService) {
      sendJson(res, 503, { error: "private_tutor_ocr_service_unavailable" });
      return true;
    }
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const materialId = decodeURIComponent(materialOcrPageImageMatch[1]);
    const material = state.privateTutorMaterialDocuments.find((item) =>
      item.id === materialId && item.learningProfileId === learnerId);
    if (!material) {
      sendJson(res, 404, { error: "material_not_found" });
      return true;
    }
    try {
      const image = privateTutorMaterialOcrService.readPageImage(
        material,
        learnerId,
        Number(materialOcrPageImageMatch[2]),
      );
      res.writeHead(200, {
        "Content-Type": image.contentType,
        "Content-Length": image.bytes.length,
        "Content-Disposition": `inline; filename="${image.fileName}"`,
        "Cache-Control": "private, no-store",
        "Cross-Origin-Resource-Policy": "same-site",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(image.bytes);
    } catch (error) {
      sendJson(res, Number(error?.status) || 400, { error: String(error?.code ?? error?.message ?? "private_tutor_ocr_page_image_failed") });
    }
    return true;
  }

  const materialOcrReviewMatch = url.pathname.match(/^\/api\/private-tutor\/materials\/([^/]+)\/ocr-review$/);
  if (materialOcrReviewMatch) {
    const learnerId = actor?.privateTutorLearnerId || actor?.userId;
    if (!learnerId) {
      sendJson(res, 403, { error: "private_tutor_learner_required" });
      return true;
    }
    if (!privateTutorMaterialOcrService) {
      sendJson(res, 503, { error: "private_tutor_ocr_service_unavailable" });
      return true;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const materialId = decodeURIComponent(materialOcrReviewMatch[1]);
    const material = state.privateTutorMaterialDocuments.find((item) =>
      item.id === materialId && item.learningProfileId === learnerId);
    if (!material) {
      sendJson(res, 404, { error: "material_not_found" });
      return true;
    }
    const body = await readJson(req).catch(() => ({}));
    try {
      const updated = privateTutorMaterialOcrService.reviewPage(material, learnerId, body);
      const job = privateTutorMaterialOcrService.listJobs(learnerId, materialId)[0] ?? null;
      sendJson(res, 200, { material: updated, job });
    } catch (error) {
      const code = String(error?.code ?? error?.message ?? "private_tutor_ocr_review_failed");
      const status = code === "private_tutor_ocr_review_revision_conflict" ? 409 : Number(error?.status) || 400;
      sendJson(res, status, { error: code, message: String(error?.message ?? code).slice(0, 500) });
    }
    return true;
  }

  const materialDetailMatch = url.pathname.match(/^\/api\/private-tutor\/materials\/([^/]+)$/);
  if (materialDetailMatch) {
    const learnerId = actor?.privateTutorLearnerId || actor?.userId;
    if (!learnerId) {
      sendJson(res, 403, { error: "private_tutor_learner_required" });
      return true;
    }
    const materialId = decodeURIComponent(materialDetailMatch[1]);
    const doc = state.privateTutorMaterialDocuments.find((d) => d.id === materialId);
    if (!doc || doc.learningProfileId !== learnerId) {
      sendJson(res, 404, { error: "material_not_found" });
      return true;
    }

    if (req.method === "GET") {
      sendJson(res, 200, { material: doc });
      return true;
    }
    if (req.method === "DELETE") {
      const deactivation = deactivateMaterialDerivedLearning(state, doc, now());
      privateTutorMaterialOcrService?.removeMaterialArtifacts(doc);
      state.privateTutorMaterialDocuments = state.privateTutorMaterialDocuments.filter((d) => d.id !== materialId);
      state.privateTutorOcrJobs = state.privateTutorOcrJobs.filter((job) => job.materialId !== materialId);
      state.privateTutorKnowledgeMapDrafts = state.privateTutorKnowledgeMapDrafts.filter((d) => d.materialDocumentId !== materialId);
      persistStateSoon();
      sendJson(res, 200, { deleted: true, deactivation });
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  const generateDraftMatch = url.pathname.match(/^\/api\/private-tutor\/materials\/([^/]+)\/generate-draft$/);
  if (generateDraftMatch) {
    const learnerId = actor?.privateTutorLearnerId || actor?.userId;
    if (!learnerId) {
      sendJson(res, 403, { error: "private_tutor_learner_required" });
      return true;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const materialId = decodeURIComponent(generateDraftMatch[1]);
    const doc = state.privateTutorMaterialDocuments.find((d) => d.id === materialId);
    if (!doc || doc.learningProfileId !== learnerId) {
      sendJson(res, 404, { error: "material_not_found" });
      return true;
    }

    const body = await readJson(req).catch(() => ({}));
    if (!body.packageName) {
      sendJson(res, 400, { error: "missing_package_name" });
      return true;
    }

    try {
      if (doc.status !== "parsed") {
        sendJson(res, 409, {
          error: "private_tutor_material_not_ready",
          status: doc.status,
          extraction: doc.extraction ?? null,
        });
        return true;
      }
      const draft = generateKnowledgeMapDraft({
        materialDocument: doc,
        packageName: body.packageName,
        subjectId: body.subjectId || "general",
        domain: body.domain || "general",
      });
      state.privateTutorKnowledgeMapDrafts.push(draft);
      persistStateSoon();
      sendJson(res, 201, { draft });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return true;
  }

  const draftDetailMatch = url.pathname.match(/^\/api\/private-tutor\/knowledge-map-drafts\/([^/]+)$/);
  if (draftDetailMatch) {
    const learnerId = actor?.privateTutorLearnerId || actor?.userId;
    if (!learnerId) {
      sendJson(res, 403, { error: "private_tutor_learner_required" });
      return true;
    }
    const draftId = decodeURIComponent(draftDetailMatch[1]);
    const draftIndex = state.privateTutorKnowledgeMapDrafts.findIndex((d) => d.id === draftId);
    const draft = draftIndex !== -1 ? state.privateTutorKnowledgeMapDrafts[draftIndex] : null;

    if (!draft || draft.learningProfileId !== learnerId) {
      sendJson(res, 404, { error: "draft_not_found" });
      return true;
    }

    if (req.method === "GET") {
      sendJson(res, 200, { draft });
      return true;
    }
    if (req.method === "PUT") {
      const body = await readJson(req).catch(() => ({}));
      try {
        const updated = updateKnowledgeMapDraft(state, draftId, body, now());
        state.privateTutorKnowledgeMapDrafts[draftIndex] = updated;
        persistStateSoon();
        sendJson(res, 200, { draft: updated });
      } catch (error) {
        sendJson(res, 400, { error: String(error?.message ?? "invalid_knowledge_map_draft") });
      }
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  const authorContentMatch = url.pathname.match(/^\/api\/private-tutor\/knowledge-map-drafts\/([^/]+)\/author-content$/);
  const authoredContentMatch = url.pathname.match(/^\/api\/private-tutor\/knowledge-map-drafts\/([^/]+)\/authored-content$/);
  const confirmAuthoredContentMatch = url.pathname.match(/^\/api\/private-tutor\/knowledge-map-drafts\/([^/]+)\/authored-content\/confirm$/);
  if (authorContentMatch || authoredContentMatch || confirmAuthoredContentMatch) {
    const learnerId = actor?.privateTutorLearnerId || actor?.userId;
    if (!learnerId) {
      sendJson(res, 403, { error: "private_tutor_learner_required" });
      return true;
    }
    const match = authorContentMatch || authoredContentMatch || confirmAuthoredContentMatch;
    const draftId = decodeURIComponent(match[1]);
    const draft = state.privateTutorKnowledgeMapDrafts.find((item) => item.id === draftId);
    if (!draft || draft.learningProfileId !== learnerId) {
      sendJson(res, 404, { error: "draft_not_found" });
      return true;
    }
    const requiredMethod = authoredContentMatch ? "PUT" : "POST";
    if (req.method !== requiredMethod) {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const body = await readJson(req).catch(() => ({}));
    try {
      const authoredContent = authorContentMatch
        ? generateAuthoredContentVersion(state, draftId, {
            actorId: actor.userId,
            forceRegenerate: body.forceRegenerate === true,
            now: now(),
          })
        : authoredContentMatch
          ? updateAuthoredContentVersion(state, draftId, body, now())
          : confirmAuthoredContentVersion(state, draftId, {
              actorId: actor.userId,
              expectedRevision: body.expectedRevision,
              acknowledgeContentReview: body.acknowledgeContentReview,
              now: now(),
            });
      persistStateSoon();
      sendJson(res, authorContentMatch ? 201 : 200, { draft, authoredContent });
    } catch (error) {
      const code = String(error?.message ?? "authored_content_operation_failed");
      const conflict = code.endsWith("_revision_conflict") || code.endsWith("_source_map_changed");
      sendJson(res, conflict ? 409 : 400, { error: code });
    }
    return true;
  }

  const publishDraftMatch = url.pathname.match(/^\/api\/private-tutor\/knowledge-map-drafts\/([^/]+)\/publish$/);
  if (publishDraftMatch) {
    const learnerId = actor?.privateTutorLearnerId || actor?.userId;
    if (!learnerId) {
      sendJson(res, 403, { error: "private_tutor_learner_required" });
      return true;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const draftId = decodeURIComponent(publishDraftMatch[1]);
    const draft = state.privateTutorKnowledgeMapDrafts.find((d) => d.id === draftId);

    if (!draft || draft.learningProfileId !== learnerId) {
      sendJson(res, 404, { error: "draft_not_found" });
      return true;
    }

    try {
      const packageId = publishKnowledgeMapDraft(state, draftId);
      persistStateSoon();
      sendJson(res, 200, { success: true, packageId });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return true;
  }

  const goldenCandidateActionMatch = url.pathname.match(/^\/api\/private-tutor\/golden-candidates\/([^/]+)\/(migration|reviews)$/);
  if (url.pathname === "/api/private-tutor/golden-candidates" || goldenCandidateActionMatch) {
    if (actor?.privateTutorLearnerId || !["owner", "admin"].includes(actor?.role)) {
      sendJson(res, 403, { error: "private_tutor_professional_role_required" });
      return true;
    }
    if (url.pathname === "/api/private-tutor/golden-candidates" && req.method === "GET") {
      const candidates = listPrivateTutorGoldenCandidates(state, {
        ownerTeamId: actor.teamId,
        status: url.searchParams.get("status"),
        limit: url.searchParams.get("limit") ?? 50,
      });
      sendJson(res, 200, { candidates });
      return true;
    }
    if (url.pathname === "/api/private-tutor/golden-candidates" && req.method === "POST") {
      const body = await readJson(req).catch(() => ({}));
      const result = createPrivateTutorGoldenCandidate(state, body, { actor, now, nextId });
      if (!result.ok) {
        sendJson(res, result.status, { error: result.error, ...(result.detected ? { detected: result.detected } : {}) });
        return true;
      }
      const stored = state.privateTutorGoldenCandidates.find((row) => row.id === result.candidate.id);
      const learner = state.privateTutorLearners.find((row) => row.id === stored?.learnerId);
      if (learner) recordAudit(state, {
        learner,
        actor,
        action: "golden_candidate_created",
        details: {
          candidateId: result.candidate.id,
          classification: result.candidate.classification,
          promotionEligible: result.candidate.promotionEligible,
        },
        now,
        nextId,
      });
      (persistStateNow ?? persistStateSoon)();
      sendJson(res, 201, result);
      return true;
    }
    if (goldenCandidateActionMatch && req.method === "POST") {
      const candidateId = decodeURIComponent(goldenCandidateActionMatch[1]);
      const body = await readJson(req).catch(() => ({}));
      const action = goldenCandidateActionMatch[2];
      const result = action === "migration"
        ? linkPrivateTutorGoldenCandidateMigration(state, candidateId, body, { actor, now, nextId })
        : reviewPrivateTutorGoldenCandidate(state, candidateId, body, { actor, now, nextId });
      if (!result.ok) {
        sendJson(res, result.status, { error: result.error, ...(result.detected ? { detected: result.detected } : {}) });
        return true;
      }
      const stored = state.privateTutorGoldenCandidates.find((row) => row.id === result.candidate.id);
      const learner = state.privateTutorLearners.find((row) => row.id === stored?.learnerId);
      if (learner) recordAudit(state, {
        learner,
        actor,
        action: action === "migration" ? "golden_candidate_migration_linked" : "golden_candidate_reviewed",
        details: {
          candidateId: result.candidate.id,
          status: result.candidate.status,
          ...(result.review ? { reviewId: result.review.id, decision: result.review.decision } : {}),
          ...(result.candidate.migration ? { migrationId: result.candidate.migration.migrationId } : {}),
        },
        now,
        nextId,
      });
      (persistStateNow ?? persistStateSoon)();
      sendJson(res, 200, result);
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  const confirmDraftMatch = url.pathname.match(/^\/api\/private-tutor\/knowledge-map-drafts\/([^/]+)\/confirm$/);
  if (confirmDraftMatch) {
    const learnerId = actor?.privateTutorLearnerId || actor?.userId;
    if (!learnerId) {
      sendJson(res, 403, { error: "private_tutor_learner_required" });
      return true;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const draftId = decodeURIComponent(confirmDraftMatch[1]);
    const draft = state.privateTutorKnowledgeMapDrafts.find((item) => item.id === draftId);
    if (!draft || draft.learningProfileId !== learnerId) {
      sendJson(res, 404, { error: "draft_not_found" });
      return true;
    }
    const body = await readJson(req).catch(() => ({}));
    try {
      const confirmed = confirmKnowledgeMapDraft(state, draftId, {
        actorId: actor.userId,
        expectedRevision: body.expectedRevision,
        acknowledgeSourceReview: body.acknowledgeSourceReview,
        now: now(),
      });
      persistStateSoon();
      sendJson(res, 200, { draft: confirmed });
    } catch (error) {
      const code = String(error?.message ?? "knowledge_map_confirmation_failed");
      sendJson(res, code === "draft_revision_conflict" ? 409 : 400, { error: code });
    }
    return true;
  }

  const evaluationReviewMatch = url.pathname.match(/^\/api\/private-tutor\/evaluation-reviews\/([^/]+)$/);
  if (url.pathname === "/api/private-tutor/evaluation-reviews" || evaluationReviewMatch) {
    if (actor?.privateTutorLearnerId || !["owner", "admin"].includes(actor?.role)) {
      sendJson(res, 403, { error: "private_tutor_professional_role_required" });
      return true;
    }
    if (url.pathname === "/api/private-tutor/evaluation-reviews" && req.method === "GET") {
      const queue = listPrivateTutorEvaluationReviewQueue(state, {
        ownerTeamId: actor.teamId,
        status: url.searchParams.get("status") ?? "required",
        limit: url.searchParams.get("limit") ?? 50,
      });
      sendJson(res, 200, { queue });
      return true;
    }
    if (evaluationReviewMatch && req.method === "POST") {
      const attemptId = decodeURIComponent(evaluationReviewMatch[1]);
      const body = await readJson(req).catch(() => ({}));
      const result = resolvePrivateTutorEvaluationReview(state, attemptId, body, { actor, now, nextId });
      if (!result.ok) {
        sendJson(res, result.status, {
          error: result.error,
          ...(result.decisionFingerprint ? { decisionFingerprint: result.decisionFingerprint } : {}),
        });
        return true;
      }
      const learner = state.privateTutorLearners.find((row) => row.id === result.attempt.learnerId && row.status === "active");
      let recomputation = { changed: false, snapshot: null, activePackage: false };
      let intelligence = learner ? currentPrivateTutorIntelligence(state, learner.id) : {};
      if (!result.replayed && learner) {
        recomputation = recomputePrivateTutorMasteryEvidence(state, learner, {
          contentPackageId: result.attempt.contentPackageId ?? activeContentPackageId(learner),
          contentPackageVersion: result.attempt.contentPackageVersion,
          reviewId: result.review.id,
          now,
        });
        if (recomputation.changed && recomputation.activePackage) {
          intelligence = refreshPrivateTutorIntelligence(state, learner, {
            now,
            nextId,
            reason: "human_evaluation_review_completed",
          });
        }
        recordAudit(state, {
          learner,
          actor,
          action: "evaluation_review_completed",
          details: {
            reviewId: result.review.id,
            attemptId: result.attempt.id,
            decision: result.review.decision,
            finalEvidenceEligible: result.review.finalEvidenceEligible,
            masteryRecomputed: recomputation.changed,
          },
          now,
          nextId,
        });
        (persistStateNow ?? persistStateSoon)();
      }
      sendJson(res, 200, {
        review: result.review,
        item: privateTutorEvaluationReviewQueueItem(state, result.attempt),
        snapshot: snapshotView(recomputation.snapshot ?? state.privateTutorSnapshots.find((row) => row.learnerId === result.attempt.learnerId)),
        masteryRecomputed: recomputation.changed,
        ...intelligence,
        replayed: result.replayed,
      });
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  if (url.pathname === "/api/private-tutor/content/questions" || url.pathname.startsWith("/api/private-tutor/content/questions/")) {
    if (actor?.privateTutorLearnerId || !["owner", "admin"].includes(actor?.role)) {
      sendJson(res, 403, { error: "private_tutor_professional_role_required" });
      return true;
    }
    if (url.pathname === "/api/private-tutor/content/questions") {
      if (req.method === "GET") {
        sendJson(res, 200, { revisions: listPrivateTutorQuestionRevisions(state) });
        return true;
      }
      if (req.method === "POST") {
        const body = await readJson(req).catch(() => ({}));
        const result = createPrivateTutorQuestionRevision(state, body, { actorId: actor.userId, now, nextId });
        if (!result.ok) sendJson(res, result.status, { error: result.error });
        else {
          persistStateSoon();
          sendJson(res, 201, result);
        }
        return true;
      }
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const rollbackMatch = url.pathname.match(/^\/api\/private-tutor\/content\/questions\/([^/]+)\/rollback$/);
    const actionMatch = url.pathname.match(/^\/api\/private-tutor\/content\/questions\/([^/]+)\/(submit|reviews|publish|disable)$/);
    if (req.method !== "POST" || (!rollbackMatch && !actionMatch)) {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const body = await readJson(req).catch(() => ({}));
    let result;
    if (rollbackMatch) {
      result = rollbackPrivateTutorQuestion(state, decodeURIComponent(rollbackMatch[1]), body, { actorId: actor.userId, now, nextId });
    } else {
      const revisionId = decodeURIComponent(actionMatch[1]);
      const action = actionMatch[2];
      if (action === "submit") result = submitPrivateTutorQuestionRevision(state, revisionId, { actorId: actor.userId, now, nextId });
      if (action === "reviews") result = reviewPrivateTutorQuestionRevision(state, revisionId, body, { actorId: actor.userId, now, nextId });
      if (action === "publish") result = publishPrivateTutorQuestionRevision(state, revisionId, { actorId: actor.userId, now, nextId });
      if (action === "disable") result = disablePrivateTutorQuestionRevision(state, revisionId, body, { actorId: actor.userId, now, nextId });
    }
    if (!result.ok) sendJson(res, result.status, { error: result.error });
    else {
      const readiness = privateTutorReleaseReadiness(state, privateTutorReleaseBuildId, now());
      enforcePrivateTutorReleaseGates(state, readiness, now());
      persistStateSoon();
      sendJson(res, 200, result);
    }
    return true;
  }

  if (url.pathname === "/api/private-tutor/release-readiness" || url.pathname === "/api/private-tutor/release-readiness/evaluations") {
    if (actor?.privateTutorLearnerId || !["owner", "admin"].includes(actor?.role)) {
      sendJson(res, 403, { error: "private_tutor_professional_role_required" });
      return true;
    }
    if (url.pathname.endsWith("/evaluations") && req.method === "POST") {
      const body = await readJson(req).catch(() => ({}));
      const evaluation = recordPrivateTutorReleaseEvaluation(state, {
        gateId: String(body?.gateId ?? ""),
        targetId: String(body?.targetId ?? ""),
        status: String(body?.status ?? ""),
        evidence: body?.evidence,
        evidenceType: String(body?.evidenceType ?? ""),
        environment: body?.environment,
        artifactName: body?.artifactName,
        artifactChecksumSha256: body?.artifactChecksumSha256,
        executedAt: body?.executedAt,
        reviewerId: actor.userId,
        at: now(),
        nextId,
        buildId: privateTutorReleaseBuildId,
      });
      if (!evaluation) {
        sendJson(res, 400, { error: "invalid_private_tutor_release_evaluation" });
        return true;
      }
      const readiness = privateTutorReleaseReadiness(state, privateTutorReleaseBuildId, now());
      enforcePrivateTutorReleaseGates(state, readiness, now());
      (persistStateNow ?? persistStateSoon)();
      sendJson(res, 201, { evaluation, readiness });
      return true;
    }
    if (url.pathname === "/api/private-tutor/release-readiness" && req.method === "GET") {
      sendJson(res, 200, { readiness: privateTutorReleaseReadiness(state, privateTutorReleaseBuildId, now()) });
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  if (url.pathname === "/api/private-tutor/pilot") {
    if (actor?.privateTutorLearnerId || !["owner", "admin"].includes(actor?.role)) {
      sendJson(res, 403, { error: "private_tutor_professional_role_required" });
      return true;
    }
    if (req.method === "GET") {
      const operations = privateTutorPilotOperations(state, now());
      sendJson(res, 200, { cohorts: operations.cohorts, readiness: privateTutorReleaseReadiness(state, privateTutorReleaseBuildId, now()), metrics: operations.metrics });
      return true;
    }
    if (req.method === "POST") {
      const body = await readJson(req).catch(() => ({}));
      const result = createPrivateTutorPilotCohort(state, body, { actor, now, nextId, buildId: privateTutorReleaseBuildId });
      if (!result.ok) {
        sendJson(res, result.status, { error: result.error, readiness: result.readiness });
        return true;
      }
      persistStateSoon();
      sendJson(res, 201, { cohort: result.cohort });
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  const pilotCohortActionMatch = url.pathname.match(/^\/api\/private-tutor\/pilot\/cohorts\/([^/]+)\/(pause|resume)$/);
  const pilotIncidentActionMatch = url.pathname.match(/^\/api\/private-tutor\/pilot\/incidents\/([^/]+)$/);
  if (url.pathname === "/api/private-tutor/pilot/operations" || pilotCohortActionMatch || pilotIncidentActionMatch) {
    if (actor?.privateTutorLearnerId || !["owner", "admin"].includes(actor?.role)) {
      sendJson(res, 403, { error: "private_tutor_professional_role_required" });
      return true;
    }
    if (url.pathname === "/api/private-tutor/pilot/operations" && req.method === "GET") {
      sendJson(res, 200, { operations: privateTutorPilotOperations(state, now()) });
      return true;
    }
    if (pilotCohortActionMatch && req.method === "POST") {
      const body = await readJson(req).catch(() => ({}));
      const cohortId = decodeURIComponent(pilotCohortActionMatch[1]);
      const result = pilotCohortActionMatch[2] === "pause"
        ? pausePrivateTutorPilotCohort(state, cohortId, body, { actor, now })
        : resumePrivateTutorPilotCohort(state, cohortId, body, { actor, now, releaseReady: privateTutorReleaseReadiness(state, privateTutorReleaseBuildId, now()).ready });
      if (!result.ok) sendJson(res, result.status, { error: result.error });
      else {
        (persistStateNow ?? persistStateSoon)();
        sendJson(res, 200, result);
      }
      return true;
    }
    if (pilotIncidentActionMatch && req.method === "POST") {
      const body = await readJson(req).catch(() => ({}));
      const result = updatePrivateTutorPilotIncident(state, decodeURIComponent(pilotIncidentActionMatch[1]), body, { actor, now });
      if (!result.ok) sendJson(res, result.status, { error: result.error });
      else {
        (persistStateNow ?? persistStateSoon)();
        sendJson(res, 200, result);
      }
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  if (url.pathname === "/api/private-tutor/child-mode") {
    if (req.method === "GET") {
      sendJson(res, 200, childModeView(actor));
      return true;
    }
    if (req.method === "POST") {
      if (!actor?.sessionId) {
        sendJson(res, 409, { error: "private_tutor_browser_session_required" });
        return true;
      }
      if (actor.privateTutorLearnerId) {
        sendJson(res, 409, { error: "private_tutor_child_mode_already_active" });
        return true;
      }
      const body = await readJson(req).catch(() => ({}));
      const learnerId = String(body?.learnerId ?? "").trim();
      const exitPin = String(body?.exitPin ?? "");
      const learner = findAuthorizedLearner(state, actor, learnerId, "manage");
      if (!learner) {
        sendJson(res, 404, learnerNotFound());
        return true;
      }
      if (!EXIT_PIN_PATTERN.test(exitPin)) {
        sendJson(res, 400, { error: "invalid_private_tutor_parent_pin", message: "Use a 6-12 digit parent PIN." });
        return true;
      }
      const session = state.identitySessions.find((row) => row.id === actor.sessionId && !row.revokedAt);
      if (!session) {
        sendJson(res, 409, { error: "private_tutor_browser_session_required" });
        return true;
      }
      const enteredAt = now();
      session.privateTutorChildMode = {
        learnerId: learner.id,
        exitPinHash: hashPassword(exitPin),
        enteredAt,
        failedExitAttempts: 0,
        lockedUntil: null,
      };
      recordAudit(state, {
        learner,
        actor,
        action: "child_mode_entered",
        details: { sessionId: session.id },
        now,
        nextId,
      });
      persistStateSoon();
      sendJson(res, 201, { active: true, learnerId: learner.id, enteredAt });
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  if (url.pathname === "/api/private-tutor/child-mode/exit") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const session = state.identitySessions.find((row) => row.id === actor?.sessionId && !row.revokedAt);
    const childMode = session?.privateTutorChildMode;
    if (!session || !childMode) {
      sendJson(res, 409, { error: "private_tutor_child_mode_not_active" });
      return true;
    }
    const nowMs = Date.parse(now());
    if (childMode.lockedUntil && Date.parse(childMode.lockedUntil) > nowMs) {
      const retryAfterSeconds = Math.ceil((Date.parse(childMode.lockedUntil) - nowMs) / 1000);
      res.setHeader("Retry-After", String(retryAfterSeconds));
      sendJson(res, 429, { error: "private_tutor_parent_reverification_locked", retryAfterSeconds });
      return true;
    }
    const body = await readJson(req).catch(() => ({}));
    const accepted = verifyPassword(String(body?.exitPin ?? ""), childMode.exitPinHash);
    const learner = state.privateTutorLearners.find((row) => row.id === childMode.learnerId) ?? {
      id: childMode.learnerId,
      ownerTeamId: actor?.teamId ?? LOCAL_TEAM_ID,
    };
    if (!accepted) {
      childMode.failedExitAttempts = Number(childMode.failedExitAttempts ?? 0) + 1;
      if (childMode.failedExitAttempts >= EXIT_FAILURE_LIMIT) {
        childMode.failedExitAttempts = 0;
        childMode.lockedUntil = new Date(nowMs + EXIT_LOCK_MS).toISOString();
      }
      recordAudit(state, {
        learner,
        actor,
        action: "parent_reverification_failed",
        details: { lockedUntil: childMode.lockedUntil },
        now,
        nextId,
      });
      persistStateSoon();
      sendJson(res, 401, { error: "private_tutor_parent_reverification_failed" });
      return true;
    }
    delete session.privateTutorChildMode;
    recordAudit(state, {
      learner,
      actor,
      action: "child_mode_exited",
      details: { sessionId: session.id },
      now,
      nextId,
    });
    persistStateSoon();
    sendJson(res, 200, { active: false });
    return true;
  }

  if (url.pathname === "/api/private-tutor/profile") {
    if (req.method === "DELETE") {
      const resolved = resolveOwnedProfileLearner(state, actor, {});
      if (!resolved.ok) {
        sendJson(res, resolved.status, resolved.body);
        return true;
      }
      const learner = resolved.learner;
      const body = await readJson(req).catch(() => ({}));
      if (String(body?.confirmDisplayName ?? "") !== learner.displayName) {
        sendJson(res, 409, { error: "private_tutor_delete_confirmation_required" });
        return true;
      }
      const prepared = preparePrivateTutorLearnerDeletion(state, learner, { actorId: actor?.userId ?? LOCAL_USER_ID, now, nextId });
      const preparationPersistence = persistStateNow ? persistStateNow() : { ok: true, skipped: true };
      if (preparationPersistence?.ok === false) {
        state.privateTutorDeletionReports = state.privateTutorDeletionReports.filter((row) => row.id !== prepared.report.id);
        state.privateTutorDeletionJobs = state.privateTutorDeletionJobs.filter((row) => row.id !== prepared.job.id);
        state.privateTutorAuditEvents = state.privateTutorAuditEvents.filter((row) => row.details?.deletionReportId !== prepared.report.id);
        sendJson(res, 503, {
          error: "private_tutor_deletion_request_not_persisted",
          message: "删除请求暂时无法安全保存，学习数据没有被删除，请稍后重试。",
        });
        return true;
      }
      const deletionReport = erasePrivateTutorLearnerData(state, learner.id, prepared.report, now());
      const durableVerification = finalizePrivateTutorLearnerDeletion
        ? finalizePrivateTutorLearnerDeletion({ learnerId: learner.id, collectionKeys: PRIVATE_TUTOR_LEARNER_COLLECTION_KEYS, report: deletionReport, job: prepared.job })
        : { backing: "memory", durableResidualCount: deletionReport.liveStateResidualCount, ok: deletionReport.liveStateResidualCount === 0 };
      if (!finalizePrivateTutorLearnerDeletion) (persistStateNow ?? persistStateSoon)();
      const deletionAudit = state.privateTutorAuditEvents.find((row) => row.details?.deletionReportId === deletionReport.id) ?? null;
      if (deletionReport.liveStateResidualCount !== 0 || durableVerification?.ok !== true) {
        sendJson(res, 503, {
          error: "private_tutor_deletion_verification_failed",
          message: "删除没有通过完整介质验证，系统不会把它标记为成功。请联系数据安全负责人。",
          deletionReport: { ...deletionReport, durableVerification },
        });
        return true;
      }
      sendJson(res, 200, { deletedId: learner.id, audit: deletionAudit, deletionReport: { ...deletionReport, durableVerification } });
      return true;
    }
    if (req.method !== "GET" && req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    if (actor?.privateTutorLearnerId) {
      sendJson(res, 403, { error: "private_tutor_child_mode_restricted" });
      return true;
    }
    const profiles = listOwnedPrivateTutorProfiles(state, actor);
    if (profiles.length > 1) {
      sendJson(res, 409, privateTutorProfileMigrationRequired(profiles.length));
      return true;
    }
    if (req.method === "GET") {
      sendJson(res, 200, {
        profile: profiles[0] ? learnerView(profiles[0]) : null,
        migrationRequired: false,
      });
      return true;
    }
    if (req.method === "POST") {
      if (profiles[0]) {
        sendJson(res, 200, {
          profile: learnerView(profiles[0]),
          created: false,
          migrationRequired: false,
        });
        return true;
      }
      const body = await readJson(req).catch(() => ({}));
      const validation = validateLearnerInput(body);
      if (!validation.ok) {
        sendJson(res, 400, validation.body);
        return true;
      }
      // readJson yields to the event loop, so re-check before writing to keep parallel creates idempotent.
      const currentProfiles = listOwnedPrivateTutorProfiles(state, actor);
      if (currentProfiles.length > 1) {
        sendJson(res, 409, privateTutorProfileMigrationRequired(currentProfiles.length));
        return true;
      }
      if (currentProfiles[0]) {
        sendJson(res, 200, {
          profile: learnerView(currentProfiles[0]),
          created: false,
          migrationRequired: false,
        });
        return true;
      }
      const { learner, snapshot, audit } = createOwnedPrivateTutorProfile(state, actor, validation, { now, nextId });
      persistStateSoon();
      sendJson(res, 201, {
        profile: learnerView(learner),
        snapshot: snapshotView(snapshot),
        audit,
        created: true,
        migrationRequired: false,
      });
      return true;
    }
  }

  if (url.pathname === "/api/private-tutor/profile/migration") {
    if (actor?.privateTutorLearnerId) {
      sendJson(res, 403, { error: "private_tutor_child_mode_restricted" });
      return true;
    }
    if (req.method === "GET") {
      sendJson(res, 200, buildPrivateTutorProfileMigrationReport(state, actor));
      return true;
    }
    if (req.method === "POST") {
      const body = await readJson(req).catch(() => ({}));
      const result = mergeOwnedPrivateTutorProfiles(state, actor, body, { now, nextId });
      if (!result.ok) {
        sendJson(res, result.status, result.body);
        return true;
      }
      if (!result.body.dryRun) (persistStateNow ?? persistStateSoon)();
      const { rollbackSnapshot: _rollbackSnapshot, ...response } = result.body;
      sendJson(res, 200, response);
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  if (url.pathname === "/api/private-tutor/profile/content-migrations/candidates") {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const resolved = resolveOwnedProfileLearner(state, actor, {});
    if (!resolved.ok) {
      sendJson(res, resolved.status, resolved.body);
      return true;
    }
    sendJson(res, 200, {
      candidates: listPrivateTutorContentMigrationCandidates(state, resolved.learner, actor?.userId ?? LOCAL_USER_ID),
    });
    return true;
  }

  if (url.pathname === "/api/private-tutor/profile/content-migrations/preview") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const resolved = resolveOwnedProfileLearner(state, actor, {});
    if (!resolved.ok) {
      sendJson(res, resolved.status, resolved.body);
      return true;
    }
    const body = await readJson(req).catch(() => ({}));
    const result = createPrivateTutorContentMigrationPreview(
      state, resolved.learner, actor?.userId ?? LOCAL_USER_ID, body, { now, nextId },
    );
    if (!result.ok) {
      sendJson(res, result.status, { error: result.error });
      return true;
    }
    recordAudit(state, { learner: resolved.learner, actor, action: "content_migration_previewed", details: { previewId: result.preview.id, fingerprint: result.preview.previewFingerprint }, now, nextId });
    persistStateSoon();
    sendJson(res, result.status, { preview: result.preview, replayed: result.replayed });
    return true;
  }

  const contentMigrationMatch = url.pathname.match(/^\/api\/private-tutor\/profile\/content-migrations\/([^/]+)\/(mapping|confirm|apply)$/);
  if (contentMigrationMatch) {
    const [, previewId, operation] = contentMigrationMatch;
    const expectedMethod = operation === "mapping" ? "PUT" : "POST";
    if (req.method !== expectedMethod) {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const resolved = resolveOwnedProfileLearner(state, actor, {});
    if (!resolved.ok) {
      sendJson(res, resolved.status, resolved.body);
      return true;
    }
    const actorId = actor?.userId ?? LOCAL_USER_ID;
    const body = await readJson(req).catch(() => ({}));
    const result = operation === "mapping"
      ? updatePrivateTutorContentMigrationMapping(state, resolved.learner, actorId, previewId, body, { now })
      : operation === "confirm"
        ? confirmPrivateTutorContentMigration(state, resolved.learner, actorId, previewId, body, { now })
        : applyPrivateTutorContentMigration(state, resolved.learner, actorId, previewId, body, { now, nextId });
    if (!result.ok) {
      sendJson(res, result.status, { error: result.error });
      return true;
    }
    recordAudit(state, {
      learner: resolved.learner,
      actor,
      action: `content_migration_${operation === "mapping" ? "mapping_updated" : operation === "confirm" ? "confirmed" : "applied"}`,
      details: operation === "apply"
        ? { previewId, applicationId: result.application.id, fingerprint: result.application.previewFingerprint }
        : { previewId, revision: result.preview.revision, fingerprint: result.preview.previewFingerprint },
      now,
      nextId,
    });
    (persistStateNow ?? persistStateSoon)();
    sendJson(res, result.status, operation === "apply"
      ? { application: result.application, replayed: result.replayed }
      : { preview: result.preview });
    return true;
  }

  const contentMigrationRollbackMatch = url.pathname.match(/^\/api\/private-tutor\/profile\/content-migration-applications\/([^/]+)\/rollback$/);
  if (contentMigrationRollbackMatch) {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const resolved = resolveOwnedProfileLearner(state, actor, {});
    if (!resolved.ok) {
      sendJson(res, resolved.status, resolved.body);
      return true;
    }
    const body = await readJson(req).catch(() => ({}));
    const result = rollbackPrivateTutorContentMigration(
      state, resolved.learner, actor?.userId ?? LOCAL_USER_ID, contentMigrationRollbackMatch[1], body, { now },
    );
    if (!result.ok) {
      sendJson(res, result.status, { error: result.error });
      return true;
    }
    recordAudit(state, { learner: resolved.learner, actor, action: "content_migration_rolled_back", details: { applicationId: result.application.id, previewId: result.application.previewId }, now, nextId });
    (persistStateNow ?? persistStateSoon)();
    sendJson(res, result.status, { application: result.application, replayed: result.replayed });
    return true;
  }

  if (url.pathname === "/api/private-tutor/profile/content-package"
    || url.pathname === "/api/private-tutor/profile/content-package/activate") {
    const resolved = resolveOwnedProfileLearner(state, actor, {});
    if (!resolved.ok) {
      sendJson(res, resolved.status, resolved.body);
      return true;
    }
    const learner = resolved.learner;
    const activationRequest = url.pathname.endsWith("/activate");
    if (!activationRequest && req.method === "GET") {
      const registry = privateTutorPackageRegistryFromState(state);
      const pkg = registry.getPackage(learner.activePackageId || "demo-math-foundations-v1");
      sendJson(res, 200, {
        activePackage: privateTutorPackageVisibleToActor(pkg, actor) ? pkg : null,
        activation: state.privateTutorPackageActivations.find((item) => item.learnerId === learner.id && item.status === "active") ?? null,
        runtimeValidation: pkg?.sourceType === "user_material" ? privateTutorRuntimeValidation(state, pkg.id, pkg.version) : null,
      });
      return true;
    }
    if ((!activationRequest && req.method === "PUT") || (activationRequest && req.method === "POST")) {
      const body = await readJson(req).catch(() => ({}));
      const packageId = String(body?.packageId ?? "").trim();
      if (!packageId) {
        sendJson(res, 400, { error: "invalid_content_package_id" });
        return true;
      }
      const registry = privateTutorPackageRegistryFromState(state);
      const pkg = registry.getPackage(packageId);
      if (!privateTutorPackageVisibleToActor(pkg, actor)) {
        sendJson(res, 404, { error: "private_tutor_content_package_not_found" });
        return true;
      }
      const entryMode = String(body?.entryMode ?? "diagnostic");
      const snapshot = state.privateTutorSnapshots.find((row) => row.learnerId === learner.id);
      const previousSnapshot = snapshot ? structuredClone(snapshot) : null;
      const previousPackageId = learner.activePackageId;
      const previousUpdatedAt = learner.updatedAt;
      try {
        if (pkg.sourceType === "user_material") {
          const validation = validatePrivateTutorPackageRuntime(state, packageId, {
            actorId: actor?.userId ?? LOCAL_USER_ID,
            learnerId: learner.id,
            now: now(),
            nextId,
          });
          if (validation?.status !== "passed") throw new Error("private_tutor_runtime_validation_failed");
        }
        const changedAt = now();
        if (snapshot) switchSnapshotPackage(snapshot, pkg, changedAt);
        learner.activePackageId = packageId;
        learner.updatedAt = changedAt;
        const runtime = activatePrivateTutorPackageRuntime(state, {
          learner,
          pkg,
          actorId: actor?.userId ?? LOCAL_USER_ID,
          entryMode,
          startModuleId: body?.startModuleId,
          startTopicId: body?.startTopicId,
          startKnowledgeId: body?.startKnowledgeId,
          now,
          nextId,
        });
        if (runtime.learningPlan) {
          recordPrivateTutorRoadmapSnapshot(state, { learner, plan: runtime.learningPlan, reason: "content_package_activated", at: changedAt, nextId });
        }
        recordAudit(state, {
          learner,
          actor,
          action: "content_package_activated",
          details: { packageId, entryMode, activationId: runtime.activation.id, startKnowledgeId: runtime.activation.startKnowledgeId },
          now,
          nextId,
        });
        persistStateSoon();
        sendJson(res, 200, {
          activePackage: pkg,
          snapshot: snapshot ? snapshotView(snapshot) : null,
          ...runtime,
          learnerModel: learnerModelView(runtime.learnerModel),
          strategyDecision: strategyDecisionView(runtime.strategyDecision),
          learningPlan: learningPlanView(runtime.learningPlan),
        });
      } catch (error) {
        if (snapshot && previousSnapshot) Object.assign(snapshot, previousSnapshot);
        learner.activePackageId = previousPackageId;
        learner.updatedAt = previousUpdatedAt;
        const code = String(error?.message ?? "private_tutor_package_activation_failed");
        sendJson(res, code.endsWith("_not_found") ? 404 : 409, { error: code });
      }
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  if (url.pathname === "/api/private-tutor/profile/learning-goal/preview"
    || url.pathname === "/api/private-tutor/profile/learning-goal/confirm") {
    const resolved = resolveOwnedProfileLearner(state, actor, {});
    if (!resolved.ok) {
      sendJson(res, resolved.status, resolved.body);
      return true;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const learner = resolved.learner;
    const body = await readJson(req).catch(() => ({}));
    const current = privateTutorLearningPreferences(state, learner.id);
    const expectedRevision = Number(body?.expectedPreferencesRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision !== current.revision) {
      sendJson(res, 409, { error: "private_tutor_learning_goal_revision_conflict", currentRevision: current.revision });
      return true;
    }
    const proposedGoal = sanitizePrivateTutorLearningGoal(body?.learningGoal ?? null);
    if (proposedGoal?.__invalid) {
      sendJson(res, 400, { error: "invalid_learning_goal" });
      return true;
    }
    const preview = privateTutorLearningGoalPreview(state, learner, current, proposedGoal, { now });
    if (!preview.ok) {
      sendJson(res, preview.status, { error: preview.error });
      return true;
    }
    if (url.pathname.endsWith("/preview")) {
      sendJson(res, 200, { preview: preview.value });
      return true;
    }
    if (String(body?.previewFingerprint ?? "") !== preview.value.fingerprint) {
      sendJson(res, 409, { error: "private_tutor_learning_goal_preview_stale" });
      return true;
    }
    const activeSession = state.privateTutorSessions.find((row) => row.learnerId === learner.id && ["active", "paused"].includes(row.status));
    if (activeSession) {
      sendJson(res, 409, { error: "private_tutor_learning_goal_session_in_progress" });
      return true;
    }
    const result = updatePrivateTutorLearningPreferences(state, learner.id, { learningGoal: proposedGoal }, { now, nextId });
    const intelligence = refreshPrivateTutorIntelligence(state, learner, {
      now,
      nextId,
      reason: "learning_goal_confirmed",
    });
    recordAudit(state, {
      learner,
      actor,
      action: "learning_goal_confirmed",
      details: {
        previousRevision: current.revision,
        revision: result.preferences.revision,
        previewFingerprint: preview.value.fingerprint,
        forecastStatus: preview.value.forecast.status,
        planId: intelligence.learningPlan?.id ?? null,
      },
      now,
      nextId,
    });
    recordPrivateTutorExperienceEvent(state, {
      learner,
      planId: intelligence.learningPlan?.id ?? null,
      type: "manual_plan_adjustment",
      details: { reason: "learning_goal_confirmed" },
      at: now(),
      nextId,
    });
    persistStateSoon();
    sendJson(res, 200, { preferences: result.preferences, preview: preview.value, ...intelligence });
    return true;
  }

  if (url.pathname === "/api/private-tutor/profile/preferences") {
    const resolved = resolveOwnedProfileLearner(state, actor, {});
    if (!resolved.ok) {
      sendJson(res, resolved.status, resolved.body);
      return true;
    }
    const learner = resolved.learner;
    if (req.method === "GET") {
      sendJson(res, 200, { preferences: privateTutorLearningPreferences(state, learner.id) });
      return true;
    }
    if (req.method === "PUT") {
      const body = await readJson(req).catch(() => ({}));
      const patch = body?.preferences && typeof body.preferences === "object" ? body.preferences : body;
      if (Object.hasOwn(patch ?? {}, "learningGoal")) {
        sendJson(res, 409, { error: "private_tutor_learning_goal_preview_required" });
        return true;
      }
      const result = updatePrivateTutorLearningPreferences(state, learner.id, patch ?? {}, { now, nextId });
      if (!result.ok) {
        sendJson(res, 400, { error: result.error });
        return true;
      }
      recordAudit(state, {
        learner,
        actor,
        action: "learning_preferences_updated",
        details: { revision: result.preferences.revision },
        now,
        nextId,
      });
      recordPrivateTutorExperienceEvent(state, {
        learner,
        type: "manual_plan_adjustment",
        details: { reason: "learning_preferences_updated" },
        at: now(),
        nextId,
      });
      persistStateSoon();
      sendJson(res, 200, { preferences: result.preferences });
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  if (url.pathname === "/api/private-tutor/profile/snapshot") {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const resolved = resolveOwnedProfileLearner(state, actor, {});
    if (!resolved.ok) {
      sendJson(res, resolved.status, resolved.body);
      return true;
    }
    const snapshot = state.privateTutorSnapshots.find((row) => row.learnerId === resolved.learner.id);
    if (!snapshot) {
      sendJson(res, 404, { error: "private_tutor_snapshot_not_found" });
      return true;
    }
    sendJson(res, 200, {
      learner: learnerView(resolved.learner),
      profile: learnerView(resolved.learner),
      snapshot: snapshotView(snapshot),
      ...currentPrivateTutorIntelligence(state, resolved.learner.id, { at: now() }),
    });
    return true;
  }

  if (url.pathname === "/api/private-tutor/profile/learning-history") {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const resolved = resolveOwnedProfileLearner(state, actor, {});
    if (!resolved.ok) {
      sendJson(res, resolved.status, resolved.body);
      return true;
    }
    sendJson(res, 200, {
      history: buildPrivateTutorLearningHistory(state, resolved.learner.id, {
        at: now(),
        learningProfileId: actor?.userId ?? LOCAL_USER_ID,
      }),
    });
    return true;
  }

  const profileLearningTrialMatch = url.pathname.match(/^\/api\/private-tutor\/profile\/learning-trial(?:\/(start|stop))?$/);
  if (profileLearningTrialMatch) {
    const resolved = resolveOwnedProfileLearner(state, actor, {});
    if (!resolved.ok) {
      sendJson(res, resolved.status, resolved.body);
      return true;
    }
    const learner = resolved.learner;
    const action = profileLearningTrialMatch[1] ?? null;
    if (!action && req.method === "GET") {
      const at = now();
      const changed = completeExpiredPrivateTutorLearningTrials(state, at);
      if (changed) persistStateSoon();
      sendJson(res, 200, { trial: latestPrivateTutorLearningTrialView(state, learner.id, at) });
      return true;
    }
    if (action === "start" && req.method === "POST") {
      const body = await readJson(req).catch(() => ({}));
      const contentPackage = privateTutorPackageRegistryFromState(state).getPackage(activeContentPackageId(learner));
      const result = startPrivateTutorLearningTrial(state, learner, body, {
        actorId: actor?.userId ?? LOCAL_USER_ID,
        contentPackage,
        now,
        nextId,
      });
      if (!result.ok) {
        sendJson(res, result.status, { error: result.error });
        return true;
      }
      recordAudit(state, { learner, actor, action: "learning_trial_started", details: { trialId: result.trial.id, durationDays: result.trial.durationDays, observationDays: result.trial.observationDays }, now, nextId });
      persistStateSoon();
      sendJson(res, 201, { trial: result.trial });
      return true;
    }
    if (action === "stop" && req.method === "POST") {
      const result = stopPrivateTutorLearningTrial(state, learner.id, { now });
      if (!result.ok) {
        sendJson(res, result.status, { error: result.error });
        return true;
      }
      recordAudit(state, { learner, actor, action: "learning_trial_stopped", details: { trialId: result.trial.id }, now, nextId });
      persistStateSoon();
      sendJson(res, 200, { trial: result.trial });
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  const profileAssessmentMatch = url.pathname.match(/^\/api\/private-tutor\/profile\/assessments\/(current|start|([^/]+)\/(answers|pause|resume))$/);
  if (profileAssessmentMatch) {
    const resolved = resolveOwnedProfileLearner(state, actor, {});
    if (!resolved.ok) {
      sendJson(res, resolved.status, resolved.body);
      return true;
    }
    const learner = resolved.learner;
    if (rejectPausedPrivateTutorLearningWrite({ req, res, url, sendJson, state, learner })) return true;
    return handleAssessmentRoute({
      req,
      res,
      sendJson,
      readJson,
      state,
      actor,
      learner,
      action: profileAssessmentMatch[1],
      assessmentId: profileAssessmentMatch[2] ? decodeURIComponent(profileAssessmentMatch[2]) : null,
      now,
      nextId,
      persistStateSoon,
    });
  }

  const profileVoiceMatch = url.pathname.match(/^\/api\/private-tutor\/profile\/tutoring-sessions\/([^/]+)\/(voice-turns|voice-events)$/);
  if (profileVoiceMatch) {
    const resolved = resolveOwnedProfileLearner(state, actor, {});
    if (!resolved.ok) {
      sendJson(res, resolved.status, resolved.body);
      return true;
    }
    const learner = resolved.learner;
    if (rejectPausedPrivateTutorLearningWrite({ req, res, url, sendJson, state, learner })) return true;
    return handleTutoringVoiceRoute({
      req,
      res,
      sendJson,
      readJson,
      state,
      actor,
      learner,
      sessionId: decodeURIComponent(profileVoiceMatch[1]),
      resource: profileVoiceMatch[2],
      now,
      nextId,
      persistStateSoon,
    });
  }

  const profileTutoringSessionMatch = url.pathname.match(/^\/api\/private-tutor\/profile\/tutoring-sessions\/(current|start|([^/]+)\/(actions|pause|resume))$/);
  if (profileTutoringSessionMatch) {
    const resolved = resolveOwnedProfileLearner(state, actor, {});
    if (!resolved.ok) {
      sendJson(res, resolved.status, resolved.body);
      return true;
    }
    const learner = resolved.learner;
    if (rejectPausedPrivateTutorLearningWrite({ req, res, url, sendJson, state, learner })) return true;
    return handleTutoringSessionRoute({
      req,
      res,
      sendJson,
      readJson,
      state,
      actor,
      learner,
      action: profileTutoringSessionMatch[1],
      sessionId: profileTutoringSessionMatch[2] ? decodeURIComponent(profileTutoringSessionMatch[2]) : null,
      now,
      nextId,
      persistStateSoon,
    });
  }

  if (url.pathname === "/api/private-tutor/profile/roadmap-ledger") {
    const resolved = resolveOwnedProfileLearner(state, actor, {});
    if (!resolved.ok) {
      sendJson(res, resolved.status, resolved.body);
      return true;
    }
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const learner = resolved.learner;
    const contentPackageId = activeContentPackageId(learner);
    const activation = activePrivateTutorPackageActivation(state, learner.id, contentPackageId);
    const currentPlan = state.privateTutorLearningPlans.find((row) => row.learnerId === learner.id
      && sameContentPackage(row.contentPackageId, contentPackageId)
      && samePrivateTutorActivation(row, activation)
      && row.status === "active") ?? null;
    if (currentPlan) {
      const beforeLedger = state.privateTutorRoadmapLedgers.find((row) => row.learnerId === learner.id
        && row.contentPackageId === contentPackageId
        && row.activationId === (activation?.id ?? null)
        && row.status === "active") ?? null;
      const beforeVersion = beforeLedger ? `${beforeLedger.id}:${beforeLedger.revision}` : null;
      const ledger = recordPrivateTutorRoadmapSnapshot(state, { learner, plan: currentPlan, reason: "ledger_bootstrap", at: now(), nextId });
      const afterVersion = ledger ? `${ledger.id}:${ledger.revision}` : null;
      if (afterVersion !== beforeVersion) persistStateSoon();
    }
    sendJson(res, 200, {
      ledger: buildPrivateTutorRoadmapLedgerView(state, learner.id, {
        contentPackageId,
        activationId: activation?.id ?? null,
        at: now(),
      }),
    });
    return true;
  }

  if (url.pathname === "/api/private-tutor/profile/experience-report") {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const resolved = resolveOwnedProfileLearner(state, actor, {});
    if (!resolved.ok) {
      sendJson(res, resolved.status, resolved.body);
      return true;
    }
    sendJson(res, 200, {
      report: buildPrivateTutorExperienceReport(state, resolved.learner.id, {
        contentPackageId: activeContentPackageId(resolved.learner),
        at: now(),
      }),
    });
    return true;
  }

  if (url.pathname === "/api/private-tutor/profile/learning-plan/catch-up/preview"
    || url.pathname === "/api/private-tutor/profile/learning-plan/catch-up/confirm") {
    const resolved = resolveOwnedProfileLearner(state, actor, {});
    if (!resolved.ok) {
      sendJson(res, resolved.status, resolved.body);
      return true;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const learner = resolved.learner;
    if (rejectPausedPrivateTutorLearningWrite({ req, res, url, sendJson, state, learner })) return true;
    const contentPackageId = activeContentPackageId(learner);
    const activation = activePrivateTutorPackageActivation(state, learner.id, contentPackageId);
    const currentPlan = state.privateTutorLearningPlans.find((row) => row.learnerId === learner.id
      && sameContentPackage(row.contentPackageId, contentPackageId)
      && samePrivateTutorActivation(row, activation)
      && row.status === "active") ?? null;
    if (!currentPlan) {
      sendJson(res, 409, { error: "private_tutor_learning_plan_required" });
      return true;
    }
    const body = await readJson(req).catch(() => ({}));
    const preview = privateTutorCatchUpPreview(currentPlan, learner.id, { now });
    if (Number(body?.expectedPlanRevision) !== currentPlan.revision) {
      sendJson(res, 409, { error: "private_tutor_catch_up_revision_conflict", currentRevision: currentPlan.revision });
      return true;
    }
    if (url.pathname.endsWith("/preview")) {
      sendJson(res, 200, { preview });
      return true;
    }
    if (String(body?.previewFingerprint ?? "") !== preview.fingerprint) {
      sendJson(res, 409, { error: "private_tutor_catch_up_preview_stale" });
      return true;
    }
    if (!preview.canConfirm) {
      sendJson(res, 409, { error: "private_tutor_catch_up_buffer_unavailable" });
      return true;
    }
    const activeSession = state.privateTutorSessions.find((row) => row.learnerId === learner.id && ["active", "paused"].includes(row.status));
    if (activeSession) {
      sendJson(res, 409, { error: "private_tutor_catch_up_session_in_progress" });
      return true;
    }
    const applied = applyPrivateTutorCatchUpPlan(currentPlan, preview, { at: now() });
    if (!applied) {
      sendJson(res, 409, { error: "private_tutor_catch_up_preview_stale" });
      return true;
    }
    recordPrivateTutorRoadmapSnapshot(state, { learner, plan: applied, reason: "catch_up_confirmed", at: now(), nextId });
    recordAudit(state, {
      learner,
      actor,
      action: "learning_plan_catch_up_confirmed",
      details: {
        planId: currentPlan.id,
        previewFingerprint: preview.fingerprint,
        assignmentCount: preview.assignments.length,
        recoveredMinutes: preview.recoveredMinutes,
      },
      now,
      nextId,
    });
    recordPrivateTutorExperienceEvent(state, {
      learner,
      planId: currentPlan.id,
      type: "manual_plan_adjustment",
      details: { reason: "catch_up_confirmed" },
      at: now(),
      nextId,
    });
    persistStateSoon();
    sendJson(res, 200, { preview, ...currentPrivateTutorIntelligence(state, learner.id, { at: now() }) });
    return true;
  }

  const profileLearningPlanMatch = url.pathname.match(/^\/api\/private-tutor\/profile\/learning-plan(?:\/(rebalance))?$/);
  if (profileLearningPlanMatch) {
    const resolved = resolveOwnedProfileLearner(state, actor, {});
    if (!resolved.ok) {
      sendJson(res, resolved.status, resolved.body);
      return true;
    }
    const learner = resolved.learner;
    if (rejectPausedPrivateTutorLearningWrite({ req, res, url, sendJson, state, learner })) return true;
    if (!profileLearningPlanMatch[1] && req.method === "GET") {
      sendJson(res, 200, currentPrivateTutorIntelligence(state, learner.id, { at: now() }));
      return true;
    }
    if (profileLearningPlanMatch[1] === "rebalance" && req.method === "POST") {
      const body = await readJson(req).catch(() => ({}));
      const missedDayIndex = Number(body?.missedDayIndex);
      const contentPackageId = activeContentPackageId(learner);
      const activation = activePrivateTutorPackageActivation(state, learner.id, contentPackageId);
      const currentPlan = state.privateTutorLearningPlans.find((row) =>
        row.learnerId === learner.id
        && sameContentPackage(row.contentPackageId, contentPackageId)
        && samePrivateTutorActivation(row, activation));
      const missedDay = currentPlan?.days.find((day) => day.dayIndex === missedDayIndex) ?? null;
      if (!currentPlan || !Number.isInteger(missedDayIndex) || !["planned", "in_progress"].includes(missedDay?.status)) {
        sendJson(res, 400, { error: "invalid_private_tutor_plan_rebalance" });
        return true;
      }
      const carryForwardKnowledgeId = missedDay.knowledgeId;
      const intelligence = refreshPrivateTutorIntelligence(state, learner, {
        now,
        nextId,
        reason: "missed_day_rescheduled",
        carryForwardKnowledgeId,
      });
      recordAudit(state, {
        learner,
        actor,
        action: "learning_plan_rebalanced",
        details: { missedDayIndex, planId: intelligence.learningPlan?.id ?? null },
        now,
        nextId,
      });
      recordPrivateTutorExperienceEvent(state, {
        learner,
        planId: intelligence.learningPlan?.id ?? null,
        type: "manual_plan_adjustment",
        details: { reason: "missed_day_rescheduled" },
        at: now(),
        nextId,
      });
      persistStateSoon();
      sendJson(res, 200, intelligence);
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  const profileReviewMatch = url.pathname.match(/^\/api\/private-tutor\/profile\/review(?:\/(schedules|themes)\/([^/]+)\/(answers|diagnosis))?$/);
  if (profileReviewMatch) {
    const resolved = resolveOwnedProfileLearner(state, actor, {});
    if (!resolved.ok) {
      sendJson(res, resolved.status, resolved.body);
      return true;
    }
    const learner = resolved.learner;
    if (rejectPausedPrivateTutorLearningWrite({ req, res, url, sendJson, state, learner })) return true;
    if (!profileReviewMatch[1] && req.method === "GET") {
      sendJson(res, 200, { reviewBook: privateTutorReviewBook(state, learner.id, now(), activeContentPackageId(learner)) });
      return true;
    }
    if (profileReviewMatch[1] === "themes" && profileReviewMatch[3] === "diagnosis" && req.method === "POST") {
      const theme = state.privateTutorErrorThemes.find((row) => row.id === decodeURIComponent(profileReviewMatch[2]) && row.learnerId === learner.id);
      const body = await readJson(req).catch(() => ({}));
      const at = now();
      if (!theme) {
        sendJson(res, 404, { error: "private_tutor_error_theme_not_found" });
        return true;
      }
      if (!correctPrivateTutorDiagnosis(theme, body?.correction, at)) {
        sendJson(res, 400, { error: "invalid_private_tutor_diagnosis_correction" });
        return true;
      }
      recordAudit(state, { learner, actor, action: "error_diagnosis_corrected", details: { themeId: theme.id }, now, nextId });
      persistStateSoon();
      sendJson(res, 200, { reviewBook: privateTutorReviewBook(state, learner.id, at, activeContentPackageId(learner)) });
      return true;
    }
    if (profileReviewMatch[1] === "schedules" && profileReviewMatch[3] === "answers" && req.method === "POST") {
      const scheduleId = decodeURIComponent(profileReviewMatch[2]);
      const body = await readJson(req).catch(() => ({}));
      const idempotencyKey = String(body?.idempotencyKey ?? "").trim();
      const source = String(body?.source ?? "screen");
      if (!idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
        sendJson(res, 400, { error: "invalid_private_tutor_review_answer" });
        return true;
      }
      const requestHash = stableHash({ scheduleId, questionRevisionId: String(body?.questionRevisionId ?? ""), rawAnswer: body?.rawAnswer, responseKind: body?.responseKind, source });
      const existing = state.privateTutorIdempotencyRecords.find((row) => row.learnerId === learner.id && row.key === idempotencyKey);
      if (existing) {
        if (existing.operation !== "review_answer" || existing.requestHash !== requestHash) sendJson(res, 409, { error: "private_tutor_idempotency_conflict" });
        else sendJson(res, 200, { ...existing.response, replayed: true });
        return true;
      }
      const schedule = state.privateTutorReviewSchedules.find((row) => row.id === scheduleId && row.learnerId === learner.id && row.status === "active");
      if (!schedule) {
        sendJson(res, 404, { error: "private_tutor_review_schedule_not_found" });
        return true;
      }
      const at = now();
      if (schedule.phase === "delayed" && Date.parse(schedule.dueAt) > Date.parse(at)) {
        sendJson(res, 409, { error: "private_tutor_delayed_review_not_due", dueAt: schedule.dueAt });
        return true;
      }
      const recognitionConfidence = body?.recognitionConfidence == null ? null : Number(body.recognitionConfidence);
      const question = currentPrivateTutorReviewQuestion(state, schedule);
      if (!question || String(body?.questionRevisionId ?? "") !== question.revisionId) {
        sendJson(res, 400, { error: "invalid_private_tutor_review_answer" });
        return true;
      }
      if (!ATTEMPT_SOURCES.has(source)) {
        sendJson(res, 400, { error: "invalid_private_tutor_attempt_source" });
        return true;
      }
      if (source === "voice_confirmed" && (!Number.isFinite(recognitionConfidence) || recognitionConfidence < 0.75)) {
        sendJson(res, 409, { error: "private_tutor_voice_confirmation_required", minimumConfidence: 0.75 });
        return true;
      }
      const judgement = judgePrivateTutorAnswer(question.revisionId, { rawAnswer: body?.rawAnswer, responseKind: body?.responseKind }, state, schedule.contentPackageId);
      if (!judgement.accepted) {
        sendJson(res, 422, { error: judgement.error });
        return true;
      }
      const phase = schedule.phase;
      const attempt = {
        id: nextId("pta"), ownerTeamId: learner.ownerTeamId, learnerId: learner.id, actorId: actor?.userId ?? LOCAL_USER_ID,
        contentPackageId: schedule.contentPackageId ?? activeContentPackageId(learner), contentPackageVersion: schedule.contentPackageVersion ?? null, subjectId: schedule.subjectId ?? "math",
        context: "review", reviewScheduleId: schedule.id, reviewPhase: phase, knowledgeId: question.knowledgeId,
        questionRevisionId: question.revisionId, correct: judgement.correct, independent: phase !== "correction", usedHint: false,
        source, recognitionConfidence: Number.isFinite(recognitionConfidence) ? recognitionConfidence : null,
        responseKind: judgement.responseKind, normalizedAnswer: judgement.normalizedAnswer, judgementReason: judgement.reason,
        evidenceEligible: judgement.evidenceEligible !== false, evidenceTier: judgement.evidenceTier ?? "deterministic", evaluation: judgement.evaluation ?? null,
        durationSeconds: Math.max(1, Math.min(600, Number(body?.durationSeconds ?? 1) || 1)), createdAt: at,
      };
      state.privateTutorAttempts.unshift(attempt);
      recordPrivateTutorReviewResult({ state, schedule, attempt, now: () => at });
      const snapshot = phase === "correction" ? state.privateTutorSnapshots.find((row) => row.learnerId === learner.id) : applyAttemptToSnapshot(state, learner, attempt, { now: () => at, nextId });
      const response = { attempt, schedule: privateTutorReviewScheduleView(state, schedule, at), reviewBook: privateTutorReviewBook(state, learner.id, at, activeContentPackageId(learner)), snapshot: snapshotView(snapshot) };
      state.privateTutorIdempotencyRecords.unshift({ id: nextId("pti"), ownerTeamId: learner.ownerTeamId, learnerId: learner.id, actorId: actor?.userId ?? LOCAL_USER_ID, key: idempotencyKey, operation: "review_answer", requestHash, attemptId: attempt.id, response, createdAt: at });
      recordAudit(state, { learner, actor, action: "review_answer_recorded", details: { scheduleId: schedule.id, phase, attemptId: attempt.id, correct: attempt.correct }, now: () => at, nextId });
      persistStateSoon();
      sendJson(res, 201, { ...response, replayed: false });
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  const profileGuardianMatch = url.pathname.match(/^\/api\/private-tutor\/profile\/guardian\/(weekly-report|preferences|data-export|data-policy|deletion-preview)$/);
  if (profileGuardianMatch) {
    const resolved = resolveOwnedProfileLearner(state, actor, {});
    if (!resolved.ok) {
      sendJson(res, resolved.status, resolved.body);
      return true;
    }
    const learner = resolved.learner;
    const guardianUserId = actor?.userId ?? LOCAL_USER_ID;
    if (profileGuardianMatch[1] === "weekly-report" && req.method === "GET") {
      const report = buildPrivateTutorWeeklyReport({ learner, snapshot: state.privateTutorSnapshots.find((row) => row.learnerId === learner.id), attempts: state.privateTutorAttempts, themes: state.privateTutorErrorThemes, sessions: state.privateTutorSessions, now });
      sendJson(res, 200, { report });
      return true;
    }
    if (profileGuardianMatch[1] === "preferences" && req.method === "GET") {
      sendJson(res, 200, { preferences: privateTutorGuardianPreferences(state, learner, guardianUserId) });
      return true;
    }
    if (profileGuardianMatch[1] === "preferences" && req.method === "PUT") {
      const body = await readJson(req).catch(() => ({}));
      const result = updatePrivateTutorGuardianPreferences(state, learner, guardianUserId, body, { at: now(), nextId });
      if (!result.ok) {
        sendJson(res, 400, { error: result.error });
        return true;
      }
      persistStateSoon();
      sendJson(res, 200, { preferences: result.preferences });
      return true;
    }
    if (profileGuardianMatch[1] === "data-export" && req.method === "GET") {
      const bundle = buildPrivateTutorLearnerExport(state, learner, now());
      recordAudit(state, { learner, actor, action: "learner_data_exported", details: { schemaVersion: bundle.schemaVersion }, now, nextId });
      persistStateSoon();
      sendJson(res, 200, { bundle });
      return true;
    }
    if (profileGuardianMatch[1] === "data-policy" && req.method === "GET") {
      sendJson(res, 200, { policy: privateTutorDataPolicy(state, learner, guardianUserId) });
      return true;
    }
    if (profileGuardianMatch[1] === "data-policy" && req.method === "PUT") {
      const body = await readJson(req).catch(() => ({}));
      const result = updatePrivateTutorDataPolicy(state, learner, guardianUserId, body, { now, nextId });
      if (!result.ok) {
        sendJson(res, 400, { error: result.error });
        return true;
      }
      recordAudit(state, { learner, actor, action: "learner_data_policy_updated", details: { rawAudioDays: 0, voiceTranscriptDays: result.policy.voiceTranscriptDays, derivedProfileHistoryDays: result.policy.derivedProfileHistoryDays }, now, nextId });
      (persistStateNow ?? persistStateSoon)();
      sendJson(res, 200, { policy: result.policy });
      return true;
    }
    if (profileGuardianMatch[1] === "deletion-preview" && req.method === "GET") {
      sendJson(res, 200, { preview: previewPrivateTutorLearnerDeletion(state, learner) });
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  const profileResourceMatch = url.pathname.match(/^\/api\/private-tutor\/profile\/(attempts|audit)$/);
  if (profileResourceMatch) {
    const resource = profileResourceMatch[1];
    const resolved = resolveOwnedProfileLearner(state, actor, {});
    if (!resolved.ok) {
      sendJson(res, resolved.status, resolved.body);
      return true;
    }
    const learner = resolved.learner;
    if (rejectPausedPrivateTutorLearningWrite({ req, res, url, sendJson, state, learner })) return true;

    if (resource === "attempts" && req.method === "POST") {
      const body = await readJson(req).catch(() => ({}));
      const validation = validateAttemptInput(body, state, activeContentPackageId(learner));
      if (!validation.ok) {
        sendJson(res, validation.status, validation.body);
        return true;
      }
      const requestHash = stableHash(validation.value);
      const existing = state.privateTutorIdempotencyRecords.find((row) =>
        row.learnerId === learner.id
        && row.actorId === (actor?.userId ?? LOCAL_USER_ID)
        && row.key === validation.value.idempotencyKey);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          sendJson(res, 409, { error: "private_tutor_idempotency_conflict" });
          return true;
        }
        const attempt = state.privateTutorAttempts.find((row) => row.id === existing.attemptId);
        const snapshot = state.privateTutorSnapshots.find((row) => row.learnerId === learner.id);
        sendJson(res, 200, {
          attempt,
          snapshot: snapshotView(snapshot),
          ...currentPrivateTutorIntelligence(state, learner.id),
          replayed: true,
        });
        return true;
      }

      const createdAt = now();
      const attempt = {
        id: nextId("pta"),
        ownerTeamId: learner.ownerTeamId,
        learnerId: learner.id,
        contentPackageId: validation.value.contentPackageId,
        contentPackageVersion: validation.value.contentPackageVersion,
        subjectId: validation.value.subjectId,
        actorId: actor?.userId ?? LOCAL_USER_ID,
        knowledgeId: validation.value.knowledgeId,
        questionRevisionId: validation.value.questionRevisionId,
        correct: validation.value.correct,
        independent: validation.value.independent,
        usedHint: validation.value.usedHint,
        source: validation.value.source,
        recognitionConfidence: validation.value.recognitionConfidence,
        responseKind: validation.value.responseKind,
        normalizedAnswer: validation.value.normalizedAnswer,
        judgementReason: validation.value.judgementReason,
        evidenceEligible: validation.value.evidenceEligible,
        evidenceTier: validation.value.evidenceTier,
        evaluation: validation.value.evaluation,
        durationSeconds: validation.value.durationSeconds,
        createdAt,
      };
      state.privateTutorAttempts.unshift(attempt);
      recordPrivateTutorErrorEvidence({ state, learner, attempt, now, nextId });
      const snapshot = applyAttemptToSnapshot(state, learner, attempt, { now, nextId });
      const intelligence = attempt.evidenceEligible === false
        ? currentPrivateTutorIntelligence(state, learner.id)
        : refreshPrivateTutorIntelligence(state, learner, {
            now,
            nextId,
            reason: "new_learning_evidence",
          });
      state.privateTutorIdempotencyRecords.unshift({
        id: nextId("pti"),
        ownerTeamId: learner.ownerTeamId,
        learnerId: learner.id,
        actorId: actor?.userId ?? LOCAL_USER_ID,
        key: validation.value.idempotencyKey,
        requestHash,
        attemptId: attempt.id,
        createdAt,
      });
      recordAudit(state, {
        learner,
        actor,
        action: "attempt_recorded",
        details: { attemptId: attempt.id, knowledgeId: attempt.knowledgeId, source: attempt.source },
        now,
        nextId,
      });
      persistStateSoon();
      sendJson(res, 201, { attempt, snapshot: snapshotView(snapshot), ...intelligence, replayed: false });
      return true;
    }

    if (resource === "audit" && req.method === "GET") {
      const audit = state.privateTutorAuditEvents
        .filter((row) => row.learnerId === learner.id && row.action !== "access_denied")
        .slice(0, 100);
      sendJson(res, 200, { audit });
      return true;
    }

    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  // Compatibility surface for the previous family/guardian model. New clients use /profile.
  if (url.pathname === "/api/private-tutor/learners") {
    if (req.method === "GET") {
      sendJson(res, 200, { learners: listAuthorizedLearners(state, actor) });
      return true;
    }
    if (req.method === "POST") {
      if (actor.privateTutorLearnerId) {
        sendJson(res, 403, { error: "private_tutor_child_mode_restricted" });
        return true;
      }
      const body = await readJson(req).catch(() => ({}));
      const validation = validateLearnerInput(body);
      if (!validation.ok) {
        sendJson(res, 400, validation.body);
        return true;
      }
      const { learner, snapshot, audit } = createOwnedPrivateTutorProfile(state, actor, validation, { now, nextId });
      persistStateSoon();
      sendJson(res, 201, { learner: learnerView(learner), snapshot: snapshotView(snapshot), audit });
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  const assessmentMatch = url.pathname.match(/^\/api\/private-tutor\/learners\/([^/]+)\/assessments\/(current|start|([^/]+)\/(answers|pause|resume))$/);
  if (assessmentMatch) {
    const learnerId = decodeURIComponent(assessmentMatch[1]);
    const learner = findAuthorizedLearner(state, actor, learnerId, req.method === "GET" ? "read" : "write");
    if (!learner) {
      recordDeniedAccess(state, { learnerId, actor, method: req.method, resource: "assessment", now, nextId });
      persistStateSoon();
      sendJson(res, 404, learnerNotFound());
      return true;
    }
    if (rejectPausedPrivateTutorLearningWrite({ req, res, url, sendJson, state, learner })) return true;
    return handleAssessmentRoute({
      req,
      res,
      sendJson,
      readJson,
      state,
      actor,
      learner,
      action: assessmentMatch[2],
      assessmentId: assessmentMatch[3] ? decodeURIComponent(assessmentMatch[3]) : null,
      now,
      nextId,
      persistStateSoon,
    });
  }

  const voiceMatch = url.pathname.match(/^\/api\/private-tutor\/learners\/([^/]+)\/tutoring-sessions\/([^/]+)\/(voice-turns|voice-events)$/);
  if (voiceMatch) {
    const learnerId = decodeURIComponent(voiceMatch[1]);
    const learner = findAuthorizedLearner(state, actor, learnerId, req.method === "GET" ? "read" : "write");
    if (!learner) {
      recordDeniedAccess(state, { learnerId, actor, method: req.method, resource: "tutoring-voice", now, nextId });
      persistStateSoon();
      sendJson(res, 404, learnerNotFound());
      return true;
    }
    if (rejectPausedPrivateTutorLearningWrite({ req, res, url, sendJson, state, learner })) return true;
    return handleTutoringVoiceRoute({
      req,
      res,
      sendJson,
      readJson,
      state,
      actor,
      learner,
      sessionId: decodeURIComponent(voiceMatch[2]),
      resource: voiceMatch[3],
      now,
      nextId,
      persistStateSoon,
    });
  }

  const tutoringSessionMatch = url.pathname.match(/^\/api\/private-tutor\/learners\/([^/]+)\/tutoring-sessions\/(current|start|([^/]+)\/(actions|pause|resume))$/);
  if (tutoringSessionMatch) {
    const learnerId = decodeURIComponent(tutoringSessionMatch[1]);
    const learner = findAuthorizedLearner(state, actor, learnerId, req.method === "GET" ? "read" : "write");
    if (!learner) {
      recordDeniedAccess(state, { learnerId, actor, method: req.method, resource: "tutoring-session", now, nextId });
      persistStateSoon();
      sendJson(res, 404, learnerNotFound());
      return true;
    }
    if (rejectPausedPrivateTutorLearningWrite({ req, res, url, sendJson, state, learner })) return true;
    return handleTutoringSessionRoute({
      req,
      res,
      sendJson,
      readJson,
      state,
      actor,
      learner,
      action: tutoringSessionMatch[2],
      sessionId: tutoringSessionMatch[3] ? decodeURIComponent(tutoringSessionMatch[3]) : null,
      now,
      nextId,
      persistStateSoon,
    });
  }

  const learningPlanMatch = url.pathname.match(/^\/api\/private-tutor\/learners\/([^/]+)\/learning-plan(?:\/(rebalance))?$/);
  if (learningPlanMatch) {
    const learnerId = decodeURIComponent(learningPlanMatch[1]);
    const learner = findAuthorizedLearner(state, actor, learnerId, req.method === "GET" ? "read" : "write");
    if (!learner) {
      recordDeniedAccess(state, { learnerId, actor, method: req.method, resource: "learning-plan", now, nextId });
      persistStateSoon();
      sendJson(res, 404, learnerNotFound());
      return true;
    }
    if (rejectPausedPrivateTutorLearningWrite({ req, res, url, sendJson, state, learner })) return true;
    if (!learningPlanMatch[2] && req.method === "GET") {
      sendJson(res, 200, currentPrivateTutorIntelligence(state, learner.id, { at: now() }));
      return true;
    }
    if (learningPlanMatch[2] === "rebalance" && req.method === "POST") {
      const body = await readJson(req).catch(() => ({}));
      const missedDayIndex = Number(body?.missedDayIndex);
      const contentPackageId = activeContentPackageId(learner);
      const activation = activePrivateTutorPackageActivation(state, learner.id, contentPackageId);
      const currentPlan = state.privateTutorLearningPlans.find((row) =>
        row.learnerId === learner.id
        && sameContentPackage(row.contentPackageId, contentPackageId)
        && samePrivateTutorActivation(row, activation));
      const missedDay = currentPlan?.days.find((day) => day.dayIndex === missedDayIndex) ?? null;
      if (!currentPlan || !Number.isInteger(missedDayIndex) || !["planned", "in_progress"].includes(missedDay?.status)) {
        sendJson(res, 400, { error: "invalid_private_tutor_plan_rebalance" });
        return true;
      }
      const carryForwardKnowledgeId = missedDay.knowledgeId;
      const intelligence = refreshPrivateTutorIntelligence(state, learner, {
        now,
        nextId,
        reason: "missed_day_rescheduled",
        carryForwardKnowledgeId,
      });
      recordAudit(state, {
        learner,
        actor,
        action: "learning_plan_rebalanced",
        details: { missedDayIndex, planId: intelligence.learningPlan?.id ?? null },
        now,
        nextId,
      });
      persistStateSoon();
      sendJson(res, 200, intelligence);
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  const reviewMatch = url.pathname.match(/^\/api\/private-tutor\/learners\/([^/]+)\/review(?:\/(schedules|themes)\/([^/]+)\/(answers|diagnosis))?$/);
  if (reviewMatch) {
    const learnerId = decodeURIComponent(reviewMatch[1]);
    const learner = findAuthorizedLearner(state, actor, learnerId, req.method === "GET" ? "read" : "write");
    if (!learner) {
      recordDeniedAccess(state, { learnerId, actor, method: req.method, resource: "review", now, nextId });
      persistStateSoon();
      sendJson(res, 404, learnerNotFound());
      return true;
    }
    if (rejectPausedPrivateTutorLearningWrite({ req, res, url, sendJson, state, learner })) return true;
    if (!reviewMatch[2] && req.method === "GET") {
      sendJson(res, 200, { reviewBook: privateTutorReviewBook(state, learner.id, now(), activeContentPackageId(learner)) });
      return true;
    }
    if (reviewMatch[2] === "themes" && reviewMatch[4] === "diagnosis" && req.method === "POST") {
      const theme = state.privateTutorErrorThemes.find((row) => row.id === decodeURIComponent(reviewMatch[3]) && row.learnerId === learner.id);
      const body = await readJson(req).catch(() => ({}));
      const at = now();
      if (!theme) {
        sendJson(res, 404, { error: "private_tutor_error_theme_not_found" });
        return true;
      }
      if (!correctPrivateTutorDiagnosis(theme, body?.correction, at)) {
        sendJson(res, 400, { error: "invalid_private_tutor_diagnosis_correction" });
        return true;
      }
      recordAudit(state, { learner, actor, action: "error_diagnosis_corrected", details: { themeId: theme.id }, now, nextId });
      persistStateSoon();
      sendJson(res, 200, { reviewBook: privateTutorReviewBook(state, learner.id, at, activeContentPackageId(learner)) });
      return true;
    }
    if (reviewMatch[2] === "schedules" && reviewMatch[4] === "answers" && req.method === "POST") {
      const scheduleId = decodeURIComponent(reviewMatch[3]);
      const body = await readJson(req).catch(() => ({}));
      const idempotencyKey = String(body?.idempotencyKey ?? "").trim();
      const source = String(body?.source ?? "screen");
      if (!idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
        sendJson(res, 400, { error: "invalid_private_tutor_review_answer" });
        return true;
      }
      const requestHash = stableHash({ scheduleId, questionRevisionId: String(body?.questionRevisionId ?? ""), rawAnswer: body?.rawAnswer, responseKind: body?.responseKind, source });
      const existing = state.privateTutorIdempotencyRecords.find((row) => row.learnerId === learner.id && row.key === idempotencyKey);
      if (existing) {
        if (existing.operation !== "review_answer" || existing.requestHash !== requestHash) sendJson(res, 409, { error: "private_tutor_idempotency_conflict" });
        else sendJson(res, 200, { ...existing.response, replayed: true });
        return true;
      }
      const schedule = state.privateTutorReviewSchedules.find((row) => row.id === scheduleId && row.learnerId === learner.id && row.status === "active");
      if (!schedule) {
        sendJson(res, 404, { error: "private_tutor_review_schedule_not_found" });
        return true;
      }
      const at = now();
      if (schedule.phase === "delayed" && Date.parse(schedule.dueAt) > Date.parse(at)) {
        sendJson(res, 409, { error: "private_tutor_delayed_review_not_due", dueAt: schedule.dueAt });
        return true;
      }
      const recognitionConfidence = body?.recognitionConfidence == null ? null : Number(body.recognitionConfidence);
      const question = currentPrivateTutorReviewQuestion(state, schedule);
      if (!question || String(body?.questionRevisionId ?? "") !== question.revisionId) {
        sendJson(res, 400, { error: "invalid_private_tutor_review_answer" });
        return true;
      }
      if (!ATTEMPT_SOURCES.has(source)) {
        sendJson(res, 400, { error: "invalid_private_tutor_attempt_source" });
        return true;
      }
      if (source === "voice_confirmed" && (!Number.isFinite(recognitionConfidence) || recognitionConfidence < 0.75)) {
        sendJson(res, 409, { error: "private_tutor_voice_confirmation_required", minimumConfidence: 0.75 });
        return true;
      }
      const judgement = judgePrivateTutorAnswer(question.revisionId, { rawAnswer: body?.rawAnswer, responseKind: body?.responseKind }, state, schedule.contentPackageId);
      if (!judgement.accepted) {
        sendJson(res, 422, { error: judgement.error });
        return true;
      }
      const phase = schedule.phase;
      const attempt = {
        id: nextId("pta"), ownerTeamId: learner.ownerTeamId, learnerId: learner.id, actorId: actor?.userId ?? LOCAL_USER_ID,
        contentPackageId: schedule.contentPackageId ?? activeContentPackageId(learner), contentPackageVersion: schedule.contentPackageVersion ?? null, subjectId: schedule.subjectId ?? "math",
        context: "review", reviewScheduleId: schedule.id, reviewPhase: phase, knowledgeId: question.knowledgeId,
        questionRevisionId: question.revisionId, correct: judgement.correct, independent: phase !== "correction", usedHint: false,
        source, recognitionConfidence: Number.isFinite(recognitionConfidence) ? recognitionConfidence : null,
        responseKind: judgement.responseKind, normalizedAnswer: judgement.normalizedAnswer, judgementReason: judgement.reason,
        evidenceEligible: judgement.evidenceEligible !== false, evidenceTier: judgement.evidenceTier ?? "deterministic", evaluation: judgement.evaluation ?? null,
        durationSeconds: Math.max(1, Math.min(600, Number(body?.durationSeconds ?? 1) || 1)), createdAt: at,
      };
      state.privateTutorAttempts.unshift(attempt);
      recordPrivateTutorReviewResult({ state, schedule, attempt, now: () => at });
      const snapshot = phase === "correction" ? state.privateTutorSnapshots.find((row) => row.learnerId === learner.id) : applyAttemptToSnapshot(state, learner, attempt, { now: () => at, nextId });
      const response = { attempt, schedule: privateTutorReviewScheduleView(state, schedule, at), reviewBook: privateTutorReviewBook(state, learner.id, at, activeContentPackageId(learner)), snapshot: snapshotView(snapshot) };
      state.privateTutorIdempotencyRecords.unshift({ id: nextId("pti"), ownerTeamId: learner.ownerTeamId, learnerId: learner.id, actorId: actor?.userId ?? LOCAL_USER_ID, key: idempotencyKey, operation: "review_answer", requestHash, attemptId: attempt.id, response, createdAt: at });
      recordAudit(state, { learner, actor, action: "review_answer_recorded", details: { scheduleId: schedule.id, phase, attemptId: attempt.id, correct: attempt.correct }, now: () => at, nextId });
      persistStateSoon();
      sendJson(res, 201, { ...response, replayed: false });
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  const guardianPilotMatch = url.pathname.match(/^\/api\/private-tutor\/learners\/([^/]+)\/guardian\/pilot(?:\/(consent|withdraw|check-ins|incidents))?$/);
  if (guardianPilotMatch) {
    const learnerId = decodeURIComponent(guardianPilotMatch[1]);
    const action = guardianPilotMatch[2] ?? null;
    const learner = findAuthorizedLearner(state, actor, learnerId, action ? "manage" : "read");
    if (!learner) {
      sendJson(res, 404, learnerNotFound());
      return true;
    }
    if (actor.privateTutorLearnerId) {
      sendJson(res, 403, { error: "private_tutor_child_mode_restricted" });
      return true;
    }
    if (!action && req.method === "GET") {
      sendJson(res, 200, { pilot: privateTutorPilotGuardianStatus(state, learner.id) });
      return true;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const body = await readJson(req).catch(() => ({}));
    let result;
    if (action === "consent") result = acceptPrivateTutorPilotConsent(state, learner, body, { actor, now, nextId, releaseReady: privateTutorReleaseReadiness(state, privateTutorReleaseBuildId, now()).ready });
    if (action === "withdraw") result = withdrawPrivateTutorPilotParticipation(state, learner, body, { actor, now, nextId });
    if (action === "check-ins") result = recordPrivateTutorPilotCheckIn(state, learner, body, { actor, now, nextId });
    if (action === "incidents") result = reportPrivateTutorPilotIncident(state, learner, body, { actor, now, nextId });
    if (!result?.ok) {
      sendJson(res, result?.status ?? 400, { error: result?.error ?? "invalid_private_tutor_pilot_action" });
      return true;
    }
    recordAudit(state, {
      learner, actor, action: `pilot_${action}`,
      details: {
        cohortId: result.participation?.cohortId ?? result.incident?.cohortId ?? result.checkIn?.cohortId,
        participationStatus: result.participation?.status,
        incidentSeverity: result.incident?.severity,
        deletionRequested: Boolean(result.deletionRequest),
      },
      now, nextId,
    });
    (persistStateNow ?? persistStateSoon)();
    sendJson(res, action === "consent" ? 201 : 200, result);
    return true;
  }

  const guardianMatch = url.pathname.match(/^\/api\/private-tutor\/learners\/([^/]+)\/guardian\/(weekly-report|preferences|invitations|data-export|data-policy|deletion-preview)$/);
  if (guardianMatch) {
    const learnerId = decodeURIComponent(guardianMatch[1]);
    const guardianResource = guardianMatch[2];
    const requiredPermission = ["invitations", "data-policy", "deletion-preview"].includes(guardianResource)
      ? "manage"
      : req.method === "GET" ? "read" : "write";
    const learner = findAuthorizedLearner(state, actor, learnerId, requiredPermission);
    if (!learner) {
      sendJson(res, 404, learnerNotFound());
      return true;
    }
    if (actor.privateTutorLearnerId) {
      sendJson(res, 403, { error: "private_tutor_child_mode_restricted" });
      return true;
    }
    const guardianUserId = actor?.userId ?? LOCAL_USER_ID;
    if (guardianMatch[2] === "weekly-report" && req.method === "GET") {
      const report = buildPrivateTutorWeeklyReport({ learner, snapshot: state.privateTutorSnapshots.find((row) => row.learnerId === learner.id), attempts: state.privateTutorAttempts, themes: state.privateTutorErrorThemes, sessions: state.privateTutorSessions, now });
      sendJson(res, 200, { report });
      return true;
    }
    if (guardianMatch[2] === "preferences" && req.method === "GET") {
      sendJson(res, 200, { preferences: privateTutorGuardianPreferences(state, learner, guardianUserId) });
      return true;
    }
    if (guardianMatch[2] === "preferences" && req.method === "PUT") {
      const body = await readJson(req).catch(() => ({}));
      const result = updatePrivateTutorGuardianPreferences(state, learner, guardianUserId, body, { at: now(), nextId });
      if (!result.ok) {
        sendJson(res, 400, { error: result.error });
        return true;
      }
      persistStateSoon();
      sendJson(res, 200, { preferences: result.preferences });
      return true;
    }
    if (guardianMatch[2] === "invitations" && req.method === "GET") {
      sendJson(res, 200, { invitations: listPrivateTutorGuardianInvitations(state, learner.id) });
      return true;
    }
    if (guardianMatch[2] === "invitations" && req.method === "POST") {
      const body = await readJson(req).catch(() => ({}));
      const result = createPrivateTutorGuardianInvitation(state, learner, body, { actorId: guardianUserId, now, nextId });
      if (!result.ok) {
        sendJson(res, result.status, { error: result.error });
        return true;
      }
      recordAudit(state, { learner, actor, action: "guardian_invitation_created", details: { invitationId: result.invitation.id, permissions: result.invitation.permissions }, now, nextId });
      (persistStateNow ?? persistStateSoon)();
      sendJson(res, 201, result);
      return true;
    }
    if (guardianMatch[2] === "data-export" && req.method === "GET") {
      const bundle = buildPrivateTutorLearnerExport(state, learner, now());
      recordAudit(state, { learner, actor, action: "learner_data_exported", details: { schemaVersion: bundle.schemaVersion }, now, nextId });
      persistStateSoon();
      sendJson(res, 200, { bundle });
      return true;
    }
    if (guardianMatch[2] === "data-policy" && req.method === "GET") {
      sendJson(res, 200, { policy: privateTutorDataPolicy(state, learner, guardianUserId) });
      return true;
    }
    if (guardianMatch[2] === "data-policy" && req.method === "PUT") {
      const body = await readJson(req).catch(() => ({}));
      const result = updatePrivateTutorDataPolicy(state, learner, guardianUserId, body, { now, nextId });
      if (!result.ok) {
        sendJson(res, 400, { error: result.error });
        return true;
      }
      recordAudit(state, { learner, actor, action: "learner_data_policy_updated", details: { rawAudioDays: 0, voiceTranscriptDays: result.policy.voiceTranscriptDays, derivedProfileHistoryDays: result.policy.derivedProfileHistoryDays }, now, nextId });
      (persistStateNow ?? persistStateSoon)();
      sendJson(res, 200, { policy: result.policy });
      return true;
    }
    if (guardianMatch[2] === "deletion-preview" && req.method === "GET") {
      sendJson(res, 200, { preview: previewPrivateTutorLearnerDeletion(state, learner) });
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  const match = url.pathname.match(/^\/api\/private-tutor\/learners\/([^/]+)(?:\/(snapshot|attempts|audit))?$/);
  if (!match) return false;
  const learnerId = decodeURIComponent(match[1]);
  const resource = match[2] ?? null;
  const requiredPermission = req.method === "DELETE" || resource === "audit"
    ? "manage"
    : req.method === "GET" ? "read" : "write";
  const learner = findAuthorizedLearner(state, actor, learnerId, requiredPermission);
  if (!learner) {
    recordDeniedAccess(state, { learnerId, actor, method: req.method, resource, now, nextId });
    persistStateSoon();
    sendJson(res, 404, learnerNotFound());
    return true;
  }

  if (actor.privateTutorLearnerId && (
    (!resource && req.method !== "GET")
    || resource === "audit"
    || (resource === "snapshot" && req.method !== "GET")
  )) {
    sendJson(res, 403, { error: "private_tutor_child_mode_restricted" });
    return true;
  }
  if (rejectPausedPrivateTutorLearningWrite({ req, res, url, sendJson, state, learner })) return true;

  if (!resource && req.method === "GET") {
    sendJson(res, 200, { learner: learnerView(learner) });
    return true;
  }

  if (!resource && req.method === "DELETE") {
    const body = await readJson(req).catch(() => ({}));
    if (String(body?.confirmDisplayName ?? "") !== learner.displayName) {
      sendJson(res, 409, { error: "private_tutor_delete_confirmation_required" });
      return true;
    }
    const prepared = preparePrivateTutorLearnerDeletion(state, learner, { actorId: actor?.userId ?? LOCAL_USER_ID, now, nextId });
    const preparationPersistence = persistStateNow ? persistStateNow() : { ok: true, skipped: true };
    if (preparationPersistence?.ok === false) {
      state.privateTutorDeletionReports = state.privateTutorDeletionReports.filter((row) => row.id !== prepared.report.id);
      state.privateTutorDeletionJobs = state.privateTutorDeletionJobs.filter((row) => row.id !== prepared.job.id);
      state.privateTutorAuditEvents = state.privateTutorAuditEvents.filter((row) => row.details?.deletionReportId !== prepared.report.id);
      sendJson(res, 503, {
        error: "private_tutor_deletion_request_not_persisted",
        message: "删除请求暂时无法安全保存，孩子数据没有被删除，请稍后重试。",
      });
      return true;
    }
    const deletionReport = erasePrivateTutorLearnerData(state, learner.id, prepared.report, now());
    const durableVerification = finalizePrivateTutorLearnerDeletion
      ? finalizePrivateTutorLearnerDeletion({ learnerId: learner.id, collectionKeys: PRIVATE_TUTOR_LEARNER_COLLECTION_KEYS, report: deletionReport, job: prepared.job })
      : { backing: "memory", durableResidualCount: deletionReport.liveStateResidualCount, ok: deletionReport.liveStateResidualCount === 0 };
    if (!finalizePrivateTutorLearnerDeletion) (persistStateNow ?? persistStateSoon)();
    const audit = state.privateTutorAuditEvents.find((row) => row.details?.deletionReportId === deletionReport.id) ?? null;
    if (deletionReport.liveStateResidualCount !== 0 || durableVerification?.ok !== true) {
      sendJson(res, 503, {
        error: "private_tutor_deletion_verification_failed",
        message: "删除没有通过完整介质验证，系统不会把它标记为成功。请联系数据安全负责人。",
        deletionReport: { ...deletionReport, durableVerification },
      });
      return true;
    }
    sendJson(res, 200, { deletedId: learner.id, audit, deletionReport: { ...deletionReport, durableVerification } });
    return true;
  }

  if (resource === "snapshot" && req.method === "GET") {
    const snapshot = state.privateTutorSnapshots.find((row) => row.learnerId === learner.id);
    if (!snapshot) {
      sendJson(res, 404, { error: "private_tutor_snapshot_not_found" });
      return true;
    }
    sendJson(res, 200, {
      learner: learnerView(learner),
      snapshot: snapshotView(snapshot),
      ...currentPrivateTutorIntelligence(state, learner.id, { at: now() }),
    });
    return true;
  }

  if (resource === "attempts" && req.method === "POST") {
    const body = await readJson(req).catch(() => ({}));
    const validation = validateAttemptInput(body, state, activeContentPackageId(learner));
    if (!validation.ok) {
      sendJson(res, validation.status, validation.body);
      return true;
    }
    const requestHash = stableHash(validation.value);
    const existing = state.privateTutorIdempotencyRecords.find((row) =>
      row.learnerId === learner.id
      && row.actorId === (actor?.userId ?? LOCAL_USER_ID)
      && row.key === validation.value.idempotencyKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        sendJson(res, 409, { error: "private_tutor_idempotency_conflict" });
        return true;
      }
      const attempt = state.privateTutorAttempts.find((row) => row.id === existing.attemptId);
      const snapshot = state.privateTutorSnapshots.find((row) => row.learnerId === learner.id);
      sendJson(res, 200, {
        attempt,
        snapshot: snapshotView(snapshot),
        ...currentPrivateTutorIntelligence(state, learner.id),
        replayed: true,
      });
      return true;
    }

    const createdAt = now();
    const attempt = {
      id: nextId("pta"),
      ownerTeamId: learner.ownerTeamId,
      learnerId: learner.id,
      contentPackageId: validation.value.contentPackageId,
      contentPackageVersion: validation.value.contentPackageVersion,
      subjectId: validation.value.subjectId,
      actorId: actor?.userId ?? LOCAL_USER_ID,
      knowledgeId: validation.value.knowledgeId,
      questionRevisionId: validation.value.questionRevisionId,
      correct: validation.value.correct,
      independent: validation.value.independent,
      usedHint: validation.value.usedHint,
      source: validation.value.source,
      recognitionConfidence: validation.value.recognitionConfidence,
      responseKind: validation.value.responseKind,
      normalizedAnswer: validation.value.normalizedAnswer,
      judgementReason: validation.value.judgementReason,
      evidenceEligible: validation.value.evidenceEligible,
      evidenceTier: validation.value.evidenceTier,
      evaluation: validation.value.evaluation,
      durationSeconds: validation.value.durationSeconds,
      createdAt,
    };
    state.privateTutorAttempts.unshift(attempt);
    recordPrivateTutorErrorEvidence({ state, learner, attempt, now, nextId });
    const snapshot = applyAttemptToSnapshot(state, learner, attempt, { now, nextId });
    const intelligence = attempt.evidenceEligible === false
      ? currentPrivateTutorIntelligence(state, learner.id)
      : refreshPrivateTutorIntelligence(state, learner, {
          now,
          nextId,
          reason: "new_learning_evidence",
        });
    state.privateTutorIdempotencyRecords.unshift({
      id: nextId("pti"),
      ownerTeamId: learner.ownerTeamId,
      learnerId: learner.id,
      actorId: actor?.userId ?? LOCAL_USER_ID,
      key: validation.value.idempotencyKey,
      requestHash,
      attemptId: attempt.id,
      createdAt,
    });
    recordAudit(state, {
      learner,
      actor,
      action: "attempt_recorded",
      details: { attemptId: attempt.id, knowledgeId: attempt.knowledgeId, source: attempt.source },
      now,
      nextId,
    });
    persistStateSoon();
    sendJson(res, 201, { attempt, snapshot: snapshotView(snapshot), ...intelligence, replayed: false });
    return true;
  }

  if (resource === "audit" && req.method === "GET") {
    const audit = state.privateTutorAuditEvents
      .filter((row) => row.learnerId === learner.id && row.action !== "access_denied")
      .slice(0, 100);
    sendJson(res, 200, { audit });
    return true;
  }

  sendJson(res, 405, { error: "method_not_allowed" });
  return true;
}

async function handleAssessmentRoute({
  req,
  res,
  sendJson,
  readJson,
  state,
  actor,
  learner,
  action,
  assessmentId,
  now,
  nextId,
  persistStateSoon,
}) {
  const contentPackageId = activeContentPackageId(learner);
  const contentPackage = privateTutorPackageRegistryFromState(state).getPackage(contentPackageId);
  const activation = activePrivateTutorPackageActivation(state, learner.id, contentPackageId);
  const latest = state.privateTutorAssessments.find((row) =>
    row.learnerId === learner.id
    && sameContentPackage(row.contentPackageId, contentPackageId)
    && samePrivateTutorActivation(row, activation)) ?? null;
  if (action === "current") {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    sendJson(res, 200, { assessment: assessmentView(latest, state) });
    return true;
  }

  if (action === "start") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const body = await readJson(req).catch(() => ({}));
    const mode = body?.mode == null || body?.mode === "full" ? "full" : body?.mode === "quick" ? "quick" : null;
    const targetKnowledgeId = mode === "quick" ? String(body?.targetKnowledgeId ?? "").trim() : null;
    if (!mode || (mode === "quick" && !targetKnowledgeId)) {
      sendJson(res, 400, { error: "invalid_private_tutor_assessment_mode" });
      return true;
    }
    if (latest && ["active", "paused"].includes(latest.status)) {
      sendJson(res, 200, { assessment: assessmentView(latest, state), resumed: true });
      return true;
    }
    const latestMode = latest?.mode ?? "full";
    const sameCompletedAssessment = latest?.status === "completed"
      && latestMode === mode
      && (mode !== "quick" || latest.targetKnowledgeId === targetKnowledgeId);
    if (sameCompletedAssessment && body?.restart !== true) {
      sendJson(res, 200, { assessment: assessmentView(latest, state), resumed: true });
      return true;
    }
    if (sameCompletedAssessment && body?.restart === true && actor?.privateTutorLearnerId) {
      sendJson(res, 403, { error: "private_tutor_parent_reverification_required" });
      return true;
    }
    const startedAt = now();
    const diagnosticConfig = mode === "quick"
      ? privateTutorQuickDiagnosticConfig(state, contentPackageId, targetKnowledgeId)
      : privateTutorDiagnosticConfig(state, contentPackageId);
    const firstQuestion = mode === "quick"
      ? initialQuickDiagnosticQuestion(state, contentPackageId, targetKnowledgeId)
      : initialDiagnosticQuestion(state, contentPackageId);
    if (!firstQuestion || !diagnosticConfig || !contentPackage) {
      sendJson(res, 409, { error: mode === "quick"
        ? "private_tutor_quick_diagnostic_content_required"
        : "private_tutor_published_diagnostic_content_required" });
      return true;
    }
    const assessment = {
      id: nextId("pas"),
      ownerTeamId: learner.ownerTeamId,
      learnerId: learner.id,
      contentPackageId,
      contentPackageVersion: contentPackage.version,
      subjectId: contentPackage.subjectId,
      activationId: activation?.id ?? null,
      activationStatus: "active",
      mode,
      targetKnowledgeId,
      status: "active",
      revision: 1,
      startedAt,
      pausedAt: null,
      completedAt: null,
      activeSeconds: 0,
      targetSeconds: diagnosticConfig.targetSeconds,
      minQuestions: diagnosticConfig.minQuestions,
      maxQuestions: diagnosticConfig.maxQuestions,
      runtimeValidationId: privateTutorRuntimeValidation(state, contentPackageId, contentPackage.version)?.id ?? null,
      currentQuestionRevisionId: firstQuestion.revisionId,
      questionPresentedAt: startedAt,
      currentQuestionActiveSeconds: 0,
      answerSummaries: [],
      result: null,
      updatedAt: startedAt,
    };
    state.privateTutorAssessments.unshift(assessment);
    recordAudit(state, { learner, actor, action: "diagnostic_started", details: { assessmentId: assessment.id, mode, targetKnowledgeId }, now, nextId });
    persistStateSoon();
    sendJson(res, 201, { assessment: assessmentView(assessment, state), resumed: false });
    return true;
  }

  const assessment = state.privateTutorAssessments.find((row) => row.id === assessmentId && row.learnerId === learner.id);
  if (!assessment) {
    sendJson(res, 404, { error: "private_tutor_assessment_not_found" });
    return true;
  }

  if (action.endsWith("/pause") || action === `${assessmentId}/pause`) {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    if (assessment.status !== "active") {
      sendJson(res, 409, { error: "private_tutor_assessment_not_active" });
      return true;
    }
    assessment.status = "paused";
    assessment.pausedAt = now();
    assessment.currentQuestionActiveSeconds += elapsedSeconds(assessment.questionPresentedAt, assessment.pausedAt);
    assessment.questionPresentedAt = null;
    assessment.updatedAt = assessment.pausedAt;
    assessment.revision += 1;
    recordAudit(state, { learner, actor, action: "diagnostic_paused", details: { assessmentId }, now, nextId });
    persistStateSoon();
    sendJson(res, 200, { assessment: assessmentView(assessment, state) });
    return true;
  }

  if (action.endsWith("/resume") || action === `${assessmentId}/resume`) {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    if (assessment.status !== "paused") {
      sendJson(res, 409, { error: "private_tutor_assessment_not_paused" });
      return true;
    }
    assessment.status = "active";
    assessment.pausedAt = null;
    assessment.updatedAt = now();
    assessment.questionPresentedAt = assessment.updatedAt;
    assessment.revision += 1;
    recordAudit(state, { learner, actor, action: "diagnostic_resumed", details: { assessmentId }, now, nextId });
    persistStateSoon();
    sendJson(res, 200, { assessment: assessmentView(assessment, state) });
    return true;
  }

  if (!(action.endsWith("/answers") || action === `${assessmentId}/answers`) || req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }
  const body = await readJson(req).catch(() => ({}));
  const idempotencyKey = String(body?.idempotencyKey ?? "").trim();
  const questionRevisionId = String(body?.questionRevisionId ?? "").trim();
  const source = String(body?.source ?? "screen").trim();
  const recognitionConfidence = body?.recognitionConfidence == null ? null : Number(body.recognitionConfidence);
  const durationSeconds = Math.max(0, Math.min(180, Number(body?.durationSeconds ?? 0) || 0));
  if (!idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    sendJson(res, 400, { error: "invalid_private_tutor_idempotency_key" });
    return true;
  }
  if (!ATTEMPT_SOURCES.has(source)) {
    sendJson(res, 400, { error: "invalid_private_tutor_attempt_source" });
    return true;
  }
  if (source === "voice_confirmed" && (!Number.isFinite(recognitionConfidence) || recognitionConfidence < 0.75)) {
    sendJson(res, 409, { error: "private_tutor_voice_confirmation_required", minimumConfidence: 0.75 });
    return true;
  }
  const requestValue = {
    assessmentId,
    questionRevisionId,
    rawAnswer: String(body?.rawAnswer ?? ""),
    responseKind: String(body?.responseKind ?? "answer"),
    source,
    recognitionConfidence: Number.isFinite(recognitionConfidence) ? recognitionConfidence : null,
    durationSeconds,
  };
  const requestHash = stableHash(requestValue);
  const actorId = actor?.userId ?? LOCAL_USER_ID;
  const existing = state.privateTutorIdempotencyRecords.find((row) =>
    row.learnerId === learner.id && row.actorId === actorId && row.key === idempotencyKey);
  if (existing) {
    if (existing.requestHash !== requestHash || existing.operation !== "assessment_answer") {
      sendJson(res, 409, { error: "private_tutor_idempotency_conflict" });
      return true;
    }
    sendJson(res, 200, { ...existing.response, replayed: true });
    return true;
  }
  if (assessment.status !== "active") {
    sendJson(res, 409, { error: "private_tutor_assessment_not_active" });
    return true;
  }
  if (questionRevisionId !== assessment.currentQuestionRevisionId) {
    sendJson(res, 409, { error: "private_tutor_assessment_question_mismatch" });
    return true;
  }
  const question = privateTutorQuestion(questionRevisionId, state, assessment.contentPackageId);
  if (!question || question.context !== "diagnostic") {
    sendJson(res, 400, { error: "private_tutor_question_revision_not_found" });
    return true;
  }
  const judgement = judgePrivateTutorAnswer(questionRevisionId, requestValue, state, assessment.contentPackageId);
  if (!judgement.accepted) {
    sendJson(res, 422, { error: judgement.error });
    return true;
  }

  const createdAt = now();
  const serverDurationSeconds = Math.min(180,
    assessment.currentQuestionActiveSeconds + elapsedSeconds(assessment.questionPresentedAt, createdAt));
  const attempt = {
    id: nextId("pta"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    contentPackageId: assessment.contentPackageId,
    contentPackageVersion: assessment.contentPackageVersion,
    subjectId: assessment.subjectId,
    actorId,
    assessmentId,
    context: "diagnostic",
    knowledgeId: question.knowledgeId,
    questionRevisionId,
    correct: judgement.correct,
    independent: true,
    usedHint: false,
    source,
    recognitionConfidence: Number.isFinite(recognitionConfidence) ? recognitionConfidence : null,
    responseKind: judgement.responseKind,
    normalizedAnswer: judgement.normalizedAnswer,
    judgementReason: judgement.reason,
    evidenceEligible: judgement.evidenceEligible !== false,
    evidenceTier: judgement.evidenceTier ?? "deterministic",
    evaluation: judgement.evaluation ?? null,
    durationSeconds: serverDurationSeconds,
    clientDurationSeconds: durationSeconds,
    createdAt,
  };
  state.privateTutorAttempts.unshift(attempt);
  recordPrivateTutorErrorEvidence({ state, learner, attempt, now, nextId });
  assessment.answerSummaries.push({
    attemptId: attempt.id,
    questionRevisionId,
    knowledgeId: question.knowledgeId,
    difficulty: question.difficulty,
    correct: attempt.correct,
    responseKind: attempt.responseKind,
    evidenceEligible: attempt.evidenceEligible,
    evidenceTier: attempt.evidenceTier,
  });
  assessment.activeSeconds = Math.min(DIAGNOSTIC_TARGET_SECONDS, assessment.activeSeconds + serverDurationSeconds);
  assessment.currentQuestionActiveSeconds = 0;
  assessment.questionPresentedAt = createdAt;
  assessment.revision += 1;
  assessment.updatedAt = createdAt;
  const nextQuestion = assessment.mode === "quick"
    ? selectNextQuickDiagnosticQuestion(assessment.answerSummaries, state, assessment.contentPackageId, assessment.targetKnowledgeId)
    : selectNextDiagnosticQuestion(assessment.answerSummaries, state, assessment.contentPackageId);
  assessment.currentQuestionRevisionId = nextQuestion?.revisionId ?? null;
  if (!nextQuestion) {
    assessment.status = "completed";
    assessment.completedAt = createdAt;
    assessment.questionPresentedAt = null;
    assessment.result = buildDiagnosticResult(assessment.answerSummaries, state, assessment.contentPackageId);
    assessment.evidenceResult = buildDiagnosticResult(
      assessment.answerSummaries.filter((item) => item.evidenceEligible === true),
      state,
      assessment.contentPackageId,
    );
    applyDiagnosticResultToSnapshot(state, learner, assessment, { now, nextId });
    refreshPrivateTutorIntelligence(state, learner, {
      now,
      nextId,
      reason: "diagnostic_completed",
    });
    recordAudit(state, {
      learner,
      actor,
      action: "diagnostic_completed",
      details: { assessmentId, answeredCount: assessment.answerSummaries.length, mode: assessment.mode ?? "full", targetKnowledgeId: assessment.targetKnowledgeId ?? null },
      now,
      nextId,
    });
  }
  const response = { assessment: assessmentView(assessment, state) };
  state.privateTutorIdempotencyRecords.unshift({
    id: nextId("pti"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    actorId,
    key: idempotencyKey,
    operation: "assessment_answer",
    requestHash,
    attemptId: attempt.id,
    response,
    createdAt,
  });
  persistStateSoon();
  sendJson(res, 201, { ...response, replayed: false });
  return true;
}

async function handleTutoringVoiceRoute({
  req,
  res,
  sendJson,
  readJson,
  state,
  actor,
  learner,
  sessionId,
  resource,
  now,
  nextId,
  persistStateSoon,
}) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }
  const session = state.privateTutorSessions.find((row) => row.id === sessionId && row.learnerId === learner.id);
  if (!session) {
    sendJson(res, 404, { error: "private_tutor_session_not_found" });
    return true;
  }
  if (session.status !== "active") {
    sendJson(res, 409, { error: "private_tutor_session_not_active" });
    return true;
  }
  const body = await readJson(req).catch(() => ({}));
  if (Object.keys(body ?? {}).some((key) => /^audio/i.test(key))) {
    sendJson(res, 400, { error: "private_tutor_raw_audio_not_accepted" });
    return true;
  }

  if (resource === "voice-events") {
    const type = String(body?.type ?? "");
    if (!VOICE_EVENT_TYPES.has(type)) {
      sendJson(res, 400, { error: "invalid_private_tutor_voice_event" });
      return true;
    }
    const createdAt = now();
    const event = {
      id: nextId("ptve"),
      ownerTeamId: learner.ownerTeamId,
      learnerId: learner.id,
      sessionId: session.id,
      actorId: actor?.userId ?? LOCAL_USER_ID,
      type,
      reason: String(body?.reason ?? "").slice(0, 80) || null,
      createdAt,
    };
    state.privateTutorVoiceEvents.unshift(event);
    persistStateSoon();
    sendJson(res, 201, { event: { id: event.id, type: event.type, createdAt } });
    return true;
  }

  const clientTurnId = String(body?.clientTurnId ?? "").trim();
  const transcript = String(body?.transcript ?? "").trim();
  const mode = String(body?.mode ?? "push_to_talk");
  const provider = String(body?.provider ?? "browser_web_speech").slice(0, 60);
  const alternatives = Array.isArray(body?.alternatives)
    ? body.alternatives.map((value) => String(value ?? "").slice(0, 300)).slice(0, 3)
    : [];
  if (!clientTurnId || clientTurnId.length > MAX_IDEMPOTENCY_KEY_LENGTH || !transcript || transcript.length > 300 || !VOICE_MODES.has(mode)) {
    sendJson(res, 400, { error: "invalid_private_tutor_voice_turn" });
    return true;
  }
  const activity = currentPrivateTutorActivity(session);
  const question = activity?.questionRevisionId ? privateTutorQuestion(activity.questionRevisionId, state) : null;
  if (!question) {
    sendJson(res, 409, { error: "private_tutor_voice_question_required" });
    return true;
  }
  const requestValue = {
    transcript,
    confidence: body?.confidence,
    alternatives,
    mode,
    provider,
    questionRevisionId: question.id,
  };
  const requestHash = stableHash(requestValue);
  const existing = state.privateTutorVoiceTurns.find((row) =>
    row.learnerId === learner.id
    && row.sessionId === session.id
    && row.actorId === (actor?.userId ?? LOCAL_USER_ID)
    && row.clientTurnId === clientTurnId);
  if (existing) {
    if (existing.requestHash !== requestHash) {
      sendJson(res, 409, { error: "private_tutor_voice_turn_conflict" });
      return true;
    }
    sendJson(res, 200, { voiceTurn: privateTutorVoiceTurnView(existing), replayed: true });
    return true;
  }
  const normalization = normalizePrivateTutorSpeech({ ...requestValue, question });
  if (!normalization.accepted) {
    sendJson(res, 400, { error: normalization.error });
    return true;
  }
  const createdAt = now();
  const voiceTurn = {
    id: nextId("ptvt"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    sessionId: session.id,
    actorId: actor?.userId ?? LOCAL_USER_ID,
    clientTurnId,
    requestHash,
    questionRevisionId: question.id,
    mode,
    provider,
    transcript: normalization.transcript,
    normalizedExpression: normalization.normalizedExpression,
    confidence: normalization.confidence,
    status: normalization.status,
    reasonCodes: normalization.reasonCodes,
    attemptId: null,
    createdAt,
    confirmedAt: null,
  };
  state.privateTutorVoiceTurns.unshift(voiceTurn);
  recordTutoringSessionEvent(state, {
    learner,
    actor,
    session,
    type: "voice_turn_normalized",
    details: { voiceTurnId: voiceTurn.id, status: voiceTurn.status, reasonCodes: voiceTurn.reasonCodes },
    now,
    nextId,
  });
  persistStateSoon();
  sendJson(res, 201, { voiceTurn: privateTutorVoiceTurnView(voiceTurn), replayed: false });
  return true;
}

async function handleTutoringSessionRoute({
  req,
  res,
  sendJson,
  readJson,
  state,
  actor,
  learner,
  action,
  sessionId,
  now,
  nextId,
  persistStateSoon,
}) {
  const actorId = actor?.userId ?? LOCAL_USER_ID;
  const contentPackageId = activeContentPackageId(learner);
  const activation = activePrivateTutorPackageActivation(state, learner.id, contentPackageId);
  const sessions = state.privateTutorSessions.filter((row) =>
    row.learnerId === learner.id
    && sameContentPackage(row.contentPackageId, contentPackageId)
    && samePrivateTutorActivation(row, activation));
  const current = sessions.find((row) => row.status === "active" || row.status === "paused") ?? sessions[0] ?? null;

  if (action === "current") {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    sendJson(res, 200, { session: privateTutorSessionView(current, state) });
    return true;
  }

  if (action === "start") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const resumable = sessions.find((row) => row.status === "active" || row.status === "paused");
    if (resumable) {
      sendJson(res, 200, { session: privateTutorSessionView(resumable, state), resumedExisting: true });
      return true;
    }
    const snapshot = state.privateTutorSnapshots.find((row) => row.learnerId === learner.id);
    const latestPlan = state.privateTutorLearningPlans.find((row) =>
      row.learnerId === learner.id
      && sameContentPackage(row.contentPackageId, contentPackageId)
      && samePrivateTutorActivation(row, activation));
    let plan = latestPlan?.status === "active" ? latestPlan : null;
    let decision = state.privateTutorStrategyDecisions.find((row) =>
      row.learnerId === learner.id
      && sameContentPackage(row.contentPackageId, contentPackageId)
      && samePrivateTutorActivation(row, activation));
    if (!plan && decision) {
      const completedPlan = latestPlan?.status === "completed" ? latestPlan : state.privateTutorLearningPlans.find((row) =>
        row.learnerId === learner.id
        && sameContentPackage(row.contentPackageId, contentPackageId)
        && row.status === "completed"
        && samePrivateTutorActivation(row, activation));
      if (completedPlan) {
        const continued = refreshPrivateTutorIntelligence(state, learner, {
          now,
          nextId,
          reason: "next_week_started",
        });
        plan = state.privateTutorLearningPlans.find((row) => row.id === continued.learningPlan?.id) ?? null;
        decision = state.privateTutorStrategyDecisions.find((row) => row.id === continued.strategyDecision?.id) ?? decision;
        if (plan) recordAudit(state, {
          learner,
          actor,
          action: "learning_plan_auto_continued",
          details: { previousPlanId: completedPlan.id, planId: plan.id, weekIndex: plan.goalRoadmap?.currentWeekIndex ?? null },
          now,
          nextId,
        });
      }
    }
    if (!plan || !decision) {
      sendJson(res, 409, { error: "private_tutor_learning_plan_required" });
      return true;
    }
    const body = await readJson(req).catch(() => ({}));
    const pace = String(body?.pace ?? "standard");
    if (!PRIVATE_TUTOR_SESSION_PACES[pace]) {
      sendJson(res, 400, { error: "invalid_private_tutor_session_pace" });
      return true;
    }
    const preferences = privateTutorLearningPreferences(state, learner.id);
    const sessionId = nextId("ptsess");
    const teachingPolicy = buildPrivateTutorTeachingPolicy(state, {
      learnerId: learner.id,
      contentPackageId,
      targetKnowledgeId: plan.days?.find((day) => ["in_progress", "planned"].includes(day.status))?.knowledgeId ?? decision.targetKnowledgeId,
      strategy: plan.days?.find((day) => ["in_progress", "planned"].includes(day.status))?.strategy ?? decision.strategy,
      trigger: "session_started",
      at: now(),
    });
    const session = createPrivateTutorSession({
      id: sessionId,
      ownerTeamId: learner.ownerTeamId,
      learnerId: learner.id,
      plan,
      decision,
      pace,
      now,
      state,
      contentPackageId,
      activationId: activation?.id ?? null,
      targetMinutes: preferences.dailyMinutes,
      teachingPolicy,
    });
    if (!session) {
      sendJson(res, 409, { error: "private_tutor_session_content_unavailable" });
      return true;
    }
    state.privateTutorSessions.unshift(session);
    const startedAt = now();
    recordPrivateTutorTeachingStrategyDecision(state, {
      learner,
      session,
      trigger: "session_started",
      policy: teachingPolicy,
      at: startedAt,
      nextId,
    });
    recordPrivateTutorExperienceEvent(state, {
      learner,
      session,
      type: "session_started",
      dedupeKey: `session_started:${session.id}`,
      at: startedAt,
      nextId,
    });
    recordTutoringSessionEvent(state, { learner, actor, session, type: "session_started", details: { pace }, now, nextId });
    recordAudit(state, { learner, actor, action: "tutoring_session_started", details: { sessionId: session.id, pace }, now, nextId });
    persistStateSoon();
    sendJson(res, 201, { session: privateTutorSessionView(session, state), resumedExisting: false });
    return true;
  }

  const session = state.privateTutorSessions.find((row) => row.id === sessionId && row.learnerId === learner.id);
  if (!session) {
    sendJson(res, 404, { error: "private_tutor_session_not_found" });
    return true;
  }

  if (action.endsWith("/pause") || action === `${sessionId}/pause`) {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    if (!pausePrivateTutorSession(session, now)) {
      sendJson(res, 409, { error: "private_tutor_session_not_active" });
      return true;
    }
    recordPrivateTutorExperienceEvent(state, {
      learner,
      session,
      type: "session_interrupted",
      details: { activity: currentPrivateTutorActivity(session)?.kind ?? "unknown" },
      dedupeKey: `session_interrupted:${session.id}:${session.revision}`,
      at: now(),
      nextId,
    });
    recordTutoringSessionEvent(state, { learner, actor, session, type: "session_paused", details: { activity: currentPrivateTutorActivity(session)?.kind ?? null }, now, nextId });
    persistStateSoon();
    sendJson(res, 200, { session: privateTutorSessionView(session, state) });
    return true;
  }

  if (action.endsWith("/resume") || action === `${sessionId}/resume`) {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    if (!resumePrivateTutorSession(session, now)) {
      sendJson(res, 409, { error: "private_tutor_session_not_paused" });
      return true;
    }
    recordPrivateTutorExperienceEvent(state, {
      learner,
      session,
      type: "session_resumed",
      details: { activity: currentPrivateTutorActivity(session)?.kind ?? "unknown" },
      dedupeKey: `session_resumed:${session.id}:${session.revision}`,
      at: now(),
      nextId,
    });
    recordTutoringSessionEvent(state, { learner, actor, session, type: "session_resumed", details: { activity: currentPrivateTutorActivity(session)?.kind ?? null }, now, nextId });
    persistStateSoon();
    sendJson(res, 200, { session: privateTutorSessionView(session, state) });
    return true;
  }

  if (!(action.endsWith("/actions") || action === `${sessionId}/actions`) || req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }
  if (session.status !== "active") {
    sendJson(res, 409, { error: "private_tutor_session_not_active" });
    return true;
  }
  const body = await readJson(req).catch(() => ({}));
  const actionType = String(body?.action ?? "");
  const activity = currentPrivateTutorActivity(session);

  if (actionType === "continue") {
    if (!activity || !["explain", "summary"].includes(activity.kind)) {
      sendJson(res, 409, { error: "private_tutor_session_answer_required" });
      return true;
    }
    const completedKind = activity.kind;
    const actionAt = now();
    recordPrivateTutorSuggestionAdoption(state, { learner, session, action: "continue", at: actionAt, nextId });
    const result = completePrivateTutorActivity(session, now);
    recordPrivateTutorExperienceEvent(state, {
      learner,
      session,
      type: "learning_step_completed",
      details: { activity: completedKind, stepIndex: session.currentActivityIndex },
      dedupeKey: `learning_step_completed:${session.id}:${completedKind}`,
      at: actionAt,
      nextId,
    });
    const sessionPlan = state.privateTutorLearningPlans.find((row) => row.id === session.planId) ?? null;
    let intelligence = { learningPlan: learningPlanView(sessionPlan) };
    if (result.completed) {
      const snapshot = state.privateTutorSnapshots.find((row) => row.learnerId === learner.id);
      if (snapshot) {
        snapshot.completedSessions += 1;
        const preferences = privateTutorLearningPreferences(state, learner.id);
        snapshot.dailyMinutes = Math.min(preferences.dailyMinutes, Math.max(snapshot.dailyMinutes, session.plannedMinutes));
        snapshot.revision += 1;
        snapshot.updatedAt = session.completedAt;
      }
      completePrivateTutorPlanDay(sessionPlan, session, session.completedAt);
      intelligence = refreshPrivateTutorIntelligence(state, learner, {
        now,
        nextId,
        reason: "tutoring_session_completed",
        learningPlanId: sessionPlan?.id ?? null,
      });
      recordAudit(state, {
        learner,
        actor,
        action: "tutoring_session_completed",
        details: { sessionId: session.id, independentCompleted: session.summary.independentCompleted },
        now,
        nextId,
      });
      recordPrivateTutorExperienceEvent(state, {
        learner,
        session,
        type: "session_completed",
        dedupeKey: `session_completed:${session.id}`,
        at: session.completedAt,
        nextId,
      });
    } else {
      recordPrivateTutorTeachingStrategyDecision(state, {
        learner,
        session,
        trigger: "activity_completed",
        at: now(),
        nextId,
      });
    }
    recordTutoringSessionEvent(state, { learner, actor, session, type: result.completed ? "session_completed" : "activity_completed", details: { activity: completedKind }, now, nextId });
    persistStateSoon();
    sendJson(res, 200, {
      session: privateTutorSessionView(session, state),
      snapshot: snapshotView(state.privateTutorSnapshots.find((row) => row.learnerId === learner.id)),
      ...intelligence,
    });
    return true;
  }

  if (actionType === "hint") {
    const actionAt = now();
    recordPrivateTutorSuggestionAdoption(state, { learner, session, action: "hint", at: actionAt, nextId });
    const result = revealPrivateTutorHint(session, now);
    if (!result.ok) {
      sendJson(res, 409, { error: result.error });
      return true;
    }
    recordPrivateTutorExperienceEvent(state, {
      learner,
      session,
      type: "hint_used",
      details: { activity: activity.kind, stepIndex: activity.hintLevel },
      at: actionAt,
      nextId,
    });
    recordPrivateTutorTeachingStrategyDecision(state, {
      learner,
      session,
      trigger: "hint_used",
      at: now(),
      nextId,
    });
    recordTutoringSessionEvent(state, { learner, actor, session, type: "hint_revealed", details: { activity: activity.kind, level: activity.hintLevel }, now, nextId });
    persistStateSoon();
    sendJson(res, 200, { session: privateTutorSessionView(session, state) });
    return true;
  }

  if (actionType === "follow_up") {
    const actionAt = now();
    recordPrivateTutorSuggestionAdoption(state, { learner, session, action: "follow_up", at: actionAt, nextId });
    const result = answerPrivateTutorFollowUp(session, {
      mode: String(body?.mode ?? "question"),
      question: body?.question,
      state,
      now,
      nextId,
    });
    if (!result.ok) {
      sendJson(res, 400, { error: result.error });
      return true;
    }
    recordPrivateTutorExperienceEvent(state, {
      learner,
      session,
      type: "teaching_support_used",
      details: { activity: activity?.kind ?? "unknown", action: result.followUp.mode },
      at: actionAt,
      nextId,
    });
    recordPrivateTutorTeachingStrategyDecision(state, {
      learner,
      session,
      trigger: "follow_up_used",
      at: now(),
      nextId,
    });
    recordTutoringSessionEvent(state, {
      learner,
      actor,
      session,
      type: "grounded_follow_up_answered",
      details: {
        activity: activity?.kind ?? null,
        mode: result.followUp.mode,
        grounding: result.followUp.grounding,
        sourceCount: result.followUp.sourceRefs.length,
        evidenceEligible: false,
      },
      now,
      nextId,
    });
    persistStateSoon();
    sendJson(res, 200, { session: privateTutorSessionView(session, state), followUp: result.followUp });
    return true;
  }

  if (actionType === "follow_up_feedback") {
    const result = recordPrivateTutorFollowUpResolution(session, body, { now });
    if (!result.ok) {
      sendJson(res, result.status, { error: result.error });
      return true;
    }
    recordTutoringSessionEvent(state, {
      learner,
      actor,
      session,
      type: "follow_up_resolution_recorded",
      details: { followUpId: result.followUp.id, resolution: result.followUp.resolution, evidenceEligible: false },
      now,
      nextId,
    });
    persistStateSoon();
    sendJson(res, 200, { session: privateTutorSessionView(session, state) });
    return true;
  }

  if (actionType !== "answer") {
    sendJson(res, 400, { error: "invalid_private_tutor_session_action" });
    return true;
  }
  const idempotencyKey = String(body?.idempotencyKey ?? "").trim();
  const voiceTurnId = String(body?.voiceTurnId ?? "").trim() || null;
  const voiceTurn = voiceTurnId
    ? state.privateTutorVoiceTurns.find((row) => row.id === voiceTurnId && row.learnerId === learner.id && row.sessionId === session.id)
    : null;
  const questionRevisionId = voiceTurn?.questionRevisionId ?? String(body?.questionRevisionId ?? "").trim();
  const source = voiceTurn ? "voice_confirmed" : String(body?.source ?? "screen").trim();
  const recognitionConfidence = voiceTurn?.confidence
    ?? (body?.recognitionConfidence == null ? null : Number(body.recognitionConfidence));
  if (!idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    sendJson(res, 400, { error: "invalid_private_tutor_idempotency_key" });
    return true;
  }
  if (voiceTurnId && !voiceTurn) {
    sendJson(res, 404, { error: "private_tutor_voice_turn_not_found" });
    return true;
  }
  if (!ATTEMPT_SOURCES.has(source)) {
    sendJson(res, 400, { error: "invalid_private_tutor_attempt_source" });
    return true;
  }
  if (!voiceTurn && source === "voice_confirmed" && (!Number.isFinite(recognitionConfidence) || recognitionConfidence < 0.75)) {
    sendJson(res, 409, { error: "private_tutor_voice_confirmation_required", minimumConfidence: 0.75 });
    return true;
  }
  const requestValue = {
    sessionId: session.id,
    questionRevisionId,
    rawAnswer: voiceTurn?.normalizedExpression ?? String(body?.rawAnswer ?? ""),
    responseKind: String(body?.responseKind ?? "answer"),
    source,
    recognitionConfidence: Number.isFinite(recognitionConfidence) ? recognitionConfidence : null,
    voiceTurnId,
  };
  const requestHash = stableHash(requestValue);
  const existing = state.privateTutorIdempotencyRecords.find((row) =>
    row.learnerId === learner.id && row.actorId === actorId && row.key === idempotencyKey);
  if (existing) {
    if (existing.requestHash !== requestHash || existing.operation !== "tutoring_session_answer") {
      sendJson(res, 409, { error: "private_tutor_idempotency_conflict" });
      return true;
    }
    sendJson(res, 200, { ...existing.response, replayed: true });
    return true;
  }
  if (voiceTurn && voiceTurn.status === "unsupported") {
    sendJson(res, 422, { error: "private_tutor_voice_expression_unsupported" });
    return true;
  }
  if (voiceTurn?.attemptId || voiceTurn?.status === "confirmed") {
    sendJson(res, 409, { error: "private_tutor_voice_turn_already_confirmed" });
    return true;
  }
  if (!activity?.questionRevisionId) {
    sendJson(res, 400, { error: "invalid_private_tutor_session_action" });
    return true;
  }
  if (questionRevisionId !== activity.questionRevisionId) {
    sendJson(res, 409, { error: "private_tutor_session_question_mismatch" });
    return true;
  }
  const question = privateTutorQuestion(questionRevisionId, state, session.contentPackageId);
  if (!question || question.context !== "tutoring" || question.knowledgeId !== session.targetKnowledgeId) {
    sendJson(res, 400, { error: "private_tutor_question_revision_not_found" });
    return true;
  }
  const judgement = judgePrivateTutorAnswer(questionRevisionId, requestValue, state, session.contentPackageId);
  if (!judgement.accepted) {
    sendJson(res, 422, { error: judgement.error });
    return true;
  }
  const createdAt = now();
  recordPrivateTutorSuggestionAdoption(state, { learner, session, action: "answer", at: createdAt, nextId });
  const attempt = {
    id: nextId("pta"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    contentPackageId: session.contentPackageId,
    contentPackageVersion: session.contentPackageVersion,
    subjectId: session.subjectId,
    actorId,
    sessionId: session.id,
    context: "tutoring",
    activityKind: activity.kind,
    knowledgeId: session.targetKnowledgeId,
    questionRevisionId,
    correct: judgement.correct,
    independent: activity.kind === "independent_check" && activity.hintLevel === 0 && (activity.followUpCount ?? 0) === 0,
    usedHint: activity.hintLevel > 0,
    usedFollowUp: (activity.followUpCount ?? 0) > 0,
    source,
    recognitionConfidence: Number.isFinite(recognitionConfidence) ? recognitionConfidence : null,
    responseKind: judgement.responseKind,
    normalizedAnswer: judgement.normalizedAnswer,
    judgementReason: judgement.reason,
    evidenceEligible: judgement.evidenceEligible !== false,
    evidenceTier: judgement.evidenceTier ?? "deterministic",
    evaluation: judgement.evaluation ?? null,
    durationSeconds: Math.min(activity.budgetMinutes * 60, elapsedSeconds(activity.startedAt, createdAt)),
    createdAt,
  };
  state.privateTutorAttempts.unshift(attempt);
  recordPrivateTutorErrorEvidence({ state, learner, attempt, now, nextId });
  const snapshot = applyAttemptToSnapshot(state, learner, attempt, { now, nextId });
  const answerResult = recordPrivateTutorSessionAnswer(session, {
    correct: attempt.correct,
    attemptId: attempt.id,
    evidenceEligible: attempt.evidenceEligible,
    now,
  });
  if (answerResult.advanced) {
    recordPrivateTutorExperienceEvent(state, {
      learner,
      session,
      type: "learning_step_completed",
      details: { activity: attempt.activityKind },
      dedupeKey: `learning_step_completed:${session.id}:${attempt.activityKind}`,
      at: createdAt,
      nextId,
    });
  }
  recordPrivateTutorTeachingStrategyDecision(state, {
    learner,
    session,
    trigger: attempt.correct ? "answer_correct" : "answer_incorrect",
    at: now(),
    nextId,
  });
  const intelligence = attempt.evidenceEligible === false
    ? currentPrivateTutorIntelligence(state, learner.id)
    : refreshPrivateTutorIntelligence(state, learner, { now, nextId, reason: "tutoring_session_evidence" });
  if (voiceTurn) {
    voiceTurn.status = "confirmed";
    voiceTurn.confirmedAt = createdAt;
    voiceTurn.attemptId = attempt.id;
  }
  const response = {
    session: privateTutorSessionView(session, state),
    snapshot: snapshotView(snapshot),
    answer: {
      correct: attempt.correct,
      independent: attempt.independent,
      usedHint: attempt.usedHint,
      evidenceEligible: attempt.evidenceEligible,
      evidenceTier: attempt.evidenceTier,
      evaluation: attempt.evaluation,
    },
    voiceTurn: privateTutorVoiceTurnView(voiceTurn),
    ...intelligence,
  };
  state.privateTutorIdempotencyRecords.unshift({
    id: nextId("pti"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    actorId,
    key: idempotencyKey,
    operation: "tutoring_session_answer",
    requestHash,
    attemptId: attempt.id,
    response,
    createdAt,
  });
  recordTutoringSessionEvent(state, {
    learner,
    actor,
    session,
    type: attempt.correct ? "answer_correct" : answerResult.advanced ? "activity_completed" : "answer_incorrect",
    details: { activity: attempt.activityKind, attemptId: attempt.id, voiceTurnId, usedHint: attempt.usedHint, usedFollowUp: attempt.usedFollowUp, independent: attempt.independent },
    now,
    nextId,
  });
  persistStateSoon();
  sendJson(res, 201, { ...response, replayed: false });
  return true;
}

function assessmentView(assessment, state) {
  if (!assessment) return null;
  return {
    id: assessment.id,
    learnerId: assessment.learnerId,
    contentPackageId: assessment.contentPackageId ?? null,
    contentPackageVersion: assessment.contentPackageVersion ?? null,
    subjectId: assessment.subjectId ?? "math",
    activationId: assessment.activationId ?? null,
    mode: assessment.mode ?? "full",
    targetKnowledgeId: assessment.targetKnowledgeId ?? null,
    status: assessment.status,
    revision: assessment.revision,
    startedAt: assessment.startedAt,
    pausedAt: assessment.pausedAt,
    completedAt: assessment.completedAt,
    activeSeconds: assessment.activeSeconds,
    targetSeconds: assessment.targetSeconds,
    minQuestions: assessment.minQuestions,
    maxQuestions: assessment.maxQuestions,
    runtimeValidationId: assessment.runtimeValidationId ?? null,
    answeredCount: assessment.answerSummaries.length,
    evidenceAnswerCount: assessment.answerSummaries.filter((item) => item.evidenceEligible === true).length,
    currentQuestion: assessment.currentQuestionRevisionId
      ? publicQuestion(privateTutorQuestion(assessment.currentQuestionRevisionId, state, assessment.contentPackageId))
      : null,
    result: assessment.status === "completed" ? assessment.result : null,
    updatedAt: assessment.updatedAt,
  };
}

function privateTutorCatchUpPreview(plan, learnerId, { now }) {
  const value = buildPrivateTutorCatchUpPlanPreview(plan, { at: now() });
  const fingerprint = stableHash({
    schemaVersion: 1,
    learnerId,
    planId: plan.id,
    planRevision: plan.revision,
    calculationDate: value.generatedAt.slice(0, 10),
    assignments: value.assignments,
    dayStates: plan.days.map((day) => ({
      dayIndex: day.dayIndex,
      date: day.date,
      status: day.status,
      minutes: day.minutes,
      knowledgeId: day.knowledgeId,
    })),
  });
  return { ...value, fingerprint, requiresConfirmation: true };
}

function privateTutorLearningGoalPreview(state, learner, preferences, proposedGoal, { now }) {
  const contentPackageId = activeContentPackageId(learner);
  const contentPackage = privateTutorPackageRegistryFromState(state).getPackage(contentPackageId);
  if (!contentPackage) return { ok: false, status: 409, error: "private_tutor_learning_goal_content_required" };
  if (proposedGoal?.contentPackageId && proposedGoal.contentPackageId !== contentPackageId) {
    return { ok: false, status: 400, error: "private_tutor_learning_goal_content_mismatch" };
  }
  const activation = activePrivateTutorPackageActivation(state, learner.id, contentPackageId);
  const storedModel = state.privateTutorLearnerModels.find((row) => row.learnerId === learner.id
    && sameContentPackage(row.contentPackageId, contentPackageId)
    && samePrivateTutorActivation(row, activation));
  const model = storedModel ?? {
    knowledge: (contentPackage.knowledgeComponents ?? []).map((item) => ({
      id: item.id,
      title: item.name ?? item.title ?? item.id,
      mastery: null,
      level: "unknown",
      forgettingRisk: 0,
      prerequisiteGap: false,
      misconception: null,
    })),
  };
  const resolvedProposedScope = resolvePrivateTutorGoalScopeKnowledgeIds(contentPackage, proposedGoal);
  if (proposedGoal?.targetTopicIds?.length && !resolvedProposedScope) {
    return { ok: false, status: 400, error: "private_tutor_learning_goal_scope_invalid" };
  }
  const proposedScope = resolvedProposedScope ?? model.knowledge.map((item) => item.id);
  const currentScope = resolvePrivateTutorGoalScopeKnowledgeIds(contentPackage, preferences.learningGoal)
    ?? model.knowledge.map((item) => item.id);
  const dailyCapacity = Math.max(5, Math.min(180, Number(preferences.dailyMinutes) || 20));
  const requestedWeekly = proposedGoal?.weeklyMinutes ?? dailyCapacity * 7;
  const weeklyCapacity = Math.max(5, Math.min(requestedWeekly, dailyCapacity * 7));
  const effortEvidence = state.privateTutorSessions.filter((row) => row.learnerId === learner.id
    && sameContentPackage(row.contentPackageId, contentPackageId));
  const forecast = buildPrivateTutorGoalForecast({
    model,
    scopeKnowledgeIds: proposedScope,
    learningGoal: proposedGoal,
    weeklyMinutes: weeklyCapacity,
    at: now(),
    effortEvidence,
  });
  const currentSet = new Set(currentScope);
  const proposedSet = new Set(proposedScope);
  const currentPlan = state.privateTutorLearningPlans.find((row) => row.learnerId === learner.id
    && sameContentPackage(row.contentPackageId, contentPackageId)
    && samePrivateTutorActivation(row, activation)) ?? null;
  const completedTimingEvidence = effortEvidence
    .filter((row) => row.status === "completed")
    .map((row) => ({
      id: row.id,
      targetKnowledgeId: row.targetKnowledgeId,
      plannedMinutes: row.plannedMinutes,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      activities: (row.activities ?? []).map((activity) => ({
        id: activity.id,
        budgetMinutes: activity.budgetMinutes,
        startedAt: activity.startedAt,
        completedAt: activity.completedAt,
      })),
    }));
  const fingerprint = stableHash({
    schemaVersion: 1,
    learnerId: learner.id,
    preferencesRevision: preferences.revision,
    contentPackageId,
    contentPackageVersion: contentPackage.version,
    learnerModel: storedModel ? {
      id: storedModel.id,
      revision: storedModel.revision,
      sourceSnapshotRevision: storedModel.sourceSnapshotRevision,
    } : null,
    currentPlan: currentPlan ? {
      id: currentPlan.id,
      revision: currentPlan.revision,
      status: currentPlan.status,
      updatedAt: currentPlan.updatedAt,
      dayStatuses: currentPlan.days?.map((day) => ({ dayIndex: day.dayIndex, status: day.status })),
    } : null,
    completedTimingEvidence,
    proposedGoal,
  });
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      fingerprint,
      expectedPreferencesRevision: preferences.revision,
      contentPackage: { id: contentPackageId, version: contentPackage.version, name: contentPackage.name },
      currentGoal: preferences.learningGoal,
      proposedGoal,
      forecast,
      changes: {
        addedKnowledgeIds: proposedScope.filter((id) => !currentSet.has(id)),
        removedKnowledgeIds: currentScope.filter((id) => !proposedSet.has(id)),
        preservedCompletedDayCount: currentPlan?.days?.filter((day) => day.status === "completed").length ?? 0,
        replacedFutureDayCount: currentPlan?.days?.filter((day) => day.status === "planned" || day.status === "rest").length ?? 0,
        inProgressDayCount: currentPlan?.days?.filter((day) => day.status === "in_progress").length ?? 0,
        weeklyMinutesBefore: preferences.learningGoal?.weeklyMinutes ?? dailyCapacity * 7,
        weeklyMinutesAfter: weeklyCapacity,
        targetDateBefore: preferences.learningGoal?.targetDate ?? null,
        targetDateAfter: proposedGoal?.targetDate ?? null,
      },
      requiresConfirmation: true,
      generatedAt: forecast.generatedAt,
    },
  };
}

function applyDiagnosticResultToSnapshot(state, learner, assessment, { now, nextId }) {
  let snapshot = state.privateTutorSnapshots.find((row) => row.learnerId === learner.id);
  if (!snapshot) {
    snapshot = createInitialSnapshot(learner, { now, nextId });
    state.privateTutorSnapshots.unshift(snapshot);
  }
  snapshot.contentPackageId = assessment.contentPackageId ?? activeContentPackageId(learner);
  snapshot.contentPackageVersion = assessment.contentPackageVersion ?? snapshot.contentPackageVersion ?? "1.0.0";
  const evidenceResult = assessment.evidenceResult ?? assessment.result;
  for (const result of evidenceResult.knowledge) {
    if (!result.evidenceCount) continue;
    let current = snapshot.knowledge.find((row) => row.id === result.knowledgeId);
    if (!current) {
      current = { id: result.knowledgeId, mastery: null, level: "unknown", evidenceCount: 0 };
      snapshot.knowledge.push(current);
    }
    current.mastery = result.mastery;
    current.level = result.level;
    current.evidenceCount += result.evidenceCount;
  }
  snapshot.revision += 1;
  snapshot.diagnosticCompletedAt = assessment.completedAt;
  snapshot.latestAssessmentId = assessment.id;
  snapshot.updatedAt = now();
}

function refreshPrivateTutorIntelligence(state, learner, {
  now,
  nextId,
  reason,
  carryForwardKnowledgeId = null,
  learningPlanId = null,
}) {
  const snapshot = state.privateTutorSnapshots.find((row) => row.learnerId === learner.id);
  if (!snapshot) return currentPrivateTutorIntelligence(state, learner.id);
  const contentPackageId = activeContentPackageId(learner);
  const contentPackage = privateTutorPackageRegistryFromState(state).getPackage(contentPackageId);
  if (!contentPackage) return currentPrivateTutorIntelligence(state, learner.id);
  const attempts = state.privateTutorAttempts.filter((row) =>
    row.learnerId === learner.id
    && row.evidenceEligible !== false
    && sameContentPackage(row.contentPackageId, contentPackageId));
  const previousModel = state.privateTutorLearnerModels.find((row) =>
    row.learnerId === learner.id && sameContentPackage(row.contentPackageId, contentPackageId)) ?? null;
  const activation = activePrivateTutorPackageActivation(state, learner.id, contentPackageId);
  const previousDecision = state.privateTutorStrategyDecisions.find((row) =>
    row.learnerId === learner.id
    && sameContentPackage(row.contentPackageId, contentPackageId)
    && samePrivateTutorActivation(row, activation)) ?? null;
  const derived = derivePrivateTutorLearnerModel({
    snapshot,
    attempts,
    now,
    knowledgeDefinitions: contentPackage.knowledgeComponents,
  });
  const learnerModel = {
    id: nextId("ptm"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    contentPackageId,
    contentPackageVersion: contentPackage.version,
    subjectId: contentPackage.subjectId,
    activationId: activation?.id ?? null,
    activationStatus: "active",
    revision: (previousModel?.revision ?? 0) + 1,
    sourceSnapshotRevision: snapshot.revision,
    reason,
    knowledge: derived.knowledge,
    createdAt: derived.at,
    updatedAt: derived.at,
  };
  state.privateTutorLearnerModels.unshift(learnerModel);

  const preferences = privateTutorLearningPreferences(state, learner.id);
  const scopeKnowledgeIds = resolvePrivateTutorGoalScopeKnowledgeIds(contentPackage, preferences.learningGoal);
  const decisionValue = decidePrivateTutorStrategy({ model: learnerModel, attempts, previousDecision, scopeKnowledgeIds })
    ?? (reason === "learning_goal_confirmed"
      ? privateTutorUnknownScopeDecision(learnerModel, scopeKnowledgeIds)
      : null);
  if (!decisionValue) return currentPrivateTutorIntelligence(state, learner.id);
  const strategyDecision = {
    id: nextId("ptd"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    contentPackageId,
    contentPackageVersion: contentPackage.version,
    subjectId: contentPackage.subjectId,
    activationId: learnerModel.activationId,
    activationStatus: "active",
    modelId: learnerModel.id,
    ...decisionValue,
    createdAt: now(),
  };
  state.privateTutorStrategyDecisions.unshift(strategyDecision);

  const runningPlan = state.privateTutorLearningPlans.find((row) =>
    row.learnerId === learner.id
    && sameContentPackage(row.contentPackageId, contentPackageId)
    && samePrivateTutorActivation(row, activation)
    && row.status === "active") ?? null;
  const rollingPlan = reason === "tutoring_session_completed" && learningPlanId
    ? state.privateTutorLearningPlans.find((row) => row.id === learningPlanId
      && row.learnerId === learner.id
      && sameContentPackage(row.contentPackageId, contentPackageId)
      && samePrivateTutorActivation(row, activation)) ?? runningPlan
    : runningPlan;
  if (reason === "tutoring_session_evidence" && runningPlan) {
    return {
      learnerModel: learnerModelView(learnerModel),
      strategyDecision: strategyDecisionView(strategyDecision),
      learningPlan: learningPlanView(runningPlan),
    };
  }

  const previousPlan = state.privateTutorLearningPlans.find((row) =>
    row.learnerId === learner.id && sameContentPackage(row.contentPackageId, contentPackageId)) ?? null;
  const previousWeekIndex = Math.max(1, Number(previousPlan?.goalRoadmap?.currentWeekIndex) || 1);
  const planValue = buildPrivateTutorSevenDayPlan({
    model: learnerModel,
    decision: strategyDecision,
    now,
    reason,
    carryForwardKnowledgeId,
    scopeKnowledgeIds,
    dailyMinutes: preferences.dailyMinutes,
    planIntensity: preferences.planIntensity,
    learningGoal: preferences.learningGoal,
    planWeekIndex: reason === "next_week_started" ? previousWeekIndex + 1 : previousWeekIndex,
    effortEvidence: state.privateTutorSessions.filter((row) => row.learnerId === learner.id
      && sameContentPackage(row.contentPackageId, contentPackageId)),
  });
  if (reason === "tutoring_session_completed" && rollingPlan) {
    rollPrivateTutorFuturePlan(rollingPlan, planValue, {
      modelId: learnerModel.id,
      decisionId: strategyDecision.id,
      now: now(),
    });
    recordPrivateTutorRoadmapSnapshot(state, { learner, plan: rollingPlan, reason, at: rollingPlan.updatedAt, nextId });
    return {
      learnerModel: learnerModelView(learnerModel),
      strategyDecision: strategyDecisionView(strategyDecision),
      learningPlan: learningPlanView(rollingPlan),
    };
  }
  const learningPlan = {
    id: nextId("ptp"),
    ownerTeamId: learner.ownerTeamId,
    learnerId: learner.id,
    contentPackageId,
    contentPackageVersion: contentPackage.version,
    subjectId: contentPackage.subjectId,
    activationId: learnerModel.activationId,
    activationStatus: "active",
    modelId: learnerModel.id,
    decisionId: strategyDecision.id,
    revision: (previousPlan?.revision ?? 0) + 1,
    status: "active",
    ...planValue,
    updatedAt: planValue.generatedAt,
  };
  if (runningPlan && runningPlan.id !== learningPlan.id) {
    runningPlan.status = "superseded";
    runningPlan.supersededAt = planValue.generatedAt;
    runningPlan.updatedAt = planValue.generatedAt;
  }
  state.privateTutorLearningPlans.unshift(learningPlan);
  recordPrivateTutorRoadmapSnapshot(state, { learner, plan: learningPlan, reason, at: learningPlan.updatedAt, nextId });
  return {
    learnerModel: learnerModelView(learnerModel),
    strategyDecision: strategyDecisionView(strategyDecision),
    learningPlan: learningPlanView(learningPlan),
  };
}

function privateTutorUnknownScopeDecision(model, scopeKnowledgeIds) {
  const scope = new Set(Array.isArray(scopeKnowledgeIds) ? scopeKnowledgeIds : []);
  const target = model.knowledge.find((item) => !scope.size || scope.has(item.id));
  if (!target) return null;
  return {
    targetKnowledgeId: target.id,
    targetTitle: target.title,
    strategy: "concept_rebuild",
    reasonCode: "goal_scope_needs_diagnostic",
    studentReason: `“${target.title}”还没有足够学习证据，先从一次低压力讲解和检查开始。`,
    misconception: null,
    evidenceAttemptIds: [],
    exitConditions: [
      `完成“${target.title}”的首次讲解与练习`,
      "用首次作答结果校准后续计划",
    ],
  };
}

function currentPrivateTutorIntelligence(state, learnerId, { at = null } = {}) {
  const learner = state.privateTutorLearners.find((row) => row.id === learnerId);
  const contentPackageId = activeContentPackageId(learner);
  const activation = activePrivateTutorPackageActivation(state, learnerId, contentPackageId);
  return {
    learnerModel: learnerModelView(state.privateTutorLearnerModels.find((row) => row.learnerId === learnerId && sameContentPackage(row.contentPackageId, contentPackageId) && samePrivateTutorActivation(row, activation)) ?? null),
    strategyDecision: strategyDecisionView(state.privateTutorStrategyDecisions.find((row) => row.learnerId === learnerId && sameContentPackage(row.contentPackageId, contentPackageId) && samePrivateTutorActivation(row, activation)) ?? null),
    learningPlan: learningPlanView(state.privateTutorLearningPlans.find((row) => row.learnerId === learnerId && sameContentPackage(row.contentPackageId, contentPackageId) && samePrivateTutorActivation(row, activation)) ?? null, { at }),
  };
}

function learnerModelView(model) {
  if (!model) return null;
  return {
    id: model.id,
    learnerId: model.learnerId,
    contentPackageId: model.contentPackageId ?? null,
    contentPackageVersion: model.contentPackageVersion ?? null,
    subjectId: model.subjectId ?? "math",
    revision: model.revision,
    sourceSnapshotRevision: model.sourceSnapshotRevision,
    reason: model.reason,
    knowledge: model.knowledge.map((item) => ({
      id: item.id,
      title: item.title,
      mastery: item.mastery,
      level: item.level,
      confidence: item.confidence,
      evidenceCount: item.evidenceCount,
      independentCorrect: item.independentCorrect,
      hintedCorrect: item.hintedCorrect,
      incorrect: item.incorrect,
      hintDependency: item.hintDependency,
      latestEvidenceAt: item.latestEvidenceAt,
      forgettingRisk: item.forgettingRisk,
      misconception: item.misconception ? {
        id: item.misconception.id,
        label: item.misconception.label,
        evidenceCount: item.misconception.evidenceCount,
      } : null,
      prerequisiteId: item.prerequisiteId,
      prerequisiteGap: item.prerequisiteGap,
    })),
    updatedAt: model.updatedAt,
  };
}

function strategyDecisionView(decision) {
  if (!decision) return null;
  return {
    id: decision.id,
    learnerId: decision.learnerId,
    contentPackageId: decision.contentPackageId ?? null,
    contentPackageVersion: decision.contentPackageVersion ?? null,
    subjectId: decision.subjectId ?? "math",
    modelId: decision.modelId,
    targetKnowledgeId: decision.targetKnowledgeId,
    targetTitle: decision.targetTitle,
    strategy: decision.strategy,
    reasonCode: decision.reasonCode,
    studentReason: decision.studentReason,
    misconception: decision.misconception ? {
      id: decision.misconception.id,
      label: decision.misconception.label,
    } : null,
    exitConditions: [...decision.exitConditions],
    createdAt: decision.createdAt,
  };
}

function learningPlanView(plan, { at = null } = {}) {
  if (!plan) return null;
  return {
    id: plan.id,
    learnerId: plan.learnerId,
    contentPackageId: plan.contentPackageId ?? null,
    contentPackageVersion: plan.contentPackageVersion ?? null,
    subjectId: plan.subjectId ?? "math",
    activationId: plan.activationId ?? null,
    entryMode: plan.entryMode ?? null,
    startModuleId: plan.startModuleId ?? null,
    startTopicId: plan.startTopicId ?? null,
    startKnowledgeId: plan.startKnowledgeId ?? null,
    revision: plan.revision,
    status: plan.status,
    reason: plan.reason,
    studentReason: plan.studentReason,
    dailyMinutes: plan.dailyMinutes ?? null,
    weeklyMinutes: plan.weeklyMinutes ?? null,
    planIntensity: plan.planIntensity ?? "standard",
    learningGoal: plan.learningGoal ? { ...plan.learningGoal, targetTopicIds: [...(plan.learningGoal.targetTopicIds ?? [])] } : null,
    scopeKnowledgeIds: [...(plan.scopeKnowledgeIds ?? [])],
    goalForecast: plan.goalForecast ? { ...plan.goalForecast } : null,
    goalRoadmap: plan.goalRoadmap ? structuredClone(plan.goalRoadmap) : null,
    progressSignal: derivePrivateTutorPlanProgress(plan, { at: at ?? plan.updatedAt ?? plan.generatedAt }),
    generatedAt: plan.generatedAt,
    days: plan.days.map((day) => ({ ...day })),
    updatedAt: plan.updatedAt,
  };
}

function listOwnedPrivateTutorProfiles(state, actor) {
  const ownerUserId = actor?.userId ?? LOCAL_USER_ID;
  return state.privateTutorLearners.filter((learner) => (
    learner.createdBy === ownerUserId && learner.status === "active"
  ));
}

function privateTutorProfileMigrationRequired(profileCount) {
  return {
    error: "private_tutor_profile_migration_required",
    message: "检测到多个旧版学习档案，需要先完成迁移；系统不会自动合并学习证据。",
    profileCount,
  };
}

function privateTutorProfileRequired() {
  return {
    error: "private_tutor_profile_required",
    message: "还没有学习档案，请先创建自己的学习档案。",
  };
}

function resolveOwnedProfileLearner(state, actor) {
  if (actor?.privateTutorLearnerId) {
    return { ok: false, status: 403, body: { error: "private_tutor_child_mode_restricted" } };
  }
  const profiles = listOwnedPrivateTutorProfiles(state, actor);
  if (profiles.length > 1) {
    return { ok: false, status: 409, body: privateTutorProfileMigrationRequired(profiles.length) };
  }
  if (!profiles.length) {
    return { ok: false, status: 404, body: privateTutorProfileRequired() };
  }
  return { ok: true, learner: profiles[0] };
}

function createOwnedPrivateTutorProfile(state, actor, validation, { now, nextId }) {
  const createdAt = now();
  const ownerTeamId = actor?.teamId ?? LOCAL_TEAM_ID;
  const ownerUserId = actor?.userId ?? LOCAL_USER_ID;
  const learner = {
    id: nextId("lrn"),
    ownerTeamId,
    displayName: validation.displayName,
    grade: validation.grade,
    curriculumEditionId: validation.curriculumEditionId,
    activePackageId: "demo-math-foundations-v1",
    status: "active",
    createdAt,
    createdBy: ownerUserId,
    updatedAt: createdAt,
  };
  // The link remains an internal authorization adapter while legacy learner routes exist.
  const ownerLink = {
    id: nextId("grd"),
    ownerTeamId,
    learnerId: learner.id,
    guardianUserId: ownerUserId,
    relationship: "guardian",
    permissions: ["read", "write", "manage"],
    verifiedAt: createdAt,
    createdAt,
  };
  const snapshot = createInitialSnapshot(learner, { now, nextId, registry: privateTutorPackageRegistryFromState(state) });
  state.privateTutorLearners.unshift(learner);
  state.privateTutorGuardianLinks.unshift(ownerLink);
  state.privateTutorSnapshots.unshift(snapshot);
  const audit = recordAudit(state, {
    learner,
    actor,
    action: "learner_created",
    details: { guardianLinkId: ownerLink.id },
    now,
    nextId,
  });
  return { learner, snapshot, audit };
}

function elapsedSeconds(start, end) {
  const milliseconds = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 1;
  return Math.max(1, Math.ceil(milliseconds / 1000));
}

function activeContentPackageId(learner) {
  return learner?.activePackageId || "demo-math-foundations-v1";
}

function sameContentPackage(value, activePackageId) {
  return (value || "demo-math-foundations-v1") === activePackageId;
}

function activePrivateTutorPackageActivation(state, learnerId, packageId) {
  return state.privateTutorPackageActivations.find((item) =>
    item.learnerId === learnerId && item.packageId === packageId && item.status === "active") ?? null;
}

function samePrivateTutorActivation(item, activation) {
  if (item?.activationStatus === "superseded") return false;
  return activation ? item?.activationId === activation.id : item?.activationId == null;
}

function privateTutorPackageVisibleToActor(pkg, actor) {
  if (!pkg) return false;
  return pkg.sourceType !== "user_material"
    || pkg.learningProfileId === (actor?.userId ?? LOCAL_USER_ID);
}

function isPrivateTutorPilotLearningWritePath(pathname) {
  return /\/(?:attempts|assessments|learning-plan|tutoring-sessions|review|voice-turns|voice-events)(?:\/|$)/.test(pathname);
}

function rejectPausedPrivateTutorLearningWrite({ req, res, url, sendJson, state, learner }) {
  if (req.method === "GET" || !isPrivateTutorPilotLearningWritePath(url.pathname)) return false;
  const packageId = activeContentPackageId(learner);
  if (!isPrivateTutorPackageLearningAvailable(state, packageId)) {
    sendJson(res, 409, {
      error: "private_tutor_source_material_unavailable",
      message: "原始资料已删除或运行校准失效，派生内容已停止新增学习证据。历史记录仍按原版本保留。",
    });
    return true;
  }

  const pause = privateTutorPilotPauseForLearner(state, learner.id);
  if (!pause) return false;
  sendJson(res, 423, {
    error: "private_tutor_pilot_paused",
    message: "今天先休息一下，家长和老师正在确认。之后可以从原来的地方继续。",
    pause: { pausedAt: pause.pausedAt },
  });
  return true;
}
