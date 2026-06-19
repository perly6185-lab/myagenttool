#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

const HELP = `MyAgentTool deploy tooling

Usage:
  node tools/deploy/src/index.mjs --check
  node tools/deploy/src/index.mjs plan --target docs|server|web|desktop|protocol --environment local|preview|staging|production [--version VALUE] [--out path]
  node tools/deploy/src/index.mjs preflight --target docs|server|web|desktop|protocol --environment local|preview|staging|production [--version VALUE]
  node tools/deploy/src/index.mjs publish --target docs|server|web|desktop|protocol --environment local|preview|staging|production [--version VALUE] [--apply]
  node tools/deploy/src/index.mjs run --target docs|server|web|desktop|protocol --environment local|preview|staging|production [--version VALUE] [--apply]

Environment:
  MYAGENTTOOL_DEPLOY_COMMAND
  MYAGENTTOOL_DEPLOY_LOCAL_COMMAND
  MYAGENTTOOL_DEPLOY_PREVIEW_COMMAND
  MYAGENTTOOL_DEPLOY_STAGING_COMMAND
  MYAGENTTOOL_DEPLOY_PRODUCTION_COMMAND

Notes:
  publish and run are dry-run by default. They execute a deploy command only with --apply.
  production also requires MYAGENTTOOL_DEPLOY_APPROVED=true.
`;

const ENVIRONMENTS = new Set(["local", "preview", "staging", "production"]);
const TARGETS = new Set(["docs", "server", "web", "desktop", "protocol"]);

function main() {
  const args = process.argv.slice(2);
  const command = args.includes("--check") ? "check" : args.find((arg) => !arg.startsWith("--"));

  if (!command || args.includes("--help") || args.includes("-h")) {
    console.log(HELP.trim());
    return;
  }

  if (command === "check") {
    check();
    return;
  }

  if (command === "plan") {
    plan(args);
    return;
  }

  if (command === "preflight") {
    preflight(args);
    return;
  }

  if (command === "publish" || command === "run") {
    publish(args);
    return;
  }

  fail(`Unknown command: ${command}\n\n${HELP}`);
}

function check() {
  const requiredFiles = [
    "docs/engineering/RELEASE_PROCESS.md",
    "docs/engineering/DEPLOYMENT_PIPELINE.md",
    ".github/workflows/release.yml",
    ".github/workflows/deploy.yml",
  ];
  const missing = requiredFiles.filter((path) => !existsSync(resolve(repoRoot, path)));
  if (missing.length > 0) {
    fail(`Deploy pipeline assets missing:\n${missing.map((path) => `  - ${path}`).join("\n")}`);
  }

  const pipeline = readFileSync(resolve(repoRoot, "docs/engineering/DEPLOYMENT_PIPELINE.md"), "utf8");
  for (const section of ["## Environments", "## Deployment Adapter", "## Required Evidence", "## Commands"]) {
    if (!pipeline.includes(section)) {
      fail(`Release deploy pipeline doc missing ${section}.`);
    }
  }

  console.log("[tools-deploy:check] deploy pipeline check OK");
}

function plan(args) {
  const context = deployContext(args);
  const command = deployCommand(context.environment);
  const content = `# Deploy Plan

Created: ${new Date().toISOString()}

## Target

${context.target}

## Environment

${context.environment}

## Version

${context.version || "not specified"}

## Command

${command ? command : "No command configured yet."}

## Required Evidence

- Linked PR and release draft.
- Passing CI, governance, AI review, release check, and deploy check.
- Human approval for staging and production.
- Rollback notes and owner.

## Data, Billing, And Local Execution Review

- Data retention impact:
- Billing or chargeback impact:
- Desktop/local execution impact:
- Security permission impact:

## Rollback

- Trigger:
- Command or manual action:
- Compatibility notes:
`;

  writeOrPrint(content, option(args, "--out"));
}

function preflight(args) {
  const context = deployContext(args);
  const failures = [];

  if (context.environment === "production" && !context.version) {
    failures.push("production requires --version.");
  }

  if (context.target === "desktop" && context.environment === "production") {
    failures.push("desktop production distribution requires signing and installer evidence before publish.");
  }

  if (failures.length > 0) {
    fail(`Deploy preflight failed:\n${failures.map((failure) => `  - ${failure}`).join("\n")}`);
  }

  console.log(`Deploy preflight OK for ${context.target}/${context.environment}${context.version ? ` ${context.version}` : ""}`);
}

