import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, CirclePause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { PrivateTutorVisualScene } from "@/features/private-tutor/private-tutor-api";

export function PrivateTutorVisualBoard({
  scene,
  reducedMotion,
  disabled,
  onNarrate,
  onStopNarration,
  onAnswer,
}: {
  scene: PrivateTutorVisualScene;
  reducedMotion: boolean;
  disabled: boolean;
  onNarrate: (text: string, onEnd: () => void) => boolean;
  onStopNarration: () => void;
  onAnswer: (value: string) => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const runTokenRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const step = scene.steps[stepIndex] ?? scene.steps[0];

  useEffect(() => {
    runTokenRef.current += 1;
    setStepIndex(0);
    setPlaying(false);
    return () => {
      runTokenRef.current += 1;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [scene.revisionId]);

  function stopPlayback() {
    runTokenRef.current += 1;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setPlaying(false);
    onStopNarration();
  }

  function playFrom(startIndex: number) {
    stopPlayback();
    const token = runTokenRef.current;
    setPlaying(true);
    if (reducedMotion) {
      setStepIndex(startIndex);
      const finish = () => { if (runTokenRef.current === token) setPlaying(false); };
      const spoken = onNarrate(scene.steps[startIndex].narration, finish);
      if (!spoken) timerRef.current = setTimeout(finish, 900);
      return;
    }
    const playStep = (index: number) => {
      if (runTokenRef.current !== token) return;
      setStepIndex(index);
      const advance = () => {
        if (runTokenRef.current !== token) return;
        if (index >= scene.steps.length - 1) {
          setPlaying(false);
          return;
        }
        playStep(index + 1);
      };
      const spoken = onNarrate(scene.steps[index].narration, advance);
      if (!spoken) {
        timerRef.current = setTimeout(advance, reducedMotion ? 900 : scene.steps[index].durationMs);
      }
    };
    playStep(startIndex);
  }

  function showStep(index: number) {
    stopPlayback();
    const bounded = Math.max(0, Math.min(scene.steps.length - 1, index));
    setStepIndex(bounded);
    onNarrate(scene.steps[bounded].narration, () => undefined);
  }

  return (
    <section className="overflow-hidden rounded-2xl border bg-sky-50/70 dark:bg-sky-950/30" aria-label={`动态白板：${scene.title}`} data-motion={reducedMotion ? "reduced" : "full"}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-card/70 px-3 py-2">
        <div>
          <p className="text-sm font-semibold">{scene.title}</p>
          <p className="text-[11px] text-muted-foreground">场景 {scene.publication.contentVersion} · 数学参数已校验</p>
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" size="icon" variant="ghost" aria-label="上一步" disabled={stepIndex === 0 || disabled} onClick={() => showStep(stepIndex - 1)}><ChevronLeft /></Button>
          <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => playing ? stopPlayback() : playFrom(stepIndex)}>{playing ? <CirclePause /> : <Play />}{playing ? "暂停" : "播放"}</Button>
          <Button type="button" size="icon" variant="ghost" aria-label="重放动画" disabled={disabled} onClick={() => playFrom(0)}><RotateCcw /></Button>
          <Button type="button" size="icon" variant="ghost" aria-label="下一步" disabled={stepIndex >= scene.steps.length - 1 || disabled} onClick={() => showStep(stepIndex + 1)}><ChevronRight /></Button>
        </div>
      </div>

      <div className={cn("p-3 sm:p-4", !reducedMotion && "transition-all duration-500")}>
        <VisualTemplate scene={scene} stepIndex={stepIndex} reducedMotion={reducedMotion} />
        <div className="mt-3 flex items-start gap-3 rounded-xl bg-card/85 p-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800">{stepIndex + 1}</span>
          <div>
            <p aria-live="polite" className="text-sm font-medium leading-6">{step.narration}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">第 {stepIndex + 1} / {scene.steps.length} 步 · 可以暂停或逐步查看</p>
          </div>
        </div>
        {scene.interaction ? (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 dark:border-emerald-900 dark:bg-emerald-950/70">
            <p className="text-sm font-medium">{scene.interaction.prompt}</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {scene.interaction.choices.map((choice) => (
                <button key={choice.id} type="button" disabled={disabled} onClick={() => onAnswer(choice.value)} className="min-h-11 rounded-lg border-2 bg-card px-2 text-sm font-semibold transition hover:border-emerald-500 disabled:opacity-60">{choice.label}</button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">点选结果会作为“视觉交互作答”交给服务端判题，动画本身不会替你判分。</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function VisualTemplate({ scene, stepIndex, reducedMotion }: { scene: PrivateTutorVisualScene; stepIndex: number; reducedMotion: boolean }) {
  if (scene.template === "number_line") return <NumberLine parameters={scene.parameters} stepIndex={stepIndex} reducedMotion={reducedMotion} ariaLabel={scene.ariaLabel} />;
  if (scene.template === "equation_balance") return <EquationBalance parameters={scene.parameters} stepIndex={stepIndex} reducedMotion={reducedMotion} ariaLabel={scene.ariaLabel} />;
  if (scene.template === "bar_model") return <BarModel parameters={scene.parameters} stepIndex={stepIndex} ariaLabel={scene.ariaLabel} />;
  if (scene.template === "comparison") return <Comparison parameters={scene.parameters} stepIndex={stepIndex} ariaLabel={scene.ariaLabel} />;
  if (scene.template === "fraction_strip") return <FractionStrip parameters={scene.parameters} stepIndex={stepIndex} ariaLabel={scene.ariaLabel} />;
  return <CoordinatePlane parameters={scene.parameters} stepIndex={stepIndex} reducedMotion={reducedMotion} ariaLabel={scene.ariaLabel} />;
}

function NumberLine({ parameters, stepIndex, reducedMotion, ariaLabel }: TemplateProps) {
  const minimum = numberParam(parameters, "minimum", -10);
  const maximum = numberParam(parameters, "maximum", 10);
  const start = numberParam(parameters, "start", 0);
  const result = numberParam(parameters, "result", start);
  const active = stepIndex === 0 ? start : result;
  const x = 60 + ((active - minimum) / (maximum - minimum)) * 520;
  const ticks = Array.from({ length: 7 }, (_, index) => Math.round(minimum + ((maximum - minimum) * index) / 6));
  return (
    <svg viewBox="0 0 640 230" role="img" aria-label={ariaLabel} className="w-full">
      <line x1="50" y1="130" x2="590" y2="130" stroke="currentColor" strokeWidth="4" className="text-slate-500" />
      <path d="M590 130 l-14 -9 v18 z" fill="currentColor" className="text-slate-500" />
      {ticks.map((value, index) => { const tickX = 60 + (index / 6) * 520; return <g key={`${value}-${index}`}><line x1={tickX} y1="119" x2={tickX} y2="141" stroke="currentColor" strokeWidth="2" /><text x={tickX} y="165" textAnchor="middle" fontSize="16" fill="currentColor">{value}</text></g>; })}
      <g className={cn(!reducedMotion && "transition-transform duration-700")} style={{ transform: `translateX(${x - 60}px)` }}>
        <circle cx="60" cy="90" r="18" fill="currentColor" className="text-emerald-500" />
        <path d="M60 108 L60 126" stroke="currentColor" strokeWidth="4" className="text-emerald-600" />
        <text x="60" y="58" textAnchor="middle" fontSize="21" fontWeight="700" fill="currentColor">{active}</text>
      </g>
    </svg>
  );
}

function EquationBalance({ parameters, stepIndex, reducedMotion, ariaLabel }: TemplateProps) {
  const states = arrayParam(parameters, "states");
  const active = objectParam(states[Math.min(stepIndex, states.length - 1)]);
  return (
    <svg viewBox="0 0 640 275" role="img" aria-label={ariaLabel} className="w-full">
      <path d="M320 54 L255 240 H385 Z" fill="currentColor" className="text-slate-300 dark:text-slate-700" />
      <circle cx="320" cy="68" r="17" fill="currentColor" className="text-emerald-500" />
      <g className={cn("origin-center", !reducedMotion && "transition-transform duration-700")}>
        <rect x="100" y="82" width="440" height="12" rx="6" fill="currentColor" className="text-slate-600 dark:text-slate-300" />
        <path d="M160 94 L112 194 H208 Z M480 94 L432 194 H528 Z" fill="none" stroke="currentColor" strokeWidth="5" className="text-slate-500" />
        <rect x="102" y="194" width="116" height="12" rx="6" fill="currentColor" className="text-amber-500" />
        <rect x="422" y="194" width="116" height="12" rx="6" fill="currentColor" className="text-amber-500" />
        <text x="160" y="162" textAnchor="middle" fontSize="30" fontWeight="700" fill="currentColor">{stringParam(active, "left", "x")}</text>
        <text x="480" y="162" textAnchor="middle" fontSize="30" fontWeight="700" fill="currentColor">{stringParam(active, "right", "?")}</text>
      </g>
    </svg>
  );
}

function BarModel({ parameters, stepIndex, ariaLabel }: Omit<TemplateProps, "reducedMotion">) {
  const total = numberParam(parameters, "total", 1);
  const parts = Math.max(1, numberParam(parameters, "equalParts", 1));
  const extra = numberParam(parameters, "extra", 0);
  return (
    <svg viewBox="0 0 640 235" role="img" aria-label={ariaLabel} className="w-full">
      <text x="320" y="42" textAnchor="middle" fontSize="20" fontWeight="700" fill="currentColor">总量 {total}</text>
      <rect x="70" y="72" width="500" height="72" rx="10" fill="currentColor" className="text-sky-100 dark:text-sky-900" stroke="currentColor" strokeWidth="3" />
      {stepIndex > 0 ? Array.from({ length: parts - 1 }, (_, index) => <line key={index} x1={70 + (500 * (index + 1)) / parts} y1="72" x2={70 + (500 * (index + 1)) / parts} y2="144" stroke="currentColor" strokeWidth="3" className="text-sky-600" />) : null}
      {stepIndex > 0 ? Array.from({ length: parts }, (_, index) => <text key={index} x={70 + (500 * (index + 0.5)) / parts} y="115" textAnchor="middle" fontSize="22" fontWeight="700" fill="currentColor">x</text>) : null}
      {extra ? <text x="320" y="180" textAnchor="middle" fontSize="18" fill="currentColor">另外多出 {extra}</text> : null}
      {stepIndex >= 2 ? <text x="320" y="215" textAnchor="middle" fontSize="22" fontWeight="700" fill="currentColor">每份 = {numberParam(parameters, "unitValue", 0)}</text> : null}
    </svg>
  );
}

function Comparison({ parameters, stepIndex, ariaLabel }: Omit<TemplateProps, "reducedMotion">) {
  return (
    <div role="img" aria-label={ariaLabel} className="grid min-h-48 grid-cols-2 gap-3 p-3">
      <div className="grid place-items-center rounded-xl border-2 bg-card p-4 text-center"><span className="text-xl font-bold">{stringParam(parameters, "left", "")}</span><span className="mt-3 text-xs text-muted-foreground">等式</span></div>
      <div className={cn("grid place-items-center rounded-xl border-2 bg-card p-4 text-center", stepIndex > 0 && "border-emerald-500 ring-4 ring-emerald-100")}><span className="text-xl font-bold">{stringParam(parameters, "right", "")}</span><span className="mt-3 text-xs text-muted-foreground">{stepIndex > 1 ? "含未知数的等式：方程" : "找到未知数"}</span></div>
    </div>
  );
}

function FractionStrip({ parameters, stepIndex, ariaLabel }: Omit<TemplateProps, "reducedMotion">) {
  const denominator = Math.max(2, numberParam(parameters, "denominator", 4));
  const numerator = Math.max(0, Math.min(denominator, numberParam(parameters, "numerator", 1)));
  return <div role="img" aria-label={ariaLabel} className="grid min-h-44 place-items-center p-6"><div className="flex w-full max-w-lg overflow-hidden rounded-xl border-2">{Array.from({ length: denominator }, (_, index) => <div key={index} className={cn("grid h-20 flex-1 place-items-center border-r last:border-r-0", stepIndex > 0 && index < numerator ? "bg-emerald-400" : "bg-card")}>{index < numerator && stepIndex > 1 ? "✓" : ""}</div>)}</div></div>;
}

function CoordinatePlane({ parameters, stepIndex, reducedMotion, ariaLabel }: TemplateProps) {
  const x = numberParam(parameters, "x", 2);
  const y = numberParam(parameters, "y", 2);
  const pointX = 320 + x * 35;
  const pointY = 150 - y * 35;
  return <svg viewBox="0 0 640 300" role="img" aria-label={ariaLabel} className="w-full"><line x1="70" y1="150" x2="570" y2="150" stroke="currentColor" strokeWidth="3" /><line x1="320" y1="25" x2="320" y2="275" stroke="currentColor" strokeWidth="3" />{stepIndex > 0 ? <circle cx={pointX} cy={pointY} r="12" fill="currentColor" className={cn("text-emerald-500", !reducedMotion && "transition-all duration-700")} /> : null}<text x={pointX + 18} y={pointY - 12} fontSize="18" fill="currentColor">({x}, {y})</text></svg>;
}

interface TemplateProps {
  parameters: Record<string, unknown>;
  stepIndex: number;
  reducedMotion: boolean;
  ariaLabel: string;
}

function numberParam(parameters: Record<string, unknown>, key: string, fallback: number) {
  return typeof parameters[key] === "number" && Number.isFinite(parameters[key]) ? parameters[key] : fallback;
}

function stringParam(parameters: Record<string, unknown>, key: string, fallback = "") {
  return typeof parameters[key] === "string" ? parameters[key] : fallback;
}

function arrayParam(parameters: Record<string, unknown>, key: string) {
  return Array.isArray(parameters[key]) ? parameters[key] : [];
}

function objectParam(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
