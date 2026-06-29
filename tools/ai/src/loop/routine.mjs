import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const __dirname = dirname(scriptPath);
const defaultRepoRoot = resolve(__dirname, "../../../..");
const repoRoot = resolve(process.env.MYAGENTTOOL_REPO_ROOT ?? defaultRepoRoot);

export const LOOP_ROUTINE_API_VERSION = "myagenttool.dev/v1";
export const LOOP_ROUTINE_KIND = "LoopRoutine";
export const LOOP_ROUTINE_SCHEMA_VERSION = 1;
export const LOOP_ROUTINE_SCHEDULE_MODES = ["manual", "cron", "event"];
export const LOOP_ROUTINE_INPUT_TYPES = [
  "filesystem.glob",
  "git.commits",
  "github.issues",
  "github.prs",
  "github.checks",
  "loop.registry",
];
export const LOOP_ROUTINE_CHECK_TYPES = ["command", "loop-registry", "docs-check", "typecheck", "test"];
export const LOOP_ROUTINE_WRITE_POLICIES = ["forbidden", "approval-required", "allowed"];

const LOOP_ROUTINE_SUPPORTED_RUN_INPUTS = ["filesystem.glob", "git.commits", "loop.registry"];
const LOOP_ROUTINE_DEFAULT_COMMAND_ALLOWLIST = new Set([
  "ai:loop-registry-check",
  "docs:check",
  "typecheck",
  "test",
  "ai:check",
]);

export function loadLoopRoutineFile(file, root = repoRoot) {
  if (!file) fail("Missing --file.");
  const path = resolve(root, file);
  if (!existsSync(path)) fail(`Loop routine file not found: ${file}`);
  const source = readFileSync(path, "utf8");
  const parsed = parseLoopRoutineSource(source, path);
  return {
    path,
    relativePath: relativeRepoPath(path, root),
    routine: normalizeLoopRoutine(parsed),
  };
}

export function parseLoopRoutineSource(source, path = "routine.json") {
  if (/\.(ya?ml)$/i.test(path)) return parseSimpleYaml(source);
  try {
    return JSON.parse(source);
  } catch (error) {
    fail(`Invalid loop routine JSON in ${path}: ${error.message}`);
  }
}

export function normalizeLoopRoutine(value) {
  const routine = isObject(value) ? value : {};
  const id = stringOr(routine.metadata?.id, "routine");
  return {
    apiVersion: stringOr(routine.apiVersion, LOOP_ROUTINE_API_VERSION),
    kind: stringOr(routine.kind, LOOP_ROUTINE_KIND),
    metadata: {
      id,
      name: stringOr(routine.metadata?.name, id),
      description: stringOr(routine.metadata?.description, ""),
      owner: stringOr(routine.metadata?.owner, "engineering"),
      enabled: booleanOr(routine.metadata?.enabled, true),
    },
    schedule: {
      mode: stringOr(routine.schedule?.mode, "manual"),
      timezone: stringOr(routine.schedule?.timezone, "UTC"),
      cron: routine.schedule?.cron ?? null,
      event: routine.schedule?.event ?? null,
      maxConcurrency: positiveIntegerOr(routine.schedule?.maxConcurrency, 1),
      cooldownMs: nonNegativeIntegerOr(routine.schedule?.cooldownMs, 0),
      deadlineMs: positiveIntegerOr(routine.schedule?.deadlineMs, 1800000),
    },
    inputs: arrayOr(routine.inputs, []).map((input) => ({ ...input })),
    skills: arrayOr(routine.skills, []).map((skill) => ({
      id: stringOr(skill?.id, ""),
      path: stringOr(skill?.path, ""),
      required: booleanOr(skill?.required, false),
    })),
    goal: {
      summary: stringOr(routine.goal?.summary, ""),
      successCriteria: stringArrayOr(routine.goal?.successCriteria, []),
      fanout: {
        enabled: booleanOr(routine.goal?.fanout?.enabled, false),
        mode: stringOr(routine.goal?.fanout?.mode, "none"),
        priority: stringOr(routine.goal?.fanout?.priority, "normal"),
        apply: booleanOr(routine.goal?.fanout?.apply, false),
        verify: booleanOr(routine.goal?.fanout?.verify, true),
        isolateWorktree: booleanOr(routine.goal?.fanout?.isolateWorktree, true),
      },
    },
    checks: arrayOr(routine.checks, []).map((check) => ({ ...check })),
    outputs: {
      summary: stringOr(routine.outputs?.summary, `.myagenttool/state/${id}.md`),
      findings: stringOr(routine.outputs?.findings, `.myagenttool/state/${id}-findings.json`),
      enqueueFindings: booleanOr(routine.outputs?.enqueueFindings, false),
    },
    safety: {
      remoteWrites: stringOr(routine.safety?.remoteWrites, "forbidden"),
      githubWrites: stringOr(routine.safety?.githubWrites, "forbidden"),
      requiresApprovalFor: stringArrayOr(routine.safety?.requiresApprovalFor, ["apply", "push", "pr-create", "pr-merge"]),
      commandAllowlist: stringArrayOr(routine.safety?.commandAllowlist, [...LOOP_ROUTINE_DEFAULT_COMMAND_ALLOWLIST]),
    },
  };
}

