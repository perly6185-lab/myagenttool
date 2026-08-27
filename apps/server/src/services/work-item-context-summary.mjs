const ROLE_PRIORITY = {
  reference: 0,
  query_source: 1,
  required_input: 2,
  change_target: 3,
  output: 4,
};
const AVAILABILITY_PRIORITY = { selected: 0, ready: 1, pending: 2, stale: 3 };

function text(value, max = 500) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, max) : null;
}

function fileName(value) {
  return text(String(value ?? "").replaceAll("\\", "/").split("/").at(-1), 300);
}

function latest(rows) {
  return [...rows].sort((left, right) => String(right.updatedAt ?? right.createdAt ?? "")
    .localeCompare(String(left.updatedAt ?? left.createdAt ?? "")))[0] ?? null;
}

function materialKey(material) {
  if (material.contentId) return `content:${material.contentId}`;
  if (material.resourceId) return `resource:${material.resourceId}`;
  if (material.recordId) return `record:${material.recordId}`;
  if (material.hash) return `hash:${material.hash}`;
  return `${material.source}:${material.id}`;
}

function mergeMaterial(materials, candidate) {
  const key = materialKey(candidate);
  const existing = materials.get(key);
  if (!existing) {
    materials.set(key, candidate);
    return;
  }
  const role = ROLE_PRIORITY[candidate.role] > ROLE_PRIORITY[existing.role]
    ? candidate.role
    : existing.role;
  const availability = AVAILABILITY_PRIORITY[candidate.availability] > AVAILABILITY_PRIORITY[existing.availability]
    ? candidate.availability
    : existing.availability;
  materials.set(key, {
    ...existing,
    role,
    availability,
    versionPolicy: existing.versionPolicy === "pinned" || candidate.versionPolicy === "pinned"
      ? "pinned"
      : "latest_at_start",
    sources: [...new Set([...(existing.sources ?? [existing.source]), ...(candidate.sources ?? [candidate.source])])],
  });
}

function projectOrigin(item, state, ownerTeamId) {
  const stored = item.channelOrigin ?? null;
  const thread = stored?.threadId
    ? (state.channelTaskThreads ?? []).find((candidate) => candidate.id === stored.threadId)
    : (state.channelTaskThreads ?? []).find((candidate) => candidate.workItemId === item.id);
  const channelId = stored?.channelId ?? thread?.channelId ?? null;
  const conversationId = stored?.conversationId ?? thread?.conversationId ?? null;
  const channel = channelId
    ? (state.channels ?? []).find((candidate) => candidate.id === channelId
      && (candidate.ownerTeamId ?? ownerTeamId) === ownerTeamId)
    : null;
  if (channelId) {
    return {
      kind: "channel",
      label: text(channel?.name, 200) ?? "Channel",
      provider: text(channel?.provider, 80),
      channelId,
      conversationId,
      threadId: stored?.threadId ?? thread?.id ?? null,
      sourceMessageCount: Math.max(1, thread?.sourceEventIds?.length ?? (stored?.messageId ? 1 : 0)),
    };
  }

  const primaryExternal = (item.externalBindings ?? []).find((binding) => binding.isPrimary)
    ?? (item.externalBindings ?? []).find((binding) => binding.relation === "source")
    ?? null;
  if (primaryExternal) {
    const provider = text(primaryExternal.provider ?? primaryExternal.kind?.split("_")[0], 40);
    return {
      kind: "issue",
      label: `${provider ? provider.toUpperCase() : "Issue"}${primaryExternal.number ? ` #${primaryExternal.number}` : ""}`,
      provider,
      channelId: null,
      conversationId: null,
      threadId: null,
      sourceMessageCount: 0,
    };
  }

  const intake = text(item.intakeChannel, 40);
  return {
    kind: intake && !["manual", "unknown"].includes(intake) ? intake : "manual",
    label: intake && !["manual", "unknown"].includes(intake) ? intake : "manual",
    provider: null,
    channelId: null,
    conversationId: null,
    threadId: null,
    sourceMessageCount: 0,
  };
}

function projectMethod(item) {
  if (item.myTemplateBinding) {
    return {
      kind: "template",
      name: text(item.myTemplateBinding.name, 300) ?? "已保存模板",
      definitionId: text(item.myTemplateBinding.definitionId, 200),
      familyId: text(item.myTemplateBinding.familyId, 200),
      version: Number.isInteger(item.myTemplateBinding.version) ? item.myTemplateBinding.version : null,
      expectedOutput: text(item.myTemplateBinding.expectedOutput, 1_000),
      snapshotHash: text(item.myTemplateBinding.snapshotHash, 128),
    };
  }
  const workMode = item.channelTaskContract?.workMode ?? null;
  const methodNeedsConfirmation = workMode?.state === "needs_confirmation";
  return {
    kind: "custom",
    name: methodNeedsConfirmation ? "处理方式待确认" : text(workMode?.name, 300) ?? "本任务方案",
    definitionId: text(workMode?.trace?.templateDefinitionId, 200),
    familyId: text(workMode?.trace?.templateFamilyId, 200),
    version: Number.isInteger(workMode?.version) ? workMode.version : null,
    expectedOutput: text(workMode?.expectedOutput ?? item.channelTaskContract?.outputExpectation, 1_000),
    snapshotHash: text(workMode?.trace?.executionDigest, 128),
  };
}

