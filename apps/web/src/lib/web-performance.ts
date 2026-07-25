export type WebPerformanceMetric = {
  name: "CLS" | "FCP" | "INP" | "LCP";
  value: number;
  rating: "good" | "needs-improvement" | "poor";
  path: string;
  recordedAt: string;
};

const thresholds: Record<WebPerformanceMetric["name"], [number, number]> = {
  CLS: [0.1, 0.25],
  FCP: [1_800, 3_000],
  INP: [200, 500],
  LCP: [2_500, 4_000],
};

export function rateWebPerformance(
  name: WebPerformanceMetric["name"],
  value: number,
): WebPerformanceMetric["rating"] {
  const [good, poor] = thresholds[name];
  if (value <= good) return "good";
  if (value <= poor) return "needs-improvement";
  return "poor";
}

declare global {
  interface Window {
    __myagenttoolPerformance?: Partial<Record<WebPerformanceMetric["name"], WebPerformanceMetric>>;
  }
}

export function startWebPerformanceMonitoring() {
  if (!("PerformanceObserver" in window)) return () => {};
  const observers: PerformanceObserver[] = [];
  let cls = 0;
  const reportTimers = new Map<WebPerformanceMetric["name"], number>();

  const publish = (name: WebPerformanceMetric["name"], value: number) => {
    const metric: WebPerformanceMetric = {
      name,
      value: Math.round(value * 100) / 100,
      rating: rateWebPerformance(name, value),
      path: `${window.location.pathname}${window.location.search}`,
      recordedAt: new Date().toISOString(),
    };
    window.__myagenttoolPerformance = { ...window.__myagenttoolPerformance, [name]: metric };
    window.dispatchEvent(new CustomEvent("myagenttool:performance", { detail: metric }));
    const previous = reportTimers.get(name);
    if (previous) window.clearTimeout(previous);
    reportTimers.set(name, window.setTimeout(() => {
      void api.reportWebPerformance({
        ...metric,
        version: document.documentElement.dataset.appVersion ?? "dev",
      }).catch(() => {
        // Telemetry must never interfere with the operator's workflow.
      });
    }, 1_000));
  };

  const observe = (type: string, callback: PerformanceObserverCallback) => {
    try {
      const observer = new PerformanceObserver(callback);
      observer.observe({ type, buffered: true });
      observers.push(observer);
    } catch {
      // Older embedded browsers may not support every entry type.
    }
  };

  observe("paint", (list) => {
    const entry = list.getEntries().find((item) => item.name === "first-contentful-paint");
    if (entry) publish("FCP", entry.startTime);
  });
  observe("largest-contentful-paint", (list) => {
    const entry = list.getEntries().at(-1);
    if (entry) publish("LCP", entry.startTime);
  });
  observe("layout-shift", (list) => {
    for (const entry of list.getEntries()) {
      const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
      if (!shift.hadRecentInput) cls += shift.value ?? 0;
    }
    publish("CLS", cls);
  });
  observe("event", (list) => {
    const longest = Math.max(0, ...list.getEntries().map((entry) => entry.duration));
    if (longest) publish("INP", longest);
  });

  return () => {
    observers.forEach((observer) => observer.disconnect());
    reportTimers.forEach((timer) => window.clearTimeout(timer));
  };
}
import { api } from "@/lib/api-client";
