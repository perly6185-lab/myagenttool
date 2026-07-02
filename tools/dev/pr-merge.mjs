/*
 * Green-before-merge discipline, codified.
 *
 * Branch protection is plan-gated on a private Free repo, so nothing at the
 * platform level stops a red merge. This script is the substitute lever:
 *
 *   pnpm pr:merge <number>
 *
 *   1. Wait for the PR's checks (gh pr checks --watch --fail-fast); any red
 *      check aborts — the PR is NOT merged.
 *   2. Merge (merge commit, matching the repo's history style).
 *   3. Verify the PR actually reports MERGED before touching anything else —
 *      a transient network failure between steps must not cascade.
 *   4. Only then delete the remote + local branch.
 *
 * Step 3-before-4 exists because we once deleted a branch after a merge call
 * that had silently failed on a TLS timeout, which closed the open PR.
 */

import { execFileSync } from "node:child_process";

function gh(...args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

const prNumber = process.argv[2];
if (!prNumber || !/^\d+$/.test(prNumber)) {
  console.error("Usage: pnpm pr:merge <pr-number>");
  process.exit(1);
}

const pr = JSON.parse(gh("pr", "view", prNumber, "--json", "state,headRefName,title"));
if (pr.state !== "OPEN") {
  console.error(`[pr:merge] PR #${prNumber} is ${pr.state}, not OPEN.`);
  process.exit(1);
}
console.log(`[pr:merge] #${prNumber} ${pr.title}`);

console.log("[pr:merge] waiting for checks…");
try {
  execFileSync("gh", ["pr", "checks", prNumber, "--watch", "--fail-fast"], { stdio: "inherit" });
} catch {
  console.error(`[pr:merge] checks are RED — not merging #${prNumber}. Fix and re-run.`);
  process.exit(1);
}

console.log("[pr:merge] checks green — merging…");
execFileSync("gh", ["pr", "merge", prNumber, "--merge"], { stdio: "inherit" });

// Confirm the merge really landed before any destructive cleanup.
const after = JSON.parse(gh("pr", "view", prNumber, "--json", "state"));
if (after.state !== "MERGED") {
  console.error(`[pr:merge] merge did not land (state: ${after.state}) — leaving the branch alone. Re-run to retry.`);
  process.exit(1);
}

console.log(`[pr:merge] merged. Cleaning up branch ${pr.headRefName}…`);
try {
  execFileSync("git", ["push", "origin", "--delete", pr.headRefName], { stdio: "inherit" });
} catch {
  console.error("[pr:merge] remote branch delete failed (may already be gone).");
}
try {
  execFileSync("git", ["branch", "-D", pr.headRefName], { stdio: "ignore" });
} catch {
  /* local branch may not exist in this checkout */
}
console.log(`[pr:merge] done: #${prNumber} merged green.`);
