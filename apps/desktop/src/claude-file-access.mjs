// Recover which files a Claude run read/wrote from its stream-json tool_use parts.
//
// claudeMessageText renders a tool_use as "[tool: Read]" and drops part.input — so
// the transcript shows THAT a tool ran but not WHICH file. This pure helper pulls
// the file path back out so the server can build a per-run file ledger: Read → read;
// Edit/Write/MultiEdit/NotebookEdit → write. Writes already show in the git diff, but
// a file the agent only *read* leaves no other trace, which is the gap this closes.
//
// Bash/Grep/Glob are not explicit single-file read/writes (Bash I/O is opaque), so
// they are intentionally excluded — the ledger tracks the explicit file tools only.

const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export function extractClaudeFileAccesses(event) {
  const content = event?.message?.content ?? event?.content;
  if (!Array.isArray(content)) return [];
  const accesses = [];
  for (const part of content) {
    if (part?.type !== "tool_use") continue;
    const input = part.input ?? {};
    const path =
      typeof input.file_path === "string"
        ? input.file_path
        : typeof input.notebook_path === "string"
          ? input.notebook_path
          : null;
    if (!path) continue;
    if (part.name === "Read") accesses.push({ tool: "Read", path, mode: "read" });
    else if (WRITE_TOOLS.has(part.name)) accesses.push({ tool: part.name, path, mode: "write" });
  }
  return accesses;
}
