import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App";
import { Providers } from "@/app/providers";
import { i18nReady } from "@/lib/i18n";
import "@/assets/main.css";
import { startWebPerformanceMonitoring } from "@/lib/web-performance";

const container = document.getElementById("root");
if (!container) throw new Error("Root container #root not found");

void i18nReady.then(() => {
  startWebPerformanceMonitoring();
  createRoot(container).render(
    <StrictMode>
      <Providers>
        <App />
      </Providers>
    </StrictMode>,
  );
});
