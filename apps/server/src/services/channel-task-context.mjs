export function createChannelTaskContext({
  channel,
  conversation,
  event,
  identity,
  terminalId,
  projectId,
  workItemId = null,
  invocationIds = [],
  deliveryIds = [],
  traceId = null,
} = {}) {
  if (!channel?.id || !conversation?.id || !event?.id || !identity?.userId) throw contextError("channel_context_identity_required");
  if (conversation.channelId !== channel.id || event.channelId !== channel.id || event.conversationId !== conversation.id) {
    throw contextError("channel_context_mismatch");
  }
  if (!terminalId || !projectId) throw contextError("channel_task_binding_required");
  const attachments = normalizeChannelAttachmentAssets(event.attachmentAssets, { terminalId, projectId });
  return Object.freeze({
    version: 1,
    channelId: channel.id,
    conversationId: conversation.id,
    messageId: event.id,
    providerMessageId: String(event.providerMessageId ?? "").slice(0, 200),
    externalIdentityId: identity.id ?? null,
    principalId: identity.userId,
    terminalId,
    projectId,
    workItemId,
    invocationIds: boundedIds(invocationIds),
    deliveryIds: boundedIds(deliveryIds),
    attachmentAssets: attachments,
    traceId: traceId ?? workItemId ?? event.id,
  });
}

export function normalizeChannelAttachmentAssets(assets, { terminalId, projectId } = {}) {
  return (Array.isArray(assets) ? assets : []).slice(0, 20).map((asset) => {
    if (!asset?.id || !asset.path || !asset.hash || !asset.version) throw contextError("channel_attachment_not_ingested");
    if (asset.terminalId !== terminalId || asset.projectId !== projectId) throw contextError("channel_attachment_scope_mismatch");
    if (asset.readiness?.state !== "ready") throw contextError("channel_attachment_not_ready");
    return {
      id: String(asset.id).slice(0, 200),
      path: String(asset.path).slice(0, 1_000),
      family: String(asset.family ?? "unknown").slice(0, 100),
      hash: String(asset.hash).slice(0, 200),
      version: String(asset.version).slice(0, 200),
      terminalId,
      projectId,
      readiness: { state: "ready" },
    };
  });
}

export function extendChannelTaskContext(context, { workItemId, invocationId, deliveryId, traceId } = {}) {
  if (!context?.channelId || !context?.terminalId) throw contextError("invalid_channel_task_context");
  return Object.freeze({
    ...context,
    workItemId: workItemId ?? context.workItemId,
    invocationIds: boundedIds([...(context.invocationIds ?? []), ...(invocationId ? [invocationId] : [])]),
    deliveryIds: boundedIds([...(context.deliveryIds ?? []), ...(deliveryId ? [deliveryId] : [])]),
    traceId: traceId ?? context.traceId,
  });
}

function boundedIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value).slice(0, 200)).filter(Boolean))].slice(-100);
}

function contextError(code) {
  return Object.assign(new Error(code), { code });
}
