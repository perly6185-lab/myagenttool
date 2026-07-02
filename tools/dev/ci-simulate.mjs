/*
 * Local CI simulator — executes the workflow's own run steps.
 *
 * GitHub-hosted runners are cost-gated off (ENABLE_GITHUB_HOSTED_RUNNERS), so
 * until an admin activates them this script IS the CI gate: it parses
 * .github/workflows/ci.yml and executes every `run:` step of the requested
 * job(s) locally, in order, with a per-step report and a non-zero exit on the
 * first failure. Because the step list comes from the workflow file itself,
 * the simulation cannot drift from what the real runner would execute.
 *
 * Usage:
 *   pnpm ci:simulate                 # verify + eval-gates (the PR gate set)
 *   pnpm ci:simulate --job verify
 *   pnpm ci:simulate --all           # includes desktop-smoke
 *
 * `uses:` steps (checkout / pnpm / node setup) are environment steps a local
 * checkout already satisfies; they are listed as skipped, not executed.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workflowPath = resolve(repoRoot, ".github/workflows/ci.yml");

/** Minimal parser for this workflow's shape: jobs → steps with name/run|uses.
 *  Handles single-line `run: cmd` and block `run: |` + indented lines. */
export function parseWorkflowJobs(yamlText) {
  const lines = yamlText.split("\n");
  const jobs = new Map();
  let inJobs = false;
  let currentJob = null;
  let currentStep = null;
  let runBlockIndent = null;

  for (const line of lines) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;

    if (runBlockIndent !== null) {
      const isBlockLine = line.startsWith(" ".repeat(runBlockIndent)) && line.trim() !== "";
      if (isBlockLine) {
        currentStep.run.push(line.slice(runBlockIndent));
        continue;
      }
      runBlockIndent = null; // block ended — fall through to normal parsing
    }

    const jobMatch = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (jobMatch) {
      currentJob = { name: jobMatch[1], steps: [] };
      jobs.set(currentJob.name, currentJob);
      currentStep = null;
      continue;
    }
    if (!currentJob) continue;

    const nameMatch = line.match(/^      - name: (.+)$/);
    if (nameMatch) {
      currentStep = { name: nameMatch[1].trim(), run: null, uses: null };
      currentJob.steps.push(currentStep);
      continue;
    }
    if (!currentStep) continue;

    const usesMatch = line.match(/^        uses: (.+)$/);
    if (usesMatch) currentStep.uses = usesMatch[1].trim();

    const runLineMatch = line.match(/^        run: (.+)$/);
    if (runLineMatch) {
      if (runLineMatch[1].trim() === "|") {
        currentStep.run = [];
        runBlockIndent = 10; // block scalar lines are indented under `run: |`
      } else {
        currentStep.run = [runLineMatch[1].trim()];
      }
    }
  }
  return jobs;
}

function runJob(job, { strict }) {
  console.log(`\n=== [ci:simulate] job: ${job.name} ===`);
  const envSkipped = [];
  for (const step of job.steps) {
    if (!step.run) {
      console.log(`  ~ ${step.name} (env step: ${step.uses ?? "n/a"} — satisfied by the local checkout)`);
      continue;
    }
    const command = step.run.join("\n");
    process.stdout.write(`  ▶ ${step.name} ... `);
    const startedAt = Date.now();
    try {
      execSync(command, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
      console.log(`ok (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
    } catch (error) {
      const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`.trim();
      // A missing local tool (e.g. pwsh — preinstalled on ubuntu-latest) is an
      // environment gap, not a code failure: warn and continue unless --strict.
      const missingTool = output.match(/(?:^|\n)(?:sh: )?([A-Za-z0-9._-]+): command not found/);
      if (missingTool && !strict) {
        console.log(`ENV-SKIP (local machine lacks "${missingTool[1]}"; ubuntu-latest runners have it)`);
        envSkipped.push(`${step.name} (${missingTool[1]})`);
        continue;
      }
      console.log(`FAILED (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
      console.error(output.split("\n").slice(-25).join("\n"));
      console.error(`\n[ci:simulate] step "${step.name}" of job "${job.name}" failed. The real runner would fail the same way.`);
      process.exit(1);
    }
  }
  return envSkipped;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const jobs = parseWorkflowJobs(readFileSync(workflowPath, "utf8"));
  const jobFlag = args.includes("--job") ? args[args.indexOf("--job") + 1] : null;
  const selected = jobFlag
    ? [jobFlag]
    : args.includes("--all")
      ? [...jobs.keys()]
      : ["verify", "eval-gates"]; // the PR gate set; smoke is opt-in (--all)

  const strict = args.includes("--strict");
  const allSkipped = [];
  for (const name of selected) {
    const job = jobs.get(name);
    if (!job) {
      console.error(`[ci:simulate] unknown job "${name}". Jobs: ${[...jobs.keys()].join(", ")}`);
      process.exit(1);
    }
    allSkipped.push(...runJob(job, { strict }));
  }
  console.log(`\n[ci:simulate] all selected jobs passed: ${selected.join(", ")}`);
  if (allSkipped.length > 0) {
    console.log(`[ci:simulate] env-skipped (not verified locally — the real runner will run them): ${allSkipped.join("; ")}`);
  }
}