export function validateLoopRoutine(routine, root = repoRoot) {
  const errors = [];
  const warnings = [];
  if (routine.apiVersion !== LOOP_ROUTINE_API_VERSION) errors.push(`apiVersion must be ${LOOP_ROUTINE_API_VERSION}.`);
  if (routine.kind !== LOOP_ROUTINE_KIND) errors.push(`kind must be ${LOOP_ROUTINE_KIND}.`);
  if (!safeId(routine.metadata.id)) errors.push("metadata.id must use letters, numbers, dots, underscores, or hyphens.");
  if (!routine.metadata.name) errors.push("metadata.name is required.");
  if (!LOOP_ROUTINE_SCHEDULE_MODES.includes(routine.schedule.mode)) {
    errors.push(`schedule.mode must be one of: ${LOOP_ROUTINE_SCHEDULE_MODES.join(", ")}.`);
  }
  if (routine.schedule.mode === "cron" && !routine.schedule.cron) {
    errors.push("schedule.cron is required when schedule.mode is cron.");
  }
  if (routine.schedule.mode === "event" && !routine.schedule.event) {
    errors.push("schedule.event is required when schedule.mode is event.");
  }
  if (routine.schedule.mode !== "manual") {
    warnings.push("Only manual routine execution is implemented in this slice; cron/event are validated for future schedulers.");
  }
  if (!routine.goal.summary) errors.push("goal.summary is required.");
  if (routine.goal.successCriteria.length === 0) warnings.push("goal.successCriteria is empty.");

  for (const input of routine.inputs) {
    if (!safeId(input.id)) errors.push("Each input requires a stable id.");
    if (!LOOP_ROUTINE_INPUT_TYPES.includes(input.type)) {
      errors.push(`Input ${input.id ?? "(missing id)"} has unsupported type ${input.type ?? "(missing type)"}.`);
    }
    if (input.type?.startsWith("github.") && !input.repo) {
      errors.push(`Input ${input.id} requires repo for GitHub input type ${input.type}.`);
    }
    if (input.type === "filesystem.glob" && !input.pattern) {
      errors.push(`Input ${input.id} requires pattern.`);
    }
  }

  for (const skill of routine.skills) {
    if (!safeId(skill.id)) errors.push("Each skill requires a stable id.");
    if (!skill.path) errors.push(`Skill ${skill.id || "(missing id)"} requires path.`);
    if (skill.path && skill.required && !existsSync(resolve(root, skill.path))) {
      errors.push(`Required skill ${skill.id} not found: ${skill.path}`);
    }
    if (skill.path && !existsSync(resolve(root, skill.path))) {
      warnings.push(`Skill ${skill.id || skill.path} not found locally: ${skill.path}`);
    }
  }

  for (const check of routine.checks) {
    if (!safeId(check.id)) errors.push("Each check requires a stable id.");
    if (!LOOP_ROUTINE_CHECK_TYPES.includes(check.type)) {
      errors.push(`Check ${check.id ?? "(missing id)"} has unsupported type ${check.type ?? "(missing type)"}.`);
    }
    if (check.type === "command" && !check.command) errors.push(`Check ${check.id} requires command.`);
    if (check.command && !routine.safety.commandAllowlist.includes(check.command)) {
      errors.push(`Check ${check.id} command is not allowlisted: ${check.command}`);
    }
  }

  if (!routine.outputs.summary) errors.push("outputs.summary is required.");
  if (!routine.outputs.findings) errors.push("outputs.findings is required.");
  if (!LOOP_ROUTINE_WRITE_POLICIES.includes(routine.safety.remoteWrites)) {
    errors.push(`safety.remoteWrites must be one of: ${LOOP_ROUTINE_WRITE_POLICIES.join(", ")}.`);
  }
  if (!LOOP_ROUTINE_WRITE_POLICIES.includes(routine.safety.githubWrites)) {
    errors.push(`safety.githubWrites must be one of: ${LOOP_ROUTINE_WRITE_POLICIES.join(", ")}.`);
  }
  if (routine.safety.remoteWrites !== "forbidden") warnings.push("Routine may affect remote state in a future execute step.");
  if (routine.safety.githubWrites !== "forbidden") warnings.push("Routine may affect GitHub state in a future execute step.");

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    routineId: routine.metadata.id,
  };
}

