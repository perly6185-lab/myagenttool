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
  node tools/deploy/src/index.mjs preflight --target docs|server|web|desktop|protocol --environment local|preview|staging|production [--version VALUE] [--out-dir path]
  node tools/deploy/src/index.mjs publish --target docs|server|web|desktop|protocol --environment local|preview|staging|production [--version VALUE] [--apply] [--out-dir path]
  node tools/deploy/src/index.mjs run --target docs|server|web|desktop|protocol --environment local|preview|staging|production [--version VALUE] [--apply] [--out-dir path]

Environment:
  MYAGENTTOOL_DEPLOY_COMMAND_JSON
  MYAGENTTOOL_DEPLOY_TARGET_ENV_COMMAND_JSON
  MYAGENTTOOL_DEPLOY_ENVIRONMENT_COMMAND_JSON
  MYAGENTTOOL_DEPLOY_APPROVED
  MYAGENTTOOL_DEPLOY_EVIDENCE_DIR

Notes:
  publish and run are dry-run by default. They execute a deploy adapter only with --apply.
  command adapters use JSON argv arrays, for example ["node","tools/deploy-preview.mjs"].
  production also requires MYAGENTTOOL_DEPLOY_APPROVED=true.
`;

const ENVIRONMENTS = new Set(["local", "preview", "staging", "production"]);
const FIRST_M0_DEPLOY_TARGET = {
  target: "docs",
  environment: "preview",
  adapter: "builtin-docs-preview",
};
const TARGETS = {
  docs: {
    description: "Documentation and engineering guidance preview.",
    rollback: "Revert the publishing commit or redeploy the previous docs artifact.",
  },
  server: {
    description: "Server control plane deployment.",
    rollback: "Redeploy the previous server version and verify queued invocation compatibility.",
  },
  web: {
    description: "Web console deployment.",
    rollback: "Redeploy the previous web artifact and verify account, task, device, and audit flows.",
  },
  desktop: {
    description: "Desktop Bridge distribution.",
    rollback: "Keep previous signed installers available and publish downgrade compatibility notes.",
  },
  protocol: {
    description: "Shared protocol/schema release.",
    rollback: "Preserve backward compatibility or pin server/bridge versions to the previous contract.",
  },
};

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
  for (const section of ["## M0 Deploy Target", "## Environments", "## Deployment Adapter", "## Required Evidence", "## Commands"]) {
    if (!pipeline.includes(section)) {
      fail(`Release deploy pipeline doc missing ${section}.`);
    }
  }

  console.log("[tools-deploy:check] deploy pipeline check OK");
}

function plan(args) {
  const context = deployContext(args);
  const adapter = deployAdapter(context);
  const content = `# Deploy Plan

Created: ${new Date().toISOString()}

## Target

${context.target}

## Environment

${context.environment}

## Version

${context.version || "not specified"}

## Adapter

- Name: ${adapter.name}
- Source: ${adapter.source}
- Configured: ${adapter.configured ? "yes" : "no"}
- Built in: ${adapter.builtin ? "yes" : "no"}

## Required Evidence

- Linked PR and release draft.
- Passing CI, governance, AI review, release check, and deploy check.
- GitHub environment approval for preview, staging, and production.
- Human approval for staging and production.
- Rollback notes and owner.

## Data, Billing, And Local Execution Review

- Data retention impact:
- Billing or chargeback impact:
- Desktop/local execution impact:
- Security permission impact:

## Rollback

