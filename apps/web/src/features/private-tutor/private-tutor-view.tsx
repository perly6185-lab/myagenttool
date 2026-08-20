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
  RotateCcw,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
  UserRound,
  Volume2,
  LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { useSessionUser } from "@/hooks/use-session-user";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import {
  completeIndependentCheck,
  DEMO_LEARNERS,
  strategyLabel,
  type LearnerTutorState,
  type TutorSettingsSpace,
  type TutorTab,
} from "@/features/private-tutor/private-tutor-model";
import { loadLearnerState, saveLearnerState } from "@/features/private-tutor/private-tutor-storage";

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

type LessonPhase = "ready" | "explain" | "practice" | "complete";

export function PrivateTutorView() {
  const sessionUser = useSessionUser();
  const navigate = usePageNavigation();
  const [tab, setTab] = useState<TutorTab>("today");
  const [activeLearnerId, setActiveLearnerId] = useState(DEMO_LEARNERS[0].id);
  const learner = useMemo(
    () => DEMO_LEARNERS.find((item) => item.id === activeLearnerId) ?? DEMO_LEARNERS[0],
    [activeLearnerId],
  );
  const [learnerState, setLearnerState] = useState<LearnerTutorState>(() => loadLearnerState(learner));

  useEffect(() => setLearnerState(loadLearnerState(learner)), [learner]);
  useEffect(() => saveLearnerState(learnerState), [learnerState]);

  const isVerifiedWorkspaceAdult = sessionUser?.role === "owner" || sessionUser?.role === "admin";

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
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-full border bg-card/80 py-1 pl-1 pr-3 text-sm shadow-sm">
              <span className="grid size-8 place-items-center rounded-full bg-amber-100 font-semibold text-amber-800">{learner.avatar}</span>
              <span className="font-medium">{learner.displayName}</span>
              <span className="text-xs text-muted-foreground">{learner.grade}</span>
            </div>
            <button type="button" onClick={() => navigate("dashboard")} className="grid size-9 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground" aria-label="退出学习"><LogOut className="size-4" /></button>
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
        {tab === "today" ? <TodayLearning state={learnerState} onStateChange={setLearnerState} /> : null}
        {tab === "map" ? <KnowledgeMap state={learnerState} /> : null}
        {tab === "errors" ? <ErrorBook state={learnerState} onStart={() => setTab("today")} /> : null}
        {tab === "growth" ? <Growth state={learnerState} /> : null}
        {tab === "settings" ? (
          <TutorSettings
            state={learnerState}
            activeLearnerId={activeLearnerId}
            onLearnerChange={setActiveLearnerId}
            verifiedAdult={isVerifiedWorkspaceAdult}
          />
        ) : null}
      </div>
    </div>
  );
}