export function buildLoopRoutinePlan({ routine, sourcePath, root = repoRoot }) {
  const validation = validateLoopRoutine(routine, root);
  const inputPlan = routine.inputs.map((input) => ({
    id: input.id,
    type: input.type,
    supportedInRun: LOOP_ROUTINE_SUPPORTED_RUN_INPUTS.includes(input.type),
    readOnly: true,
    summary: inputSummary(input),
  }));
  const skillPlan = routine.skills.map((skill) => ({
    id: skill.id,
    path: skill.path,
    required: skill.required,
    exists: skill.path ? existsSync(resolve(root, skill.path)) : false,
  }));
  const checkPlan = routine.checks.map((check) => ({
    id: check.id,
    type: check.type,
    command: check.command ?? null,
    required: booleanOr(check.required, true),
    allowed: !check.command || routine.safety.commandAllowlist.includes(check.command),
  }));
  return {
    schemaVersion: LOOP_ROUTINE_SCHEMA_VERSION,
    routineId: routine.metadata.id,
    sourcePath,
    valid: validation.ok,
    validation,
    schedule: routine.schedule,
    execution: {
      implementedMode: "manual",
      canRunNow: validation.ok && routine.metadata.enabled && routine.schedule.mode === "manual",
      dryRunSupported: true,
      writesLocalEvidence: true,
      remoteWrites: routine.safety.remoteWrites,
      githubWrites: routine.safety.githubWrites,
    },
    inputs: inputPlan,
    skills: skillPlan,
    goal: routine.goal,
    checks: checkPlan,
    outputs: routine.outputs,
    safety: routine.safety,
    risks: loopRoutinePlanRisks({ routine, inputPlan, skillPlan, checkPlan }),
  };
}

export function formatLoopRoutineCheck({ routine, sourcePath, validation }) {
  return `# Loop Routine Check

Routine: ${routine.metadata.id}
Source: ${sourcePath}
OK: ${validation.ok ? "yes" : "no"}

Errors:
${list(validation.errors)}

Warnings:
${list(validation.warnings)}
`;
}

export function formatLoopRoutinePlan(plan) {
  return `# Loop Routine Plan

Routine: ${plan.routineId}
Source: ${plan.sourcePath}
Valid: ${plan.valid ? "yes" : "no"}
Can run now: ${plan.execution.canRunNow ? "yes" : "no"}
Schedule: ${plan.schedule.mode}${plan.schedule.cron ? ` (${plan.schedule.cron})` : ""}

## Inputs

${plan.inputs.map((input) => `- ${input.id}: ${input.type} (${input.supportedInRun ? "implemented" : "planned"}) - ${input.summary}`).join("\n") || "- None."}

## Skills

${plan.skills.map((skill) => `- ${skill.id}: ${skill.path} (${skill.exists ? "found" : "missing"}${skill.required ? ", required" : ""})`).join("\n") || "- None."}

## Checks

${plan.checks.map((check) => `- ${check.id}: ${check.type}${check.command ? ` ${check.command}` : ""} (${check.allowed ? "allowed" : "blocked"})`).join("\n") || "- None."}

## Outputs

- Summary: ${plan.outputs.summary}
- Findings: ${plan.outputs.findings}
- Enqueue findings: ${plan.outputs.enqueueFindings ? "yes" : "no"}

## Safety

- Remote writes: ${plan.safety.remoteWrites}
- GitHub writes: ${plan.safety.githubWrites}
- Approval gates: ${plan.safety.requiresApprovalFor.join(", ") || "none"}

## Risks

${list(plan.risks)}
`;
}