- Trigger: failed smoke check, incident, broken artifact, or release owner request.
- Command or manual action: ${rollbackAction(context.target)}
- Compatibility notes:
`;

  writeOrPrint(content, option(args, "--out"));
}

function preflight(args) {
  const context = deployContext(args);
  const adapter = deployAdapter(context);
  const evidence = createEvidence(context, "preflight", option(args, "--out-dir"));
  const failures = [];

  if (context.environment === "production" && !context.version) {
    failures.push("production requires --version.");
  }

  if ((context.environment === "staging" || context.environment === "production") && !context.version) {
    failures.push(`${context.environment} requires --version so rollback evidence is traceable.`);
  }

  if (context.environment === "production" && process.env.MYAGENTTOOL_DEPLOY_APPROVED !== "true") {
    failures.push("production requires MYAGENTTOOL_DEPLOY_APPROVED=true after human approval.");
  }

  if (context.target === "desktop" && context.environment === "production") {
    failures.push("desktop production distribution requires signing and installer evidence before publish.");
  }

  writeEvidence(evidence, {
    context,
    adapter: redactAdapter(adapter),
    status: failures.length > 0 ? "failed" : "passed",
    failures,
    rollback: rollbackAction(context.target),
  });

  if (failures.length > 0) {
    fail(`Deploy preflight failed:\n${failures.map((failure) => `  - ${failure}`).join("\n")}`);
  }

  console.log(`Deploy preflight OK for ${context.target}/${context.environment}${context.version ? ` ${context.version}` : ""}. Evidence: ${relative(evidence.jsonFile)}.`);
}

function publish(args) {
  const context = deployContext(args);
  const apply = args.includes("--apply");
  const adapter = deployAdapter(context);
  const evidence = createEvidence(context, apply ? "publish" : "dry-run", option(args, "--out-dir"));
  writeFileSync(evidence.contextFile, `${JSON.stringify(context, null, 2)}\n`, "utf8");

  if (!apply) {
    writeEvidence(evidence, {
      context,
      adapter: redactAdapter(adapter),
      status: "dry-run",
      rollback: rollbackAction(context.target),
    });
    writeFileSync(evidence.mdFile, dryRunReport(context, adapter), "utf8");
    console.log(`Deploy dry-run written to ${relative(evidence.mdFile)}.`);
    console.log("Re-run with --apply after human approval to execute the configured command.");
    return;
  }

  if (context.environment === "production" && process.env.MYAGENTTOOL_DEPLOY_APPROVED !== "true") {
    fail("Production deploy requires MYAGENTTOOL_DEPLOY_APPROVED=true after human approval.");
  }

  if (!adapter.configured && !adapter.builtin) {
    fail(`No deploy adapter configured for ${context.target}/${context.environment}. Set ${deployCommandEnvNames(context).join(", ")}.`);
  }

  const result = executeDeployAdapter({ context, adapter, evidence });

  writeEvidence(evidence, {
    context,
    adapter: redactAdapter(adapter),
    status: result.status === 0 ? "completed" : "failed",
    exitCode: result.status,
    rollback: rollbackAction(context.target),
    artifact: result.artifact ?? "",
  });
  writeFileSync(evidence.mdFile, applyReport(context, adapter, result), "utf8");
  if (result.status !== 0) {
    fail(`Deploy adapter failed with exit ${result.status}. See ${relative(evidence.mdFile)}.`);
  }

  console.log(`Deploy adapter completed. Evidence: ${relative(evidence.mdFile)}.`);
}

function deployContext(args) {
  const target = option(args, "--target") ?? process.env.MYAGENTTOOL_DEPLOY_TARGET ?? "docs";
  const environment = option(args, "--environment") ?? process.env.MYAGENTTOOL_DEPLOY_ENVIRONMENT ?? "preview";
  if (!TARGETS[target]) {
    fail(`Invalid --target ${target}. Expected one of: ${Object.keys(TARGETS).join(", ")}.`);
  }
  if (!ENVIRONMENTS.has(environment)) {
    fail(`Invalid --environment ${environment}. Expected one of: ${[...ENVIRONMENTS].join(", ")}.`);
  }
  return {
    target,
    environment,
    adapterTarget: `${target}/${environment}`,
    firstM0Target: target === FIRST_M0_DEPLOY_TARGET.target && environment === FIRST_M0_DEPLOY_TARGET.environment,
    version: option(args, "--version") ?? process.env.MYAGENTTOOL_DEPLOY_VERSION ?? "",
    branch: commandOutput("git", ["branch", "--show-current"]),
    head: commandOutput("git", ["rev-parse", "--short", "HEAD"]),
    repository: commandOutput("git", ["remote", "get-url", "origin"]),
    createdAt: new Date().toISOString(),
  };
}

function deployAdapter(context) {
  const envNames = deployCommandEnvNames(context);
  for (const envName of envNames) {
    if (process.env[envName]) {
      return {
        name: `${context.target}-${context.environment}-command`,
        source: envName,
        command: parseCommandJson(process.env[envName], envName),
        configured: true,
        builtin: false,
      };
    }
  }

  if (context.firstM0Target) {
    return {
      name: FIRST_M0_DEPLOY_TARGET.adapter,
      source: "built-in",
      command: [],
      configured: false,
      builtin: true,
    };
  }

  return {
    name: "unconfigured",
    source: "none",
    command: [],
    configured: false,
    builtin: false,
  };
}

function deployCommandEnvNames(context) {
  return [
    `MYAGENTTOOL_DEPLOY_${context.target.toUpperCase()}_${context.environment.toUpperCase()}_COMMAND_JSON`,
    `MYAGENTTOOL_DEPLOY_${context.environment.toUpperCase()}_COMMAND_JSON`,
    `MYAGENTTOOL_DEPLOY_${context.target.toUpperCase()}_COMMAND_JSON`,
    "MYAGENTTOOL_DEPLOY_COMMAND_JSON",
  ];
}

function parseCommandJson(raw, source) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`${source} must be a JSON argv array, for example ["node","tools/deploy-preview.mjs"]. Parse error: ${error.message}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((item) => typeof item !== "string" || item.length === 0)) {
    fail(`${source} must be a non-empty JSON string array.`);
  }
  return parsed;
}

