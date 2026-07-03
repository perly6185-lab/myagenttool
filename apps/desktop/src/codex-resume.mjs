// Pure helpers for Codex CLI session resume (#163). Extracted from index.mjs so
// they can be unit-tested in CI — the bridge's own `--check` self-check is
// environment-gated (it needs a locally configured Codex CLI) and excluded from
// test:ci, so the resume/injection logic would otherwise be unverified.

// A provider session id is emitted by the codex JSONL stream (a uuid/rollout
// token). Accept only a bounded alphanumeric token that cannot begin with "-",
// so it is always a resume TARGET and can never be smuggled in as an argv flag.
export function safeCodexSessionId(value) {
  const text = String(value ?? "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(text) ? text : null;
}

// Args for a `continue_last` resume: continue the SPECIFIC provider session the
// server resolved (resume by id), not whatever ran last globally. Falls back to
// `--last` when there is no safe resumable id (no prior session, or a malformed
// / hostile id that failed the safe-token guard).
export function codexResumeArgs(options) {
  const resumeId = safeCodexSessionId(options?.codexResumeSessionId);
  return ["exec", "resume", resumeId ?? "--last", "--skip-git-repo-check", "--json", "{{task}}"];
}
