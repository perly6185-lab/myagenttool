import { spawnSync } from "node:child_process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const expectedCcusageVersion = "20.0.16";

const checks = [
  {
    name: "ccusage published version matches the pinned Application baseline",
    command: npm,
    args: ["view", "ccusage", "version"],
    validate: (result) => {
      const version = result.stdout.trim();
      if (version !== expectedCcusageVersion) {
        throw new Error(`expected ccusage ${expectedCcusageVersion}, got ${version || "(empty)"}`);
      }
    },
  },
  {
    name: "server Application focused tests",
    command: pnpm,
    args: [
      "--filter",
      "@myagenttool/server",
      "exec",
      "node",
      "--test",
      "test/application-descriptors.test.mjs",
      "test/application-mcp-agent.test.mjs",
      "test/application-wrapper-dispatch.test.mjs",
      "test/ccusage-application.test.mjs",
    ],
  },
  {
    name: "desktop Application bridge check",
    command: "node",
    args: ["apps/desktop/src/index.mjs", "--check"],
  },
  {
    name: "web Application, Evidence Center, and Codex UI regressions",
    command: pnpm,
    args: [
      "--filter",
      "@myagenttool/web",
      "test",
      "--",
      "audit-view",
      "application-draft-generator",
      "application-onboarding-guide",
      "applications-inspector",
      "applications-view",
      "descriptor-utils",
      "register-application-modal",
      "tools-view",
    ],
  },
  {
    name: "web typecheck",
    command: pnpm,
    args: ["--filter", "@myagenttool/web", "typecheck"],
  },
  {
    name: "server typecheck",
    command: pnpm,
    args: ["--filter", "@myagenttool/server", "typecheck"],
  },
  {
    name: "Application registry and smoke-evidence projection",
    command: pnpm,
    args: ["smoke:applications"],
  },
  {
    name: "Application wrapper and stdio MCP live execution",
    command: pnpm,
    args: ["smoke:application-wrapper"],
  },
  {
    name: "Application mixed fleet HTTP MCP and manual manifests",
    command: pnpm,
    args: ["smoke:application-fleet"],
  },
  {
    name: "real doocs/md Application rehearsal",
    command: pnpm,
    args: ["smoke:doocs-md-application"],
  },
  {
    name: "ccusage agent compatibility baseline",
    command: pnpm,
    args: ["smoke:ccusage-agent"],
  },
  {
    name: "Codex governed review tool",
    command: pnpm,
    args: ["smoke:codex-tool"],
  },
  {
    name: "Codex governed patch proposal",
    command: pnpm,
    args: ["smoke:codex-patch-proposal"],
  },
  {
    name: "Codex governed patch apply",
    command: pnpm,
    args: ["smoke:codex-apply-patch"],
  },
  {
    name: "engineering docs links",
    command: pnpm,
    args: ["docs:check"],
  },
];

let passed = 0;
const startedAt = Date.now();

for (const check of checks) {
  const label = `[application-m4-readiness] ${check.name}`;
  console.log(`\n${label}`);
  console.log(`  $ ${[check.command, ...check.args].join(" ")}`);
  const result = spawnSync(check.command, check.args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    shell: process.platform === "win32",
  });
  if (result.error) {
    console.error(`  failed to start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    printTail(result.stdout, "stdout");
    printTail(result.stderr, "stderr");
    console.error(`\n${label} FAILED with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
  try {
    check.validate?.(result);
  } catch (error) {
    printTail(result.stdout, "stdout");
    printTail(result.stderr, "stderr");
    console.error(`\n${label} FAILED: ${error.message}`);
    process.exit(1);
  }
  passed += 1;
  printTail(result.stdout, "stdout", 8);
  console.log(`  ok - ${check.name}`);
}

const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\napplication-m4-readiness-smoke: ${passed} checks passed in ${seconds}s`);

function printTail(value, label, lineCount = 30) {
  const text = (value ?? "").trim();
  if (!text) return;
  const lines = text.split(/\r?\n/);
  const tail = lines.slice(-lineCount).join("\n");
  console.log(`  ${label}:\n${indent(tail)}`);
}

function indent(value) {
  return value.split(/\r?\n/).map((line) => `    ${line}`).join("\n");
}
