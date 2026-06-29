import { spawnSync } from "node:child_process";

export function executeRoutineChecks(routine, root, { cliPath }) {
  const checks = routine.checks.map((check) => {
    const startedAt = new Date().toISOString();
    const command = resolveRoutineCheckCommand(check, { cliPath });
    const required = booleanOr(check.required, true);
    if (!command) {
      return {
        id: check.id,
        type: check.type,
        command: check.command ?? null,
        required,
        status: required ? "failed" : "skipped",
        exitCode: null,
        startedAt,
        completedAt: new Date().toISOString(),
        stdout: "",
        stderr: "",
        error: `Unsupported routine check type: ${check.type}`,
      };
    }
    const result = spawnSync(command.bin, command.args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    const exitCode = result.status ?? (result.error ? 1 : 0);
    return {
      id: check.id,
      type: check.type,
      command: command.id,
      required,
      status: exitCode === 0 ? "passed" : "failed",
      exitCode,
      startedAt,
      completedAt: new Date().toISOString(),
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      error: result.error?.message ?? null,
    };
  });
  return {
    completedAt: new Date().toISOString(),
    ok: checks.every((check) => check.status !== "failed" || !check.required),
    checks,
  };
}

export function resolveRoutineCheckCommand(check, { cliPath }) {
  const id = check.type === "command" ? check.command : check.type;
  const commands = {
    "ai:loop-registry-check": ["node", [cliPath, "loop-registry-check"]],
    "loop-registry": ["node", [cliPath, "loop-registry-check"]],
    "docs-check": ["pnpm", ["docs:check"]],
    "docs:check": ["pnpm", ["docs:check"]],
    typecheck: ["pnpm", ["typecheck"]],
    test: ["pnpm", ["test"]],
    "ai:check": ["node", [cliPath, "--check"]],
  };
  const command = commands[id];
  if (!command) return null;
  return {
    id,
    bin: command[0],
    args: command[1],
  };
}

function booleanOr(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