function createEvidence(context, phase, outDir) {
  const root = resolve(repoRoot, outDir ?? process.env.MYAGENTTOOL_DEPLOY_EVIDENCE_DIR ?? ".myagenttool/deploy-runs");
  mkdirSync(root, { recursive: true });
  const stem = `${new Date().toISOString().replace(/[:.]/g, "-")}-${context.target}-${context.environment}-${phase}`;
  return {
    root,
    stem,
    contextFile: resolve(root, `${stem}.context.json`),
    jsonFile: resolve(root, `${stem}.evidence.json`),
    mdFile: resolve(root, `${stem}.md`),
    stdoutFile: resolve(root, `${stem}.stdout.txt`),
    stderrFile: resolve(root, `${stem}.stderr.txt`),
  };
}

function writeEvidence(evidence, payload) {
  writeFileSync(evidence.jsonFile, `${JSON.stringify({
    evidenceVersion: "2026-06-19",
    createdAt: new Date().toISOString(),
    ...payload,
  }, null, 2)}\n`, "utf8");
}

function executeDeployAdapter({ context, adapter, evidence }) {
  if (adapter.builtin && adapter.name === FIRST_M0_DEPLOY_TARGET.adapter) {
    return executeDocsPreviewAdapter({ context, evidence });
  }

  const [command, ...args] = adapter.command;
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      MYAGENTTOOL_DEPLOY_CONTEXT: evidence.contextFile,
      MYAGENTTOOL_DEPLOY_EVIDENCE_DIR: evidence.root,
      MYAGENTTOOL_DEPLOY_TARGET: context.target,
      MYAGENTTOOL_DEPLOY_ENVIRONMENT: context.environment,
      MYAGENTTOOL_DEPLOY_VERSION: context.version,
    },
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  writeFileSync(evidence.stdoutFile, result.stdout ?? "", "utf8");
  writeFileSync(evidence.stderrFile, result.stderr ?? "", "utf8");
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    artifact: "",
  };
}

function executeDocsPreviewAdapter({ context, evidence }) {
  const artifact = resolve(evidence.root, `${evidence.stem}.artifact.md`);
  const content = `# Docs Preview Deploy Artifact

Created: ${new Date().toISOString()}
Target: ${context.target}
Environment: ${context.environment}
Version: ${context.version || "not specified"}
Branch: ${context.branch}
Head: ${context.head}

This M0 preview adapter records a deployable documentation artifact without
publishing to a public hosting provider.
`;
  writeFileSync(artifact, content, "utf8");
  const stdout = `Built docs preview artifact at ${relative(artifact)}.\n`;
  writeFileSync(evidence.stdoutFile, stdout, "utf8");
  writeFileSync(evidence.stderrFile, "", "utf8");
  return {
    status: 0,
    stdout,
    stderr: "",
    artifact: relative(artifact),
  };
}

function redactAdapter(adapter) {
  return {
    name: adapter.name,
    source: adapter.source,
    configured: adapter.configured,
    builtin: adapter.builtin,
    command: adapter.command?.length ? [adapter.command[0], ...adapter.command.slice(1).map(() => "<arg>")] : [],
  };
}

function rollbackAction(target) {
  return TARGETS[target]?.rollback ?? "Restore the previous verified artifact.";
}

function dryRunReport(context, adapter) {
  return `# Deploy Dry Run

Created: ${new Date().toISOString()}

Target: ${context.target}
Environment: ${context.environment}
Version: ${context.version || "not specified"}
Adapter: ${adapter.name}
Adapter source: ${adapter.source}
Configured: ${adapter.configured ? "yes" : "no"}
Built in: ${adapter.builtin ? "yes" : "no"}
Rollback: ${rollbackAction(context.target)}

No deploy adapter was executed.
`;
}

function applyReport(context, adapter, result) {
  return `# Deploy Run

Created: ${new Date().toISOString()}

Target: ${context.target}
Environment: ${context.environment}
Version: ${context.version || "not specified"}
Adapter: ${adapter.name}
Adapter source: ${adapter.source}
Exit: ${result.status}
Artifact: ${result.artifact || "not recorded"}
Rollback: ${rollbackAction(context.target)}

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
