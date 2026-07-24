export function paginateRows(rows, query = {}, { idOf = (row) => row.id } = {}) {
  const requested = query.limit != null || query.cursor != null;
  if (!requested) return { ok: true, rows, nextCursor: null, hasMore: false };
  const limit = query.limit == null ? 100 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return { ok: false, error: "invalid_pagination_limit" };
  }
  let offset = 0;
  if (query.cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(String(query.cursor), "base64url").toString("utf8"));
      const index = rows.findIndex((row) => String(idOf(row)) === decoded.id);
      if (index < 0) return { ok: false, error: "invalid_pagination_cursor" };
      offset = index + 1;
    } catch {
      return { ok: false, error: "invalid_pagination_cursor" };
    }
  }
  const page = rows.slice(offset, offset + limit);
  const hasMore = offset + page.length < rows.length;
  const last = page.at(-1);
  const nextCursor = hasMore && last
    ? Buffer.from(JSON.stringify({ id: String(idOf(last)) })).toString("base64url")
    : null;
  return { ok: true, rows: page, nextCursor, hasMore };
}

export function normalizedUpdatedSince(value) {
  if (value == null || value === "") return null;
  const candidate = String(value);
  return Number.isFinite(Date.parse(candidate)) ? candidate : undefined;
}