function publish(args) {
  const context = deployContext(args);
  const apply = args.includes("--apply");
  const command = deployCommand(context.environment);
  const runDir = resolve(repoRoot, ".myagenttool/deploy-runs");
  mkdirSync(runDir, { recursive: true });
  const runFile = resolve(runDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${context.target}-${context.environment}.md`);
  const contextFile = resolve(runDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${context.target}-${context.environment}.json`);
  writeFileSync(contextFile, `${JSON.stringify(context, null, 2)}\n`, "utf8");

  if (!apply) {
    writeFileSync(runFile, dryRunReport(context, command ?? "No command configured yet."), "utf8");
    console.log(`Deploy dry-run written to ${relative(runFile)}.`);
    console.log("Re-run with --apply after human approval to execute the configured command.");
    return;
  }

  if (!command) {
    fail(`No deploy command configured for ${context.environment}. Set MYAGENTTOOL_DEPLOY_COMMAND or ${deployEnvName(context.environment)}.`);
  }

  if (context.environment === "production" && process.env.MYAGENTTOOL_DEPLOY_APPROVED !== "true") {
    fail("Production deploy requires MYAGENTTOOL_DEPLOY_APPROVED=true after human approval.");
  }

  const result = spawnSync(command, {
    cwd: repoRoot,
    env: {
      ...process.env,
      MYAGENTTOOL_DEPLOY_CONTEXT: contextFile,
    },
    encoding: "utf8",
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  writeFileSync(runFile, applyReport(context, command, result), "utf8");
  if (result.status !== 0) {
    fail(`Deploy command failed with exit ${result.status}. See ${relative(runFile)}.`);
  }

  console.log(`Deploy command completed. Evidence: ${relative(runFile)}.`);
}

function deployContext(args) {
  const target = option(args, "--target") ?? process.env.MYAGENTTOOL_DEPLOY_TARGET ?? "docs";
  const environment = option(args, "--environment") ?? process.env.MYAGENTTOOL_DEPLOY_ENVIRONMENT ?? "preview";
  if (!TARGETS.has(target)) {
    fail(`Invalid --target ${target}. Expected one of: ${[...TARGETS].join(", ")}.`);
  }
  if (!ENVIRONMENTS.has(environment)) {
    fail(`Invalid --environment ${environment}. Expected one of: ${[...ENVIRONMENTS].join(", ")}.`);
  }
  return {
    target,
    environment,
    version: option(args, "--version") ?? process.env.MYAGENTTOOL_DEPLOY_VERSION ?? "",
    branch: commandOutput("git", ["branch", "--show-current"]),
    head: commandOutput("git", ["rev-parse", "--short", "HEAD"]),
    repository: commandOutput("git", ["remote", "get-url", "origin"]),
    createdAt: new Date().toISOString(),
  };
}

function deployCommand(environment) {
  return process.env[deployEnvName(environment)] ?? process.env.MYAGENTTOOL_DEPLOY_COMMAND;
}

function deployEnvName(environment) {
  return `MYAGENTTOOL_DEPLOY_${environment.toUpperCase()}_COMMAND`;
}

function dryRunReport(context, command) {
  return `# Deploy Dry Run

Created: ${new Date().toISOString()}

Target: ${context.target}
Environment: ${context.environment}
Version: ${context.version || "not specified"}
Command: ${command}

No deploy command was executed.
`;
}

function applyReport(context, command, result) {
  return `# Deploy Run

Created: ${new Date().toISOString()}

Target: ${context.target}
Environment: ${context.environment}
Version: ${context.version || "not specified"}
Command: ${command}
Exit: ${result.status}

## stdout

\`\`\`text
${result.stdout ?? ""}
\`\`\`

## stderr

\`\`\`text
${result.stderr ?? ""}
\`\`\`
`;
}

function writeOrPrint(content, out) {
  if (!out) {
    console.log(content.trimEnd());
    return;
  }

  const target = resolve(repoRoot, out);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
  console.log(`Wrote ${out}`);
}

function relative(path) {
  return path.replace(`${repoRoot}\\`, "").replace(`${repoRoot}/`, "");
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

main();
