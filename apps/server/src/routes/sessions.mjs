// Session-manager routes: login-state observability for profile-backed site
// plugins (zhihu today). Read-only listing plus on-demand probe / interactive
// reseed — deliberately tiny; the card page consumes exactly these three.
//
// POST .../reauth spawns a HEADED browser on the server's machine and blocks
// until the operator finishes logging in (bounded by the site CLI's login
// timeout). Single-user local deployment by design (the server binds
// 127.0.0.1), so "the operator is at the machine" is the operating assumption.

export async function handleSessionRoutes({
  req,
  res,
  url,
  sendJson,
  listSessions,
  probeSessionSite,
  reseedSessionSite,
}) {
  if (req.method === "GET" && url.pathname === "/api/sessions") {
    sendJson(res, 200, { sessions: listSessions() });
    return true;
  }

  const probeMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/probe$/);
  if (req.method === "POST" && probeMatch) {
    const site = decodeURIComponent(probeMatch[1]);
    try {
      const result = await probeSessionSite(site);
      sendJson(res, 200, result);
    } catch (error) {
      const status = error?.code === "session_site_unknown" ? 404 : 502;
      sendJson(res, status, { error: error?.code ?? "session_probe_failed", message: String(error?.message ?? error) });
    }
    return true;
  }

  const reauthMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/reauth$/);
  if (req.method === "POST" && reauthMatch) {
    const site = decodeURIComponent(reauthMatch[1]);
    try {
      const result = await reseedSessionSite(site);
      sendJson(res, 200, result);
    } catch (error) {
      const status = error?.code === "session_site_unknown" ? 404 : 502;
      sendJson(res, status, { error: error?.code ?? "session_login_failed", message: String(error?.message ?? error) });
    }
    return true;
  }

  return false;
}