export function runLoopRoutine({ routine, sourcePath, dryRun = false, root = repoRoot }) {
  const plan = buildLoopRoutinePlan({ routine, sourcePath, root });
  if (!plan.valid) fail(`Loop routine is invalid:\n${plan.validation.errors.map((error) => `- ${error}`).join("\n")}`);
  if (!routine.metadata.enabled) fail(`Loop routine is disabled: ${routine.metadata.id}`);
  if (routine.schedule.mode !== "manual") fail(`Only manual routine execution is implemented. Got: ${routine.schedule.mode}`);
  if (dryRun) {
    return {
      dryRun: true,
      plan,
      routineRun: null,
    };
  }

  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${safePathSegment(routine.metadata.id)}`;
  const runDir = resolve(root, ".myagenttool/routine-runs", runId);
  mkdirSync(runDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const events = [];
  const appendEvent = (type, message, data = {}) => {
    const event = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
      routineRunId: runId,
      routineId: routine.metadata.id,
      type,
      createdAt: new Date().toISOString(),
      message,
      data,
    };
    events.push(event);
    writeFileSync(resolve(runDir, "events.jsonl"), `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
  };

  appendEvent("loop_routine_run_created", "Loop routine run created.", { sourcePath });
  writeFileSync(resolve(runDir, "routine.json"), `${JSON.stringify(routine, null, 2)}\n`, "utf8");
  writeFileSync(resolve(runDir, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  appendEvent("loop_routine_plan_written", "Loop routine plan written.", { plan: routineRunPath(runId, "plan.json") });

  const inputSnapshot = collectRoutineInputs(routine, root);
  writeFileSync(resolve(runDir, "input-snapshot.json"), `${JSON.stringify(inputSnapshot, null, 2)}\n`, "utf8");
  appendEvent("loop_routine_inputs_collected", "Loop routine inputs collected.", {
    inputCount: inputSnapshot.inputs.length,
    unsupportedCount: inputSnapshot.inputs.filter((input) => input.status === "unsupported").length,
  });

  const findings = [];
  const summary = buildRoutineSummary({ routine, plan, inputSnapshot, findings, startedAt });
  writeFileSync(resolve(runDir, "summary.md"), summary, "utf8");
  writeFileSync(resolve(runDir, "findings.json"), `${JSON.stringify(findings, null, 2)}\n`, "utf8");
  writeRoutineOutput(root, routine.outputs.summary, summary);
  writeRoutineOutput(root, routine.outputs.findings, `${JSON.stringify(findings, null, 2)}\n`);
  appendEvent("loop_routine_outputs_written", "Loop routine outputs written.", {
    summary: routine.outputs.summary,
    findings: routine.outputs.findings,
  });
  appendEvent("loop_routine_run_completed", "Loop routine run completed.", {
    findingCount: findings.length,
    fanoutExecuted: false,
  });

  return {
    dryRun: false,
    plan,
    routineRun: {
      routineRunId: runId,
      routineId: routine.metadata.id,
      runDir: relativeRepoPath(runDir, root),
      events: routineRunPath(runId, "events.jsonl"),
      summary: routineRunPath(runId, "summary.md"),
      findings: routineRunPath(runId, "findings.json"),
      inputSnapshot: routineRunPath(runId, "input-snapshot.json"),
      outputSummary: routine.outputs.summary,
      outputFindings: routine.outputs.findings,
      findingCount: findings.length,
      eventsWritten: events.length,
    },
  };
}

function collectRoutineInputs(routine, root) {
  const inputs = routine.inputs.map((input) => {
    if (!LOOP_ROUTINE_SUPPORTED_RUN_INPUTS.includes(input.type)) {
      return {
        id: input.id,
        type: input.type,
        status: "unsupported",
        reason: "This input type is planned but not collected by the local routine runner yet.",
        items: [],
      };
    }
    try {
      if (input.type === "loop.registry") return collectLoopRegistryInput(input, root);
      if (input.type === "git.commits") return collectGitCommitsInput(input, root);
      if (input.type === "filesystem.glob") return collectFilesystemGlobInput(input, root);
    } catch (error) {
      return {
        id: input.id,
        type: input.type,
        status: "failed",
        reason: error?.message ?? String(error),
        items: [],
      };
    }
    return {
      id: input.id,
      type: input.type,
      status: "unsupported",
      reason: "Input collector missing.",
      items: [],
    };
  });
  return {
    collectedAt: new Date().toISOString(),
    inputs,
  };
}

function collectLoopRegistryInput(input, root) {
  const path = resolve(root, ".myagenttool/runs/registry.json");
  if (!existsSync(path)) {
    return { id: input.id, type: input.type, status: "ok", items: [], summary: "No loop registry exists yet." };
  }
  const registry = JSON.parse(readFileSync(path, "utf8"));
  const limit = positiveIntegerOr(input.limit, 20);
  const states = stringArrayOr(input.states, []);
  const runs = arrayOr(registry.runs, [])
    .filter((run) => states.length === 0 || states.includes(run.state))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, limit)
    .map((run) => ({
      runId: run.runId,
      state: run.state,
      issue: run.issue,
      branch: run.branch,
      updatedAt: run.updatedAt,
      lastError: run.lastError,
    }));
  return { id: input.id, type: input.type, status: "ok", items: runs, summary: `${runs.length} loop run(s) collected.` };
}

