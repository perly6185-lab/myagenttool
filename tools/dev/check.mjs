import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const required = ["run-local-demo.mjs", "restart-changed-services.mjs", "local-smoke.mjs", "m0-acceptance.mjs", "visual-qa.mjs", "prototype-qa.mjs", "canvas-contract-qa.mjs", "import-ascii-prototype.mjs", "export-prototype-canvas.mjs"];
const missing = required.filter((path) => !existsSync(new URL(path, import.meta.url)));

if (missing.length > 0) {
  console.error(`[tools-dev:check] missing files: ${missing.join(", ")}`);
  process.exit(1);
}

const codexPilotDoc = resolve(repoRoot, "docs/engineering/CODEX_AGENT_PILOT.md");
if (!existsSync(codexPilotDoc)) {
  console.error("[tools-dev:check] missing docs/engineering/CODEX_AGENT_PILOT.md");
  process.exit(1);
}
const codexCloseoutDoc = resolve(repoRoot, "docs/engineering/CODEX_AGENT_PILOT_CLOSEOUT.md");
if (!existsSync(codexCloseoutDoc)) {
  console.error("[tools-dev:check] missing docs/engineering/CODEX_AGENT_PILOT_CLOSEOUT.md");
  process.exit(1);
}

const codexPilot = readFileSync(codexPilotDoc, "utf8");
const requiredCodexPilotMarkers = [
  "Stage 1: M0-M2 Readiness Audit",
  "Stage 2: Codex Discovery And Adapter Config",
  "Stage 3: Probe, Registration, And Enable Flow",
  "Stage 4: Real Invocation, Cancellation, And Evidence",
  "codex exec",
  "native to Codex CLI",
  "JSONL output",
];
const missingMarkers = requiredCodexPilotMarkers.filter((marker) => !codexPilot.includes(marker));
if (missingMarkers.length > 0) {
  console.error(`[tools-dev:check] Codex pilot doc missing markers: ${missingMarkers.join(", ")}`);
  process.exit(1);
}

const codexCloseout = readFileSync(codexCloseoutDoc, "utf8");
for (const marker of ["Delivered Stages", "Safety Boundaries Preserved", "Residual Follow-Up"]) {
  if (!codexCloseout.includes(marker)) {
    console.error(`[tools-dev:check] Codex pilot closeout missing marker: ${marker}`);
    process.exit(1);
  }
}

console.log("[tools-dev:check] local demo tooling check OK");
