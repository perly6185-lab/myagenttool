export const ENTRY_BUNDLE_LIMITS = Object.freeze({
  "index.html": 525_000,
  "src/features/tasks/local-tasks-view.tsx": 140_000,
  "src/features/auto-runs/auto-runs-view.tsx": 110_000,
  "src/features/local-content/local-library-view.tsx": 30_000,
});

export const INITIAL_JS_WARNING_BYTES = 780_000;
// A first-level Local Library adds only shell registration and navigation copy
// to the initial graph; its implementation remains route-lazy and has its own
// hard budget above. Preserve that deliberate 2 kB shell allowance explicitly.
export const INITIAL_JS_HARD_LIMIT_BYTES = 802_000;

export function evaluateInitialJsBudget(
  size,
  { warningBytes = INITIAL_JS_WARNING_BYTES, hardLimitBytes = INITIAL_JS_HARD_LIMIT_BYTES } = {},
) {
  if (!Number.isFinite(size) || size < 0) throw new TypeError("Initial JS size must be a non-negative number");
  if (!Number.isFinite(warningBytes) || !Number.isFinite(hardLimitBytes) || warningBytes > hardLimitBytes) {
    throw new TypeError("Initial JS warning threshold must not exceed the hard limit");
  }
  return {
    size,
    warningBytes,
    hardLimitBytes,
    level: size > hardLimitBytes ? "failure" : size >= warningBytes ? "warning" : "ok",
    hardHeadroom: Math.max(0, hardLimitBytes - size),
    hardOverage: Math.max(0, size - hardLimitBytes),
  };
}

export function initialJsManifestEntries(manifest) {
  const entry = manifest?.["index.html"];
  if (!entry) throw new Error("Bundle manifest is missing index.html");
  return [entry, ...(entry.imports ?? []).map((key) => {
    const imported = manifest[key];
    if (!imported) throw new Error(`Bundle manifest import is missing: ${key}`);
    return imported;
  })];
}

export async function calculateInitialJsSize(manifest, assetSize) {
  const sizes = await Promise.all(initialJsManifestEntries(manifest).map(assetSize));
  return sizes.reduce((sum, size) => sum + size, 0);
}

export function formatKilobytes(bytes) {
  return `${(bytes / 1000).toFixed(1)} kB`;
}

export function initialJsWarningMessage(evaluation) {
  if (evaluation.level !== "warning") return null;
  return [
    `Initial Web JavaScript is ${formatKilobytes(evaluation.size)}, leaving ${formatKilobytes(evaluation.hardHeadroom)}`,
    `before the ${formatKilobytes(evaluation.hardLimitBytes)} hard limit.`,
    "Keep route-only resources and heavy feature modules behind lazy import() boundaries; inspect newly added static imports.",
  ].join(" ");
}

export function initialJsFailureMessage(evaluation) {
  return evaluation.level === "failure"
    ? `initial JS exceeds its budget by ${formatKilobytes(evaluation.hardOverage)}`
    : null;
}

function escapeWorkflowCommand(value) {
  return String(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

export function githubActionsWarning(message) {
  return `::warning title=Web bundle budget::${escapeWorkflowCommand(message)}`;
}

export function githubStepSummary(message) {
  return `\n## Web bundle budget warning\n\n${message}\n`;
}
