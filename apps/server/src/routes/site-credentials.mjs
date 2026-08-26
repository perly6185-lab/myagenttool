import { timingSafeEqual } from "node:crypto";

function tokenValid(req, expected) {
  const actual = String(req.headers["x-desktop-credential-token"] ?? "");
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  if (!expected || actualBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(actualBytes, expectedBytes);
}

export async function handleSiteCredentialRoutes({ req, res, url, sendJson, readJson, desktopToken, provision, revoke }) {
  if (url.pathname !== "/api/internal/site-credentials") return false;
  if (!tokenValid(req, desktopToken)) {
    sendJson(res, 404, { error: "not_found" });
    return true;
  }
  if (req.method === "PUT") {
    const result = provision(await readJson(req));
    sendJson(res, result.ok ? 200 : 400, result.ok ? { ok: true, reference: result.reference } : { error: result.error });
    return true;
  }
  if (req.method === "DELETE") {
    const result = revoke((await readJson(req))?.reference);
    sendJson(res, result.ok ? 200 : 400, result.ok ? { ok: true, reference: result.reference } : { error: result.error });
    return true;
  }
  sendJson(res, 405, { error: "method_not_allowed" });
  return true;
}