function TodayLearning({ state, onStateChange }: { state: LearnerTutorState; onStateChange: (state: LearnerTutorState) => void }) {
  const [phase, setPhase] = useState<LessonPhase>("ready");
  const [pace, setPace] = useState<"easy" | "standard" | "review">("standard");
  const [answer, setAnswer] = useState<number | null>(null);
  const [voiceMessage, setVoiceMessage] = useState("点一下麦克风，也可以直接说");
  const [listening, setListening] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const progress = Math.round((state.dailyMinutes / 20) * 100);

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);

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

  function chooseAnswer(value: number) {
    setAnswer(value);
    if (value === 5) {
      const updated = completeIndependentCheck(state);
      onStateChange(updated);
      setPhase("complete");
    }
  }

  if (phase === "ready") {
    return (
      <div className="grid gap-5 lg:grid-cols-[1.45fr_0.75fr]">
        <section className="rounded-3xl bg-emerald-600 p-6 text-white shadow-sm sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-emerald-100">下午好，{state.learner.displayName}</p>
              <h1 className="mt-2 max-w-xl text-2xl font-bold leading-tight sm:text-3xl">今天一起弄懂“等式两边为什么要做同样的事”</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-emerald-50">不是因为你粗心，而是这个概念还没有真正站稳。我们会换成天平的方法来看。</p>
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
                {{ easy: "轻松学", standard: "标准 20 分钟", review: "今天只复习" }[value]}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setPhase("explain")} className="mt-7 inline-flex min-h-12 items-center gap-2 rounded-xl bg-amber-300 px-5 font-semibold text-amber-950 shadow-sm transition hover:bg-amber-200">
            开始今天的学习 <ChevronRight className="size-5" />
          </button>
        </section>

        <div className="grid gap-4">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium"><Clock3 className="size-4 text-emerald-600" />今日进度</span>
              <span className="text-sm font-bold text-emerald-700">{state.dailyMinutes} / 20 分钟</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} /></div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">随时可以暂停，明天会从这里继续，不会显示“失败”。</p>
          </Card>
          <Card className="p-5">
            <p className="flex items-center gap-2 text-sm font-medium"><BrainCircuit className="size-4 text-violet-500" />今天为什么学这个？</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">最近两次作答都只改变了等式一边。AI 选择了“概念重建”，不是继续刷同类题。</p>
            <span className="mt-3 inline-flex rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-200">{strategyLabel("concept_rebuild")}</span>
          </Card>
        </div>
      </div>
    );
  }

  if (phase === "complete") {
    return (
      <section className="mx-auto max-w-2xl py-6 text-center">
        <span className="mx-auto grid size-20 place-items-center rounded-full bg-emerald-100 text-emerald-700"><Star className="size-10 fill-current" /></span>
        <h1 className="mt-5 text-2xl font-bold">这是你自己想出来的</h1>
        <p className="mt-2 text-muted-foreground">不是记答案。你用“天平两边一起变化”解释了为什么 x = 5。</p>
        <Card className="mt-6 grid gap-4 p-5 text-left sm:grid-cols-3">
          <GentleStat value="1" label="独立答对" />
          <GentleStat value="+12%" label="当前证据" />
          <GentleStat value="明天" label="换题复测" />
        </Card>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button onClick={() => { setAnswer(null); setPhase("practice"); }}>再挑战一道</Button>
          <Button variant="secondary" onClick={() => setPhase("ready")}>今天先到这里</Button>
        </div>
      </section>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
      <Card className="overflow-hidden">
        <div className="border-b bg-amber-50/70 px-5 py-4 dark:bg-amber-950/20">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">动态白板 · 第 2 步</p>
              <h1 className="mt-1 text-xl font-bold">把方程想成一架平衡的天平</h1>
            </div>
            <button type="button" onClick={() => setPhase("ready")} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted"><CirclePause className="size-4" />暂停</button>
          </div>
        </div>
        <div className="p-5 sm:p-7">
          <BalanceScene revealed={phase === "practice"} />
          <div className="mt-5 rounded-2xl bg-muted/60 p-4">
            <p className="flex gap-2 text-sm leading-6"><Volume2 className="mt-1 size-4 shrink-0 text-emerald-600" />{phase === "explain" ? "两边现在一样重。如果左边拿走 3，右边也要拿走 3，天平才不会歪。" : "现在两边都减去 3。左边只剩 x，右边还剩多少？"}</p>
          </div>
          {phase === "explain" ? (
            <Button className="mt-5" onClick={() => setPhase("practice")}>我看懂了，试一试</Button>
          ) : (
            <div className="mt-5">
              <p className="text-sm font-semibold">x + 3 = 8，所以 x = ?</p>
              <div className="mt-3 grid grid-cols-3 gap-3">
                {[3, 5, 11].map((value) => (
                  <button key={value} type="button" onClick={() => chooseAnswer(value)} className={cn("min-h-12 rounded-xl border-2 text-lg font-bold transition", answer === value && value !== 5 ? "border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950" : "border-border bg-card hover:border-emerald-400")}>{value}</button>
                ))}
              </div>
              {answer !== null && answer !== 5 ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">没关系。不要猜答案：试着在右边的 8 里也拿走 3。</p> : null}
            </div>
          )}
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
            <Button variant="secondary" className="justify-start"><RotateCcw />换一种讲法</Button>
            <Button variant="secondary" className="justify-start"><Volume2 />说慢一点</Button>
            <Button variant="secondary" className="justify-start"><BrainCircuit />我完全不会</Button>
          </div>
        </Card>
      </aside>
    </div>
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

function KnowledgeMap({ state }: { state: LearnerTutorState }) {
  const tone = { mastered: "border-emerald-400 bg-emerald-50", learning: "border-sky-400 bg-sky-50", needs_support: "border-amber-400 bg-amber-50", unknown: "border-slate-300 bg-slate-50" };
  const label = { mastered: "已经掌握", learning: "正在学习", needs_support: "需要帮助", unknown: "尚未测到" };
  return (
    <section>
      <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{state.learner.curriculum}</p>
      <h1 className="mt-1 text-2xl font-bold">我的知识地图</h1>
      <p className="mt-2 text-sm text-muted-foreground">它不是成绩单，而是一张“下一步怎么学”的地图。没有证据的地方会显示尚未测到。</p>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {state.knowledge.map((node, index) => (
          <Card key={node.id} className={cn("relative overflow-hidden border-2 p-5", tone[node.level])}>
            <span className="absolute right-4 top-3 text-5xl font-black text-foreground/5">{index + 1}</span>
            <div className="relative">
              <span className="rounded-full bg-card/80 px-2.5 py-1 text-xs font-medium">{label[node.level]}</span>
              <h2 className="mt-4 text-lg font-bold">{node.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{node.evidence}</p>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/70 dark:bg-black/20"><div className="h-full rounded-full bg-current opacity-55" style={{ width: node.mastery === null ? "0%" : `${Math.round(node.mastery * 100)}%` }} /></div>
              <p className="mt-2 text-xs text-muted-foreground">{node.mastery === null ? "等待后续学习证据" : `当前证据 ${Math.round(node.mastery * 100)}%`}</p>
            </div>
          </Card>
        ))}
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

function TutorSettings({ state, activeLearnerId, onLearnerChange, verifiedAdult }: { state: LearnerTutorState; activeLearnerId: string; onLearnerChange: (id: string) => void; verifiedAdult: boolean }) {
  const [space, setSpace] = useState<TutorSettingsSpace>("student");
  const [captions, setCaptions] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
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
