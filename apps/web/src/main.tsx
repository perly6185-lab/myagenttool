import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App";
import { Providers } from "@/app/providers";
import { i18nReady } from "@/lib/i18n";
import "@/assets/main.css";
import { startWebPerformanceMonitoring } from "@/lib/web-performance";

const container = document.getElementById("root");
if (!container) throw new Error("Root container #root not found");

const RiskReminderAcceptanceSurface = lazy(() => import("@/features/tasks/risk-reminder-acceptance-surface"));
const acceptanceSurface = window.location.pathname === "/_acceptance/risk-reminders";

void i18nReady.then(() => {
  if (!acceptanceSurface) startWebPerformanceMonitoring();
  createRoot(container).render(
    <StrictMode>
      <Providers>
        {acceptanceSurface ? (
          <Suspense fallback={null}>
            <RiskReminderAcceptanceSurface />
          </Suspense>
        ) : <App />}
      </Providers>
    </StrictMode>,
  );
});
