// Parsers for the git Application's read-only capability output (#801, epic #772).
//
// The git capabilities in `git-application.mjs` were deliberately shaped to be
// machine-readable — porcelain v2 and `--format` with %x1f (unit) / %x1e (record)
// separators — because git has no JSON mode. Until now nothing read them: the
// wrapper runner's non-JSON fallback stored the raw stdout as `{ text }` and the
// result stopped there.
//
// Every parser here DEGRADES rather than throws. A git version that formats
// differently, or a truncated body, must produce a worse result — never a failed
// invocation. The caller keeps the raw text either way.

const UNIT = "\u001F"; // %x1f — between fields
const RECORD = "\u001E"; // %x1e — between records

/**
 * Parse one git capability's stdout into a typed payload.
 * Returns `null` when the output cannot be read as this command — the caller
 * then keeps the raw text and marks the record unparsed.
 */
export function parseGitApplicationResult({ commandId, text }) {
  const body = typeof text === "string" ? text : "";
  if (!body.trim()) return null;
  const parse = PARSERS[commandId];
  if (!parse) return null;
  try {
    return parse(body);
  } catch {
    // A parser bug must not fail a successful git run.
    return null;
  }
}

/** The command id inside a git wrapper capability name, or null. */
export function gitCommandIdOf(capability) {
  return String(capability ?? "").match(/^app\.app_git\.wrapper\.([a-z0-9_]+)$/)?.[1] ?? null;
}

// --- status: porcelain v2, with the --branch header ---------------------------

function parseStatus(body) {
  const branch = { name: null, oid: null, upstream: null, ahead: 0, behind: 0 };
  const changed = [];
  const untracked = [];
  const unmerged = [];
  const ignored = [];
  for (const line of lines(body)) {
    if (line.startsWith("# branch.head ")) branch.name = detached(line.slice(14).trim());
    else if (line.startsWith("# branch.oid ")) branch.oid = detached(line.slice(13).trim());
    else if (line.startsWith("# branch.upstream ")) branch.upstream = line.slice(18).trim() || null;
    else if (line.startsWith("# branch.ab ")) {
      // "+2 -3" — ahead of / behind the upstream.
      const [ahead, behind] = line.slice(12).trim().split(/\s+/u);
      branch.ahead = signedCount(ahead);
      branch.behind = signedCount(behind);
    }
    // Ordinary (1) and renamed/copied (2) entries share a fixed field count
    // before the path; the path is whatever remains, so a path containing spaces
    // survives. A renamed entry's path is "<new>\t<old>".
    else if (line.startsWith("1 ")) changed.push(changedEntry(line, 8));
    else if (line.startsWith("2 ")) changed.push({ ...changedEntry(line, 9), renamed: true });
    else if (line.startsWith("u ")) unmerged.push(changedEntry(line, 10));
    else if (line.startsWith("? ")) untracked.push({ path: line.slice(2) });
    else if (line.startsWith("! ")) ignored.push({ path: line.slice(2) });
  }
  // A porcelain v2 body with no branch header and no entries is not a status.
  if (!branch.name && changed.length === 0 && untracked.length === 0 && unmerged.length === 0) return null;
  return {
    branch,
    changed,
    untracked,
    unmerged,
    ignored,
    clean: changed.length === 0 && untracked.length === 0 && unmerged.length === 0,
    counts: {
      changed: changed.length,
      untracked: untracked.length,
      unmerged: unmerged.length,
    },
  };
}

// Split off `fieldCount` fixed fields (including the leading marker), then treat
// the entire remainder as the path — porcelain v2 puts the path last precisely so
// that spaces in it need no quoting.
function changedEntry(line, fieldCount) {
  const fields = splitLeading(line, fieldCount);
  const rest = fields.at(-1) ?? "";
  const [path, originalPath = null] = rest.split("\t");
  return {
    code: fields[1] ?? null,
    path,
    ...(originalPath ? { originalPath } : {}),
  };
}