function collectGitCommitsInput(input, root) {
  const limit = positiveIntegerOr(input.limit, 20);
  const ref = stringOr(input.ref, "HEAD");
  const args = ["log", ref, `--max-count=${limit}`, "--pretty=format:%H%x09%h%x09%cI%x09%s"];
  if (input.since) args.splice(2, 0, `--since=${input.since}`);
  const output = execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const commits = output
    ? output.split(/\r?\n/).map((line) => {
        const [sha, shortSha, committedAt, subject] = line.split("\t");
        return { sha, shortSha, committedAt, subject };
      })
    : [];
  return { id: input.id, type: input.type, status: "ok", items: commits, summary: `${commits.length} commit(s) collected.` };
}

function collectFilesystemGlobInput(input, root) {
  const pattern = normalizePath(input.pattern);
  const limit = positiveIntegerOr(input.limit, 100);
  const tracked = execFileSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const matcher = globMatcher(pattern);
  const files = tracked.filter((file) => matcher(normalizePath(file))).slice(0, limit);
  return { id: input.id, type: input.type, status: "ok", items: files.map((path) => ({ path })), summary: `${files.length} file(s) matched ${pattern}.` };
}

function buildRoutineSummary({ routine, plan, inputSnapshot, findings, startedAt }) {
  const inputLines = inputSnapshot.inputs.map((input) => `- ${input.id}: ${input.status} (${input.items.length} item(s))${input.reason ? ` - ${input.reason}` : ""}`);
  return `# Loop Routine Summary

Routine: ${routine.metadata.name}
Routine ID: ${routine.metadata.id}
Started: ${startedAt}
Completed: ${new Date().toISOString()}
Schedule mode: ${routine.schedule.mode}

## Goal

${routine.goal.summary}

## Inputs

${inputLines.join("\n") || "- None."}

## Findings

${findings.length > 0 ? findings.map((finding) => `- ${finding.id}: ${finding.title}`).join("\n") : "- No findings generated by this local routine slice."}

## Outputs

- Summary: ${routine.outputs.summary}
- Findings: ${routine.outputs.findings}

## Safety

- Remote writes: ${plan.safety.remoteWrites}
- GitHub writes: ${plan.safety.githubWrites}
- Fanout executed: no
`;
}