function projectMaterials(item, origin) {
  const materials = new Map();
  for (const asset of (item.inputAssets ?? []).slice(0, 100)) {
    const channelAttachment = asset.readiness?.reason === "channel_attachment_ingested"
      || (origin.kind === "channel" && item.channelTaskContract?.dataSources?.some((source) => source.id === asset.id && source.kind === "channel_attachment"));
    mergeMaterial(materials, {
      id: text(asset.id ?? asset.path, 200) ?? `asset-${materials.size + 1}`,
      contentId: text(asset.contentId, 200),
      resourceId: null,
      recordId: null,
      title: text(asset.originalName, 300) ?? fileName(asset.path) ?? "任务文件",
      role: "required_input",
      source: channelAttachment ? "channel_attachment" : "task_file",
      locality: "local",
      availability: asset.readiness?.state === "ready" ? "ready" : "pending",
      versionPolicy: asset.hash || asset.version ? "pinned" : "latest_at_start",
      hash: text(asset.hash, 128),
    });
  }
  for (const reference of (item.localContentRefs ?? []).slice(0, 50)) {
    mergeMaterial(materials, {
      id: text(reference.id, 200) ?? `content-${materials.size + 1}`,
      contentId: text(reference.contentId, 200),
      resourceId: text(reference.resourceId, 200),
      recordId: null,
      title: text(reference.title, 300) ?? "我的资料",
      role: reference.purpose === "required_input" ? "required_input" : "reference",
      source: "my_materials",
      locality: "local",
      availability: "selected",
      versionPolicy: reference.selectedFingerprint ? "pinned" : "latest_at_start",
      hash: null,
    });
  }
  for (const reference of (item.taskResourceRefs ?? []).slice(0, 50)) {
    mergeMaterial(materials, {
      id: text(reference.id, 200) ?? `resource-${materials.size + 1}`,
      contentId: null,
      resourceId: text(reference.resourceId, 200),
      recordId: null,
      title: text(reference.title, 300) ?? "工作资料",
      role: ["query_source", "change_target"].includes(reference.purpose) ? reference.purpose : "reference",
      source: reference.locality === "remote" ? "remote_resource" : "local_resource",
      locality: reference.locality === "remote" ? "remote" : "local",
      availability: "selected",
      versionPolicy: reference.selectedVersion ? "pinned" : "latest_at_start",
      hash: null,
    });
  }
  for (const binding of (item.recordBindings ?? []).slice(0, 50)) {
    const output = binding.direction === "output";
    mergeMaterial(materials, {
      id: text(binding.id, 200) ?? `record-${materials.size + 1}`,
      contentId: null,
      resourceId: null,
      recordId: text(binding.record?.recordId, 200),
      title: text(binding.record?.title, 300) ?? (output ? "结果业务记录" : "业务记录"),
      role: output ? "output" : binding.role === "required" ? "required_input" : "reference",
      source: "business_record",
      locality: "managed",
      availability: binding.resolution?.state === "resolved" ? "ready"
        : binding.resolution?.state === "stale" ? "stale" : "pending",
      versionPolicy: binding.snapshot ? "pinned" : "latest_at_start",
      hash: null,
    });
  }
  return [...materials.values()].slice(0, 100).map(({ contentId: _contentId, resourceId: _resourceId, recordId: _recordId, hash: _hash, ...visible }) => visible);
}

function projectDelivery(item, state, origin, ownerTeamId) {
  if (origin.kind === "channel") {
    const delivery = latest((state.channelDeliveries ?? []).filter((candidate) =>
      candidate.channelId === origin.channelId
      && (candidate.taskContext?.workItemId === item.id
        || candidate.taskContext?.threadId === origin.threadId)
      && (!candidate.ownerTeamId || candidate.ownerTeamId === ownerTeamId)));
    return {
      destination: "channel",
      label: origin.label,
      channelId: origin.channelId,
      conversationId: origin.conversationId,
      status: text(delivery?.status, 60),
    };
  }
  return {
    destination: "task",
    label: "task",
    channelId: null,
    conversationId: null,
    status: null,
  };
}

/**
 * One bounded ordinary-user projection over existing canonical task, Channel,
 * template, and material records. It deliberately persists no parallel copy.
 */
export function projectWorkItemContextSummary({ item, state, ownerTeamId } = {}) {
  if (!item?.id || !state) return null;
  const teamId = ownerTeamId ?? item.ownerTeamId;
  const origin = projectOrigin(item, state, teamId);
  return {
    schemaVersion: 1,
    origin,
    method: projectMethod(item),
    materials: projectMaterials(item, origin),
    delivery: projectDelivery(item, state, origin, teamId),
  };
}
