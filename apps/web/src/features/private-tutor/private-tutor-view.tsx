import { useEffect, useRef, useState } from "react";
import {
  BookHeart,
  BrainCircuit,
  Check,
  ChevronRight,
  CirclePause,
  Clock3,
  GraduationCap,
  Heart,
  House,
  Map,
  Mic,
  MicOff,
  Settings,
  Sparkles,
  Star,
  TrendingUp,
  UserRound,
  Volume2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { ApiError } from "@/lib/api/request";
import { useSessionUser } from "@/hooks/use-session-user";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import {
  createInitialLearnerState,
  strategyLabel,
  type LearnerTutorState,
  type TutorSettingsSpace,
  type TutorTab,
} from "@/features/private-tutor/private-tutor-model";
import { saveLearnerState } from "@/features/private-tutor/private-tutor-storage";
import { PrivateTutorVisualBoard } from "@/features/private-tutor/private-tutor-visual-board";
import {
  actOnPrivateTutorSession,
  createPrivateTutorProfile,
  createPrivateTutorVoiceTurn,
  correctPrivateTutorReviewDiagnosis,
  deletePrivateTutorProfile,
  answerPrivateTutorAssessment,
  answerPrivateTutorReview,
  getCurrentPrivateTutorAssessment,
  getCurrentPrivateTutorSession,
  getPrivateTutorLearningHistory,
  getPrivateTutorLearningPreferences,
  getPrivateTutorProfile,
  getPrivateTutorDataPolicy,
  getPrivateTutorSnapshot,
  getPrivateTutorProfileMigrationReport,
  confirmPrivateTutorProfileMigration,
  getPrivateTutorReviewBook,
  getPrivateTutorWeeklyReport,
  listPrivateTutorDeletionJobs,
  pausePrivateTutorAssessment,
  pausePrivateTutorSession,
  exportPrivateTutorLearnerData,
  previewPrivateTutorLearnerDeletion,
  recordPrivateTutorVoiceEvent,
  rebalancePrivateTutorLearningPlan,
  resumePrivateTutorAssessment,
  resumePrivateTutorSession,
  retryPrivateTutorLearnerDeletion,
  startPrivateTutorAssessment,
  startPrivateTutorSession,
  updatePrivateTutorDataPolicy,
  updatePrivateTutorLearningPreferences,
  type PrivateTutorAssessment,
  type PrivateTutorDataPolicy,
  type PrivateTutorDeletionJobStatus,
  type PrivateTutorDeletionPreview,
  type PrivateTutorEvaluation,
  type PrivateTutorLearnerModel,
  type PrivateTutorReviewBook,
  type PrivateTutorLearner,
  type PrivateTutorLearningPlan,
  type PrivateTutorLearningHistory,
  type PrivateTutorLearningPreferences,
  type PrivateTutorLearningPreferencesPatch,
  type PrivateTutorProfileMigrationReport,
  type PrivateTutorSession,
  type PrivateTutorSessionPace,
  type PrivateTutorSnapshot,
  type PrivateTutorStrategyDecision,
  type PrivateTutorVoiceTurn,
  type PrivateTutorWeeklyReport,
  getPrivateTutorActiveContentPackage,
  getPrivateTutorContentPackage,
  listPrivateTutorContentPackages,
  activatePrivateTutorContentPackage,
  type PrivateTutorPackageActivationResult,
  type LearningContentPackage,
  listPrivateTutorMaterials,
  generatePrivateTutorKnowledgeMapDraft,
  type MaterialDocument,
  type KnowledgeMapDraft,
} from "@/features/private-tutor/private-tutor-api";
import { PrivateTutorMaterialImport } from "@/features/private-tutor/components/private-tutor-material-import";
import { PrivateTutorDraftEditor } from "@/features/private-tutor/components/private-tutor-draft-editor";
import { PrivateTutorContentMigration } from "@/features/private-tutor/components/private-tutor-content-migration";
import {
  browserSpeechRecognitionAvailable,
  interruptPrivateTutorSpeech,
  speakPrivateTutorText,
  startPrivateTutorRecognition,
  type PrivateTutorRecognitionController,
  type PrivateTutorVoiceMode,
} from "@/features/private-tutor/private-tutor-voice";

const STUDENT_TABS: Array<{ key: TutorTab; label: string; icon: typeof House }> = [
  { key: "today", label: "今日学习", icon: House },
  { key: "map", label: "知识地图", icon: Map },
  { key: "errors", label: "我的错题本", icon: BookHeart },
  { key: "growth", label: "我的成长", icon: TrendingUp },
  { key: "settings", label: "我的设置", icon: Settings },
];

const SETTINGS_SPACES: Array<{
  key: TutorSettingsSpace;
  title: string;
  hint: string;
  audience: string;
}> = [
  { key: "preferences", title: "学习偏好", hint: "声音、字幕、动画与学习节奏", audience: "我" },
  { key: "content", title: "学习内容", hint: "教材、课程、专业资料与学习目标", audience: "我" },
  { key: "teacher", title: "AI 私教", hint: "讲解方式、追问深度和反馈风格", audience: "我" },
  { key: "data", title: "学习数据", hint: "学习记录、导出、保留与清除", audience: "我" },
];

function defaultPrivateTutorLearningPreferences(learnerId: string): PrivateTutorLearningPreferences {
  return {
    learnerId,
    captions: true,
    reducedMotion: typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
    dailyMinutes: 20,
    planIntensity: "standard",
    teacherStyle: "heuristic_guidance",
    explanationDepth: "concise_then_expand",
    followUpStyle: "gentle_probe",
    voicePreference: "push_to_talk",
    learningGoal: null,
    deactivatedPackageIds: [],
    revision: 0,
    schemaVersion: 1,
    updatedAt: null,
  };
}

export function PrivateTutorView() {
  const sessionUser = useSessionUser();
  const navigate = usePageNavigation();
  const [learnerId, setLearnerId] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profileError, setProfileError] = useState("");
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [loadProfileAttempt, setLoadProfileAttempt] = useState(0);

  useEffect(() => {
    if (!sessionUser) {
      setLoadingProfile(false);
      setMigrationRequired(false);
      return;
    }
    let current = true;
    setLoadingProfile(true);
    setProfileError("");
    setMigrationRequired(false);
    void getPrivateTutorProfile()
      .then(({ profile }) => {
        if (!current) return;
        setLearnerId(profile?.id ?? null);
      })
      .catch((error) => {
        if (!current) return;
        if (error instanceof ApiError && error.code === "private_tutor_profile_migration_required") {
          setMigrationRequired(true);
          return;
        }
        setProfileError(error instanceof Error ? error.message : "暂时无法读取你的学习档案。");
      })
      .finally(() => { if (current) setLoadingProfile(false); });
    return () => { current = false; };
  }, [loadProfileAttempt, sessionUser]);

  if (!sessionUser) {
    return (
      <div className="mx-auto grid min-h-[65vh] max-w-2xl place-items-center p-4">
        <Card className="w-full p-8 text-center">
          <GraduationCap className="mx-auto size-11 text-emerald-600" />
          <h1 className="mt-4 text-2xl font-bold">登录后开始我的学习</h1>
          <p className="mt-2 text-sm text-muted-foreground">学习内容、知识地图、计划和错题都会归到你自己的账号。</p>
          <Button className="mt-6" onClick={() => navigate("me")}>前往登录</Button>
        </Card>
      </div>
    );
  }
  if (loadingProfile) return <div className="grid min-h-[65vh] place-items-center text-sm text-muted-foreground">正在读取我的学习档案…</div>;
  if (migrationRequired) return <MigrationRequiredBanner onMigrated={() => setLoadProfileAttempt((value) => value + 1)} />;
  if (profileError) {
    return <div className="mx-auto grid min-h-[65vh] max-w-xl place-items-center p-4"><Card className="w-full p-6 text-center"><h1 className="text-lg font-semibold">学习档案暂时没有准备好</h1><p className="mt-2 text-sm text-muted-foreground">{profileError}</p><Button className="mt-5" onClick={() => setLoadProfileAttempt((value) => value + 1)}>重新读取</Button></Card></div>;
  }
  if (!learnerId) return <PersonalTutorSetup onCreated={setLearnerId} />;
  return <PersonalTutorExperience learnerId={learnerId} />;
}

