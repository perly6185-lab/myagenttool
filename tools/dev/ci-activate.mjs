/*
 * CI activation — the two admin actions that turn the wired-but-dormant CI
 * into a real PR gate. Deliberately NOT run by automation: flipping the runner
 * variable starts GitHub-hosted runner spend, so a human runs this once the
 * cost is approved.
 *
 *   pnpm ci:activate            # dry run: print exactly what would happen
 *   pnpm ci:activate --apply    # flip the variable + set branch protection
 *
 * What --apply does:
 *   1. Sets the ENABLE_GITHUB_HOSTED_RUNNERS repo variable to "true" — the CI
 *      workflow's jobs (verify, eval-gates, desktop-smoke) start running on
 *      pull_request and push-to-main.
 *   2. Protects `main`: requires the "verify" and "eval-gates" status checks
 *      before merge (smoke is matrix-named and OS-dependent, so it reports but
 *      is not required), and enforces the rules for ADMINS too — the L3
 *      governance reading found 56 silent-bypass commits, all direct admin
 *      pushes, so enforce_admins is the half of the gate that closes them
 *      (#243).
 *
 * Flags:
 *   --require-governance  also require the "pr-governance" check (phase 2 of
 *                         #243 — promote once its advisory green rate holds).
 *
 * Rollback: pnpm ci:activate --deactivate (sets the variable to "false";
 * branch protection is left in place and can be removed in repo settings).
 */

import { execSync } from "node:child_process";

const REQUIRED_CHECKS = ["verify", "eval-gates"];
const GOVERNANCE_CHECK = "pr-governance";

function sh(command) {
  return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const deactivate = args.includes("--deactivate");
const requireGovernance = args.includes("--require-governance");

const repo = sh("gh repo view --json nameWithOwner --jq .nameWithOwner");
const requiredChecks = requireGovernance ? [...REQUIRED_CHECKS, GOVERNANCE_CHECK] : REQUIRED_CHECKS;
const protectionBody = JSON.stringify({
  required_status_checks: { strict: true, contexts: requiredChecks },
  // Admins are enforced too: the 56 silent-bypass commits in the L3 reading
  // were all direct admin pushes to main (#243).
  enforce_admins: true,
  required_pull_request_reviews: null,
  restrictions: null,
});

const steps = deactivate
  ? [
      { label: `Set ENABLE_GITHUB_HOSTED_RUNNERS=false on ${repo} (runners stop; zero further spend)`,
        command: `gh variable set ENABLE_GITHUB_HOSTED_RUNNERS --body false --repo ${repo}` },
    ]
  : [
      { label: `Set ENABLE_GITHUB_HOSTED_RUNNERS=true on ${repo} (starts runner spend on PR/push)`,
        command: `gh variable set ENABLE_GITHUB_HOSTED_RUNNERS --body true --repo ${repo}` },
      { label: `Protect main: require status checks [${requiredChecks.join(", ")}], enforce admins`,
        command: `gh api -X PUT repos/${repo}/branches/main/protection --input - <<'JSON'\n${protectionBody}\nJSON` },
    ];

if (!apply) {
  console.log("[ci:activate] DRY RUN — nothing executed. The following would run with --apply:\n");
  for (const step of steps) {
    console.log(`  # ${step.label}`);
    console.log(`  ${step.command}\n`);
  }
  console.log("Runner cost note: verify+eval-gates ≈ 3-5 min ubuntu per PR; desktop-smoke ≈ 2-4 min.");
  console.log("Until activated, `pnpm ci:simulate` executes the same steps locally.");
  process.exit(0);
}

for (const step of steps) {
  console.log(`[ci:activate] ${step.label}`);
  try {
    execSync(step.command, { stdio: ["ignore", "inherit", "pipe"], shell: "/bin/bash", encoding: "utf8" });
  } catch (error) {
    const stderr = String(error.stderr ?? "");
    // Branch protection on a PRIVATE repo is plan-gated (GitHub Free doesn't
    // include it; needs Pro/Team or a public repo). The runners themselves are
    // NOT plan-gated, so measurement still works — only red-merge *enforcement*
    // is unavailable. Don't fail the whole activation over it.
    if (/Upgrade to GitHub Pro|make this repository public/i.test(stderr)) {
      console.log("[ci:activate] branch protection is not available on this plan for a private repo.");
      console.log("  CI runs + the L2 green-rate measurement are active anyway. To also ENFORCE");
      console.log("  green-before-merge: upgrade to GitHub Pro, make the repo public, or use");
      console.log(`  merge discipline — \`gh pr checks <n> --watch\` before \`gh pr merge\`.`);
      continue;
    }
    process.stderr.write(stderr);
    throw error;
  }
}
console.log("[ci:activate] done.");
