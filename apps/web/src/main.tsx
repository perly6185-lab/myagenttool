import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App";
import { Providers } from "@/app/providers";
import "@/lib/i18n";
import "@/assets/main.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root container #root not found");

createRoot(container).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>,
);
