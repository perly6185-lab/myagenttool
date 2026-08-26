export type PrivateTutorVoiceMode = "push_to_talk" | "hands_free";

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: { readonly length: number; [index: number]: SpeechRecognitionResultLike };
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechWindow extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

export interface PrivateTutorRecognitionController {
  stop(): void;
  abort(): void;
}

export function browserSpeechRecognitionAvailable() {
  const speechWindow = window as SpeechWindow;
  return Boolean(speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition);
}

export function startPrivateTutorRecognition({
  mode,
  onInterim,
  onFinal,
  onError,
  onEnd,
}: {
  mode: PrivateTutorVoiceMode;
  onInterim: (transcript: string) => void;
  onFinal: (result: { transcript: string; confidence: number; alternatives: string[] }) => void;
  onError: (error: string) => void;
  onEnd: () => void;
}): PrivateTutorRecognitionController | null {
  const speechWindow = window as SpeechWindow;
  const Constructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
  if (!Constructor) return null;
  const recognition = new Constructor();
  recognition.lang = "zh-CN";
  recognition.continuous = mode === "hands_free";
  recognition.interimResults = true;
  recognition.maxAlternatives = 3;
  recognition.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = String(result[0]?.transcript ?? "").trim();
      if (!transcript) continue;
      if (!result.isFinal) {
        onInterim(transcript);
        continue;
      }
      onFinal({
        transcript,
        confidence: Number.isFinite(result[0]?.confidence) ? result[0].confidence : 0,
        alternatives: Array.from({ length: result.length }, (_, alternativeIndex) => result[alternativeIndex]?.transcript?.trim())
          .filter((value): value is string => Boolean(value))
          .slice(1, 3),
      });
    }
  };
  recognition.onerror = (event) => onError(event.error || "recognition_error");
  recognition.onend = onEnd;
  try {
    recognition.start();
  } catch {
    onError("start_failed");
    return null;
  }
  return {
    stop: () => recognition.stop(),
    abort: () => recognition.abort(),
  };
}

export function speakPrivateTutorText(text: string, {
  rate = 1,
  onStart,
  onEnd,
}: {
  rate?: number;
  onStart?: () => void;
  onEnd?: () => void;
} = {}) {
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  utterance.rate = Math.max(0.6, Math.min(1.2, rate));
  utterance.onstart = () => onStart?.();
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();
  window.speechSynthesis.speak(utterance);
  return true;
}

export function interruptPrivateTutorSpeech() {
  if (!("speechSynthesis" in window)) return false;
  const wasSpeaking = window.speechSynthesis.speaking || window.speechSynthesis.pending;
  window.speechSynthesis.cancel();
  return wasSpeaking;
}
