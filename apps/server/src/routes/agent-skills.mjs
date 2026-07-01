export async function handleAgentSkillRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  state,
  createAgentSkill,
  updateAgentSkill,
  deleteAgentSkill,
}) {
  if (req.method === "GET" && url.pathname === "/api/agent-skills") {
    sendJson(res, 200, { agentSkills: state.agentSkills ?? [] });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/agent-skills") {
    const body = await readJson(req);
    try {
      sendJson(res, 201, { agentSkill: createAgentSkill(body) });
    } catch (error) {
      sendJson(res, 400, { error: "invalid_agent_skill", message: errorMessage(error) });
    }
    return true;
  }

  const skillMatch = url.pathname.match(/^\/api\/agent-skills\/([^/]+)$/);
  if (req.method === "PATCH" && skillMatch) {
    const body = await readJson(req);
    try {
      sendJson(res, 200, { agentSkill: updateAgentSkill(decodeURIComponent(skillMatch[1]), body) });
    } catch (error) {
      sendJson(res, 404, { error: "agent_skill_not_found", message: errorMessage(error) });
    }
    return true;
  }

  if (req.method === "DELETE" && skillMatch) {
    try {
      deleteAgentSkill(decodeURIComponent(skillMatch[1]));
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 404, { error: "agent_skill_not_found", message: errorMessage(error) });
    }
    return true;
  }

  return false;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
