// #913: the immutable bindings of a claude.propose.patch artifact. A proposal is
// only trustworthy for a later approval-bound apply (#914) if the artifact carries
// what it was generated FROM: the patch content hash (tamper evidence), the
// worktree HEAD it was proposed against (staleness evidence), and the Application
// descriptor revision it was governed under (contract lineage). The hash and the
// lineage are stamped SERVER-SIDE at completion — never taken from the caller —
// and the base commit is taken from the wrapper's git, validated to be a real sha.
import { createHash } from "node:crypto";

import { CLAUDE_PROPOSE_TOOL_CONTRACT } from "./claude-propose-agent.mjs";

const COMMIT_SHA = /^[0-9a-f]{40}$/i;

export function proposalContentHash(patch) {
  return createHash("sha256").update(String(patch ?? ""), "utf8").digest("hex");
}

/**
 * Stamp the artifact bindings on a completed proposal result, in place. No-ops for
 * anything that is not a succeeded claude.propose.patch with a non-empty patch.
 * Returns the stamped output, or null when it did not apply.
 */
export function stampClaudeProposalArtifact({ invocation, result }) {
  const meta = invocation?.options?.metadata ?? {};
  if (meta.tool !== CLAUDE_PROPOSE_TOOL_CONTRACT.name) return null;
  const output = result?.output;
  if (!output || typeof output !== "object" || typeof output.patch !== "string" || !output.patch.trim()) {
    return null;
  }
  output.contentHash = proposalContentHash(output.patch);
  // The wrapper reports the HEAD it generated against via its own `git rev-parse`.
  // Keep it only when it is a full commit sha — anything else (including model
  // output that leaked into the field) must not become a binding.
  output.baseCommit = typeof output.baseCommit === "string" && COMMIT_SHA.test(output.baseCommit.trim())
    ? output.baseCommit.trim().toLowerCase()
    : null;
  // Descriptor lineage was stamped on the invocation metadata at creation (from
  // the server's own Application record); copy it onto the artifact so the apply
  // gate revalidates against ONE place.
  if (meta.descriptorRevision != null) output.descriptorRevision = meta.descriptorRevision;
  if (meta.applicationId) output.applicationId = meta.applicationId;
  return output;
}
