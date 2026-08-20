import { useEffect, useMemo, useRef, useState } from "react";
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
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
  UserRound,
  Volume2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { useSessionUser } from "@/hooks/use-session-user";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import {
  createInitialLearnerState,
  DEMO_LEARNERS,
  strategyLabel,
  type LearnerTutorState,
  type TutorSettingsSpace,
  type TutorTab,
} from "@/features/private-tutor/private-tutor-model";
import { loadLearnerState, saveLearnerState } from "@/features/private-tutor/private-tutor-storage";
import {
  actOnPrivateTutorSession,
  createPrivateTutorLearner,
  answerPrivateTutorAssessment,
  exitPrivateTutorChildMode,
  getCurrentPrivateTutorAssessment,
  getCurrentPrivateTutorSession,
  getPrivateTutorSnapshot,
  listPrivateTutorLearners,
  pausePrivateTutorAssessment,
  pausePrivateTutorSession,
  rebalancePrivateTutorLearningPlan,
  resumePrivateTutorAssessment,
  resumePrivateTutorSession,
  startPrivateTutorAssessment,
  startPrivateTutorChildMode,
  startPrivateTutorSession,
  type PrivateTutorAssessment,
  type PrivateTutorLearnerModel,
  type PrivateTutorLearner,
  type PrivateTutorLearningPlan,
  type PrivateTutorSession,
  type PrivateTutorSessionPace,
  type PrivateTutorSnapshot,
  type PrivateTutorStrategyDecision,
} from "@/features/private-tutor/private-tutor-api";

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
  { key: "student", title: "我的偏好", hint: "声音、字幕、动画与学习节奏", audience: "学生" },
  { key: "guardian", title: "家庭与监护", hint: "孩子档案、授权、周报与隐私", audience: "家长" },
  { key: "educator", title: "教学内容与策略", hint: "课程、题库、知识点和教学策略", audience: "教研" },
  { key: "safety", title: "质量与安全", hint: "内容审核、儿童安全和质量评测", audience: "运营 / 安全" },
  { key: "system", title: "系统与 AI", hint: "模型、语音、成本与审计", audience: "技术管理员" },
];

export function PrivateTutorView() {
  const sessionUser = useSessionUser();
  const navigate = usePageNavigation();
  const childMode = sessionUser?.privateTutorChildMode ?? null;

  if (!childMode) {
    return <ParentTutorEntry signedIn={Boolean(sessionUser)} onOpenLogin={() => navigate("me")} />;
  }

  async function exitToParent(exitPin: string) {
    try {
      await exitPrivateTutorChildMode(exitPin);
      navigate("dashboard");
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "家长验证失败，请重试。";
    }
  }

  return <ChildTutorExperience learnerId={childMode.learnerId} onParentExit={exitToParent} />;
}

