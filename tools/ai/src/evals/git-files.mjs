// Shared "what did the agent change" policy for the held-out eval.
//
// The resolver (oracle side) and the adapters (evidence side) MUST agree on
// this list — if the copies drifted, the judge would score a different file
// set than the adapter reported. Keep the policy in this one module.

import { execFileSync } from "node:child_process";

// Union of modified/added tracked files and new untracked files (the agent may
// create files), excluding harness run evidence under .myagenttool/ — old base
// refs may predate the .gitignore line that normally hides it.
export function collectChangedFiles(cwd) {
  const tracked = gitLines(["diff", "--name-only"], cwd);
  const untracked = gitLines(["ls-files", "--others", "--exclude-standard"], cwd);
  return [...new Set([...tracked, ...untracked])]
    .map((path) => path.replace(/\\/g, "/"))
    .filter((path) => !path.startsWith(".myagenttool/"))
    .sort();
}

export function gitLines(args, cwd) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
