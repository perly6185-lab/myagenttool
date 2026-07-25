import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// The web console is served two ways: `vite` dev server for HMR, and the
// Node static server (src/index.mjs) over the built `dist/` for the M0 demo.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "app-version",
      transformIndexHtml(html) {
        const version = process.env.GITHUB_SHA?.slice(0, 12) ?? process.env.npm_package_version ?? "dev";
        return html.replace("<html", `<html data-app-version="${version}"`);
      },
    },
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 3000,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    manifest: true,
    // Feature screens are route-lazy. Keep frequently shared libraries stable
    // so a screen update does not invalidate the whole application shell.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) return "vendor-react";
          if (id.includes("@tanstack/react-query") || id.includes("/zustand/")) return "vendor-state";
          if (id.includes("react-markdown") || id.includes("remark-") || id.includes("micromark") || id.includes("mdast-") || id.includes("hast-")) return "vendor-markdown";
          return undefined;
        },
      },
    },
    // Excalidraw's lazy-loaded font-subsetting worker is a standalone optional
    // asset (~1.8 MB) and never blocks the shell. Warn only above that boundary.
    chunkSizeWarningLimit: 1_900,
  },
});