function splitLeading(line, fieldCount) {
  const fields = [];
  let rest = line;
  for (let index = 0; index < fieldCount; index += 1) {
    const at = rest.indexOf(" ");
    if (at === -1) {
      fields.push(rest);
      return fields;
    }
    fields.push(rest.slice(0, at));
    rest = rest.slice(at + 1);
  }
  fields.push(rest);
  return fields;
}

// --- log / branch_list / head -------------------------------------------------

function parseLog(body) {
  const commits = body
    .split(RECORD)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash, author, date, ...subject] = entry.split(UNIT);
      return {
        hash: (hash ?? "").trim(),
        author: author ?? null,
        // %aI is strict ISO-8601 — keep it verbatim rather than re-parsing into a
        // Date and re-serializing, which would silently shift the offset.
        date: date ?? null,
        subject: subject.join(UNIT) || null,
      };
    })
    .filter((commit) => /^[0-9a-f]{7,40}$/u.test(commit.hash));
  if (commits.length === 0) return null;
  return { commits, count: commits.length };
}

function parseBranchList(body) {
  const branches = lines(body)
    .map((line) => {
      const [name, objectName] = line.split(UNIT);
      return { name: (name ?? "").trim(), objectName: (objectName ?? "").trim() || null };
    })
    .filter((branch) => branch.name);
  if (branches.length === 0) return null;
  return { branches, count: branches.length };
}

function parseHead(body) {
  const hash = body.trim();
  if (!/^[0-9a-f]{7,40}$/u.test(hash)) return null;
  return { hash };
}

// --- diff --stat / show --stat ------------------------------------------------

function parseDiffStat(body) {
  const files = [];
  let summary = null;
  for (const line of lines(body)) {
    // " path/to/file.ts | 12 ++++--------"
    const file = line.match(/^\s*(.+?)\s+\|\s+(\d+|Bin)\s*(.*)$/u);
    if (file) {
      files.push({
        path: file[1].trim(),
        changes: file[2] === "Bin" ? null : Number(file[2]),
        binary: file[2] === "Bin",
      });
      continue;
    }
    // " 3 files changed, 12 insertions(+), 4 deletions(-)"
    if (/files? changed/u.test(line)) {
      summary = {
        filesChanged: countIn(line, /(\d+) files? changed/u),
        insertions: countIn(line, /(\d+) insertions?\(\+\)/u),
        deletions: countIn(line, /(\d+) deletions?\(-\)/u),
      };
    }
  }
  if (files.length === 0 && !summary) return null;
  return { files, summary: summary ?? { filesChanged: files.length, insertions: 0, deletions: 0 } };
}

// `show --stat` is a commit header followed by a diff stat. Parse both; a missing
// stat (an empty commit) still yields the commit.
function parseShow(body) {
  const commit = {
    hash: body.match(/^commit\s+([0-9a-f]{7,40})/mu)?.[1] ?? null,
    author: body.match(/^Author:\s*(.+)$/mu)?.[1]?.trim() ?? null,
    date: body.match(/^Date:\s*(.+)$/mu)?.[1]?.trim() ?? null,
  };
  if (!commit.hash) return null;
  const stat = parseDiffStat(body);
  return { commit, ...(stat ?? { files: [], summary: { filesChanged: 0, insertions: 0, deletions: 0 } }) };
}

const PARSERS = {
  status: parseStatus,
  log: parseLog,
  branch_list: parseBranchList,
  head: parseHead,
  diff_stat: parseDiffStat,
  diff_ref: parseDiffStat,
  show: parseShow,
};

// --- helpers ------------------------------------------------------------------

function lines(body) {
  return body.split(/\r?\n/u).map((line) => line.replace(/\s+$/u, "")).filter(Boolean);
}

function detached(value) {
  // porcelain v2 reports a detached HEAD as the literal "(detached)".
  return value === "(detached)" ? null : value || null;
}

function signedCount(value) {
  const number = Number(String(value ?? "").replace(/^[+-]/u, ""));
  return Number.isFinite(number) ? Math.abs(number) : 0;
}

function countIn(line, pattern) {
  const number = Number(line.match(pattern)?.[1] ?? 0);
  return Number.isFinite(number) ? number : 0;
}
