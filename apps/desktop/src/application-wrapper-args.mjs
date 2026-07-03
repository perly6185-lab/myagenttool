// Bridge-side argv injection for the platform Application Wrapper Runner (#359).
// Extracted from index.mjs so it is unit-testable in CI (the bridge --check is
// environment-gated and excluded from test:ci).
//
// The runner agent's command is fixed (`node application-wrapper.mjs`). The
// SERVER resolved an approved command and put it in `options.metadata.
// applicationWrapper`; here we relay it as discrete argv — `--exec-command` +
// one `--exec-arg` per element — so each token stays a separate argv element and
// nothing becomes a shell string. cwd resolution (filesystem-dependent) is
// injected by the caller so this stays pure/testable.

export function usesApplicationWrapper(renderedArgs) {
  return renderedArgs.some((arg) => String(arg).endsWith("application-wrapper.mjs"));
}

export function applicationWrapperArgs(renderedArgs, payload, { resolveCwd } = {}) {
  if (!usesApplicationWrapper(renderedArgs)) return renderedArgs;
  const metadata = payload?.options?.metadata;
  const spec = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata.applicationWrapper : null;
  // No spec → leave args untouched; the runner then fails safely on a missing
  // --exec-command rather than executing anything.
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return renderedArgs;

  const injected = [...renderedArgs];
  const execCommand = boundedString(spec.execCommand, 200);
  if (execCommand && !hasFlag(injected, "--exec-command")) {
    injected.push("--exec-command", execCommand);
  }
  // Each arg is preceded by its own --exec-arg, so an arg that itself looks like
  // a flag (e.g. "--json") is consumed as a value, never as a runner flag.
  for (const arg of Array.isArray(spec.execArgs) ? spec.execArgs : []) {
    injected.push("--exec-arg", String(arg));
  }
  const cwd = typeof resolveCwd === "function" ? resolveCwd(spec, metadata) : null;
  if (cwd && !hasFlag(injected, "--cwd")) {
    injected.push("--cwd", cwd);
  }
  const capability = boundedString(spec.capability, 200);
  if (capability && !hasFlag(injected, "--capability")) {
    injected.push("--capability", capability);
  }
  return injected;
}

function boundedString(value, maxLength) {
  const text = String(value ?? "").trim();
  return text && text.length <= maxLength ? text : null;
}

function hasFlag(args, flag) {
  return args.includes(flag);
}
