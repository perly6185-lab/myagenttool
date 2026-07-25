import { LOCAL_TEAM_ID, teamOf } from "./auth.mjs";
import { createAlertDispatcher, resolveOwnedAlertWebhookUrl } from "../services/auto-run-alerts.mjs";
import { createAlertOutboxService } from "../services/alert-outbox.mjs";

export function enrichAlertOwnership(state, alert) {
  const data = { ...(alert?.data ?? {}) };
  const autoRun = data.autoRunId
    ? (state.autoRuns ?? []).find((run) => run.id === data.autoRunId) ?? null
    : null;
  const workItem = data.localIssueId
    ? (state.workItems ?? []).find((item) => item.id === data.localIssueId) ?? null
    : null;
  const projectId = autoRun?.projectId ?? workItem?.projectId ?? data.projectId ?? null;
  const project = projectId
    ? (state.projects ?? []).find((item) => item.id === projectId) ?? null
    : null;
  const teamId = project ? teamOf(project) : (workItem?.ownerTeamId ?? autoRun?.teamId ?? data.teamId ?? null);
  const executionChainId = data.executionChainId ?? autoRun?.executionChainId ?? workItem?.id ?? null;
  return { ...alert, data: { ...data, projectId, teamId, executionChainId } };
}

export function createOwnedAlertRuntime({
  state,
  now,
  nextId,
  persistStateSoon,
  store,
}) {
  const dispatcher = createAlertDispatcher({
    getWebhookUrl: (alert) => resolveOwnedAlertWebhookUrl(state, alert, { localTeamId: LOCAL_TEAM_ID }),
    shouldValidateTarget: (alert) => Boolean(alert?.data?.teamId && alert.data.teamId !== LOCAL_TEAM_ID),
  });
  const outbox = createAlertOutboxService({
    state,
    now,
    nextId,
    persistStateSoon,
    store,
    dispatch: dispatcher.dispatch,
    enrichAlert: (alert) => enrichAlertOwnership(state, alert),
  });
  return { dispatcher, outbox };
}