function MigrationRequiredBanner({ onMigrated }: { onMigrated: () => void }) {
  const [report, setReport] = useState<PrivateTutorProfileMigrationReport | null>(null);
  const [keepLearnerId, setKeepLearnerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setLoadError("");
    void getPrivateTutorProfileMigrationReport()
      .then((result) => {
        if (!current) return;
        setReport(result);
        setKeepLearnerId((value) => (value && result.candidates.some((item) => item.learnerId === value))
          ? value
          : result.recommendedKeepLearnerId ?? result.candidates[0]?.learnerId ?? "");
      })
      .catch((error) => {
        if (!current) return;
        setLoadError(error instanceof Error ? error.message : "暂时无法读取迁移报告。");
      });
    return () => { current = false; };
  }, [loadAttempt]);

  async function confirmMigration() {
    if (!report || !keepLearnerId) return;
    const discardLearnerIds = report.candidates.map((item) => item.learnerId).filter((id) => id !== keepLearnerId);
    if (!discardLearnerIds.length) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await confirmPrivateTutorProfileMigration({ keepLearnerId, discardLearnerIds });
      if (!result.merged || result.rollbackReceipt?.rollbackCheck.residualDiscardReferences !== result.rollbackReceipt?.rollbackCheck.expectedResidualDiscardReferences) {
        setMessage("迁移校验没有完全通过，请稍后再试；历史记录没有被改动。");
        return;
      }
      onMigrated();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "迁移暂时没有完成，请稍后再试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid min-h-[65vh] max-w-2xl place-items-center p-4">
      <Card className="w-full p-7">
        <GraduationCap className="size-10 text-emerald-600" />
        <h1 className="mt-4 text-xl font-bold">这个账号还保留着多份历史学习档案</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">为了把学习记录收拢到“我的私教”，请保留一份继续学习；其余档案的作答、评估与复习记录会合并到保留的档案里，不会丢失。</p>
        {loadError ? (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
            <p role="alert">{loadError}</p>
            <Button className="mt-3" size="sm" variant="secondary" onClick={() => setLoadAttempt((value) => value + 1)}>重新读取迁移报告</Button>
          </div>
        ) : !report ? (
          <p className="mt-5 text-sm text-muted-foreground">正在读取迁移报告…</p>
        ) : (
          <div className="mt-5 grid gap-3">
            {report.candidates.map((candidate) => (
              <label key={candidate.learnerId} className={cn("flex cursor-pointer items-start justify-between gap-3 rounded-xl border p-4", keepLearnerId === candidate.learnerId ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950" : "bg-card")}>
                <span className="flex gap-3">
                  <input type="radio" name="keep-learner" className="mt-1 size-4 accent-emerald-600" checked={keepLearnerId === candidate.learnerId} onChange={() => setKeepLearnerId(candidate.learnerId)} />
                  <span>
                    <span className="block font-medium">{candidate.displayName} · {candidate.grade}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{candidate.evidenceTotal} 条学习证据 · 创建于 {candidate.createdAt.slice(0, 10)}</span>
                  </span>
                </span>
                {candidate.learnerId === report.recommendedKeepLearnerId ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100">建议保留</span> : null}
              </label>
            ))}
            <Button disabled={busy || !keepLearnerId} onClick={() => void confirmMigration()}>{busy ? "正在合并…" : "保留这一份并合并其余档案"}</Button>
            <p className="text-xs leading-5 text-muted-foreground">合并前服务端会先做一次完整预演；合并后返回回滚校验，确认其余档案没有残留引用才会完成。</p>
          </div>
        )}
        {message ? <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-200">{message}</p> : null}
      </Card>
    </div>
  );
}

function PersonalTutorSetup({ onCreated }: { onCreated: (learnerId: string) => void }) {
  const [displayName, setDisplayName] = useState("");
  const [learningStage, setLearningStage] = useState("自主学习");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function createProfile() {
    if (!displayName.trim()) {
      setMessage("请告诉私教怎么称呼你。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await createPrivateTutorProfile({
        displayName: displayName.trim(),
        grade: learningStage,
        curriculumEditionId: "demo-math-foundations-v1",
      });
      onCreated(result.profile.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "学习档案创建失败，请稍后再试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center p-4">
      <Card className="w-full overflow-hidden">
        <div className="bg-[linear-gradient(135deg,#059669,#0f766e)] p-7 text-white sm:p-10">
          <GraduationCap className="size-12" />
          <p className="mt-6 text-sm text-emerald-100">我的私教</p>
          <h1 className="mt-2 text-3xl font-bold">为我建立一份长期学习档案</h1>
          <p className="mt-3 max-w-2xl leading-7 text-emerald-50">这里只记录你的学习目标、理解证据和复习进度。今天可以从数学开始，未来也可以接入大学教材、专业课程或你自己的资料。</p>
        </div>
        <div className="grid gap-5 p-6 sm:p-8">
          <label className="text-sm font-medium">私教怎么称呼你<input value={displayName} onChange={(event) => setDisplayName(event.target.value.slice(0, 40))} placeholder="例如：小林、Alex" className="mt-2 h-11 w-full rounded-lg border bg-card px-3 font-normal" /></label>
          <label className="text-sm font-medium">当前学习阶段<select value={learningStage} onChange={(event) => setLearningStage(event.target.value)} className="mt-2 h-11 w-full rounded-lg border bg-card px-3 font-normal"><option>自主学习</option><option>中学课程</option><option>大学课程</option><option>职业与专业学习</option></select></label>
          <div className="rounded-xl bg-muted/60 p-4 text-sm"><p className="font-medium">首个可用内容：数学基础演示</p><p className="mt-1 text-xs leading-5 text-muted-foreground">进入后可在“我的设置 → 学习内容”管理教材、课程和学习目标。内容架构会按通用课程包扩展，不绑定某个年龄或年级。</p></div>
          <Button size="lg" disabled={busy} onClick={() => void createProfile()}>{busy ? "正在创建…" : "开始我的学习"}</Button>
          {message ? <p role="alert" className="text-sm text-rose-600">{message}</p> : null}
        </div>
      </Card>
    </div>
  );
}

function PersonalTutorExperience({ learnerId }: { learnerId: string }) {
  const [tab, setTab] = useState<TutorTab>("today");
  const [learnerState, setLearnerState] = useState<LearnerTutorState>(() => emptyLearnerState({ id: learnerId, displayName: "", grade: "", curriculum: "", avatar: "学" }));
  const [assessment, setAssessment] = useState<PrivateTutorAssessment | null>(null);
  const [learnerModel, setLearnerModel] = useState<PrivateTutorLearnerModel | null>(null);
  const [strategyDecision, setStrategyDecision] = useState<PrivateTutorStrategyDecision | null>(null);
  const [learningPlan, setLearningPlan] = useState<PrivateTutorLearningPlan | null>(null);
  const [tutoringSession, setTutoringSession] = useState<PrivateTutorSession | null>(null);
  const [reviewBook, setReviewBook] = useState<PrivateTutorReviewBook | null>(null);
  const [assessmentReady, setAssessmentReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [diagnosticDismissed, setDiagnosticDismissed] = useState(false);
  const [initialLearningRoute, setInitialLearningRoute] = useState<"choose" | "diagnostic" | "content">("choose");
  const [learningPreferences, setLearningPreferences] = useState<PrivateTutorLearningPreferences>(() => defaultPrivateTutorLearningPreferences(learnerId));

  useEffect(() => {
    let current = true;
    setLearnerState(emptyLearnerState({ id: learnerId, displayName: "", grade: "", curriculum: "", avatar: "学" }));
    setAssessmentReady(false);
    setLoadError("");
    setDiagnosticDismissed(false);
    setInitialLearningRoute("choose");
    setLearningPreferences(defaultPrivateTutorLearningPreferences(learnerId));
    void Promise.allSettled([getPrivateTutorSnapshot(), getCurrentPrivateTutorAssessment(), getCurrentPrivateTutorSession(), getPrivateTutorReviewBook(), getPrivateTutorLearningPreferences()])
      .then(([snapshotResult, assessmentResult, sessionResult, reviewResult, preferencesResult]) => {
        if (!current) return;
        if (snapshotResult.status === "fulfilled") {
          setLearnerState(serverLearnerState(snapshotResult.value.learner, snapshotResult.value.snapshot));
          setLearnerModel(snapshotResult.value.learnerModel ?? null);
          setStrategyDecision(snapshotResult.value.strategyDecision ?? null);
          setLearningPlan(snapshotResult.value.learningPlan ?? null);
        } else {
          setLoadError("暂时无法读取你的学习空间。为避免显示错误或演示数据，学习已安全停止。");
        }
        if (assessmentResult.status === "fulfilled") {
          setAssessment(assessmentResult.value);
          setDiagnosticDismissed(assessmentResult.value?.status === "completed");
        } else {
          setAssessment(null);
        }
        setTutoringSession(sessionResult.status === "fulfilled" ? sessionResult.value : null);
        setReviewBook(reviewResult.status === "fulfilled" ? reviewResult.value : null);
        if (preferencesResult.status === "fulfilled") setLearningPreferences(preferencesResult.value);
        setAssessmentReady(true);
      });
    return () => { current = false; };
  }, [learnerId, loadAttempt]);
  useEffect(() => {
    if (learnerState.learner.id === learnerId) saveLearnerState(learnerState);
  }, [learnerId, learnerState]);

  async function finishDiagnostic() {
    try {
      const result = await getPrivateTutorSnapshot();
      setLearnerState(serverLearnerState(result.learner, result.snapshot));
      setLearnerModel(result.learnerModel ?? null);
      setStrategyDecision(result.strategyDecision ?? null);
      setLearningPlan(result.learningPlan ?? null);
      setDiagnosticDismissed(true);
      setTab("map");
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "知识地图暂时无法读取，请稍后再试。";
    }
  }

  async function rescheduleToday() {
    try {
      const result = await rebalancePrivateTutorLearningPlan(1);
      setLearnerModel(result.learnerModel ?? null);
      setStrategyDecision(result.strategyDecision ?? null);
      setLearningPlan(result.learningPlan ?? null);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "计划暂时无法调整，请稍后再试。";
    }
  }

  async function startLesson(pace: PrivateTutorSessionPace) {
    try {
      const result = await startPrivateTutorSession(pace);
      setTutoringSession(result.session);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "今天的课程暂时无法开始，请稍后再试。";
    }
  }

  async function pauseLesson() {
    if (!tutoringSession) return "没有可以暂停的课程。";
    try {
      const result = await pausePrivateTutorSession(tutoringSession.id);
      setTutoringSession(result.session);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "课程暂时无法暂停。";
    }
  }

  async function resumeLesson() {
    if (!tutoringSession) return "没有可以继续的课程。";
    try {
      const result = await resumePrivateTutorSession(tutoringSession.id);
      setTutoringSession(result.session);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "课程暂时无法继续。";
    }
  }

  async function actOnLesson(input: Parameters<typeof actOnPrivateTutorSession>[1]) {
    if (!tutoringSession) return { error: "课程还没有开始。", correct: null, evidenceEligible: null, evaluation: null };
    try {
      const result = await actOnPrivateTutorSession(tutoringSession.id, input);
      setTutoringSession(result.session);
      if (result.snapshot) setLearnerState(applyServerSnapshot(learnerState, result.snapshot));
      if (result.learnerModel !== undefined) setLearnerModel(result.learnerModel ?? null);
      if (result.strategyDecision !== undefined) setStrategyDecision(result.strategyDecision ?? null);
      if (result.learningPlan !== undefined) setLearningPlan(result.learningPlan ?? null);
      void getPrivateTutorReviewBook().then(setReviewBook).catch(() => undefined);
      return {
        error: null,
        correct: result.answer?.correct ?? null,
        evidenceEligible: result.answer?.evidenceEligible ?? null,
        evaluation: result.answer?.evaluation ?? null,
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "这一步暂时没有保存，请重试。", correct: null, evidenceEligible: null, evaluation: null };
    }
  }

  function applyPackageActivation(result: PrivateTutorPackageActivationResult) {
    if (result.snapshot) setLearnerState((current) => applyServerSnapshot(current, result.snapshot!));
    setLearnerModel(result.learnerModel ?? null);
    setStrategyDecision(result.strategyDecision ?? null);
    setLearningPlan(result.learningPlan ?? null);
    setAssessment(null);
    setTutoringSession(null);
    setDiagnosticDismissed(result.activation.entryMode === "chapter");
    setInitialLearningRoute(result.activation.entryMode === "diagnostic" ? "diagnostic" : "choose");
    setTab("today");
  }

  async function saveLearningPreferences(patch: PrivateTutorLearningPreferencesPatch) {
    try {
      const updated = await updatePrivateTutorLearningPreferences(patch);
      setLearningPreferences(updated);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "学习偏好暂时没有保存，请重试。";
    }
  }

  const allKnowledgeUnknown = learnerState.knowledge.every((item) => item.level === "unknown");
  const needsInitialLearningRoute = !assessment && allKnowledgeUnknown && !learningPlan;
  if (!assessmentReady) {
    return <div className="grid min-h-[65vh] place-items-center text-sm text-muted-foreground">正在准备专属于你的学习空间…</div>;
  }
  if (loadError) {
    return (
      <div className="grid min-h-[65vh] place-items-center p-4">
        <Card className="w-full max-w-lg p-6 text-center">
          <GraduationCap className="mx-auto size-10 text-amber-600" />
          <h1 className="mt-4 text-lg font-semibold">学习空间暂时没有准备好</h1>
          <p role="alert" className="mt-2 text-sm leading-6 text-muted-foreground">{loadError}</p>
          <Button className="mt-5" onClick={() => setLoadAttempt((value) => value + 1)}>重新读取</Button>
        </Card>
      </div>
    );
  }
  if (needsInitialLearningRoute && initialLearningRoute === "choose") {
    return (
      <InitialLearningRoute
        learnerName={learnerState.learner.displayName}
        onDiagnostic={() => setInitialLearningRoute("diagnostic")}
        onContent={() => setInitialLearningRoute("content")}
      />
    );
  }
  if (needsInitialLearningRoute && initialLearningRoute === "content") {
    return (
      <div className="mx-auto max-w-6xl p-4 sm:p-7">
        <Button className="mb-5" variant="secondary" onClick={() => setInitialLearningRoute("choose")}>返回开始方式</Button>
        <TutorSettings
          state={learnerState}
          preferences={learningPreferences}
          onPreferencesChange={saveLearningPreferences}
          onPackageActivated={applyPackageActivation}
          onProfileDeleted={() => window.location.reload()}
          initialSpace="content"
        />
      </div>
    );
  }
  if ((needsInitialLearningRoute && initialLearningRoute === "diagnostic")
    || (assessment != null && assessment.status !== "completed")
    || (assessment?.status === "completed" && !diagnosticDismissed)) {
    return (
      <DiagnosticExperience
        learnerName={learnerState.learner.displayName}
        assessment={assessment}
        onAssessmentChange={setAssessment}
        onFinish={finishDiagnostic}
      />
    );
  }

  return (
    <div className="mx-auto min-h-full max-w-7xl overflow-hidden rounded-3xl border border-emerald-100 bg-[linear-gradient(145deg,color-mix(in_oklab,var(--color-card)_94%,#ecfdf5),color-mix(in_oklab,var(--color-background)_93%,#fff7ed))] shadow-sm dark:border-emerald-950">
      <header className="border-b border-emerald-100/80 px-4 py-4 dark:border-emerald-950 sm:px-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl bg-emerald-500 text-white shadow-sm">
              <GraduationCap className="size-6" aria-hidden="true" />
            </span>
            <div>
              <p className="text-lg font-bold tracking-tight">我的私教</p>
              <p className="text-xs text-muted-foreground">围绕我正在学的内容，把真正不会的学会</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border bg-card/80 py-1 pl-1 pr-3 text-sm shadow-sm">
            <span className="grid size-8 place-items-center rounded-full bg-amber-100 font-semibold text-amber-800">{learnerState.learner.avatar}</span>
            <span className="font-medium">{learnerState.learner.displayName}</span>
            <span className="text-xs text-muted-foreground">{learnerState.learner.grade}</span>
          </div>
        </div>
      </header>

      <nav aria-label="我的私教一级目录" className="overflow-x-auto border-b bg-card/55 px-2 sm:px-5">
        <ul className="flex min-w-max gap-1">
          {STUDENT_TABS.map((item) => {
            const Icon = item.icon;
            const active = item.key === tab;
            return (
              <li key={item.key}>
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => setTab(item.key)}
                  className={cn(
                    "flex min-h-14 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors sm:px-4",
                    active ? "border-emerald-500 text-emerald-700 dark:text-emerald-300" : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="p-4 sm:p-7">
        {tab === "today" ? <TodayLearning state={learnerState} learningPlan={learningPlan} strategyDecision={strategyDecision} session={tutoringSession} preferences={learningPreferences} onReschedule={rescheduleToday} onStart={startLesson} onPause={pauseLesson} onResume={resumeLesson} onAction={actOnLesson} /> : null}
        {tab === "map" ? <KnowledgeMap state={learnerState} learnerModel={learnerModel} /> : null}
        {tab === "errors" ? <ErrorBook state={learnerState} reviewBook={reviewBook} onReviewBookChange={setReviewBook} onSnapshot={(snapshot) => setLearnerState((current) => applyServerSnapshot(current, snapshot))} /> : null}
        {tab === "growth" ? <Growth state={learnerState} /> : null}
        {tab === "settings" ? (
          <TutorSettings
            state={learnerState}
            preferences={learningPreferences}
            onPreferencesChange={saveLearningPreferences}
            onPackageActivated={applyPackageActivation}
            onProfileDeleted={() => window.location.reload()}
          />
        ) : null}
      </div>
    </div>
  );
}

function InitialLearningRoute({ learnerName, onDiagnostic, onContent }: { learnerName: string; onDiagnostic: () => void; onContent: () => void }) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-4xl items-center justify-center p-4">
      <Card className="w-full overflow-hidden">
        <div className="bg-[linear-gradient(135deg,#059669,#0f766e)] p-7 text-white sm:p-9">
          <p className="text-sm text-emerald-100">你好，{learnerName}</p>
          <h1 className="mt-2 text-3xl font-bold">先选择这次想学什么</h1>
          <p className="mt-3 max-w-2xl leading-7 text-emerald-50">可以用当前课程先做摸底，也可以先导入自己的教材。选择教材不会被当成已经掌握，历史学习记录也不会被覆盖。</p>
        </div>
        <div className="grid gap-4 p-6 sm:grid-cols-2 sm:p-8">
          <button type="button" onClick={onDiagnostic} className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/60 p-5 text-left transition hover:border-emerald-500 dark:border-emerald-900 dark:bg-emerald-950/30">
            <BrainCircuit className="size-8 text-emerald-600" />
            <span className="mt-4 block text-lg font-bold">用当前内容开始摸底</span>
            <span className="mt-2 block text-sm leading-6 text-muted-foreground">先了解已经会什么，再生成七日计划。</span>
          </button>
          <button type="button" onClick={onContent} className="rounded-2xl border-2 border-sky-200 bg-sky-50/60 p-5 text-left transition hover:border-sky-500 dark:border-sky-900 dark:bg-sky-950/30">
            <BookHeart className="size-8 text-sky-600" />
            <span className="mt-4 block text-lg font-bold">选择课程或导入我的教材</span>
            <span className="mt-2 block text-sm leading-6 text-muted-foreground">支持已有内容包、PDF、Markdown 和文本资料。</span>
          </button>
        </div>
      </Card>
    </div>
  );
}

const DIAGNOSTIC_KNOWLEDGE_LABELS: Record<string, string> = {
  integer: "有理数运算",
  "equation-meaning": "等式与方程",
  balance: "等式平衡",
  "word-problem": "方程应用",
};

function DiagnosticExperience({
  learnerName,
  assessment,
  onAssessmentChange,
  onFinish,
}: {
  learnerName: string;
  assessment: PrivateTutorAssessment | null;
  onAssessmentChange: (assessment: PrivateTutorAssessment) => void;
  onFinish: () => Promise<string | null>;
}) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const questionStartedAt = useRef(Date.now());
  const answerKey = useRef(newClientKey("diagnostic"));

  useEffect(() => {
    setAnswer("");
    setMessage("");
    questionStartedAt.current = Date.now();
    answerKey.current = newClientKey("diagnostic");
  }, [assessment?.currentQuestion?.revisionId]);

  async function start() {
    setBusy(true);
    setMessage("");
    try {
      onAssessmentChange(await startPrivateTutorAssessment());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "摸底暂时无法开始，请稍后再试。" );
    } finally {
      setBusy(false);
    }
  }

  async function pause() {
    if (!assessment) return;
    setBusy(true);
    setMessage("");
    try {
      onAssessmentChange(await pausePrivateTutorAssessment(assessment.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "暂时无法暂停。" );
    } finally {
      setBusy(false);
    }
  }

  async function resume() {
    if (!assessment) return;
    setBusy(true);
    setMessage("");
    try {
      onAssessmentChange(await resumePrivateTutorAssessment(assessment.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "暂时无法继续。" );
    } finally {
      setBusy(false);
    }
  }

  async function submit(responseKind: "answer" | "dont_know") {
    if (!assessment?.currentQuestion) return;
    if (responseKind === "answer" && !answer.trim()) {
      setMessage("先写下你的答案；如果现在不会，可以直接点“我暂时不会”。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const next = await answerPrivateTutorAssessment(assessment.id, {
        idempotencyKey: answerKey.current,
        questionRevisionId: assessment.currentQuestion.revisionId,
        rawAnswer: responseKind === "answer" ? answer : "",
        responseKind,
        source: "screen",
        durationSeconds: Math.max(1, Math.round((Date.now() - questionStartedAt.current) / 1000)),
      });
      onAssessmentChange(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "答案还没有保存，请再试一次。" );
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    setMessage("");
    const error = await onFinish();
    if (error) setMessage(error);
    setBusy(false);
  }

  if (!assessment) {
    return (
      <div className="mx-auto flex min-h-full max-w-4xl items-center justify-center p-3 sm:p-6">
        <Card className="w-full overflow-hidden">
          <div className="bg-[linear-gradient(135deg,#059669,#0f766e)] p-7 text-white sm:p-10">
            <span className="grid size-14 place-items-center rounded-2xl bg-white/15"><BrainCircuit className="size-8" /></span>
            <p className="mt-7 text-sm text-emerald-100">你好，{learnerName}</p>
            <h1 className="mt-2 text-3xl font-bold">先让我认识一下你会什么</h1>
            <p className="mt-3 max-w-2xl leading-7 text-emerald-50">大约 10 分钟，没有排名，也不会因为答错扣分。我会根据每一步调整下一题，先找到你已经会的，再决定从哪里开始学。</p>
          </div>
          <div className="grid gap-4 p-6 sm:grid-cols-3 sm:p-8">
            <DiagnosticPromise icon={Clock3} title="约 10 分钟" hint="中途可以暂停，下次接着做" />
            <DiagnosticPromise icon={Heart} title="不会也可以说" hint="“我暂时不会”也是有用的信息" />
            <DiagnosticPromise icon={Map} title="生成知识地图" hint="尚未测到不会被当成薄弱" />
            <div className="sm:col-span-3 sm:text-center">
              <Button size="lg" disabled={busy} onClick={() => void start()}>{busy ? "正在准备…" : "开始摸底"}</Button>
              {message ? <p role="alert" className="mt-3 text-sm text-rose-600">{message}</p> : null}
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (assessment.status === "paused") {
    return (
      <div className="mx-auto grid min-h-full max-w-2xl place-items-center p-4">
        <Card className="w-full p-7 text-center">
          <CirclePause className="mx-auto size-12 text-emerald-600" />
          <h1 className="mt-4 text-2xl font-bold">已经帮你保存好了</h1>
          <p className="mt-2 text-sm text-muted-foreground">目前完成 {assessment.answeredCount} 题。休息好以后，会从刚才的位置继续。</p>
          <div className="mt-6"><Button disabled={busy} onClick={() => void resume()}>继续摸底</Button></div>
          {message ? <p role="alert" className="mt-3 text-sm text-rose-600">{message}</p> : null}
        </Card>
      </div>
    );
  }

  if (assessment.status === "completed" && assessment.result) {
    const measuredStrengths = assessment.result.strengths.map((id) => DIAGNOSTIC_KNOWLEDGE_LABELS[id] ?? id);
    const focus = assessment.result.focus.map((id) => DIAGNOSTIC_KNOWLEDGE_LABELS[id] ?? id);
    return (
      <div className="mx-auto max-w-4xl p-4 sm:p-7">
        <Card className="overflow-hidden">
          <div className="bg-emerald-600 p-7 text-white sm:p-9">
            <Star className="size-11 fill-amber-300 text-amber-300" />
            <h1 className="mt-4 text-3xl font-bold">我已经更了解你了</h1>
            <p className="mt-2 text-emerald-50">完成了 {assessment.result.answeredCount} 道自适应题。先看看你已经站稳的地方。</p>
            {assessment.runtimeValidationId ? <p className="mt-2 text-xs text-emerald-100">其中 {assessment.evidenceAnswerCount ?? 0} 道通过来源量表运行校准并形成受限置信度证据。</p> : null}
          </div>
          <div className="grid gap-5 p-6 sm:grid-cols-2 sm:p-8">
            <div className="rounded-2xl bg-emerald-50 p-5 dark:bg-emerald-950">
              <p className="font-semibold text-emerald-800 dark:text-emerald-200">已经掌握</p>
              <p className="mt-2 text-sm leading-6 text-emerald-900 dark:text-emerald-100">{measuredStrengths.length ? measuredStrengths.join("、") : "你认真完成了整次摸底，这本身就是很好的开始。"}</p>
            </div>
            <div className="rounded-2xl bg-amber-50 p-5 dark:bg-amber-950">
              <p className="font-semibold text-amber-900 dark:text-amber-100">接下来优先学</p>
              <p className="mt-2 text-sm leading-6 text-amber-900 dark:text-amber-100">{focus.length ? focus.join("、") : "继续用新题巩固正在学习的知识点。"}</p>
            </div>
            <div className="sm:col-span-2 text-center">
              <Button size="lg" disabled={busy} onClick={() => void finish()}>{busy ? "正在生成…" : "看看我的知识地图"}</Button>
              {message ? <p role="alert" className="mt-3 text-sm text-rose-600">{message}</p> : null}
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const question = assessment.currentQuestion;
  if (!question) return null;
  const progress = Math.min(96, Math.round((assessment.answeredCount / assessment.minQuestions) * 100));
  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-7">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-sm font-semibold text-emerald-700">AI 摸底</p><p className="text-xs text-muted-foreground">第 {assessment.answeredCount + 1} 题 · 约 {assessment.minQuestions} 至 {assessment.maxQuestions} 题</p></div>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void pause()}><CirclePause />暂停</Button>
      </div>
      <div className="mb-6 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} /></div>
      <Card className="p-6 sm:p-9">
        <p className="text-xs font-medium text-muted-foreground">{DIAGNOSTIC_KNOWLEDGE_LABELS[question.knowledgeId] ?? "当前知识点"}</p>
        <h1 className="mt-3 text-2xl font-bold leading-relaxed">{question.prompt}</h1>
        {question.sourceRefs?.length ? <p className="mt-3 text-xs text-muted-foreground">来源位置：{question.sourceRefs.map((ref) => `${ref.sectionId}${ref.pageNumber ? ` · 第 ${ref.pageNumber} 页` : ""}`).join("；")}</p> : null}
        {question.kind === "choice" && question.options ? (
          <div className="mt-7 grid gap-3">
            {question.options.map((option) => <button key={option.id} type="button" onClick={() => setAnswer(option.id)} className={cn("rounded-xl border-2 p-4 text-left transition", answer === option.id ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950" : "hover:border-emerald-300")}><span className="mr-3 font-bold uppercase">{option.id}</span>{option.label}</button>)}
          </div>
        ) : question.kind === "rubric_response" ? (
          <div className="mt-7"><label className="text-sm font-medium" htmlFor="diagnostic-answer">写下你的理解，并保留题目要求的来源标记</label><textarea id="diagnostic-answer" value={answer} onChange={(event) => setAnswer(event.target.value.slice(0, 4000))} placeholder="用自己的话解释，并写出 [ref:章节]" className="mt-2 min-h-36 w-full rounded-xl border-2 bg-card p-4 text-base leading-7 outline-none focus:border-emerald-500" /></div>
        ) : (
          <div className="mt-7"><label className="text-sm font-medium" htmlFor="diagnostic-answer">写下答案</label><input id="diagnostic-answer" value={answer} onChange={(event) => setAnswer(event.target.value.slice(0, 80))} onKeyDown={(event) => { if (event.key === "Enter") void submit("answer"); }} placeholder="例如：5、1/2 或 x=5" className="mt-2 h-14 w-full rounded-xl border-2 bg-card px-4 text-xl font-semibold outline-none focus:border-emerald-500" autoComplete="off" /></div>
        )}
        <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" disabled={busy} onClick={() => void submit("dont_know")}>我暂时不会</Button>
          <Button size="lg" disabled={busy || !answer.trim()} onClick={() => void submit("answer")}>{busy ? "正在保存…" : "提交并看下一题"}</Button>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">答错不会扣分；系统只用它选择更合适的下一题，不会评价你聪明不聪明。</p>
        {message ? <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-200">{message}</p> : null}
      </Card>
    </div>
  );
}

function DiagnosticPromise({ icon: Icon, title, hint }: { icon: typeof Clock3; title: string; hint: string }) {
  return <div className="rounded-2xl bg-muted/50 p-4"><Icon className="size-5 text-emerald-600" /><p className="mt-3 text-sm font-semibold">{title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{hint}</p></div>;
}

function newClientKey(prefix: string) {
  return `${prefix}-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
}

function emptyLearnerState(learner: LearnerTutorState["learner"]): LearnerTutorState {
  const empty = createInitialLearnerState(learner);
  return {
    ...empty,
    dailyMinutes: 0,
    streakDays: 0,
    completedSessions: 0,
    independentAnswers: 0,
    knowledge: empty.knowledge.map((item) => ({ ...item, mastery: null, level: "unknown", evidence: "尚未测到" })),
    errors: [],
  };
}

function serverLearnerState(learner: PrivateTutorLearner, snapshot: PrivateTutorSnapshot): LearnerTutorState {
  const titles: Record<string, string> = { integer: "有理数运算", "equation-meaning": "等式与方程", balance: "等式两边同乘同除", "word-problem": "一元一次方程应用" };
  const fallback = createInitialLearnerState({ id: learner.id, displayName: learner.displayName, grade: learner.grade, curriculum: learner.curriculumEditionId ?? "演示课程 · 方程基础", avatar: learner.displayName.slice(0, 1) || "学" });
  return {
    ...fallback,
    dailyMinutes: snapshot.dailyMinutes,
    completedSessions: snapshot.completedSessions,
    independentAnswers: snapshot.independentAnswers,
    knowledge: snapshot.knowledge.map((item) => ({ id: item.id, title: titles[item.id] ?? item.id, mastery: item.mastery, level: item.level, evidence: item.evidenceCount ? `${item.evidenceCount} 条学习证据` : "尚未测到" })),
    errors: [],
  };
}

function applyServerSnapshot(state: LearnerTutorState, snapshot: PrivateTutorSnapshot): LearnerTutorState {
  const byId = new globalThis.Map(snapshot.knowledge.map((item) => [item.id, item]));
  return {
    ...state,
    dailyMinutes: snapshot.dailyMinutes,
    completedSessions: snapshot.completedSessions,
    independentAnswers: snapshot.independentAnswers,
    knowledge: state.knowledge.map((item) => {
      const server = byId.get(item.id);
      return server ? { ...item, mastery: server.mastery, level: server.level, evidence: server.evidenceCount ? `${server.evidenceCount} 条学习证据` : "尚未测到" } : item;
    }),
  };
}

export function formatPrivateTutorEvaluationFeedback(evaluation: PrivateTutorEvaluation | null | undefined) {
  if (!evaluation) return null;
  if (typeof evaluation.firstIncorrectStep === "number") {
    const step = evaluation.steps?.[evaluation.firstIncorrectStep];
    if (step?.feedback) return `第 ${evaluation.firstIncorrectStep + 1} 步：${step.feedback}`;
  }
  return evaluation.explanation ?? null;
}

function TodayLearning({
  state,
  learningPlan,
  strategyDecision,
  session,
  preferences,
  onReschedule,
  onStart,
  onPause,
  onResume,
  onAction,
}: {
  state: LearnerTutorState;
  learningPlan: PrivateTutorLearningPlan | null;
  strategyDecision: PrivateTutorStrategyDecision | null;
  session: PrivateTutorSession | null;
  preferences: PrivateTutorLearningPreferences;
  onReschedule: () => Promise<string | null>;
  onStart: (pace: PrivateTutorSessionPace) => Promise<string | null>;
  onPause: () => Promise<string | null>;
  onResume: () => Promise<string | null>;
  onAction: (input: Parameters<typeof actOnPrivateTutorSession>[1]) => Promise<{
    error: string | null;
    correct: boolean | null;
    evidenceEligible?: boolean | null;
    evaluation?: PrivateTutorEvaluation | null;
  }>;
}) {
  const [pace, setPace] = useState<PrivateTutorSessionPace>("standard");
  const [answer, setAnswer] = useState("");
  const [voiceMessage, setVoiceMessage] = useState("点一下麦克风，也可以直接说");
  const [voiceMode, setVoiceMode] = useState<PrivateTutorVoiceMode>("push_to_talk");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [pendingVoiceTurn, setPendingVoiceTurn] = useState<PrivateTutorVoiceTurn | null>(null);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speechRate, setSpeechRate] = useState(1);
  const [subtitle, setSubtitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const recognitionRef = useRef<PrivateTutorRecognitionController | null>(null);
  const attemptKeyRef = useRef(newClientKey("tutoring"));
  const dailyTargetMinutes = Math.max(5, preferences.dailyMinutes);
  const dailyProgress = Math.min(100, Math.round((state.dailyMinutes / dailyTargetMinutes) * 100));
  const captions = preferences.captions;
  const reducedMotion = preferences.reducedMotion;
  const voiceEnabled = preferences.voicePreference !== "text_only";

  useEffect(() => () => {
    recognitionRef.current?.abort();
    interruptPrivateTutorSpeech();
  }, []);
  useEffect(() => {
    if (preferences.voicePreference === "text_only") {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      setListening(false);
      return;
    }
    setVoiceMode(preferences.voicePreference);
  }, [preferences.voicePreference]);
  useEffect(() => {
    setAnswer("");
    setMessage("");
    setInterimTranscript("");
    setPendingVoiceTurn(null);
    attemptKeyRef.current = newClientKey("tutoring");
  }, [session?.currentActivity?.question?.revisionId]);

  function recordVoiceEvent(type: Parameters<typeof recordPrivateTutorVoiceEvent>[1]["type"], reason?: string) {
    if (!session) return;
    void recordPrivateTutorVoiceEvent(session.id, { type, reason }).catch(() => undefined);
  }

  function stopVoiceRecognition() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
    recordVoiceEvent("recognition_stopped");
  }

  async function toggleVoice() {
    if (listening) {
      stopVoiceRecognition();
      setVoiceMessage("已停止。本站后端不接收或保存原始音频");
      return;
    }
    const question = session?.currentActivity?.question;
    if (!session || !question) {
      setVoiceMessage("讲解时可以点“读给我听”；遇到题目后再用语音回答");
      return;
    }
    if (!browserSpeechRecognitionAvailable()) {
      setVoiceMessage("当前浏览器没有语音识别能力，请直接写答案；学习不会中断");
      return;
    }
    if (interruptPrivateTutorSpeech()) recordVoiceEvent("playback_interrupted", "student_barge_in");
    setSpeaking(false);
    setSubtitle("");
    setPendingVoiceTurn(null);
    setInterimTranscript("");
    const controller = startPrivateTutorRecognition({
      mode: voiceMode,
      onInterim: (transcript) => {
        setInterimTranscript(transcript);
        setVoiceMessage("正在听…你可以随时停下来");
      },
      onFinal: ({ transcript, confidence, alternatives }) => {
        recognitionRef.current?.stop();
        recognitionRef.current = null;
        setInterimTranscript("");
        setListening(false);
        setVoiceMessage("正在把语音变成规范的数学表达…");
        void createPrivateTutorVoiceTurn(session.id, {
          clientTurnId: newClientKey("voice"),
          transcript,
          confidence,
          alternatives,
          mode: voiceMode,
          provider: "browser_web_speech",
        }).then(({ voiceTurn }) => {
          setPendingVoiceTurn(voiceTurn);
          setAnswer(voiceTurn.normalizedExpression ?? "");
          if (voiceTurn.status === "unsupported") {
            setVoiceMessage("这句话还不能安全地变成数学答案，请再说一次或直接写答案");
          } else if (voiceTurn.requiresConfirmation) {
            setVoiceMessage("我不太确定，确认后才会判题，不会直接算错");
          } else {
            setVoiceMessage("我已经整理成数学表达，请看一眼再确认");
          }
          if (voiceMode === "hands_free" && !voiceTurn.requiresConfirmation && voiceTurn.normalizedExpression) {
            void gradeVoiceTurn(voiceTurn);
          }
        }).catch(() => setVoiceMessage("语音暂时没有处理成功，请再说一次或直接写答案"));
      },
      onError: (error) => {
        recognitionRef.current = null;
        setListening(false);
        setVoiceMessage(error === "not-allowed" ? "没有获得麦克风权限，请直接写答案" : "没有听清，请再试一次或直接写答案");
        recordVoiceEvent("recognition_error", error);
      },
      onEnd: () => {
        recognitionRef.current = null;
        setListening(false);
      },
    });
    if (!controller) {
      setVoiceMessage("语音没有启动成功，请检查麦克风权限或直接写答案");
      return;
    }
    recognitionRef.current = controller;
    setListening(true);
    setVoiceMessage(voiceMode === "hands_free" ? "自由对话已开启，说完一句后会显示识别结果" : "正在听…说出你的答案");
    recordVoiceEvent("recognition_started");
  }

  async function gradeVoiceTurn(voiceTurn: PrivateTutorVoiceTurn) {
    const question = session?.currentActivity?.question;
    if (!question || !voiceTurn.normalizedExpression) return;
    setBusy(true);
    setMessage("");
    const result = await onAction({
      action: "answer",
      idempotencyKey: attemptKeyRef.current,
      questionRevisionId: question.revisionId,
      rawAnswer: "",
      responseKind: "answer",
      source: "voice_confirmed",
      recognitionConfidence: voiceTurn.confidence,
      voiceTurnId: voiceTurn.id,
    });
    if (result.error) setMessage(result.error);
    else {
      setPendingVoiceTurn(null);
      setAnswer("");
      const feedback = formatPrivateTutorEvaluationFeedback(result.evaluation);
      if (result.evidenceEligible === false) {
        setVoiceMessage(feedback ?? "答案已确认，但这次结果需要复核后才会计入掌握度");
        setMessage(feedback
          ? `${feedback} 当前结果不会计入掌握度。`
          : "答案已确认，但这次结果需要复核，不会计入掌握度。");
        attemptKeyRef.current = newClientKey("tutoring");
      } else {
        setVoiceMessage(result.correct ? "听对了，也答对了。继续下一小步吧" : "答案已经确认。没关系，我会换一种讲法");
        if (result.correct === false) attemptKeyRef.current = newClientKey("tutoring");
      }
    }
    setBusy(false);
  }

  async function confirmVoiceAnswer() {
    if (pendingVoiceTurn) await gradeVoiceTurn(pendingVoiceTurn);
  }

  function speakCurrent(rate = speechRate) {
    if (!session?.currentActivity) return;
    const text = [session.currentActivity.instruction, session.currentActivity.question?.prompt].filter(Boolean).join("。 ");
    setSubtitle(captions ? text : "");
    const started = speakPrivateTutorText(text, {
      rate,
      onStart: () => { setSpeaking(true); recordVoiceEvent("playback_started"); },
      onEnd: () => { setSpeaking(false); recordVoiceEvent("playback_completed"); },
    });
    if (!started) setVoiceMessage("当前设备不能语音播报，字幕仍然可以使用");
  }

  function narrateVisualStep(text: string, onEnd: () => void) {
    setSubtitle(captions ? text : "");
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      setSpeaking(false);
      recordVoiceEvent("playback_completed");
      onEnd();
    };
    const started = speakPrivateTutorText(text, {
      rate: speechRate,
      onStart: () => { setSpeaking(true); recordVoiceEvent("playback_started"); },
      onEnd: finish,
    });
    if (!started) setSpeaking(false);
    return started;
  }

  function stopPlayback() {
    if (interruptPrivateTutorSpeech()) recordVoiceEvent("playback_interrupted", "student_stop");
    setSpeaking(false);
  }

  async function start() {
    setBusy(true);
    setMessage("");
    setMessage(await onStart(pace) ?? "");
    setBusy(false);
  }

  async function pause() {
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    setListening(false);
    stopPlayback();
    setBusy(true);
    setMessage(await onPause() ?? "");
    setBusy(false);
  }

  async function resume() {
    setBusy(true);
    setMessage(await onResume() ?? "");
    setBusy(false);
  }

  async function simpleAction(action: "continue" | "hint") {
    setBusy(true);
    setMessage("");
    const result = await onAction({ action });
    setMessage(result.error ?? "");
    setBusy(false);
  }

  async function submit(responseKind: "answer" | "dont_know", rawAnswer = answer, source: "screen" | "visual" = "screen") {
    const question = session?.currentActivity?.question;
    if (!question) return;
    if (responseKind === "answer" && !rawAnswer.trim()) {
      setMessage("先写下答案，或者点“我还不会”。");
      return;
    }
    setBusy(true);
    setMessage("");
    const result = await onAction({
      action: "answer",
      idempotencyKey: attemptKeyRef.current,
      questionRevisionId: question.revisionId,
      rawAnswer,
      responseKind,
      source,
    });
    if (result.error) setMessage(result.error);
    else if (result.evidenceEligible === false) {
      const feedback = formatPrivateTutorEvaluationFeedback(result.evaluation);
      setMessage(feedback
        ? `${feedback} 当前结果需要补充或复核，不会计入掌握度。`
        : "已生成练习反馈，但当前结果需要补充或复核，不会计入掌握度。");
      attemptKeyRef.current = newClientKey("tutoring");
    }
    else if (result.correct === false) {
      setMessage(formatPrivateTutorEvaluationFeedback(result.evaluation) ?? "没关系，这次答案会帮助我换一种更合适的讲法。");
      attemptKeyRef.current = newClientKey("tutoring");
    }
    setBusy(false);
  }

  if (!session) {
    return (
      <div className="grid gap-5 lg:grid-cols-[1.45fr_0.75fr]">
        <section className="rounded-3xl bg-emerald-600 p-6 text-white shadow-sm sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-emerald-100">下午好，{state.learner.displayName}</p>
              <h1 className="mt-2 max-w-xl text-2xl font-bold leading-tight sm:text-3xl">今天一起学会“{strategyDecision?.targetTitle ?? learningPlan?.days[0]?.knowledgeTitle ?? "今天这一小步"}”</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-emerald-50">{strategyDecision?.studentReason ?? "我会从你现在最需要的一小步开始，随时可以暂停。"}</p>
            </div>
            <Sparkles className="size-9 shrink-0 text-amber-200" aria-hidden="true" />
          </div>
          <div className="mt-7 flex flex-wrap gap-2">
            {(["easy", "standard", "review"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setPace(value)}
                className={cn("rounded-full px-3 py-1.5 text-xs font-medium transition", pace === value ? "bg-white text-emerald-800" : "bg-emerald-700/70 text-emerald-50 hover:bg-emerald-700")}
              >
                {{ easy: "轻松学 5 分钟", standard: `按我的设置 ${dailyTargetMinutes} 分钟`, review: "今天只复习 10 分钟" }[value]}
              </button>
            ))}
          </div>
          <button type="button" disabled={busy || !learningPlan} onClick={() => void start()} className="mt-7 inline-flex min-h-12 items-center gap-2 rounded-xl bg-amber-300 px-5 font-semibold text-amber-950 shadow-sm transition hover:bg-amber-200 disabled:opacity-60">
            {busy ? "正在准备…" : "开始今天的学习"} <ChevronRight className="size-5" />
          </button>
        </section>

        <div className="grid gap-4">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium"><Clock3 className="size-4 text-emerald-600" />今日进度</span>
              <span className="text-sm font-bold text-emerald-700">{state.dailyMinutes} / {dailyTargetMinutes} 分钟</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${dailyProgress}%` }} /></div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">随时可以暂停，明天会从这里继续，不会显示“失败”。</p>
          </Card>
          <Card className="p-5">
            <p className="flex items-center gap-2 text-sm font-medium"><BrainCircuit className="size-4 text-violet-500" />计划为什么这样排？</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{strategyDecision?.studentReason ?? "最近两次作答都只改变了等式一边。这次先用天平重新理解，而不是继续刷同类题。"}</p>
            <span className="mt-3 inline-flex rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-200">{strategyLabel(strategyDecision?.strategy ?? "concept_rebuild")}</span>
          </Card>
        </div>
        {message ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 lg:col-span-2">{message}</p> : null}
        {learningPlan ? <SevenDayPlan plan={learningPlan} onReschedule={onReschedule} /> : null}
      </div>
    );
  }

  if (session.status === "completed" && session.summary) {
    return (
      <section className="mx-auto max-w-2xl py-6 text-center">
        <span className="mx-auto grid size-20 place-items-center rounded-full bg-emerald-100 text-emerald-700"><Star className="size-10 fill-current" /></span>
        <h1 className="mt-5 text-2xl font-bold">今天这一小步完成了</h1>
        <p className="mt-2 text-muted-foreground">{session.summary.learned}</p>
        <Card className="mt-6 grid gap-4 p-5 text-left sm:grid-cols-3">
          <GentleStat value={session.summary.independentCompleted ? "独立完成" : "辅助完成"} label="新题复测" />
          <GentleStat value={`${session.summary.evidenceCount}`} label="新增学习证据" />
          <GentleStat value={session.summary.methodSwitchCount ? `${session.summary.methodSwitchCount} 次` : "不需要"} label="换方法" />
        </Card>
        <p className="mt-5 rounded-xl bg-sky-50 p-4 text-sm text-sky-900 dark:bg-sky-950 dark:text-sky-100">{session.summary.nextStep}</p>
        <Button variant="secondary" className="mt-5" disabled={busy} onClick={() => void start()}>{busy ? "正在准备…" : "再开始一节新的学习"}</Button>
      </section>
    );
  }

  if (session.status === "paused") {
    return (
      <Card className="mx-auto max-w-2xl p-7 text-center">
        <CirclePause className="mx-auto size-10 text-emerald-600" />
        <h1 className="mt-4 text-2xl font-bold">课程停在原来的位置</h1>
        <p className="mt-2 text-sm text-muted-foreground">回来时不用重做，也不会显示失败。</p>
        <Button className="mt-6" disabled={busy} onClick={() => void resume()}>{busy ? "正在恢复…" : "从这里继续"}</Button>
        {message ? <p role="alert" className="mt-4 text-sm text-rose-700">{message}</p> : null}
      </Card>
    );
  }

  const current = session.currentActivity;
  if (!current) return null;
  const activityLabels: Record<PrivateTutorSession["progress"][number]["kind"], string> = {
    recall: "回想一下",
    explain: "私教讲解",
    guided_practice: "一起练习",
    independent_check: "独立新题",
    summary: "学习总结",
  };
  const completedActivities = session.progress.filter((item) => item.status === "completed").length;

  return (
    <div className="grid gap-5">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-emerald-700">{activityLabels[current.kind]} · 约 {current.budgetMinutes} 分钟</p>
            <h1 className="mt-1 text-xl font-bold">{session.targetTitle}</h1>
          </div>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void pause()}><CirclePause />暂停一下</Button>
        </div>
        <div className="mt-4 grid grid-cols-5 gap-2" aria-label="今日课程进度">
          {session.progress.map((item, index) => <div key={item.kind} className={cn("h-2 rounded-full", index < completedActivities ? "bg-emerald-500" : index === session.currentActivityIndex ? "bg-amber-400" : "bg-muted")} />)}
        </div>
      </Card>
      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
      <Card className="overflow-hidden">
        <div className="border-b bg-amber-50/70 px-5 py-4 dark:bg-amber-950/20">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">{activityLabels[current.kind]}</p>
              <h2 className="mt-1 text-xl font-bold">每天只完成眼前这一小步</h2>
            </div>
          </div>
        </div>
        <div className="p-5 sm:p-7">
          {current.visualScene ? (
            <PrivateTutorVisualBoard
              scene={current.visualScene}
              reducedMotion={reducedMotion}
              disabled={busy}
              onNarrate={narrateVisualStep}
              onStopNarration={stopPlayback}
              onAnswer={(value) => void submit("answer", value, "visual")}
            />
          ) : <div className="grid min-h-48 place-items-center rounded-2xl border bg-sky-50 text-center dark:bg-sky-950/30"><div><BrainCircuit className="mx-auto size-10 text-sky-600" /><p className="mt-3 font-semibold">使用静态步骤继续学习</p></div></div>}
          <div className="mt-5 rounded-2xl bg-muted/60 p-4">
            <p className="flex gap-2 text-sm leading-6"><Volume2 className="mt-1 size-4 shrink-0 text-emerald-600" />{current.instruction}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => speaking ? stopPlayback() : speakCurrent()}>{speaking ? <MicOff /> : <Volume2 />}{speaking ? "停止播放" : "读给我听"}</Button>
              <button type="button" className="rounded-md px-3 text-xs text-muted-foreground hover:bg-muted" onClick={() => { const nextRate = speechRate === 1 ? 0.78 : 1; setSpeechRate(nextRate); }}>{speechRate < 1 ? "慢速" : "正常语速"}</button>
            </div>
            {subtitle ? <p aria-live="polite" className="mt-3 rounded-lg bg-card px-3 py-2 text-xs leading-5 text-muted-foreground">字幕：{subtitle}</p> : null}
          </div>
          {session.intervention ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">{session.intervention.message}</p> : null}
          {current.kind === "explain" ? <Button className="mt-5" disabled={busy} onClick={() => void simpleAction("continue")}>我理解了，继续</Button> : null}
          {current.kind === "summary" ? (
            <div className="mt-5">
              <p className="text-sm text-muted-foreground">今天的答案已安全记入自己的学习记录。完成总结后，明天会从新的复习题继续。</p>
              <Button className="mt-4" disabled={busy} onClick={() => void simpleAction("continue")}>{busy ? "正在保存…" : "完成今天的学习"}</Button>
            </div>
          ) : null}
          {current.question ? (
            <div className="mt-5">
              <p className="text-base font-semibold">{current.question.prompt}</p>
              {current.question.sourceRefs?.length ? <p className="mt-2 text-xs text-muted-foreground">来源位置：{current.question.sourceRefs.map((ref) => `${ref.sectionId}${ref.pageNumber ? ` · 第 ${ref.pageNumber} 页` : ""}`).join("；")}</p> : null}
              {current.question.options ? <div className="mt-3 grid gap-2">{current.question.options.map((option) => <button key={option.id} type="button" disabled={busy} onClick={() => { setAnswer(option.id); void submit("answer", option.id); }} className="min-h-12 rounded-xl border-2 bg-card px-4 text-left text-sm font-medium hover:border-emerald-400 disabled:opacity-60">{option.label}</button>)}</div> : <div className="mt-3 flex flex-wrap items-end gap-3"><textarea value={answer} onChange={(event) => setAnswer(event.target.value.slice(0, 4000))} aria-label="写下答案" rows={current.question.kind === "numeric" ? 2 : 5} className="min-w-48 flex-1 resize-y rounded-xl border bg-card px-4 py-3 font-mono text-base" placeholder={current.question.kind === "math_steps" ? "每行写一个步骤，或用 => 分隔" : current.question.kind === "code" ? "写下受限函数或 return 表达式" : "写下你的答案"} /><Button className="min-h-12" disabled={busy} onClick={() => void submit("answer")}>{busy ? "正在检查…" : "提交答案"}</Button></div>}
              {current.hint ? <p className="mt-3 rounded-lg bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-950 dark:text-sky-100">提示 {current.hintLevel}：{current.hint}</p> : null}
              {message ? <p role="status" className="mt-3 rounded-lg bg-muted p-3 text-sm">{message}</p> : null}
            </div>
          ) : null}
        </div>
      </Card>

      <aside className="grid content-start gap-4">
        <Card className="p-5">
          <p className="text-sm font-semibold">可以说，也可以点</p>
          {voiceEnabled ? <>
            <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-muted/60 p-1" aria-label="语音交互模式">
              {(["push_to_talk", "hands_free"] as const).map((mode) => <button key={mode} type="button" disabled={listening} onClick={() => { setVoiceMode(mode); recordVoiceEvent("mode_changed", mode); }} className={cn("rounded-lg px-2 py-2 text-xs font-medium", voiceMode === mode ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>{mode === "push_to_talk" ? "点按说话" : "自由对话"}</button>)}
            </div>
            <button type="button" onClick={() => void toggleVoice()} className={cn("mt-4 flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed transition", listening ? "border-rose-400 bg-rose-50 text-rose-700 dark:bg-rose-950" : "border-emerald-300 bg-emerald-50/70 text-emerald-800 dark:bg-emerald-950")}>{listening ? <MicOff className="size-7" /> : <Mic className="size-7" />}<span className="text-sm font-medium">{listening ? "停止聆听" : "开始说话"}</span></button>
          </> : <p className="mt-3 rounded-xl bg-muted p-4 text-sm text-muted-foreground">你已在“我的设置”中选择纯文字学习，语音输入已关闭。</p>}
          {interimTranscript ? <p className="mt-3 rounded-lg bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-950 dark:text-sky-100">正在识别：{interimTranscript}</p> : null}
          <p role="status" className="mt-3 text-xs leading-5 text-muted-foreground">{voiceMessage}</p>
          {pendingVoiceTurn ? (
            <div className={cn("mt-3 rounded-xl border p-3", pendingVoiceTurn.requiresConfirmation ? "border-amber-300 bg-amber-50 dark:bg-amber-950" : "border-emerald-300 bg-emerald-50 dark:bg-emerald-950")}>
              <p className="text-xs text-muted-foreground">我听到：{pendingVoiceTurn.transcript}</p>
              <p className="mt-1 text-base font-semibold">数学表达：{pendingVoiceTurn.normalizedExpression ?? "暂时无法确认"}</p>
              {pendingVoiceTurn.requiresConfirmation ? <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">识别把握不足或存在不同候选，确认前不会判题，也不会影响掌握度。</p> : null}
              <div className="mt-3 flex gap-2">
                <Button size="sm" disabled={busy || !pendingVoiceTurn.normalizedExpression} onClick={() => void confirmVoiceAnswer()}><Check />就是这个</Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setPendingVoiceTurn(null); setAnswer(""); void toggleVoice(); }}>重新说</Button>
              </div>
            </div>
          ) : null}
          <p className="mt-3 text-[11px] leading-4 text-muted-foreground">本站后端不接收或保存原始音频；浏览器语音服务可能按设备设置处理音频。口音、音色和流利度不会作为掌握度证据。</p>
        </Card>
        <Card className="p-5">
          <p className="flex items-center gap-2 text-sm font-semibold"><Heart className="size-4 text-rose-500" />卡住了也没关系</p>
          <div className="mt-3 grid gap-2">
            {current.question ? <Button variant="secondary" className="justify-start" disabled={busy || current.hintLevel >= 3} onClick={() => void simpleAction("hint")}><BrainCircuit />给我一点提示</Button> : null}
            {current.question ? <Button variant="secondary" className="justify-start" disabled={busy} onClick={() => void submit("dont_know", "")}><Heart />我还不会</Button> : null}
            <Button variant="secondary" className="justify-start" onClick={() => { setSpeechRate(0.78); speakCurrent(0.78); }}><Volume2 />说慢一点</Button>
          </div>
          {current.kind === "independent_check" ? <p className="mt-3 text-xs leading-5 text-muted-foreground">这道题与刚才不同。看提示后仍会保留证据，但会记作辅助完成。</p> : null}
        </Card>
      </aside>
      </div>
    </div>
  );
}

function SevenDayPlan({ plan, onReschedule }: { plan: PrivateTutorLearningPlan; onReschedule: () => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);

  async function reschedule() {
    setBusy(true);
    setMessage("");
    const error = await onReschedule();
    setHasError(Boolean(error));
    setMessage(error ?? "已经顺延好了。今天没有失败，从最合适的位置继续就可以。" );
    setBusy(false);
  }

  return (
    <Card className="p-5 lg:col-span-2 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">我的 7 天计划</p>
          <h2 className="mt-1 text-lg font-bold">每天只看今天这一小步</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">{plan.studentReason}</p>
        </div>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void reschedule()}>{busy ? "正在调整…" : "今天来不及，帮我顺延"}</Button>
      </div>
      <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
        {plan.days.map((day) => (
          <div key={`${plan.id}-${day.dayIndex}`} className={cn("rounded-xl border p-3", day.status === "completed" ? "border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950" : day.status === "in_progress" ? "border-sky-400 bg-sky-50 dark:bg-sky-950" : "bg-card")}>
            <p className="text-[11px] font-medium text-muted-foreground">{day.status === "completed" ? "已完成" : day.status === "in_progress" ? "正在学习" : `第 ${day.dayIndex} 天`}</p>
            <p className="mt-2 text-sm font-semibold leading-5">{day.title}</p>
            <p className="mt-2 text-[11px] text-muted-foreground">{day.minutes} 分钟</p>
          </div>
        ))}
      </div>
      {message ? <p role="status" className={cn("mt-3 rounded-lg p-3 text-sm", hasError ? "bg-rose-50 text-rose-700 dark:bg-rose-950" : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950")}>{message}</p> : null}
    </Card>
  );
}

function KnowledgeMap({ state, learnerModel }: { state: LearnerTutorState; learnerModel: PrivateTutorLearnerModel | null }) {
  const tone = { mastered: "border-emerald-400 bg-emerald-50", learning: "border-sky-400 bg-sky-50", needs_support: "border-amber-400 bg-amber-50", unknown: "border-slate-300 bg-slate-50" };
  const label = { mastered: "已经掌握", learning: "正在学习", needs_support: "需要帮助", unknown: "尚未测到" };
  return (
    <section>
      <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{state.learner.curriculum}</p>
      <h1 className="mt-1 text-2xl font-bold">我的知识地图</h1>
      <p className="mt-2 text-sm text-muted-foreground">它不是成绩单，而是一张“下一步怎么学”的地图。没有证据的地方会显示尚未测到。</p>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {state.knowledge.map((node, index) => {
          const modelNode = learnerModel?.knowledge.find((item) => item.id === node.id);
          return (
            <Card key={node.id} className={cn("relative overflow-hidden border-2 p-5", tone[node.level])}>
              <span className="absolute right-4 top-3 text-5xl font-black text-foreground/5">{index + 1}</span>
              <div className="relative">
                <span className="rounded-full bg-card/80 px-2.5 py-1 text-xs font-medium">{label[node.level]}</span>
                <h2 className="mt-4 text-lg font-bold">{node.title}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{node.evidence}</p>
                {modelNode?.misconception ? <p className="mt-3 rounded-lg bg-card/70 p-3 text-sm">最近卡在：{modelNode.misconception.label}</p> : null}
                {modelNode?.prerequisiteGap ? <p className="mt-2 text-sm font-medium text-amber-800 dark:text-amber-200">先补稳前面的知识，后面会更容易。</p> : null}
                {modelNode && modelNode.forgettingRisk >= 0.5 ? <p className="mt-2 text-sm font-medium text-sky-800 dark:text-sky-200">到了回想复习的时间，花几分钟就好。</p> : null}
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/70 dark:bg-black/20"><div className="h-full rounded-full bg-current opacity-55" style={{ width: node.mastery === null ? "0%" : `${Math.round(node.mastery * 100)}%` }} /></div>
                <p className="mt-2 text-xs text-muted-foreground">{node.mastery === null ? "等待后续学习证据" : `当前掌握证据 ${Math.round(node.mastery * 100)}%${modelNode ? ` · 证据把握 ${Math.round(modelNode.confidence * 100)}%` : ""}`}</p>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function ErrorBook({ state, reviewBook, onReviewBookChange, onSnapshot }: {
  state: LearnerTutorState;
  reviewBook: PrivateTutorReviewBook | null;
  onReviewBookChange: (reviewBook: PrivateTutorReviewBook) => void;
  onSnapshot: (snapshot: PrivateTutorSnapshot) => void;
}) {
  const [activeThemeId, setActiveThemeId] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [correction, setCorrection] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const answerKey = useRef(newClientKey("review"));
  const questionStartedAt = useRef(Date.now());
  const themes = reviewBook?.themes ?? [];

  function beginReview(themeId: string) {
    setActiveThemeId(themeId);
    setAnswer("");
    setMessage("");
    answerKey.current = newClientKey("review");
    questionStartedAt.current = Date.now();
  }

  async function submitReview(theme: PrivateTutorReviewBook["themes"][number], responseKind: "answer" | "dont_know") {
    const schedule = theme.schedule;
    const question = schedule?.question;
    if (!schedule || !question || !schedule.due) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await answerPrivateTutorReview(schedule.id, {
        idempotencyKey: answerKey.current,
        questionRevisionId: question.revisionId,
        rawAnswer: answer,
        responseKind,
        source: "screen",
        durationSeconds: Math.max(1, Math.round((Date.now() - questionStartedAt.current) / 1000)),
      });
      onReviewBookChange(result.reviewBook);
      onSnapshot(result.snapshot);
      setAnswer("");
      answerKey.current = newClientKey("review");
      questionStartedAt.current = Date.now();
      const updated = result.reviewBook.themes.find((item) => item.id === theme.id);
      setMessage(updated?.status === "mastered" ? "这类问题已经攻克。以后如果再次遇到，它仍会回到这里。" : "这一小步完成了，下一题会换一种方式确认你真的理解了。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "这次复习暂时没有保存，请重试。");
    } finally {
      setBusy(false);
    }
  }

  async function saveDiagnosis(themeId: string) {
    if (!correction.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      onReviewBookChange(await correctPrivateTutorReviewDiagnosis(themeId, correction));
      setCorrection("");
      setMessage("已按你的说法修正错因记录。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "错因修正暂时没有保存。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <p className="text-sm font-medium text-rose-600">只属于 {state.learner.displayName}</p>
      <h1 className="mt-1 text-2xl font-bold">我的错题本</h1>
      <p className="mt-2 text-sm text-muted-foreground">不堆积做错的题，只保留真正需要攻克的错因和复习时间。</p>
      {reviewBook ? <div className="mt-5 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-amber-100 px-3 py-1.5 text-amber-900">今天再挑战 {reviewBook.counts.challengeToday}</span><span className="rounded-full bg-sky-100 px-3 py-1.5 text-sky-900">正在攻克 {reviewBook.counts.working}</span><span className="rounded-full bg-emerald-100 px-3 py-1.5 text-emerald-900">已经攻克 {reviewBook.counts.mastered}</span></div> : null}
      <div className="mt-6 grid gap-4">
        {!themes.length ? (
          <Card className="border-dashed p-6 text-center">
            <BookHeart className="mx-auto size-8 text-emerald-600" />
            <p className="mt-3 font-medium">现在还没有需要复习的错题</p>
            <p className="mt-1 text-sm text-muted-foreground">以后遇到真正没弄懂的地方，我会帮你放到这里。</p>
          </Card>
        ) : null}
        {themes.map((item) => {
          const reviewing = activeThemeId === item.id;
          const question = item.schedule?.question;
          return <Card key={item.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", item.status === "mastered" ? "bg-emerald-100 text-emerald-800" : item.status === "challenge_today" ? "bg-amber-100 text-amber-900" : "bg-sky-100 text-sky-800")}>{item.status === "mastered" ? "已经攻克" : item.status === "challenge_today" ? "今天再挑战" : "正在攻克"}</span>
                <h2 className="mt-3 text-lg font-bold">{item.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">真正的错因：{item.misconception}</p>
                {item.learnerDiagnosisCorrection ? <p className="mt-2 text-sm text-emerald-800 dark:text-emerald-200">你的补充：{item.learnerDiagnosisCorrection}</p> : null}
                <p className="mt-2 text-xs text-muted-foreground">教学方法：{strategyLabel(item.strategy)} · 出现 {item.occurrenceCount} 次{item.reopenedCount ? ` · 重新挑战 ${item.reopenedCount} 次` : ""}</p>
              </div>
              {item.status === "challenge_today" && item.schedule?.due ? <Button variant="secondary" onClick={() => beginReview(item.id)}>{reviewing ? "正在复习" : "开始纠正"}</Button> : item.status === "mastered" ? <span className="flex items-center gap-1 text-sm font-medium text-emerald-700"><Check className="size-4" />已经攻克</span> : <span className="flex items-center gap-1 text-sm text-sky-700"><Clock3 className="size-4" />等待间隔复查</span>}
            </div>
            {reviewing && question && item.schedule?.due ? (
              <div className="mt-5 rounded-xl border bg-muted/35 p-4">
                <p className="text-xs font-medium text-emerald-700">{reviewPhaseLabel(item.schedule.phase)}</p>
                <p className="mt-2 text-lg font-semibold">{question.prompt}</p>
                {question.sourceRefs?.length ? <p className="mt-2 text-xs text-muted-foreground">来源位置：{question.sourceRefs.map((ref) => `${ref.sectionId}${ref.pageNumber ? ` · 第 ${ref.pageNumber} 页` : ""}`).join("；")}</p> : null}
                {question.kind === "choice" && question.options ? <div className="mt-4 grid gap-2">{question.options.map((option) => <button key={option.id} type="button" disabled={busy} onClick={() => setAnswer(option.id)} className={cn("rounded-lg border p-3 text-left text-sm", answer === option.id ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950" : "bg-card")}><span className="mr-2 font-bold uppercase">{option.id}</span>{option.label}</button>)}</div> : <input value={answer} disabled={busy} onChange={(event) => setAnswer(event.target.value.slice(0, 80))} onKeyDown={(event) => { if (event.key === "Enter" && answer.trim()) void submitReview(item, "answer"); }} aria-label="复习答案" placeholder="写下你的答案" autoComplete="off" className="mt-4 h-12 w-full rounded-lg border bg-card px-3 text-lg font-semibold" />}
                <div className="mt-4 flex flex-wrap justify-between gap-2"><Button variant="ghost" disabled={busy} onClick={() => void submitReview(item, "dont_know")}>我还没想明白</Button><Button disabled={busy || !answer.trim()} onClick={() => void submitReview(item, "answer")}>{busy ? "正在保存…" : "提交答案"}</Button></div>
                <div className="mt-4 border-t pt-4"><p className="text-xs text-muted-foreground">如果系统理解错了你的卡点，可以用自己的话修正：</p><div className="mt-2 flex flex-wrap gap-2"><input value={correction} onChange={(event) => setCorrection(event.target.value.slice(0, 240))} placeholder="例如：方法会了，只是刚才算错了" className="h-9 min-w-60 flex-1 rounded-md border bg-card px-3 text-sm" /><Button size="sm" variant="secondary" disabled={busy || !correction.trim()} onClick={() => void saveDiagnosis(item.id)}>修正错因</Button></div></div>
              </div>
            ) : null}
          </Card>;
        })}
      </div>
      {message ? <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">{message}</p> : null}
    </section>
  );
}

function reviewPhaseLabel(phase: "correction" | "similar" | "variation" | "delayed") {
  return { correction: "先把原题讲清楚", similar: "换一道同类题", variation: "再试一道变式题", delayed: "间隔一天再确认" }[phase];
}

function Growth({ state: _state }: { state: LearnerTutorState }) {
  const [history, setHistory] = useState<PrivateTutorLearningHistory | null>(null);
  const [selectedPackageKey, setSelectedPackageKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    void getPrivateTutorLearningHistory()
      .then((value) => {
        if (!current) return;
        setHistory(value);
        setSelectedPackageKey((selected) => value.packages.some((item) => historyPackageKey(item) === selected)
          ? selected
          : value.packages[0] ? historyPackageKey(value.packages[0]) : "");
      })
      .catch((loadError) => {
        if (!current) return;
        setError(loadError instanceof Error ? loadError.message : "暂时无法读取学习历史。");
      })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [loadAttempt]);

  const selectedPackage = history?.packages.find((item) => historyPackageKey(item) === selectedPackageKey)
    ?? history?.packages[0]
    ?? null;
  return (
    <section>
      <p className="text-sm font-medium text-violet-600">看见自己的进步</p>
      <h1 className="mt-1 text-2xl font-bold">我的成长</h1>
      <p className="mt-2 text-sm text-muted-foreground">这里没有排名，只按教材版本和章节记录真实完成情况、独立作答与复习安排。</p>
      {loading ? <p className="mt-6 text-sm text-muted-foreground">正在整理学习历史…</p> : null}
      {error ? <Card className="mt-6 border-amber-200 p-5"><p role="alert" className="text-sm text-amber-800 dark:text-amber-200">{error}</p><Button className="mt-3" size="sm" variant="secondary" onClick={() => setLoadAttempt((value) => value + 1)}>重新读取</Button></Card> : null}
      {!loading && !error && history ? (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <Card className="p-5"><GentleStat value={formatHistoryRate(history.summary.planDayCompletionRate)} label={`已完成 ${history.summary.completedPlanDayCount}/${history.summary.startedPlanDayCount} 个开始过的计划日`} /></Card>
            <Card className="p-5"><GentleStat value={formatHistoryRate(history.summary.independentCorrectRate)} label={`独立正确 ${history.summary.independentCorrectCount}/${history.summary.independentAttemptCount} 次`} /></Card>
            <Card className="p-5"><GentleStat value={`${history.summary.dueReviewCount}`} label="已经到期、等待回想的复习" /></Card>
          </div>
          {history.packages.length === 0 ? (
            <Card className="mt-5 p-6 text-center"><BookHeart className="mx-auto size-9 text-violet-500" /><p className="mt-3 font-medium">完成第一段学习后，这里会出现章节历史</p><p className="mt-1 text-sm text-muted-foreground">摸底、练习和会话记录不会被虚构成进度。</p></Card>
          ) : (
            <>
              <Card className="mt-5 p-5">
                <label className="text-sm font-medium">查看教材与版本
                  <select value={selectedPackage ? historyPackageKey(selectedPackage) : ""} onChange={(event) => setSelectedPackageKey(event.target.value)} className="mt-2 h-11 w-full rounded-lg border bg-card px-3 font-normal sm:max-w-xl">
                    {history.packages.map((item) => <option key={historyPackageKey(item)} value={historyPackageKey(item)}>{item.packageName} · v{item.packageVersion}</option>)}
                  </select>
                </label>
                {selectedPackage ? <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground"><span className="rounded-full bg-muted px-3 py-1.5">{selectedPackage.activationCount} 次学习入口</span><span className="rounded-full bg-muted px-3 py-1.5">{selectedPackage.summary.practiceAttemptCount} 次作答</span><span className="rounded-full bg-muted px-3 py-1.5">{selectedPackage.summary.eligibleEvidenceCount} 条有效证据</span>{selectedPackage.summary.sourceRubric.attemptCount > 0 ? <span className="rounded-full bg-muted px-3 py-1.5">来源量表复核 {formatHistoryRate(selectedPackage.summary.sourceRubric.reviewCompletionRate)}{selectedPackage.summary.sourceRubric.pendingReviewCount ? ` · 待复核 ${selectedPackage.summary.sourceRubric.pendingReviewCount}` : ""}</span> : null}{!selectedPackage.contentDefinitionAvailable ? <span className="rounded-full bg-amber-100 px-3 py-1.5 text-amber-900">当前缺少该旧版本的章节定义</span> : null}</div> : null}
              </Card>
              {selectedPackage ? (
                <div className="mt-5 grid gap-4">
                  {selectedPackage.chapters.map((chapter) => (
                    <Card key={chapter.moduleId} className="p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-medium text-violet-600">章节学习历史</p><h2 className="mt-1 font-semibold">{chapter.moduleName}</h2><p className="mt-1 text-xs text-muted-foreground">{chapter.topics.map((topic) => topic.topicName).join(" · ") || "旧版本章节"}</p></div><span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{chapter.summary.completedSessionCount} 次完整学习</span></div>
                      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
                        <HistoryMetric label="开始过的计划日" value={`${chapter.summary.completedPlanDayCount}/${chapter.summary.startedPlanDayCount}`} />
                        <HistoryMetric label="证据有效率" value={formatHistoryRate(chapter.summary.evidenceEligibilityRate)} />
                        <HistoryMetric label="独立正确率" value={formatHistoryRate(chapter.summary.independentCorrectRate)} />
                        <HistoryMetric label="到期复习" value={`${chapter.summary.review.dueCount}`} />
                      </div>
                      {chapter.summary.currentPlan.scheduledDays > 0 ? <p className="mt-4 text-xs text-muted-foreground">当前计划：完成 {chapter.summary.currentPlan.completedDays}/{chapter.summary.currentPlan.scheduledDays} 天，进行中 {chapter.summary.currentPlan.inProgressDays} 天。</p> : null}
                    </Card>
                  ))}
                  {selectedPackage.recentSessions.length > 0 ? <Card className="p-5"><h2 className="font-semibold">最近学习记录</h2><div className="mt-3 divide-y">{selectedPackage.recentSessions.slice(0, 5).map((session) => <div key={session.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><div><p className="font-medium">{session.knowledgeTitle}</p><p className="text-xs text-muted-foreground">{session.moduleName} · {formatHistoryDate(session.completedAt ?? session.startedAt)}</p></div><span className="text-xs text-muted-foreground">练习 {session.practiceCount} 次 · 证据 {session.evidenceCount} 条</span></div>)}</div></Card> : null}
                </div>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </section>
  );
}

function HistoryMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-muted/55 p-3"><p className="font-semibold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{label}</p></div>;
}

function historyPackageKey(item: { packageId: string; packageVersion: string }) {
  return `${item.packageId}@${item.packageVersion}`;
}

function formatHistoryRate(value: number | null) {
  return value == null ? "暂无" : `${Math.round(value * 100)}%`;
}

function formatHistoryDate(value: string | null) {
  if (!value) return "时间未记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未记录" : date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function GentleStat({ value, label }: { value: string; label: string }) {
  return <div><p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{value}</p><p className="mt-1 text-xs text-muted-foreground">{label}</p></div>;
}

function privateTutorOcrReasonLabel(reason: string | null | undefined) {
  if (!reason) return "";
  if (reason === "workflow_ocr_platform_unsupported") return "当前系统没有可用的本地 OCR 提供器";
  if (reason === "workflow_ocr_disabled") return "本地 OCR 已被关闭";
  if (reason === "workflow_ocr_provider_unavailable") return "本地 OCR 尚未安装或不可用";
  if (reason === "workflow_ocr_timeout") return "本地 OCR 处理超时";
  return "本地 OCR 未能完成识别";
}

function TutorSettings({ state, preferences, onPreferencesChange, onPackageActivated, onProfileDeleted, initialSpace = "preferences" }: { state: LearnerTutorState; preferences: PrivateTutorLearningPreferences; onPreferencesChange: (patch: PrivateTutorLearningPreferencesPatch) => Promise<string | null>; onPackageActivated: (result: PrivateTutorPackageActivationResult) => void; onProfileDeleted: () => void; initialSpace?: TutorSettingsSpace }) {
  const [space, setSpace] = useState<TutorSettingsSpace>(initialSpace);
  const [preferenceBusy, setPreferenceBusy] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState("");
  const [goalDescription, setGoalDescription] = useState(preferences.learningGoal?.note ?? "");
  const [goalWeeklyMinutes, setGoalWeeklyMinutes] = useState(preferences.learningGoal?.weeklyMinutes?.toString() ?? "");
  const [goalTargetDate, setGoalTargetDate] = useState(preferences.learningGoal?.targetDate ?? "");
  const [packages, setPackages] = useState<LearningContentPackage[]>([]);
  const [activePackage, setActivePackage] = useState<LearningContentPackage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [materials, setMaterials] = useState<MaterialDocument[]>([]);
  const [activeDraft, setActiveDraft] = useState<{ material: MaterialDocument; draft: KnowledgeMapDraft } | null>(null);
  const [pendingPackage, setPendingPackage] = useState<LearningContentPackage | null>(null);
  const [entryMode, setEntryMode] = useState<"diagnostic" | "chapter">("diagnostic");
  const [startModuleId, setStartModuleId] = useState("");
  const selected = SETTINGS_SPACES.find((item) => item.key === space) ?? SETTINGS_SPACES[0];

  useEffect(() => {
    setGoalDescription(preferences.learningGoal?.note ?? "");
    setGoalWeeklyMinutes(preferences.learningGoal?.weeklyMinutes?.toString() ?? "");
    setGoalTargetDate(preferences.learningGoal?.targetDate ?? "");
  }, [preferences.revision, preferences.learningGoal]);

  async function savePreference(patch: PrivateTutorLearningPreferencesPatch, success = "学习偏好已保存。") {
    setPreferenceBusy(true);
    setPreferenceMessage("");
    const failure = await onPreferencesChange(patch);
    setPreferenceMessage(failure ?? success);
    setPreferenceBusy(false);
  }

  async function saveLearningGoal() {
    const description = goalDescription.trim();
    const weeklyMinutes = goalWeeklyMinutes ? Number(goalWeeklyMinutes) : null;
    await savePreference({
      learningGoal: description || weeklyMinutes || goalTargetDate
        ? { targetTopicIds: preferences.learningGoal?.targetTopicIds ?? [], note: description, weeklyMinutes, targetDate: goalTargetDate || null }
        : null,
    }, "学习目标已保存。后续计划会保留这个目标。" );
  }

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    void Promise.allSettled([listPrivateTutorContentPackages(), getPrivateTutorActiveContentPackage(), listPrivateTutorMaterials()])
      .then(([pkgsRes, activeRes, materialsRes]) => {
        if (!current) return;
        if (pkgsRes.status === "fulfilled") setPackages(pkgsRes.value);
        if (activeRes.status === "fulfilled") setActivePackage(activeRes.value);
        if (materialsRes.status === "fulfilled") setMaterials(materialsRes.value);
        if (pkgsRes.status === "rejected" || activeRes.status === "rejected") setError("无法加载内容包。");
        setLoading(false);
      });
    return () => { current = false; };
  }, []);

  async function handleMaterialUploaded(material: MaterialDocument) {
    setShowImport(false);
    setMaterials((prev) => [...prev.filter((item) => item.id !== material.id), material]);
    if (material.status !== "parsed") {
      const reason = privateTutorOcrReasonLabel(material.extraction?.ocr.reason);
      setError(material.status === "needs_ocr"
        ? `这份 PDF 没有足够的可提取文字，本机 OCR 暂时无法完成识别${reason ? `（${reason}）` : ""}。资料已保留，但不会生成错误的知识地图。`
        : "资料尚未解析完成，暂时不能生成知识地图。");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const draft = await generatePrivateTutorKnowledgeMapDraft(material.id, {
        packageName: material.fileName.replace(/\.[^/.]+$/, "") || "我的学习资料",
      });
      setActiveDraft({ material, draft });
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成知识地图草稿失败，请重试。");
    } finally {
      setLoading(false);
    }
  }

  async function handleDraftPublished(packageId: string) {
    setActiveDraft(null);
    setLoading(true);
    try {
      const [pkgs, active] = await Promise.all([listPrivateTutorContentPackages(), getPrivateTutorActiveContentPackage()]);
      setPackages(pkgs);
      setActivePackage(active);
      setError("");
      alert(`发布成功！已生成专属内容包: ${packageId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "刷新内容包失败。");
    } finally {
      setLoading(false);
    }
  }

  async function choosePackage(packageId: string) {
    setLoading(true);
    setError("");
    try {
      const pkg = await getPrivateTutorContentPackage(packageId);
      setPendingPackage(pkg);
      setEntryMode("diagnostic");
      setStartModuleId(pkg.modules?.[0]?.id ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法读取内容包，请重试。");
    } finally {
      setLoading(false);
    }
  }

  async function activatePackage() {
    if (!pendingPackage) return;
    if (entryMode === "chapter" && !startModuleId) {
      setError("请选择开始学习的章节。");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await activatePrivateTutorContentPackage({
        packageId: pendingPackage.id,
        entryMode,
        ...(entryMode === "chapter" ? { startModuleId } : {}),
      });
      setActivePackage(result.activePackage);
      setPendingPackage(null);
      onPackageActivated(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "内容包校准或激活失败，请检查内容后重试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">把私教调成适合我的样子</p>
      <h1 className="mt-1 text-2xl font-bold">我的设置</h1>
      <p className="mt-2 text-sm text-muted-foreground">学习内容、AI 老师和体验偏好都由我管理，不区分家长、孩子或后台角色。</p>
      <div className="mt-6 grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="grid content-start gap-2">
          {SETTINGS_SPACES.map((item) => (
            <button key={item.key} type="button" onClick={() => setSpace(item.key)} className={cn("rounded-xl border p-4 text-left transition", space === item.key ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950" : "bg-card hover:bg-muted/50")}>
              <div className="flex items-start justify-between gap-3"><span className="font-semibold">{item.title}</span><span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{item.audience}</span></div>
              <p className="mt-1 text-xs text-muted-foreground">{item.hint}</p>
            </button>
          ))}
        </div>
        <Card className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs text-muted-foreground">只影响我的私教体验</p><h2 className="mt-1 text-lg font-bold">{selected.title}</h2></div><UserRound className="size-6 text-emerald-600" /></div>
          {space === "preferences" ? (
            <div className="mt-6 grid gap-4">
              <PreferenceToggle label="显示实时字幕" hint="语音教学时同步显示文字" checked={preferences.captions} disabled={preferenceBusy} onChange={(value) => void savePreference({ captions: value })} />
              <PreferenceToggle label="减少动画" hint="使用静态图和单步切换，学习内容保持完整" checked={preferences.reducedMotion} disabled={preferenceBusy} onChange={(value) => void savePreference({ reducedMotion: value })} />
              <div className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
                <label className="text-sm font-medium">每天可用时间
                  <input aria-label="每天可用时间" type="number" min={5} max={180} value={preferences.dailyMinutes} disabled={preferenceBusy} onChange={(event) => void savePreference({ dailyMinutes: Number(event.target.value) }, "每日学习时长已保存，并会用于新计划和标准学习会话。") } className="mt-2 h-10 w-full rounded-lg border bg-card px-3 font-normal" />
                </label>
                <label className="text-sm font-medium">计划强度
                  <select aria-label="计划强度" value={preferences.planIntensity} disabled={preferenceBusy} onChange={(event) => void savePreference({ planIntensity: event.target.value as PrivateTutorLearningPreferences["planIntensity"] }, "计划强度已保存，将用于下一次生成或重排计划。") } className="mt-2 h-10 w-full rounded-lg border bg-card px-3 font-normal"><option value="relaxed">轻松</option><option value="standard">标准</option><option value="intensive">强化</option></select>
                </label>
              </div>
              <div className="grid gap-3 rounded-xl border p-4">
                <p className="text-sm font-medium">我的学习目标</p>
                <textarea aria-label="学习目标" value={goalDescription} disabled={preferenceBusy} onChange={(event) => setGoalDescription(event.target.value.slice(0, 200))} rows={3} placeholder="例如：六周内读完前三章，并能独立解释核心概念" className="w-full rounded-lg border bg-card p-3 text-sm" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-medium">每周投入分钟<input aria-label="每周投入分钟" type="number" min={5} max={180} value={goalWeeklyMinutes} disabled={preferenceBusy} onChange={(event) => setGoalWeeklyMinutes(event.target.value)} className="mt-1 h-9 w-full rounded-md border bg-card px-2 text-sm font-normal" /></label>
                  <label className="text-xs font-medium">目标日期<input aria-label="目标日期" type="date" value={goalTargetDate} disabled={preferenceBusy} onChange={(event) => setGoalTargetDate(event.target.value)} className="mt-1 h-9 w-full rounded-md border bg-card px-2 text-sm font-normal" /></label>
                </div>
                <Button size="sm" variant="secondary" disabled={preferenceBusy} onClick={() => void saveLearningGoal()}>保存学习目标</Button>
              </div>
              <div className="rounded-xl bg-muted/60 p-4"><p className="text-sm font-medium">当前学习档案</p><p className="mt-1 text-sm text-muted-foreground">{state.learner.displayName} · {state.learner.grade} · {state.learner.curriculum}</p></div>
              {preferenceMessage ? <p role="status" className="rounded-lg bg-muted p-3 text-sm">{preferenceMessage}</p> : null}
            </div>
          ) : null}
          {space === "content" ? (
            <div className="mt-6 grid gap-4">
              {loading ? <p className="text-sm text-muted-foreground">正在加载可用内容包…</p> : null}
              {error ? <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
              {activePackage ? (
                <div className="rounded-xl border border-emerald-300 bg-emerald-50/50 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">当前学习内容包</span>
                    <span className="rounded-full bg-emerald-200/60 px-2 py-0.5 text-[10px] text-emerald-900 dark:bg-emerald-900 dark:text-emerald-200">v{activePackage.version}</span>
                  </div>
                  <h3 className="mt-1 text-base font-bold">{activePackage.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{activePackage.targetAudience?.description || "通识与专业基础"}</p>
                </div>
              ) : null}
              {pendingPackage ? (
                <div className="rounded-xl border border-sky-300 bg-sky-50/60 p-4 dark:border-sky-900 dark:bg-sky-950/30">
                  <p className="text-sm font-semibold">如何开始“{pendingPackage.name}”</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">个人资料会先回放不足、发展中、熟练三档评分锚点；校准未通过时不会启动，也不会写入掌握证据。</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <label className={cn("cursor-pointer rounded-lg border p-3 text-sm", entryMode === "diagnostic" ? "border-sky-500 bg-card" : "bg-card/60")}>
                      <input className="mr-2 accent-sky-600" type="radio" name="package-entry-mode" checked={entryMode === "diagnostic"} onChange={() => setEntryMode("diagnostic")} />
                      先做练习模式摸底
                      <span className="mt-1 block text-xs text-muted-foreground">根据可验证作答生成七日计划。</span>
                    </label>
                    <label className={cn("cursor-pointer rounded-lg border p-3 text-sm", entryMode === "chapter" ? "border-sky-500 bg-card" : "bg-card/60")}>
                      <input className="mr-2 accent-sky-600" type="radio" name="package-entry-mode" checked={entryMode === "chapter"} onChange={() => setEntryMode("chapter")} />
                      从指定章节开始
                      <span className="mt-1 block text-xs text-muted-foreground">只确定学习起点，不假定已经掌握。</span>
                    </label>
                  </div>
                  {entryMode === "chapter" ? (
                    <label className="mt-3 block text-sm font-medium">开始章节
                      <select value={startModuleId} onChange={(event) => setStartModuleId(event.target.value)} className="mt-2 h-10 w-full rounded-lg border bg-card px-3 font-normal">
                        {(pendingPackage.modules ?? []).map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}
                      </select>
                    </label>
                  ) : null}
                  <div className="mt-4 flex gap-2">
                    <Button size="sm" disabled={loading} onClick={() => void activatePackage()}>{loading ? "正在校准…" : "校准并开始"}</Button>
                    <Button size="sm" variant="secondary" disabled={loading} onClick={() => setPendingPackage(null)}>取消</Button>
                  </div>
                </div>
              ) : null}
              <div className="mt-2 grid gap-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">选择学习内容</p>
                  <Button size="sm" variant="secondary" onClick={() => setShowImport(true)}>导入我的资料</Button>
                </div>
                {packages.map((pkg) => {                  const isActive = activePackage?.id === pkg.id;
                  return (
                    <div key={pkg.id} className={cn("flex flex-col justify-between gap-3 rounded-xl border p-4 sm:flex-row sm:items-center", isActive ? "border-emerald-500 bg-emerald-50/30 dark:bg-emerald-950/20" : "bg-card")}>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold">{pkg.name}</span>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{pkg.sourceType}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{pkg.targetAudience?.stage ?? "全部阶段"} · {pkg.sourceType === "user_material" ? "来源量表将在启动时校准" : pkg.evaluationCapabilities?.deterministicGrading ? "支持确定性判题" : "主观开放评估"}</p>
                      </div>
                      <Button size="sm" variant={isActive ? "secondary" : "primary"} disabled={loading || isActive} onClick={() => void choosePackage(pkg.id)}>
                        {isActive ? "正在学习" : "选择开始方式"}
                      </Button>
                    </div>
                  );
                })}
              </div>

              {materials.length > 0 ? (
                <div className="mt-4 rounded-xl border bg-muted/20 p-4">
                  <p className="text-sm font-medium">我的资料库</p>
                  <div className="mt-3 space-y-2">
                    {materials.map((m) => (
                      <div key={m.id} className="flex items-center justify-between rounded-lg border bg-card px-3 py-2 text-sm">
                        <div className="flex items-center gap-2 truncate">
                          <span className="truncate font-medium">{m.fileName}</span>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{m.fileType}</span>
                        </div>
                        <span className={cn("text-xs", m.status === "needs_ocr" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                          {m.status === "parsed" ? "已解析" : m.status === "needs_ocr" ? "需要本地 OCR" : m.status === "draft_ready" ? "草稿待确认" : m.status === "published" ? "已发布" : m.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {showImport ? (
                <PrivateTutorMaterialImport
                  onClose={() => setShowImport(false)}
                  onUploaded={(material) => void handleMaterialUploaded(material)}
                />
              ) : null}

              {activeDraft ? (
                <PrivateTutorDraftEditor
                  material={activeDraft.material}
                  draft={activeDraft.draft}
                  onClose={() => setActiveDraft(null)}
                  onPublished={(packageId) => void handleDraftPublished(packageId)}
                />
              ) : null}

              <PrivateTutorContentMigration />
            </div>
          ) : null}
          {space === "teacher" ? <div className="mt-6 grid gap-4">
            <label className="text-sm font-medium">老师的讲解方式<select aria-label="老师的讲解方式" value={preferences.teacherStyle} disabled={preferenceBusy} onChange={(event) => void savePreference({ teacherStyle: event.target.value as PrivateTutorLearningPreferences["teacherStyle"] })} className="mt-2 h-10 w-full rounded-lg border bg-card px-3 font-normal"><option value="heuristic_guidance">启发式引导</option><option value="direct_concept">直接讲清概念</option><option value="case_driven">案例驱动</option><option value="socratic_questioning">苏格拉底式追问</option></select></label>
            <label className="text-sm font-medium">讲解深度<select aria-label="讲解深度" value={preferences.explanationDepth} disabled={preferenceBusy} onChange={(event) => void savePreference({ explanationDepth: event.target.value as PrivateTutorLearningPreferences["explanationDepth"] })} className="mt-2 h-10 w-full rounded-lg border bg-card px-3 font-normal"><option value="concise_then_expand">先简洁，再展开</option><option value="from_foundations">从基础完整讲起</option><option value="key_difficulties_only">只讲关键难点</option><option value="professional_depth">按专业标准深入</option></select></label>
            <label className="text-sm font-medium">追问方式<select aria-label="追问方式" value={preferences.followUpStyle} disabled={preferenceBusy} onChange={(event) => void savePreference({ followUpStyle: event.target.value as PrivateTutorLearningPreferences["followUpStyle"] })} className="mt-2 h-10 w-full rounded-lg border bg-card px-3 font-normal"><option value="gentle_probe">温和追问理由</option><option value="direct_check">直接检查理解</option><option value="none">不主动追问</option></select></label>
            <label className="text-sm font-medium">语音偏好<select aria-label="语音偏好" value={preferences.voicePreference} disabled={preferenceBusy} onChange={(event) => void savePreference({ voicePreference: event.target.value as PrivateTutorLearningPreferences["voicePreference"] })} className="mt-2 h-10 w-full rounded-lg border bg-card px-3 font-normal"><option value="push_to_talk">点按说话</option><option value="hands_free">自由对话</option><option value="text_only">只用文字</option></select></label>
            <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">这些偏好会保存到账户，并影响新学习会话的讲解、追问和语音入口；判题与掌握证据仍保持不变。</div>
            {preferenceMessage ? <p role="status" className="rounded-lg bg-muted p-3 text-sm">{preferenceMessage}</p> : null}
          </div> : null}
          {space === "data" ? <MyDataControls learnerName={state.learner.displayName} onProfileDeleted={onProfileDeleted} /> : null}
        </Card>
      </div>
    </section>
  );
}

function PreferenceToggle({ label, hint, checked, disabled = false, onChange }: { label: string; hint: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border p-4">
      <span><span className="block text-sm font-medium">{label}</span><span className="mt-1 block text-xs text-muted-foreground">{hint}</span></span>
      <input type="checkbox" className="size-5 accent-emerald-600" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function MyDataControls({ learnerName, onProfileDeleted }: { learnerName: string; onProfileDeleted: () => void }) {
  const [report, setReport] = useState<PrivateTutorWeeklyReport | null>(null);
  const [policy, setPolicy] = useState<PrivateTutorDataPolicy | null>(null);
  const [deletionPreview, setDeletionPreview] = useState<PrivateTutorDeletionPreview | null>(null);
  const [pendingDeletions, setPendingDeletions] = useState<PrivateTutorDeletionJobStatus[]>([]);
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failedDeletionReportId, setFailedDeletionReportId] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setMessage("");
    void Promise.allSettled([getPrivateTutorWeeklyReport(), getPrivateTutorDataPolicy(), listPrivateTutorDeletionJobs()])
      .then(([reportResult, policyResult, deletionsResult]) => {
        if (!current) return;
        setReport(reportResult.status === "fulfilled" ? reportResult.value : null);
        setPolicy(policyResult.status === "fulfilled" ? policyResult.value : null);
        setPendingDeletions(deletionsResult.status === "fulfilled" ? deletionsResult.value : []);
      });
    return () => { current = false; };
  }, [loadAttempt]);

  async function savePolicy(next: PrivateTutorDataPolicy) {
    setBusy(true);
    setMessage("");
    try {
      const saved = await updatePrivateTutorDataPolicy({
        rawAudioDays: 0,
        voiceTranscriptDays: next.voiceTranscriptDays,
        derivedProfileHistoryDays: next.derivedProfileHistoryDays,
        learningEvidenceRetention: "until_learner_deletion",
      });
      setPolicy(saved);
      setMessage("数据保留策略已保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "数据保留策略保存失败。");
    } finally {
      setBusy(false);
    }
  }

  async function downloadExport() {
    setBusy(true);
    setMessage("");
    try {
      const bundle = await exportPrivateTutorLearnerData();
      downloadPrivateTutorJson(bundle, "my-private-tutor-data.json");
      setMessage("我的学习数据导出已生成。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "我的学习数据导出失败。");
    } finally {
      setBusy(false);
    }
  }

  async function loadDeletionPreview() {
    setBusy(true);
    setMessage("");
    try {
      setDeletionPreview(await previewPrivateTutorLearnerDeletion());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除范围预览失败。");
    } finally {
      setBusy(false);
    }
  }

  async function deleteProfile() {
    if (confirmName !== learnerName) {
      setMessage(`请输入“${learnerName}”确认删除。`);
      return;
    }
    setBusy(true);
    setMessage("");
    setFailedDeletionReportId("");
    try {
      const result = await deletePrivateTutorProfile(confirmName);
      if (result.deletionReport.liveStateResidualCount !== 0 || result.deletionReport.durableVerification.ok !== true) {
        setMessage("删除验证发现残留，已阻止显示成功状态，请联系数据安全负责人。");
        return;
      }
      onProfileDeleted();
    } catch (error) {
      if (error instanceof ApiError) {
        const reportDetails = error.details?.deletionReport as { id?: unknown } | undefined;
        if (typeof reportDetails?.id === "string") setFailedDeletionReportId(reportDetails.id);
      }
      setMessage(error instanceof Error ? error.message : "我的学习数据删除失败。");
    } finally {
      setBusy(false);
    }
  }

  async function retryDeletion(reportId: string) {
    setBusy(true);
    setMessage("");
    try {
      const result = await retryPrivateTutorLearnerDeletion(reportId);
      if (result.deletionReport.durableVerification.ok !== true) {
        setMessage("介质清理仍未完成，任务会继续保留以便重试。");
        return;
      }
      setFailedDeletionReportId("");
      setPendingDeletions((items) => items.filter((item) => item.reportId !== reportId));
      setMessage("删除任务已完成全部介质验证。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除任务重试失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 grid gap-4">
      {pendingDeletions.length ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100" role="status">
          <p className="text-sm font-semibold">有 {pendingDeletions.length} 个删除任务等待完整验证</p>
          <div className="mt-3 flex flex-wrap gap-2">{pendingDeletions.map((item) => <Button key={item.reportId} size="sm" variant="secondary" disabled={busy} aria-label={`重新验证删除任务 ${item.requestedAt}`} onClick={() => void retryDeletion(item.reportId)}>重新验证</Button>)}</div>
        </div>
      ) : null}
      <div className="rounded-xl border p-4">
        <p className="text-sm font-medium">单账号学习记录</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">知识地图、计划、错题和课程记录只归属于当前账号，不提供家庭成员或多个孩子之间的切换。</p>
      </div>
      {report ? (
        <div className="rounded-xl border p-4">
          <p className="text-sm font-medium">这一周的学习证据</p>
          <p className="mt-2 text-sm text-muted-foreground">{report.highlight}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{report.nextStep}</p>
        </div>
      ) : null}
      {policy ? (
        <div className="rounded-xl border p-4">
          <p className="text-sm font-medium">数据保留期</p>
          <p className="mt-1 text-xs text-muted-foreground">原始音频始终不保存；学习证据保留到我删除学习档案为止。</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium">语音转写<select aria-label="语音转写保留期" value={policy.voiceTranscriptDays} disabled={busy} onChange={(event) => void savePolicy({ ...policy, voiceTranscriptDays: Number(event.target.value) as PrivateTutorDataPolicy["voiceTranscriptDays"] })} className="mt-1 h-9 w-full rounded-md border bg-card px-2 text-sm"><option value={0}>不保留</option><option value={7}>7 天</option><option value={30}>30 天</option><option value={90}>90 天</option><option value={365}>365 天</option></select></label>
            <label className="text-xs font-medium">历史派生画像<select aria-label="派生画像保留期" value={policy.derivedProfileHistoryDays} disabled={busy} onChange={(event) => void savePolicy({ ...policy, derivedProfileHistoryDays: Number(event.target.value) as PrivateTutorDataPolicy["derivedProfileHistoryDays"] })} className="mt-1 h-9 w-full rounded-md border bg-card px-2 text-sm"><option value={180}>180 天</option><option value={365}>365 天</option><option value={730}>730 天</option></select></label>
          </div>
        </div>
      ) : null}
      <div className="rounded-xl border p-4">
        <p className="text-sm font-medium">导出我的学习数据</p>
        <p className="mt-1 text-xs text-muted-foreground">导出档案、学习证据、复习记录、语音转写和审计记录，不包含题库答案。</p>
        <Button className="mt-3" variant="secondary" disabled={busy} onClick={() => void downloadExport()}>下载 JSON 导出</Button>
      </div>
      <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-4 dark:border-rose-950 dark:bg-rose-950/20">
        <p className="text-sm font-medium text-rose-800 dark:text-rose-200">永久删除我的学习档案</p>
        <p className="mt-1 text-xs text-muted-foreground">先看看会删除哪些资料。确认后无法恢复，仅保留一份不含身份信息的删除证明。</p>
        {!deletionPreview ? (
          <Button className="mt-3" variant="secondary" disabled={busy} onClick={() => void loadDeletionPreview()}>预览删除范围</Button>
        ) : (
          <div className="mt-3">
            <p className="text-sm">将删除 {deletionPreview.totalRecords} 条学习记录。</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input aria-label="确认删除的档案称呼" value={confirmName} onChange={(event) => setConfirmName(event.target.value)} placeholder={`输入 ${learnerName}`} className="h-9 min-w-52 flex-1 rounded-md border bg-card px-2 text-sm" />
              <Button disabled={busy || confirmName !== learnerName} onClick={() => void deleteProfile()}>永久删除</Button>
            </div>
          </div>
        )}
      </div>
      {message ? <p role="status" className="rounded-lg bg-muted p-3 text-sm">{message}</p> : null}
      {failedDeletionReportId ? <Button variant="secondary" disabled={busy} onClick={() => void retryDeletion(failedDeletionReportId)}>重新验证并完成删除</Button> : null}
      {!report && !policy ? <div className="text-center"><Button variant="ghost" size="sm" onClick={() => setLoadAttempt((value) => value + 1)}>重新读取我的数据</Button></div> : null}
    </div>
  );
}

function downloadPrivateTutorJson(bundle: Record<string, unknown>, filename: string) {
  const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