function writeRoutineOutput(root, path, content) {
  const target = resolve(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function inputSummary(input) {
  if (input.type === "github.issues") return `${input.repo} ${input.query ?? ""}`.trim();
  if (input.type === "github.prs") return `${input.repo} ${input.query ?? ""}`.trim();
  if (input.type === "github.checks") return `${input.repo} ${input.ref ?? ""}`.trim();
  if (input.type === "git.commits") return `${input.ref ?? "HEAD"} since ${input.since ?? "not specified"}`;
  if (input.type === "filesystem.glob") return input.pattern ?? "";
  if (input.type === "loop.registry") return `states ${(input.states ?? []).join(", ") || "any"}`;
  return "";
}

function loopRoutinePlanRisks({ routine, inputPlan, skillPlan, checkPlan }) {
  const risks = [];
  if (routine.schedule.mode !== "manual") risks.push("Cron/event scheduling is specified but not executed by this local slice.");
  if (inputPlan.some((input) => !input.supportedInRun)) risks.push("Some inputs are planned but not collected by the local runner yet.");
  if (skillPlan.some((skill) => skill.required && !skill.exists)) risks.push("A required skill is missing.");
  if (checkPlan.some((check) => !check.allowed)) risks.push("One or more checks are blocked by the command allowlist.");
  if (routine.goal.fanout.enabled) risks.push("Finding fanout is specified but not executed by this slice.");
  if (routine.outputs.enqueueFindings) risks.push("Output enqueueFindings is recorded but not executed by this slice.");
  if (risks.length === 0) risks.push("No known routine plan risks.");
  return risks;
}

function parseSimpleYaml(source) {
  const lines = source
    .split(/\r?\n/)
    .map((raw) => raw.replace(/\t/g, "  "))
    .map((raw) => ({ indent: raw.match(/^ */)[0].length, text: raw.trim() }))
    .filter((line) => line.text && !line.text.startsWith("#"));
  if (lines.length === 0) return {};
  const [value, index] = parseYamlBlock(lines, 0, lines[0].indent);
  if (index < lines.length) fail(`Invalid YAML near: ${lines[index].text}`);
  return value;
}

function parseYamlBlock(lines, index, indent) {
  const line = lines[index];
  if (!line || line.indent < indent) return [null, index];
  if (line.text.startsWith("- ")) return parseYamlArray(lines, index, indent);
  return parseYamlObject(lines, index, indent);
}

function parseYamlArray(lines, index, indent) {
  const items = [];
  let cursor = index;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.indent < indent) break;
    if (line.indent !== indent || !line.text.startsWith("- ")) break;
    const rest = line.text.slice(2).trim();
    cursor += 1;
    if (!rest) {
      const [value, next] = parseYamlBlock(lines, cursor, lines[cursor]?.indent ?? indent + 2);
      items.push(value);
      cursor = next;
      continue;
    }
    if (isYamlKeyValue(rest)) {
      const item = {};
      cursor = assignYamlKeyValue(item, rest, lines, cursor);
      while (cursor < lines.length && lines[cursor].indent === indent + 2 && !lines[cursor].text.startsWith("- ")) {
        const propertyLine = lines[cursor];
        cursor += 1;
        cursor = assignYamlKeyValue(item, propertyLine.text, lines, cursor);
      }
      items.push(item);
    } else {
      items.push(parseYamlScalar(rest));
    }
  }
  return [items, cursor];
}

function parseYamlObject(lines, index, indent) {
  const object = {};
  let cursor = index;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.indent < indent) break;
    if (line.indent !== indent || line.text.startsWith("- ")) break;
    cursor += 1;
    cursor = assignYamlKeyValue(object, line.text, lines, cursor);
  }
  return [object, cursor];
}

function assignYamlKeyValue(object, text, lines, cursor) {
  const match = text.match(/^([^:]+):(.*)$/);
  if (!match) fail(`Invalid YAML key/value line: ${text}`);
  const key = match[1].trim();
  const rawValue = match[2].trim();
  if (rawValue) {
    object[key] = parseYamlScalar(rawValue);
    return cursor;
  }
  if (cursor < lines.length && lines[cursor].indent > 0) {
    const [value, next] = parseYamlBlock(lines, cursor, lines[cursor].indent);
    object[key] = value;
    return next;
  }
  object[key] = null;
  return cursor;
}

function isYamlKeyValue(text) {
  return /^[^:]+:/.test(text);
}

function parseYamlScalar(raw) {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (/^\[[\s\S]*\]$/.test(value)) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((item) => parseYamlScalar(item.trim()));
  }
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

function globMatcher(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__DOUBLE_STAR__/g, ".*");
  const regex = new RegExp(`^${escaped}$`);
  return (value) => regex.test(value);
}

function safeId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9._-]+$/.test(value);
}

function safePathSegment(text) {
  return String(text)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "routine";
}

function routineRunPath(runId, file) {
  return `.myagenttool/routine-runs/${runId}/${file}`;
}

function relativeRepoPath(path, root = repoRoot) {
  return normalizePath(resolve(path).replace(resolve(root), "")).replace(/^\/+/, "");
}

function normalizePath(path) {
  return path.replace(/\\/g, "/");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function arrayOr(value, fallback) {
  return Array.isArray(value) ? value : fallback;
}

function stringArrayOr(value, fallback) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : fallback;
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function booleanOr(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function positiveIntegerOr(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeIntegerOr(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function list(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None.";
}

function fail(message) {
  throw new Error(message);
}
