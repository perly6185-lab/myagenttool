import { afterEach, describe, expect, it, vi } from "vitest";
import {
  interruptPrivateTutorSpeech,
  speakPrivateTutorText,
  startPrivateTutorRecognition,
} from "@/features/private-tutor/private-tutor-voice";

describe("private tutor browser voice adapter", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "webkitSpeechRecognition");
    Reflect.deleteProperty(window, "speechSynthesis");
    Reflect.deleteProperty(globalThis, "SpeechSynthesisUtterance");
    vi.restoreAllMocks();
  });

  it("returns final transcript, confidence, and alternatives without recording audio", () => {
    const onFinal = vi.fn();
    class MockRecognition {
      static latest: MockRecognition;
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: ((event: never) => void) | null = null;
      onerror = null;
      onend = null;
      constructor() { MockRecognition.latest = this; }
      start() {}
      stop() {}
      abort() {}
    }
    (window as typeof window & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = MockRecognition;
    startPrivateTutorRecognition({ mode: "push_to_talk", onInterim: vi.fn(), onFinal, onError: vi.fn(), onEnd: vi.fn() });
    MockRecognition.latest.onresult?.({
      resultIndex: 0,
      results: { length: 1, 0: { isFinal: true, length: 2, 0: { transcript: "五", confidence: 0.92 }, 1: { transcript: "四", confidence: 0.3 } } },
    } as never);
    expect(onFinal).toHaveBeenCalledWith({ transcript: "五", confidence: 0.92, alternatives: ["四"] });
  });

  it("supports speech synthesis rate control and immediate interruption", () => {
    const speak = vi.fn();
    const cancel = vi.fn();
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { speak, cancel, speaking: true, pending: false } });
    class MockUtterance {
      lang = "";
      rate = 1;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(readonly text: string) {}
    }
    Object.defineProperty(globalThis, "SpeechSynthesisUtterance", { configurable: true, value: MockUtterance });

    expect(speakPrivateTutorText("把方程想成平衡的天平", { rate: 0.78 })).toBe(true);
    expect(speak).toHaveBeenCalledOnce();
    expect(speak.mock.calls[0][0].rate).toBe(0.78);
    expect(interruptPrivateTutorSpeech()).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(2);
  });
});