function ChildTutorExperience({ learnerId, onParentExit }: { learnerId: string; onParentExit: (exitPin: string) => Promise<string | null> }) {
  const [tab, setTab] = useState<TutorTab>("today");
  const learner = useMemo(
    () => DEMO_LEARNERS.find((item) => item.id === learnerId) ?? { ...DEMO_LEARNERS[0], id: learnerId },
    [learnerId],
  );
  const [learnerState, setLearnerState] = useState<LearnerTutorState>(() => loadLearnerState(learner));
  const [assessment, setAssessment] = useState<PrivateTutorAssessment | null>(null);
  const [learnerModel, setLearnerModel] = useState<PrivateTutorLearnerModel | null>(null);
  const [strategyDecision, setStrategyDecision] = useState<PrivateTutorStrategyDecision | null>(null);
  const [learningPlan, setLearningPlan] = useState<PrivateTutorLearningPlan | null>(null);
  const [tutoringSession, setTutoringSession] = useState<PrivateTutorSession | null>(null);
  const [assessmentReady, setAssessmentReady] = useState(false);
  const [diagnosticDismissed, setDiagnosticDismissed] = useState(false);

  useEffect(() => {
    let current = true;
    setLearnerState(loadLearnerState(learner));
    setAssessmentReady(false);
    setDiagnosticDismissed(false);
    void Promise.allSettled([getPrivateTutorSnapshot(learnerId), getCurrentPrivateTutorAssessment(learnerId), getCurrentPrivateTutorSession(learnerId)])
      .then(([snapshotResult, assessmentResult, sessionResult]) => {
        if (!current) return;
        if (snapshotResult.status === "fulfilled") {
          setLearnerState(serverLearnerState(snapshotResult.value.learner, snapshotResult.value.snapshot));
          setLearnerModel(snapshotResult.value.learnerModel ?? null);
          setStrategyDecision(snapshotResult.value.strategyDecision ?? null);
          setLearningPlan(snapshotResult.value.learningPlan ?? null);
        }
        if (assessmentResult.status === "fulfilled") {
          setAssessment(assessmentResult.value);
          setDiagnosticDismissed(assessmentResult.value?.status === "completed");
        } else {
          setAssessment(null);
        }
        setTutoringSession(sessionResult.status === "fulfilled" ? sessionResult.value : null);
        setAssessmentReady(true);
      });
    return () => { current = false; };
  }, [learner, learnerId]);
  useEffect(() => {
    if (DEMO_LEARNERS.some((item) => item.id === learnerState.learner.id)) saveLearnerState(learnerState);
  }, [learnerState]);

  // A parent commonly hands the already signed-in computer to a child. The
  // platform account role therefore MUST NOT unlock adult spaces. A future
  // server-issued parent re-verification result is the only valid source.
  const isParentReverified = false;

  async function finishDiagnostic() {
    try {
      const result = await getPrivateTutorSnapshot(learnerId);
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
      const result = await rebalancePrivateTutorLearningPlan(learnerId, 1);
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
      const result = await startPrivateTutorSession(learnerId, pace);
      setTutoringSession(result.session);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "今天的课程暂时无法开始，请稍后再试。";
    }
  }

  async function pauseLesson() {
    if (!tutoringSession) return "没有可以暂停的课程。";
    try {
      const result = await pausePrivateTutorSession(learnerId, tutoringSession.id);
      setTutoringSession(result.session);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "课程暂时无法暂停。";
    }
  }

  async function resumeLesson() {
    if (!tutoringSession) return "没有可以继续的课程。";
    try {
      const result = await resumePrivateTutorSession(learnerId, tutoringSession.id);
      setTutoringSession(result.session);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "课程暂时无法继续。";
    }
  }

  async function actOnLesson(input: Parameters<typeof actOnPrivateTutorSession>[2]) {
    if (!tutoringSession) return { error: "课程还没有开始。", correct: null };
    try {
      const result = await actOnPrivateTutorSession(learnerId, tutoringSession.id, input);
      setTutoringSession(result.session);
      if (result.snapshot) setLearnerState(applyServerSnapshot(learnerState, result.snapshot));
      if (result.learnerModel !== undefined) setLearnerModel(result.learnerModel ?? null);
      if (result.strategyDecision !== undefined) setStrategyDecision(result.strategyDecision ?? null);
      if (result.learningPlan !== undefined) setLearningPlan(result.learningPlan ?? null);
      return { error: null, correct: result.answer?.correct ?? null };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "这一步暂时没有保存，请重试。", correct: null };
    }
  }

  const allKnowledgeUnknown = learnerState.knowledge.every((item) => item.level === "unknown");
  if (!assessmentReady) {
    return <div className="grid min-h-[65vh] place-items-center text-sm text-muted-foreground">正在准备专属于你的学习空间…</div>;
  }
  if ((!assessment && allKnowledgeUnknown)
    || (assessment != null && assessment.status !== "completed")
    || (assessment?.status === "completed" && !diagnosticDismissed)) {
    return (
      <DiagnosticExperience
        learnerName={learnerState.learner.displayName}
        learnerId={learnerId}
        assessment={assessment}
        onAssessmentChange={setAssessment}
        onFinish={finishDiagnostic}
        onParentExit={onParentExit}
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
              <p className="text-xs text-muted-foreground">每天 20 分钟，把真正不会的学会</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border bg-card/80 py-1 pl-1 pr-3 text-sm shadow-sm">
            <span className="grid size-8 place-items-center rounded-full bg-amber-100 font-semibold text-amber-800">{learnerState.learner.avatar}</span>
            <span className="font-medium">{learnerState.learner.displayName}</span>
            <span className="text-xs text-muted-foreground">{learnerState.learner.grade}</span>
          </div>
        </div>
      </header>

      <nav aria-label="我的私教学生一级目录" className="overflow-x-auto border-b bg-card/55 px-2 sm:px-5">
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
        {tab === "today" ? <TodayLearning state={learnerState} learningPlan={learningPlan} strategyDecision={strategyDecision} session={tutoringSession} onReschedule={rescheduleToday} onStart={startLesson} onPause={pauseLesson} onResume={resumeLesson} onAction={actOnLesson} /> : null}
        {tab === "map" ? <KnowledgeMap state={learnerState} learnerModel={learnerModel} /> : null}
        {tab === "errors" ? <ErrorBook state={learnerState} onStart={() => setTab("today")} /> : null}
        {tab === "growth" ? <Growth state={learnerState} /> : null}
        {tab === "settings" ? (
          <TutorSettings
            state={learnerState}
            activeLearnerId={learnerId}
            onLearnerChange={() => {}}
            verifiedAdult={isParentReverified}
            onParentExit={onParentExit}
          />
        ) : null}
      </div>
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
  learnerId,
  assessment,
  onAssessmentChange,
  onFinish,
  onParentExit,
}: {
  learnerName: string;
  learnerId: string;
  assessment: PrivateTutorAssessment | null;
  onAssessmentChange: (assessment: PrivateTutorAssessment) => void;
  onFinish: () => Promise<string | null>;
  onParentExit: (exitPin: string) => Promise<string | null>;
}) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [showParentGate, setShowParentGate] = useState(false);
  const [parentPin, setParentPin] = useState("");
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
      onAssessmentChange(await startPrivateTutorAssessment(learnerId));
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
      onAssessmentChange(await pausePrivateTutorAssessment(learnerId, assessment.id));
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
      onAssessmentChange(await resumePrivateTutorAssessment(learnerId, assessment.id));
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
      const next = await answerPrivateTutorAssessment(learnerId, assessment.id, {
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

  async function exitToParent() {
    if (parentPin.length < 6) return;
    setBusy(true);
    setMessage("");
    const error = await onParentExit(parentPin);
    if (error) setMessage("PIN 不正确或暂时被锁定，请由家长稍后重试。");
    setBusy(false);
  }

  async function finish() {
    setBusy(true);
    setMessage("");
    const error = await onFinish();
    if (error) setMessage(error);
    setBusy(false);
  }

  const parentGate = showParentGate ? (
    <div className="mt-3 flex flex-wrap justify-end gap-2">
      <input
        type="password"
        inputMode="numeric"
        value={parentPin}
        onChange={(event) => setParentPin(event.target.value.replace(/\D/g, "").slice(0, 12))}
        aria-label="摸底中的家长 PIN"
        placeholder="家长 PIN"
        className="h-9 w-40 rounded-lg border bg-card px-3 text-sm text-foreground"
      />
      <Button size="sm" variant="secondary" disabled={busy || parentPin.length < 6} onClick={() => void exitToParent()}>验证并退出</Button>
    </div>
  ) : null;

  if (!assessment) {
    return (
      <div className="mx-auto flex min-h-full max-w-4xl items-center justify-center p-3 sm:p-6">
        <Card className="w-full overflow-hidden">
          <div className="bg-[linear-gradient(135deg,#059669,#0f766e)] p-7 text-white sm:p-10">
            <div className="flex items-start justify-between gap-4">
              <span className="grid size-14 place-items-center rounded-2xl bg-white/15"><BrainCircuit className="size-8" /></span>
              <Button variant="secondary" size="sm" onClick={() => setShowParentGate((value) => !value)}><ShieldCheck />家长入口</Button>
            </div>
            {parentGate}
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
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button disabled={busy} onClick={() => void resume()}>继续摸底</Button>
            <Button variant="secondary" onClick={() => setShowParentGate((value) => !value)}>家长入口</Button>
          </div>
          {parentGate}
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
        <div className="flex gap-2"><Button variant="secondary" size="sm" disabled={busy} onClick={() => void pause()}><CirclePause />暂停</Button><Button variant="ghost" size="sm" onClick={() => setShowParentGate((value) => !value)}><ShieldCheck />家长入口</Button></div>
      </div>
      {parentGate}
      <div className="mb-6 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} /></div>
      <Card className="p-6 sm:p-9">
        <p className="text-xs font-medium text-muted-foreground">{DIAGNOSTIC_KNOWLEDGE_LABELS[question.knowledgeId] ?? "数学理解"}</p>
        <h1 className="mt-3 text-2xl font-bold leading-relaxed">{question.prompt}</h1>
        {question.kind === "choice" && question.options ? (
          <div className="mt-7 grid gap-3">
            {question.options.map((option) => <button key={option.id} type="button" onClick={() => setAnswer(option.id)} className={cn("rounded-xl border-2 p-4 text-left transition", answer === option.id ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950" : "hover:border-emerald-300")}><span className="mr-3 font-bold uppercase">{option.id}</span>{option.label}</button>)}
          </div>
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

function ParentTutorEntry({ signedIn, onOpenLogin }: { signedIn: boolean; onOpenLogin: () => void }) {
  const [learners, setLearners] = useState<PrivateTutorLearner[]>([]);
  const [selectedLearnerId, setSelectedLearnerId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [grade, setGrade] = useState("七年级");
  const [exitPin, setExitPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!signedIn) return;
    let current = true;
    void listPrivateTutorLearners()
      .then((items) => {
        if (!current) return;
        setLearners(items);
        setSelectedLearnerId((value) => value || items[0]?.id || "");
      })
      .catch((error) => current && setMessage(error instanceof Error ? error.message : "暂时无法读取孩子档案。"));
    return () => { current = false; };
  }, [signedIn]);

  async function createLearner() {
    if (!displayName.trim()) {
      setMessage("请填写孩子的小名。正式姓名不是必需的。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await createPrivateTutorLearner({ displayName: displayName.trim(), grade });
      setLearners((items) => [result.learner, ...items]);
      setSelectedLearnerId(result.learner.id);
      setDisplayName("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "孩子档案创建失败。" );
    } finally {
      setBusy(false);
    }
  }

  async function enterChildMode() {
    if (!selectedLearnerId) {
      setMessage("请先选择一个孩子。" );
      return;
    }
    if (!/^\d{6,12}$/.test(exitPin)) {
      setMessage("请设置 6–12 位数字家长 PIN，用于取回家长模式。" );
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await startPrivateTutorChildMode(selectedLearnerId, exitPin);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "儿童模式启动失败。" );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-4xl items-center justify-center p-3 sm:p-6">
      <Card className="w-full overflow-hidden">
        <div className="bg-emerald-600 p-6 text-white sm:p-8">
          <span className="grid size-12 place-items-center rounded-2xl bg-white/15"><GraduationCap className="size-7" /></span>
          <h1 className="mt-5 text-2xl font-bold">家长准备好，再交给孩子</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-emerald-50">家长账号负责孩子档案和授权。进入儿童模式后，这台电脑只显示所选孩子的学习空间，取回家长模式需要重新输入家长 PIN。</p>
        </div>
        <div className="grid gap-6 p-6 sm:p-8">
          {!signedIn ? (
            <div className="rounded-2xl border border-dashed p-6 text-center">
              <ShieldCheck className="mx-auto size-9 text-emerald-600" />
              <h2 className="mt-3 font-semibold">请先登录家长账号</h2>
              <p className="mt-2 text-sm text-muted-foreground">孩子不需要单独账号。登录后由家长选择孩子并启动儿童模式。</p>
              <Button className="mt-5" onClick={onOpenLogin}>前往登录</Button>
            </div>
          ) : (
            <>
              <div>
                <h2 className="font-semibold">1. 选择这次使用的孩子</h2>
                {learners.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{learners.map((item) => <button key={item.id} type="button" onClick={() => setSelectedLearnerId(item.id)} className={cn("rounded-xl border p-4 text-left", selectedLearnerId === item.id ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950" : "bg-card")}><span className="font-medium">{item.displayName}</span><span className="mt-1 block text-xs text-muted-foreground">{item.grade} · 独立学习空间</span></button>)}</div> : <p className="mt-2 text-sm text-muted-foreground">还没有孩子档案，先在下面创建一个。</p>}
              </div>
              <div className="rounded-2xl bg-muted/50 p-4">
                <h2 className="font-semibold">添加孩子</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_0.7fr_auto]">
                  <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={40} placeholder="孩子的小名" aria-label="孩子的小名" className="h-10 rounded-lg border bg-card px-3 text-sm" />
                  <select value={grade} onChange={(event) => setGrade(event.target.value)} aria-label="孩子年级" className="h-10 rounded-lg border bg-card px-3 text-sm"><option>六年级</option><option>七年级</option><option>八年级</option></select>
                  <Button variant="secondary" disabled={busy} onClick={() => void createLearner()}>添加</Button>
                </div>
              </div>
              <div>
                <h2 className="font-semibold">2. 设置本次家长 PIN</h2>
                <p className="mt-1 text-xs text-muted-foreground">仅用于退出本次儿童模式，不是孩子的登录密码。请不要告诉孩子。</p>
                <div className="mt-3 flex flex-wrap gap-3"><input type="password" inputMode="numeric" value={exitPin} onChange={(event) => setExitPin(event.target.value.replace(/\D/g, "").slice(0, 12))} placeholder="6–12 位数字" aria-label="家长 PIN" className="h-10 min-w-52 rounded-lg border bg-card px-3 text-sm" /><Button disabled={busy || !selectedLearnerId} onClick={() => void enterChildMode()}>{busy ? "正在准备…" : "进入儿童模式"}</Button></div>
              </div>
            </>
          )}
          {message ? <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">{message}</p> : null}
        </div>
      </Card>
    </div>
  );
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

function TodayLearning({
  state,
  learningPlan,
  strategyDecision,
  session,
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
  onReschedule: () => Promise<string | null>;
  onStart: (pace: PrivateTutorSessionPace) => Promise<string | null>;
  onPause: () => Promise<string | null>;
  onResume: () => Promise<string | null>;
  onAction: (input: Parameters<typeof actOnPrivateTutorSession>[2]) => Promise<{ error: string | null; correct: boolean | null }>;
}) {
  const [pace, setPace] = useState<PrivateTutorSessionPace>("standard");
  const [answer, setAnswer] = useState("");
  const [voiceMessage, setVoiceMessage] = useState("点一下麦克风，也可以直接说");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const attemptKeyRef = useRef(newClientKey("tutoring"));
  const dailyProgress = Math.round((state.dailyMinutes / 20) * 100);

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);
  useEffect(() => {
    setAnswer("");
    setMessage("");
    attemptKeyRef.current = newClientKey("tutoring");
  }, [session?.currentActivity?.question?.revisionId]);

  async function toggleVoice() {
    if (listening) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setListening(false);
      setVoiceMessage("已停止。本演示不保存原始音频");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceMessage("当前设备不支持麦克风，请使用屏幕作答");
      return;
    }
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      setListening(true);
      setVoiceMessage("正在听…说完后再点一下。低置信度表达不会直接判错");
    } catch {
      setVoiceMessage("没有获得麦克风权限，仍可使用屏幕作答");
    }
  }

  async function start() {
    setBusy(true);
    setMessage("");
    setMessage(await onStart(pace) ?? "");
    setBusy(false);
  }

  async function pause() {
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

  async function submit(responseKind: "answer" | "dont_know", rawAnswer = answer) {
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
      source: "screen",
    });
    if (result.error) setMessage(result.error);
    else if (result.correct === false) {
      setMessage("没关系，这次答案会帮助我换一种更合适的讲法。");
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
                {{ easy: "轻松学 5 分钟", standard: "标准 20 分钟", review: "今天只复习 10 分钟" }[value]}
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
              <span className="text-sm font-bold text-emerald-700">{state.dailyMinutes} / 20 分钟</span>
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
          {current.kind === "explain" && session.targetKnowledgeId === "balance" ? <BalanceScene revealed /> : null}
          {current.kind === "explain" && session.targetKnowledgeId !== "balance" ? <div className="grid min-h-48 place-items-center rounded-2xl border bg-sky-50 text-center dark:bg-sky-950/30"><div><BrainCircuit className="mx-auto size-10 text-sky-600" /><p className="mt-3 font-semibold">换成具体步骤来看</p></div></div> : null}
          <div className="mt-5 rounded-2xl bg-muted/60 p-4">
            <p className="flex gap-2 text-sm leading-6"><Volume2 className="mt-1 size-4 shrink-0 text-emerald-600" />{current.instruction}</p>
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
              {current.question.options ? <div className="mt-3 grid gap-2">{current.question.options.map((option) => <button key={option.id} type="button" disabled={busy} onClick={() => { setAnswer(option.id); void submit("answer", option.id); }} className="min-h-12 rounded-xl border-2 bg-card px-4 text-left text-sm font-medium hover:border-emerald-400 disabled:opacity-60">{option.label}</button>)}</div> : <div className="mt-3 flex flex-wrap gap-3"><input value={answer} onChange={(event) => setAnswer(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submit("answer"); }} aria-label="写下答案" className="h-12 min-w-48 flex-1 rounded-xl border bg-card px-4 text-lg" placeholder="写下你的答案" /><Button className="min-h-12" disabled={busy} onClick={() => void submit("answer")}>{busy ? "正在检查…" : "提交答案"}</Button></div>}
              {current.hint ? <p className="mt-3 rounded-lg bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-950 dark:text-sky-100">提示 {current.hintLevel}：{current.hint}</p> : null}
              {message ? <p role="status" className="mt-3 rounded-lg bg-muted p-3 text-sm">{message}</p> : null}
            </div>
          ) : null}
        </div>
      </Card>

      <aside className="grid content-start gap-4">
        <Card className="p-5">
          <p className="text-sm font-semibold">可以说，也可以点</p>
          <button type="button" onClick={() => void toggleVoice()} className={cn("mt-4 flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed transition", listening ? "border-rose-400 bg-rose-50 text-rose-700 dark:bg-rose-950" : "border-emerald-300 bg-emerald-50/70 text-emerald-800 dark:bg-emerald-950")}>{listening ? <MicOff className="size-7" /> : <Mic className="size-7" />}<span className="text-sm font-medium">{listening ? "停止聆听" : "按住说话"}</span></button>
          <p role="status" className="mt-3 text-xs leading-5 text-muted-foreground">{voiceMessage}</p>
        </Card>
        <Card className="p-5">
          <p className="flex items-center gap-2 text-sm font-semibold"><Heart className="size-4 text-rose-500" />卡住了也没关系</p>
          <div className="mt-3 grid gap-2">
            {current.question ? <Button variant="secondary" className="justify-start" disabled={busy || current.hintLevel >= 3} onClick={() => void simpleAction("hint")}><BrainCircuit />给我一点提示</Button> : null}
            {current.question ? <Button variant="secondary" className="justify-start" disabled={busy} onClick={() => void submit("dont_know", "")}><Heart />我还不会</Button> : null}
            <Button variant="secondary" className="justify-start" onClick={() => setVoiceMessage("已放慢讲解节奏。正式语音合成将在 P6 接入。") }><Volume2 />说慢一点</Button>
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
          <div key={`${plan.id}-${day.dayIndex}`} className={cn("rounded-xl border p-3", day.dayIndex === 1 ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950" : "bg-card")}>
            <p className="text-[11px] font-medium text-muted-foreground">{day.dayIndex === 1 ? "今天" : `第 ${day.dayIndex} 天`}</p>
            <p className="mt-2 text-sm font-semibold leading-5">{day.title}</p>
            <p className="mt-2 text-[11px] text-muted-foreground">{day.minutes} 分钟</p>
          </div>
        ))}
      </div>
      {message ? <p role="status" className={cn("mt-3 rounded-lg p-3 text-sm", hasError ? "bg-rose-50 text-rose-700 dark:bg-rose-950" : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950")}>{message}</p> : null}
    </Card>
  );
}

function BalanceScene({ revealed }: { revealed: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-sky-50 p-3 dark:bg-sky-950/30">
      <svg viewBox="0 0 640 300" role="img" aria-label={revealed ? "等式两边都减去三以后，x 等于五" : "天平左边是 x 加三，右边是八"} className="w-full">
        <path d="M320 55 L250 245 H390 Z" fill="currentColor" className="text-slate-300 dark:text-slate-700" />
        <circle cx="320" cy="72" r="18" fill="currentColor" className="text-emerald-500" />
        <g className={cn("origin-center transition-transform duration-700", revealed ? "rotate-0" : "rotate-[-1deg]")}>
          <rect x="105" y="82" width="430" height="12" rx="6" fill="currentColor" className="text-slate-600 dark:text-slate-300" />
          <path d="M155 94 L110 190 H200 Z" fill="none" stroke="currentColor" strokeWidth="5" className="text-slate-500" />
          <path d="M485 94 L440 190 H530 Z" fill="none" stroke="currentColor" strokeWidth="5" className="text-slate-500" />
          <rect x="100" y="190" width="110" height="12" rx="6" fill="currentColor" className="text-amber-500" />
          <rect x="430" y="190" width="110" height="12" rx="6" fill="currentColor" className="text-amber-500" />
          <text x="155" y="160" textAnchor="middle" fontSize="34" fontWeight="700" fill="currentColor" className="text-slate-800 dark:text-slate-100">{revealed ? "x" : "x + 3"}</text>
          <text x="485" y="160" textAnchor="middle" fontSize="34" fontWeight="700" fill="currentColor" className="text-slate-800 dark:text-slate-100">{revealed ? "5" : "8"}</text>
        </g>
        {revealed ? <text x="320" y="278" textAnchor="middle" fontSize="20" fontWeight="600" fill="currentColor" className="text-emerald-700 dark:text-emerald-300">两边同时减去 3，仍然平衡</text> : null}
      </svg>
    </div>
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

function ErrorBook({ state, onStart }: { state: LearnerTutorState; onStart: () => void }) {
  return (
    <section>
      <p className="text-sm font-medium text-rose-600">只属于 {state.learner.displayName}</p>
      <h1 className="mt-1 text-2xl font-bold">我的错题本</h1>
      <p className="mt-2 text-sm text-muted-foreground">不堆积做错的题，只保留真正需要攻克的错因和复习时间。</p>
      <div className="mt-6 grid gap-4">
        {!state.errors.length ? (
          <Card className="border-dashed p-6 text-center">
            <BookHeart className="mx-auto size-8 text-emerald-600" />
            <p className="mt-3 font-medium">现在还没有需要复习的错题</p>
            <p className="mt-1 text-sm text-muted-foreground">以后遇到真正没弄懂的地方，我会帮你放到这里。</p>
          </Card>
        ) : null}
        {state.errors.map((item) => (
          <Card key={item.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", item.status === "mastered" ? "bg-emerald-100 text-emerald-800" : item.status === "challenge_today" ? "bg-amber-100 text-amber-900" : "bg-sky-100 text-sky-800")}>{item.status === "mastered" ? "已经攻克" : item.status === "challenge_today" ? "今天再挑战" : "正在攻克"}</span>
                <h2 className="mt-3 text-lg font-bold">{item.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">真正的错因：{item.misconception}</p>
                <p className="mt-2 text-xs text-muted-foreground">教学方法：{strategyLabel(item.strategy)} · 下次复习：{item.nextReview}</p>
              </div>
              {item.status !== "mastered" ? <Button variant="secondary" onClick={onStart}>开始纠正</Button> : <span className="flex items-center gap-1 text-sm font-medium text-emerald-700"><Check className="size-4" />等待换题复测</span>}
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

function Growth({ state }: { state: LearnerTutorState }) {
  const bars = [32, 44, 41, 56, 63, 69, Math.min(92, 56 + state.completedSessions * 3)];
  return (
    <section>
      <p className="text-sm font-medium text-violet-600">看见自己的进步</p>
      <h1 className="mt-1 text-2xl font-bold">我的成长</h1>
      <p className="mt-2 text-sm text-muted-foreground">这里没有排名，只记录你能独立做到的事情。</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Card className="p-5"><GentleStat value={`${state.completedSessions}`} label="完成学习旅程" /></Card>
        <Card className="p-5"><GentleStat value={`${state.independentAnswers}`} label="独立想出的答案" /></Card>
        <Card className="p-5"><GentleStat value={`${state.streakDays} 天`} label="最近愿意来学习" /></Card>
      </div>
      <Card className="mt-5 p-5">
        <div className="flex items-center justify-between"><h2 className="font-semibold">这一周的理解在变稳</h2><span className="text-xs text-muted-foreground">只和过去的自己比</span></div>
        <div className="mt-6 flex h-44 items-end gap-3" aria-label="七天独立掌握趋势">
          {bars.map((height, index) => <div key={index} className="flex flex-1 flex-col items-center gap-2"><div className="w-full max-w-12 rounded-t-xl bg-gradient-to-t from-violet-500 to-emerald-400 transition-all" style={{ height: `${height}%` }} /><span className="text-xs text-muted-foreground">{index + 1}</span></div>)}
        </div>
      </Card>
    </section>
  );
}

function GentleStat({ value, label }: { value: string; label: string }) {
  return <div><p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{value}</p><p className="mt-1 text-xs text-muted-foreground">{label}</p></div>;
}

function TutorSettings({ state, activeLearnerId, onLearnerChange, verifiedAdult, onParentExit }: { state: LearnerTutorState; activeLearnerId: string; onLearnerChange: (id: string) => void; verifiedAdult: boolean; onParentExit: (exitPin: string) => Promise<string | null> }) {
  const [space, setSpace] = useState<TutorSettingsSpace>("student");
  const [captions, setCaptions] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [parentGateRequested, setParentGateRequested] = useState(false);
  const [parentPin, setParentPin] = useState("");
  const [parentGateBusy, setParentGateBusy] = useState(false);
  const [parentGateError, setParentGateError] = useState("");
  const effectiveSpace = verifiedAdult ? space : "student";
  const selected = SETTINGS_SPACES.find((item) => item.key === effectiveSpace) ?? SETTINGS_SPACES[0];
  const professional = effectiveSpace !== "student";
  const visibleSpaces = verifiedAdult ? SETTINGS_SPACES : SETTINGS_SPACES.filter((item) => item.key === "student");

  return (
    <section>
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{verifiedAdult ? "角色能力彼此分开" : "让学习更舒服"}</p>
      <h1 className="mt-1 text-2xl font-bold">我的设置</h1>
      <p className="mt-2 text-sm text-muted-foreground">{verifiedAdult ? "学生日常只看到自己的偏好。其他空间需要服务端验证角色后显式进入。" : "在这里调整声音、字幕和动画，不会影响已经学会的内容。"}</p>
      <div className="mt-6 grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="grid content-start gap-2">
          {visibleSpaces.map((item) => (
            <button key={item.key} type="button" onClick={() => setSpace(item.key)} className={cn("rounded-xl border p-4 text-left transition", effectiveSpace === item.key ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950" : "bg-card hover:bg-muted/50")}>
              <div className="flex items-start justify-between gap-3"><span className="font-semibold">{item.title}</span><span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{item.audience}</span></div>
              <p className="mt-1 text-xs text-muted-foreground">{item.hint}</p>
            </button>
          ))}
        </div>
        <Card className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs text-muted-foreground">{selected.audience}空间</p><h2 className="mt-1 text-lg font-bold">{selected.title}</h2></div>{professional ? <ShieldCheck className="size-6 text-emerald-600" /> : <UserRound className="size-6 text-emerald-600" />}</div>
          {!professional ? (
            <div className="mt-6 grid gap-4">
              <PreferenceToggle label="显示实时字幕" hint="语音教学时同步显示文字" checked={captions} onChange={setCaptions} />
              <PreferenceToggle label="减少动画" hint="使用静态图和单步切换，学习内容保持完整" checked={reducedMotion} onChange={setReducedMotion} />
              <div className="rounded-xl bg-muted/60 p-4"><p className="text-sm font-medium">当前学习档案</p><p className="mt-1 text-sm text-muted-foreground">{state.learner.displayName} · {state.learner.grade} · {state.learner.curriculum}</p></div>
              <div className="rounded-xl border border-dashed p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><p className="text-sm font-medium">家长入口</p><p className="mt-1 text-xs text-muted-foreground">切换孩子、查看周报或离开儿童模式前，需要重新验证家长身份。</p></div>
                  <Button variant="secondary" onClick={() => setParentGateRequested(true)}><ShieldCheck />家长验证</Button>
                </div>
                {parentGateRequested ? (
                  <div className="mt-3 rounded-lg bg-amber-50 p-3 dark:bg-amber-950">
                    <label className="text-xs font-medium text-amber-900 dark:text-amber-100">输入家长设置的 PIN</label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <input type="password" inputMode="numeric" value={parentPin} onChange={(event) => setParentPin(event.target.value.replace(/\D/g, "").slice(0, 12))} aria-label="退出儿童模式的家长 PIN" className="h-9 min-w-44 rounded-md border bg-card px-3 text-sm" />
                      <Button size="sm" disabled={parentGateBusy || parentPin.length < 6} onClick={() => {
                        setParentGateBusy(true);
                        setParentGateError("");
                        void onParentExit(parentPin).then((error) => {
                          if (error) setParentGateError("PIN 不正确或暂时被锁定，请由家长稍后重试。");
                        }).finally(() => setParentGateBusy(false));
                      }}>{parentGateBusy ? "正在验证…" : "验证并退出"}</Button>
                    </div>
                    {parentGateError ? <p role="alert" className="mt-2 text-xs text-rose-700 dark:text-rose-300">{parentGateError}</p> : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : verifiedAdult ? (
            <AdultSpacePreview space={effectiveSpace} activeLearnerId={activeLearnerId} onLearnerChange={onLearnerChange} />
          ) : (
            null
          )}
        </Card>
      </div>
    </section>
  );
}

function PreferenceToggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border p-4">
      <span><span className="block text-sm font-medium">{label}</span><span className="mt-1 block text-xs text-muted-foreground">{hint}</span></span>
      <input type="checkbox" className="size-5 accent-emerald-600" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function AdultSpacePreview({ space, activeLearnerId, onLearnerChange }: { space: TutorSettingsSpace; activeLearnerId: string; onLearnerChange: (id: string) => void }) {
  if (space === "guardian") {
    return (
      <div className="mt-5">
        <div className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">当前工作台管理员已验证。正式版将使用独立的监护人关系授权。</div>
        <p className="mt-5 text-sm font-semibold">选择孩子的独立数据空间</p>
        <div className="mt-3 grid gap-2">
          {DEMO_LEARNERS.map((learner) => <button key={learner.id} type="button" onClick={() => onLearnerChange(learner.id)} className={cn("flex items-center justify-between rounded-xl border p-3 text-left", learner.id === activeLearnerId ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950" : "bg-card")}><span className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full bg-amber-100 font-semibold text-amber-800">{learner.avatar}</span><span><span className="block text-sm font-medium">{learner.displayName}</span><span className="block text-xs text-muted-foreground">独立掌握度、计划与错题本</span></span></span>{learner.id === activeLearnerId ? <Check className="size-4 text-emerald-600" /> : null}</button>)}
        </div>
      </div>
    );
  }
  const content = {
    educator: ["课程版本与知识图谱", "题目双人审核", "教学策略触发与退出条件"],
    safety: ["儿童安全审核队列", "数学与语音质量评测", "数据导出、保留与删除审计"],
    system: ["模型与语音服务配置", "成本和延迟门槛", "不可变策略与调用日志"],
    student: [], guardian: [],
  }[space];
  return <div className="mt-5 grid gap-3">{content.map((item) => <div key={item} className="flex items-center gap-3 rounded-xl border p-4 text-sm"><ShieldCheck className="size-4 text-emerald-600" />{item}<ChevronRight className="ml-auto size-4 text-muted-foreground" /></div>)}</div>;
}
