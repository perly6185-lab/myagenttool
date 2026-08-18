/*
 * Channel Registry (S2 of initiative #1090, ADR 0012): the control-plane
 * lifecycle of a Channel — register, enable/disable, readiness, and the
 * explicit provider-identity → user mappings that S4 dispatch fails closed on.
 *
 * Two properties this holds, both load-bearing:
 *   1. No secret ever enters a channel record. Readiness is computed by an
 *      injected probe (gateway env presence) and reported as booleans per
 *      scope (ADR 0010/0012 rule 4).
 *   2. Enabling — the risky direction, it turns on external message intake —
 *      is approval-gated through the same single-use grant flow every other
 *      side-effecting action uses. Disabling is always allowed for the owner.
 */

import {
  channelIdPrefixes,
  channelProviders,
  channelReadinessScopes,
} from "@myagenttool/protocol/channel";
import { detectPromptInjection } from "@myagenttool/protocol/issue-prompt";
import { LOCAL_TEAM_ID } from "../runtime/auth.mjs";
import { listDevices } from "../runtime/device.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { normalizeChannelAttachmentAssets } from "./channel-task-context.mjs";

export const CHANNEL_ENABLE_ACTION = "channel.enable";
export const CHANNEL_ALLOWLIST_ACTION = "channel.allowlist";
export const CHANNEL_TASK_PROJECT_ACTION = "channel.taskProject";
export const CHANNEL_APPROVAL_POLICY_ACTION = "channel.approvalPolicy";
const MAX_NAME_LENGTH = 80;
const MAX_ALLOWLIST = 50;
// Inbound-flood bounds (#channel-audit): a signed corp user's messages clear the
// gateway, so the event log must be bounded in both per-message size and count.
const MAX_EVENT_CONTENT_CHARS = 4000;
const MAX_OUTBOUND_CONTENT_CHARS = 2048;
const MAX_CHANNEL_EVENTS = 2000;
// Per-channel /task aggregate ceiling (across ALL the channel's users, per UTC
// day) — the second limiter above the per-conversation 10/min. Owner-configurable.
const DEFAULT_TASK_DAILY_LIMIT = 50;
const MAX_TASK_DAILY_LIMIT = 10_000;
export const CHANNEL_OPERATION_MODES = Object.freeze(["personal", "team"]);

function encodeInteractionCursor(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeInteractionCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    if (!parsed || typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") return null;
    return { createdAt: parsed.createdAt.slice(0, 80), id: parsed.id.slice(0, 200) };
  } catch {
    return null;
  }
}

/** WeCom readiness probe: configuration PRESENCE from the gateway env — never values. */
export function wecomEnvReadiness(env = process.env) {
  return {
    callback_token: Boolean(String(env.WECOM_CALLBACK_TOKEN ?? "").trim()),
    encoding_aes_key: Boolean(String(env.WECOM_ENCODING_AES_KEY ?? "").trim()),
    corp_secret: Boolean(String(env.WECOM_CORP_SECRET ?? "").trim()),
  };
}

/** Feishu readiness probe (#1110): env PRESENCE only, never the secret values. */
export function feishuEnvReadiness(env = process.env) {
  return {
    app_id: Boolean(String(env.FEISHU_APP_ID ?? "").trim()),
    app_secret: Boolean(String(env.FEISHU_APP_SECRET ?? "").trim()),
    verification_token: Boolean(String(env.FEISHU_VERIFICATION_TOKEN ?? "").trim()),
    encrypt_key: Boolean(String(env.FEISHU_ENCRYPT_KEY ?? "").trim()),
  };
}

/** DingTalk readiness probe (#1119): env PRESENCE only, never the secret values. */
export function dingtalkEnvReadiness(env = process.env) {
  return {
    app_key: Boolean(String(env.DINGTALK_APP_KEY ?? "").trim()),
    app_secret: Boolean(String(env.DINGTALK_APP_SECRET ?? "").trim()),
    robot_code: Boolean(String(env.DINGTALK_ROBOT_CODE ?? "").trim()),
  };
}

/** Slack readiness probe (#1128): env PRESENCE only, never the secret values. */
export function slackEnvReadiness(env = process.env) {
  return {
    signing_secret: Boolean(String(env.SLACK_SIGNING_SECRET ?? "").trim()),
    bot_token: Boolean(String(env.SLACK_BOT_TOKEN ?? "").trim()),
  };
}

/** Microsoft Teams readiness probe (#1135): env PRESENCE only, never the secret values. */
export function teamsEnvReadiness(env = process.env) {
  return {
    app_id: Boolean(String(env.TEAMS_APP_ID ?? "").trim()),
    app_password: Boolean(String(env.TEAMS_APP_PASSWORD ?? "").trim()),
  };
}

/** iLink readiness is supplied by the session runtime, not environment secrets. */
export function wechatIlinkEnvReadiness() {
  return { account: false, session: false, worker: false };
}

/** Default readiness probes by provider (#1110/#1119/#1128/#1135). */
export const defaultReadinessProbes = {
  wecom: wecomEnvReadiness,
  feishu: feishuEnvReadiness,
  dingtalk: dingtalkEnvReadiness,
  slack: slackEnvReadiness,
  teams: teamsEnvReadiness,
  wechat_ilink: wechatIlinkEnvReadiness,
};

export function createChannelService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon = () => {},
  store,
  validateApprovalToken,
  // Back-compat: a single `readinessProbe` still overrides WeCom's probe (the
  // shape existing tests pass); `readinessProbes` overrides per provider.
  readinessProbe = null,
  readinessProbes = defaultReadinessProbes,
  refuse = null,
}) {
  const probes = {
    ...readinessProbes,
    ...(readinessProbe ? { wecom: readinessProbe } : {}),
  };
  const runTx = makeRunTx({ store, persistStateSoon });

  const actorTeam = (actor) => actor?.teamId ?? LOCAL_TEAM_ID;

  // Foreign team sees the same shape as "does not exist" — 404, never 403,
  // so channel ids cannot be enumerated across teams (the tenancy policy of
  // TENANCY_ROUTE_MATRIX.md).
  function findOwnChannel(channelId, actor) {
    const channel = (state.channels ?? []).find((row) => row.id === String(channelId ?? ""));
    if (!channel) return null;
    if (actor?.teamId && (channel.ownerTeamId ?? LOCAL_TEAM_ID) !== actor.teamId) return null;
    return channel;
  }

  const notFound = () => ({ ok: false, status: 404, body: { error: "channel_not_found" } });

  function readiness(channel) {
    const probe = probes[channel.provider];
    const probed = typeof probe === "function" ? probe(channel) : {};
    const scopes = {};
    for (const scope of channelReadinessScopes[channel.provider] ?? []) {
      scopes[scope] = Boolean(probed?.[scope]);
    }
    return scopes;
  }

  function publicChannel(channel) {
    return { ...channel, readiness: readiness(channel) };
  }

  function registerChannel({ provider, name } = {}, actor = null) {
    const normalizedProvider = String(provider ?? "").trim();
    if (!channelProviders.includes(normalizedProvider)) {
      return { ok: false, status: 400, body: { error: "unsupported_channel_provider", supported: channelProviders } };
    }
    const normalizedName = String(name ?? "").trim().slice(0, MAX_NAME_LENGTH);
    if (!normalizedName) {
      return { ok: false, status: 400, body: { error: "invalid_channel_name" } };
    }
    const ownerTeamId = actorTeam(actor);
    const duplicate = (state.channels ?? []).find(
      (row) => row.provider === normalizedProvider && row.name === normalizedName && (row.ownerTeamId ?? LOCAL_TEAM_ID) === ownerTeamId,
    );
    if (duplicate) {
      return { ok: false, status: 409, body: { error: "channel_already_registered", channelId: duplicate.id } };
    }
    const channel = {
      id: nextId(channelIdPrefixes.channel),
      provider: normalizedProvider,
      name: normalizedName,
      status: "registered",
      ownerTeamId,
      // S4: nothing is dispatchable until the owner allowlists it explicitly —
      // the channel-side gate, independent of the capability gateway's own.
      capabilityAllowlist: [],
      statusCapability: null,
      // The project /task files GitHub issues into. Null = /task disabled for this
      // channel; the owner binding a project IS the authorization to file tasks
      // from this channel's (untrusted) inbound into that repo.
      taskProjectId: null,
      // Personal channels are the default local-user experience: the owner is
      // also the operator, so confirmed tasks enter execution directly. Team
      // channels can opt back into capture/approval semantics.
      operationMode: "personal",
      taskAutoRoute: true,
      // Aggregate /task ceiling: at most this many per UTC day across all users.
      taskDailyLimit: DEFAULT_TASK_DAILY_LIMIT,
      taskDayDate: null, // the UTC day taskDayCount is counting
      taskDayCount: 0,
      // Personal mode removes the team-admin step for ordinary confirmed
      // tasks. High-risk invocation approval remains a separate, explicit
      // console action unless the owner opts into in-channel approval.
      allowSelfApprove: false,
      createdAt: now(),
      updatedAt: now(),
    };
    runTx(() => {
      state.channels.push(channel);
      appendEvent({
        invocationId: null,
        type: "channel_registered",
        level: "info",
        message: `Channel ${channel.id} (${channel.provider}: ${channel.name}) registered.`,
        data: { channelId: channel.id, provider: channel.provider },
      });
    });
    return { ok: true, status: 201, body: { channel: publicChannel(channel) } };
  }

  function listChannels(actor = null) {
    const rows = (state.channels ?? []).filter(
      (row) => !actor?.teamId || (row.ownerTeamId ?? LOCAL_TEAM_ID) === actor.teamId,
    );
    return { ok: true, status: 200, body: { channels: rows.map(publicChannel), count: rows.length } };
  }

  function listChannelInteractions({ channelId, conversationId = null, direction = "all", type = "all", status = "all", query = "", cursor = null, limit = 50 } = {}, actor = null) {
    const channel = findOwnChannel(channelId, actor);
    if (!channel) return notFound();
    const normalizedDirection = ["all", "inbound", "outbound"].includes(String(direction)) ? String(direction) : "all";
    const normalizedType = ["all", "text", "image", "voice", "file", "mixed"].includes(String(type)) ? String(type) : "all";
    const normalizedStatus = String(status ?? "all").slice(0, 40) || "all";
    const normalizedQuery = String(query ?? "").trim().toLowerCase().slice(0, 200);
    const normalizedConversationId = conversationId ? String(conversationId) : null;
    const pageSize = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));

    const attachmentView = (asset) => {
      const path = asset?.path ? String(asset.path).replaceAll("\\", "/").slice(0, 1_000) : null;
      return {
        id: asset?.id ? String(asset.id).slice(0, 200) : null,
        name: String(asset?.name ?? path?.split("/").at(-1) ?? "attachment").slice(0, 200),
        family: String(asset?.family ?? "unknown").slice(0, 40),
        mimeType: asset?.mimeType ? String(asset.mimeType).slice(0, 120) : null,
        size: Number.isFinite(Number(asset?.size)) ? Number(asset.size) : null,
        projectId: asset?.projectId ? String(asset.projectId).slice(0, 200) : null,
        path,
      };
    };
    const typeFor = (directionValue, content, assets) => {
      if (!assets.length) return "text";
      if (assets.length > 1) return "mixed";
      const family = assets[0].family;
      return ["image", "audio", "video"].includes(family) ? (family === "audio" ? "voice" : family) : directionValue === "inbound" && content ? "mixed" : "file";
    };
    const inbound = (state.channelEvents ?? [])
      .filter((row) => row.channelId === channel.id)
      .map((row) => {
        const attachments = (row.attachmentAssets ?? []).map(attachmentView);
        return {
          id: row.id,
          direction: "inbound",
          type: typeFor("inbound", row.content, attachments),
          content: String(row.content ?? "").slice(0, MAX_EVENT_CONTENT_CHARS),
          attachments,
          status: row.status ?? "imported",
          createdAt: row.receivedAt ?? row.providerCreateTime ?? null,
          conversationId: row.conversationId,
          externalUserId: row.externalUserId,
          providerMessageId: row.providerMessageId,
          injectionSuspicious: Boolean(row.injectionSuspicious),
          mediaFailure: row.mediaFailure
            ? {
              total: row.mediaFailure.total ?? 0,
              failed: (row.mediaFailure.failed ?? []).map((item) => ({
                kind: String(item?.kind ?? "file").slice(0, 40),
                filename: String(item?.filename ?? "attachment").slice(0, 160),
                code: String(item?.code ?? "media_import_failed").slice(0, 80),
              })),
            }
            : null,
        };
      });
    const outbound = (state.channelDeliveries ?? [])
      .filter((row) => row.channelId === channel.id)
      .map((row) => {
        const attachments = (row.mediaAssets ?? []).map(attachmentView);
        return {
          id: row.id,
          direction: "outbound",
          type: typeFor("outbound", row.content, attachments),
          content: String(row.content ?? "").slice(0, MAX_OUTBOUND_CONTENT_CHARS),
          attachments,
          status: row.status ?? "queued",
          createdAt: row.updatedAt ?? row.createdAt ?? null,
          conversationId: row.conversationId,
          deliveryId: row.id,
          invocationId: row.invocationId ?? null,
          attempts: Number(row.attempts ?? 0),
          providerReceiptId: row.providerReceiptId ?? null,
          lastErrorCode: row.lastErrorCode ?? null,
        };
      });
    let rows = [...inbound, ...outbound]
      .filter((row) => !normalizedConversationId || row.conversationId === normalizedConversationId)
      .filter((row) => normalizedDirection === "all" || row.direction === normalizedDirection)
      .filter((row) => normalizedType === "all" || row.type === normalizedType)
      .filter((row) => normalizedStatus === "all" || row.status === normalizedStatus)
      .filter((row) => {
        if (!normalizedQuery) return true;
        const attachmentText = row.attachments.map((asset) => `${asset.name} ${asset.family}`).join(" ");
        return `${row.content} ${row.externalUserId ?? ""} ${attachmentText}`.toLowerCase().includes(normalizedQuery);
      })
      .sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")) || String(right.id).localeCompare(String(left.id)));
    const decodedCursor = decodeInteractionCursor(cursor);
    if (decodedCursor) {
      rows = rows.filter((row) => String(row.createdAt ?? "") < decodedCursor.createdAt
        || (String(row.createdAt ?? "") === decodedCursor.createdAt && String(row.id) < decodedCursor.id));
    }
    const page = rows.slice(0, pageSize);
    const last = page.at(-1);
    const nextCursor = rows.length > pageSize && last ? encodeInteractionCursor({ createdAt: String(last.createdAt ?? ""), id: last.id }) : null;
    return { ok: true, status: 200, body: { interactions: page, nextCursor, count: page.length } };
  }

  /**
   * Enable external intake. Gated on a single-use grant bound to
   * (channel.enable, channelId) — turning on a public listener's traffic is a
   * side effect a human explicitly confirms (ADR 0012 rule 5).
   */
  function enableChannel({ channelId, approvalToken } = {}, actor = null) {
    const channel = findOwnChannel(channelId, actor);
    if (!channel) return notFound();
    if (channel.status === "enabled") {
      return { ok: true, status: 200, body: { channel: publicChannel(channel), status: "noop" } };
    }
    const approval = typeof validateApprovalToken === "function"
      ? validateApprovalToken(approvalToken, { action: CHANNEL_ENABLE_ACTION, targetId: channel.id, actor })
      : { approved: false, reason: "approval_validator_unavailable" };
    if (!approval.approved) {
      return {
        ok: false,
        status: 409,
        body: {
          error: "approval_required",
          reason: approval.reason === "missing_token"
            ? "Enabling a channel requires an explicit approvalToken."
            : `approvalToken rejected: ${approval.reason}.`,
          action: CHANNEL_ENABLE_ACTION,
          targetId: channel.id,
        },
      };
    }
    runTx(() => {
      channel.status = "enabled";
      channel.updatedAt = now();
      appendEvent({
        invocationId: null,
        type: "channel_enabled",
        level: "info",
        message: `Channel ${channel.id} enabled.`,
        data: { channelId: channel.id, provider: channel.provider },
      });
    });
    return { ok: true, status: 200, body: { channel: publicChannel(channel) } };
  }

  function disableChannel({ channelId } = {}, actor = null) {
    const channel = findOwnChannel(channelId, actor);
    if (!channel) return notFound();
    if (channel.status === "disabled") {
      return { ok: true, status: 200, body: { channel: publicChannel(channel), status: "noop" } };
    }
    runTx(() => {
      channel.status = "disabled";
      channel.updatedAt = now();
      appendEvent({
        invocationId: null,
        type: "channel_disabled",
        level: "info",
        message: `Channel ${channel.id} disabled.`,
        data: { channelId: channel.id, provider: channel.provider },
      });
    });
    return { ok: true, status: 200, body: { channel: publicChannel(channel) } };
  }

  function channelHealth({ channelId } = {}, actor = null) {
    const channel = findOwnChannel(channelId, actor);
    if (!channel) return notFound();
    const scopes = readiness(channel);
    const ready = Object.values(scopes).every(Boolean);
    const deliveries = (state.channelDeliveries ?? []).filter((row) => row.channelId === channel.id);
    return {
      ok: true,
      status: 200,
      body: {
        channelId: channel.id,
        status: channel.status,
        ready,
        readiness: scopes,
        counts: {
          events: (state.channelEvents ?? []).filter((row) => row.channelId === channel.id).length,
          conversations: (state.channelConversations ?? []).filter((row) => row.channelId === channel.id).length,
          deliveries: deliveries.length,
          failedDeliveries: deliveries.filter((row) => row.status === "failed_terminal").length,
        },
      },
    };
  }

  function channelDiagnostics({ channelId } = {}, actor = null) {
    const channel = findOwnChannel(channelId, actor);
    if (!channel) return notFound();
    const events = (state.channelEvents ?? []).filter((row) => row.channelId === channel.id);
    const deliveries = (state.channelDeliveries ?? []).filter((row) => row.channelId === channel.id);
    const conversations = (state.channelConversations ?? []).filter((row) => row.channelId === channel.id);
    const threads = (state.channelTaskThreads ?? []).filter((row) => row.channelId === channel.id);
    const readinessScopes = readiness(channel);
    const latest = (rows, selector) => rows
      .map(selector)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
    const inboundStatus = Object.fromEntries([...new Set(events.map((row) => row.status).filter(Boolean))].map((status) => [status, events.filter((row) => row.status === status).length]));
    const outboundStatus = Object.fromEntries([...new Set(deliveries.map((row) => row.status).filter(Boolean))].map((status) => [status, deliveries.filter((row) => row.status === status).length]));
    const taskStatus = Object.fromEntries([...new Set(threads.map((row) => row.status).filter(Boolean))].map((status) => [status, threads.filter((row) => row.status === status).length]));
    const failures = [
      ...deliveries
        .filter((row) => row.status === "failed_terminal")
        .map((row) => ({ direction: "outbound", status: row.status, code: row.lastErrorCode ?? "delivery_failed", attempts: row.attempts ?? 0, at: row.updatedAt ?? row.createdAt ?? null })),
      ...events
        .filter((row) => row.status === "refused" || row.mediaFailure?.failed?.length)
        .map((row) => ({ direction: "inbound", status: row.status, code: row.mediaFailure?.failed?.[0]?.code ?? row.intentDecision?.reason ?? "event_refused", attempts: 0, at: row.receivedAt ?? null })),
    ].filter((row) => row.at).sort((left, right) => String(right.at).localeCompare(String(left.at))).slice(0, 10);
    const scopes = Object.values(readinessScopes);
    return {
      ok: true,
      status: 200,
      body: {
        generatedAt: now(),
        channel: {
          id: channel.id,
          provider: channel.provider,
          name: channel.name,
          status: channel.status,
          ready: scopes.length > 0 && scopes.every(Boolean),
          readiness: readinessScopes,
        },
        activity: {
          lastInboundAt: latest(events, (row) => row.receivedAt),
          lastOutboundAt: latest(deliveries, (row) => row.createdAt ?? row.updatedAt),
          lastDeliveredAt: latest(deliveries.filter((row) => row.status === "delivered"), (row) => row.updatedAt ?? row.createdAt),
          lastFailureAt: failures[0]?.at ?? null,
        },
        pipeline: {
          conversations: conversations.length,
          inbound: inboundStatus,
          outbound: outboundStatus,
          tasks: taskStatus,
        },
        failures,
        note: "诊断信息已脱敏，不包含消息正文、凭据或访问令牌。",
      },
    };
  }

  /** Map a provider identity onto a user of the channel's own team. Fail-closed dispatch (S4) depends on these rows. */
  function mapChannelIdentity({ channelId, externalUserId, userId } = {}, actor = null) {
    const channel = findOwnChannel(channelId, actor);
    if (!channel) return notFound();
    const externalId = String(externalUserId ?? "").trim();
    const targetUserId = String(userId ?? "").trim();
    if (!externalId || !targetUserId) {
      return { ok: false, status: 400, body: { error: "invalid_identity_mapping" } };
    }
    const user = (state.users ?? []).find((row) => row.id === targetUserId);
    // The mapped user must exist AND belong to the channel's owning team — a
    // mapping onto a foreign team's user would let a WeCom sender act across
    // the tenancy boundary.
    if (!user || (user.teamId ?? LOCAL_TEAM_ID) !== (channel.ownerTeamId ?? LOCAL_TEAM_ID)) {
      return { ok: false, status: 404, body: { error: "user_not_found" } };
    }
    const existing = (state.channelIdentities ?? []).find(
      (row) => row.channelId === channel.id && row.externalUserId === externalId,
    );
    if (existing) {
      return { ok: false, status: 409, body: { error: "identity_already_mapped", identityId: existing.id } };
    }
    const identity = {
      id: nextId(channelIdPrefixes.identity),
      channelId: channel.id,
      externalUserId: externalId,
      userId: targetUserId,
      ownerTeamId: channel.ownerTeamId ?? LOCAL_TEAM_ID,
      createdAt: now(),
    };
    runTx(() => {
      state.channelIdentities.push(identity);
      appendEvent({
        invocationId: null,
        type: "channel_identity_mapped",
        level: "info",
        message: `Channel ${channel.id}: external identity mapped to ${targetUserId}.`,
        data: { channelId: channel.id, identityId: identity.id, userId: targetUserId },
      });
    });
    return { ok: true, status: 201, body: { identity } };
  }

  function removeChannelIdentity({ channelId, identityId } = {}, actor = null) {
    const channel = findOwnChannel(channelId, actor);
    if (!channel) return notFound();
    const identity = (state.channelIdentities ?? []).find(
      (row) => row.id === String(identityId ?? "") && row.channelId === channel.id,
    );
    if (!identity) {
      return { ok: false, status: 404, body: { error: "identity_not_found" } };
    }
    runTx(() => {
      state.channelIdentities = state.channelIdentities.filter((row) => row.id !== identity.id);
      appendEvent({
        invocationId: null,
        type: "channel_identity_removed",
        level: "info",
        message: `Channel ${channel.id}: identity mapping ${identity.id} removed.`,
        data: { channelId: channel.id, identityId: identity.id, userId: identity.userId },
      });
    });
    return { ok: true, status: 200, body: { removed: identity.id } };
  }

  function listChannelIdentities({ channelId } = {}, actor = null) {
    const channel = findOwnChannel(channelId, actor);
    if (!channel) return notFound();
    const rows = (state.channelIdentities ?? []).filter((row) => row.channelId === channel.id);
    return { ok: true, status: 200, body: { identities: rows, count: rows.length } };
  }

  /**
   * Set the per-channel capability allowlist (S4). Approval-gated: expanding
   * what a public conversation can reach is a side effect a human confirms.
   * `statusCapability` must itself be allowlisted — /status is sugar for /run.
   */
  function setChannelAllowlist({ channelId, capabilities, statusCapability = null, approvalToken } = {}, actor = null) {
    const channel = findOwnChannel(channelId, actor);
    if (!channel) return notFound();
    if (!Array.isArray(capabilities) || capabilities.length > MAX_ALLOWLIST) {
      return { ok: false, status: 400, body: { error: "invalid_allowlist" } };
    }
    const normalized = [...new Set(capabilities.map((name) => String(name ?? "").trim()).filter(Boolean))];
    const status = statusCapability == null ? null : String(statusCapability).trim() || null;
    if (status && !normalized.includes(status)) {
      return { ok: false, status: 400, body: { error: "status_capability_not_allowlisted" } };
    }
    const approval = typeof validateApprovalToken === "function"
      ? validateApprovalToken(approvalToken, { action: CHANNEL_ALLOWLIST_ACTION, targetId: channel.id, actor })
      : { approved: false, reason: "approval_validator_unavailable" };
    if (!approval.approved) {
      return {
        ok: false,
        status: 409,
        body: {
          error: "approval_required",
          reason: approval.reason === "missing_token"
            ? "Changing a channel's capability allowlist requires an explicit approvalToken."
            : `approvalToken rejected: ${approval.reason}.`,
          action: CHANNEL_ALLOWLIST_ACTION,
          targetId: channel.id,
        },
      };
    }
    runTx(() => {
      channel.capabilityAllowlist = normalized;
      channel.statusCapability = status;
      channel.updatedAt = now();
      appendEvent({
        invocationId: null,
        type: "channel_allowlist_updated",
        level: "info",
        message: `Channel ${channel.id}: capability allowlist set (${normalized.length} entries).`,
        data: { channelId: channel.id, capabilities: normalized, statusCapability: status },
      });
    });
    return { ok: true, status: 200, body: { channel: publicChannel(channel) } };
  }

  // Bind (or clear, projectId=null) the project that /task files GitHub issues
  // into. Owner-scoped + approval-gated like the allowlist; the bound project
  // must belong to the channel's owning team (no cross-team task filing).
  function setChannelTaskProject({ channelId, projectId, terminalId = null, autoRoute, dailyLimit, operationMode, approvalToken } = {}, actor = null) {
    const channel = findOwnChannel(channelId, actor);
    if (!channel) return notFound();
    const target = projectId == null ? null : (state.projects ?? []).find((p) => p.id === String(projectId));
    if (projectId != null && !target) {
      return { ok: false, status: 400, body: { error: "project_not_found" } };
    }
    if (target && (target.ownerTeamId ?? LOCAL_TEAM_ID) !== (channel.ownerTeamId ?? LOCAL_TEAM_ID)) {
      return { ok: false, status: 403, body: { error: "project_foreign_team" } };
    }
    const devices = listDevices(state);
    const requestedTerminalId = terminalId == null ? null : String(terminalId);
    const terminal = target
      ? requestedTerminalId
        ? devices.find((candidate) => candidate.id === requestedTerminalId)
        : devices.length <= 1
          ? devices[0] ?? null
          : null
      : null;
    if (target && !terminal) {
      return { ok: false, status: 400, body: { error: requestedTerminalId ? "terminal_not_found" : "terminal_binding_required" } };
    }
    const requestedMode = operationMode == null ? null : String(operationMode).trim().toLowerCase();
    if (requestedMode != null && !CHANNEL_OPERATION_MODES.includes(requestedMode)) {
      return { ok: false, status: 400, body: { error: "invalid_channel_operation_mode", supported: CHANNEL_OPERATION_MODES } };
    }
    const approval = typeof validateApprovalToken === "function"
      ? validateApprovalToken(approvalToken, { action: CHANNEL_TASK_PROJECT_ACTION, targetId: channel.id, actor })
      : { approved: false, reason: "approval_validator_unavailable" };
    if (!approval.approved) {
      return {
        ok: false,
        status: 409,
        body: {
          error: "approval_required",
          reason: approval.reason === "missing_token"
            ? "Binding a channel's task project requires an explicit approvalToken."
            : `approvalToken rejected: ${approval.reason}.`,
          action: CHANNEL_TASK_PROJECT_ACTION,
          targetId: channel.id,
        },
      };
    }
    runTx(() => {
      channel.taskProjectId = target ? target.id : null;
      channel.taskTerminalId = terminal?.id ?? null;
      if (requestedMode != null) channel.operationMode = requestedMode;
      if (requestedMode === "personal") channel.taskAutoRoute = true;
      else if (autoRoute != null) channel.taskAutoRoute = Boolean(autoRoute);
      if (dailyLimit != null) {
        const n = Number(dailyLimit);
        if (Number.isInteger(n) && n >= 0) channel.taskDailyLimit = Math.min(n, MAX_TASK_DAILY_LIMIT);
      }
      channel.updatedAt = now();
      appendEvent({
        invocationId: null,
        type: "channel_task_project_set",
        level: "info",
        message: `Channel ${channel.id}: task project ${target ? `bound to ${target.id}` : "cleared"}${requestedMode != null ? `, mode ${channel.operationMode}` : ""}${autoRoute != null ? `, auto-route ${channel.taskAutoRoute ? "on" : "off"}` : ""}.`,
        data: { channelId: channel.id, projectId: target?.id ?? null, terminalId: channel.taskTerminalId, operationMode: channel.operationMode, autoRoute: channel.taskAutoRoute },
      });
    });
    return { ok: true, status: 200, body: { channel: publicChannel(channel) } };
  }

  // Owner opt-in for in-channel self-approval (default off). Approval-gated +
  // owner-scoped like the other channel-trust setters.
  function setChannelApprovalPolicy({ channelId, allowSelfApprove, approvalToken } = {}, actor = null) {
    const channel = findOwnChannel(channelId, actor);
    if (!channel) return notFound();
    const approval = typeof validateApprovalToken === "function"
      ? validateApprovalToken(approvalToken, { action: CHANNEL_APPROVAL_POLICY_ACTION, targetId: channel.id, actor })
      : { approved: false, reason: "approval_validator_unavailable" };
    if (!approval.approved) {
      return {
        ok: false,
        status: 409,
        body: {
          error: "approval_required",
          reason: approval.reason === "missing_token"
            ? "Changing in-channel approval policy requires an explicit approvalToken."
            : `approvalToken rejected: ${approval.reason}.`,
          action: CHANNEL_APPROVAL_POLICY_ACTION,
          targetId: channel.id,
        },
      };
    }
    runTx(() => {
      channel.allowSelfApprove = Boolean(allowSelfApprove);
      channel.updatedAt = now();
      appendEvent({
        invocationId: null,
        type: "channel_approval_policy_set",
        level: "info",
        message: `Channel ${channel.id}: in-channel self-approval ${channel.allowSelfApprove ? "enabled" : "disabled"}.`,
        data: { channelId: channel.id, allowSelfApprove: channel.allowSelfApprove },
      });
    });
    return { ok: true, status: 200, body: { channel: publicChannel(channel) } };
  }

  /**
   * Import one verified, decrypted inbound message from the gateway (S3). This
   * is the exactly-once boundary: a duplicate providerMessageId is a no-op ACK,
   * a disabled/unknown channel refuses (auditable) but still ACKs — WeCom's
   * retry semantics must never observe an error it can amplify.
   *
   * Trusted in-process caller only (the gateway); there is no user actor here,
   * so lookup is by id, not team.
   */
  function importChannelEvent({
    channelId,
    providerMessageId,
    externalUserId,
    msgType = "text",
    content = "",
    providerCreateTime = null,
    agentId = null,
    attachmentAssets = [],
    mediaFailure = null,
    // Optional per-provider reply target (#1135): providers whose reply address
    // differs from the sender identity (Teams: {serviceUrl, conversationId})
    // pass this; it is stored on the conversation and used by delivery. Other
    // providers omit it and reply to the sender's externalUserId as before.
    replyContext = null,
  } = {}) {
    const channel = (state.channels ?? []).find((row) => row.id === String(channelId ?? ""));
    const messageId = String(providerMessageId ?? "").trim();
    const senderId = String(externalUserId ?? "").trim();
    if (!channel || channel.status !== "enabled" || !messageId || !senderId) {
      const reason = !channel ? "channel_not_found" : channel.status !== "enabled" ? "channel_not_enabled" : "invalid_event";
      // The veto is first-class (refusal model #758) — but the sender only ever
      // sees the ACK. Content is NOT recorded on a refused import: an
      // unregistered/disabled channel must not accumulate attacker text.
      refuse?.({
        subject: { kind: "channel_event", id: messageId || null },
        requester: { kind: "channel_identity", id: senderId || null },
        category: "state",
        code: "subject_not_actionable",
        decidedBy: { kind: "server", id: channel?.id ?? (String(channelId ?? "") || null) },
        summary: `Channel event refused at import: ${reason}.`,
        evidence: { channelId: channel?.id ?? String(channelId ?? ""), reason, msgType: String(msgType ?? "") },
        remedy: reason === "channel_not_enabled" ? "Enable the channel, then resend." : "",
        event: {
          invocationId: null,
          type: "channel_event_import_refused",
          level: "warn",
          message: `Channel event import refused (${reason}).`,
          data: { channelId: channel?.id ?? String(channelId ?? ""), reason },
        },
      });
      return { ok: false, refused: true, reason };
    }

    const duplicate = (state.channelEvents ?? []).find(
      (row) => row.channelId === channel.id && row.providerMessageId === messageId,
    );
    if (duplicate) {
      return { ok: true, duplicate: true, eventId: duplicate.id, conversationId: duplicate.conversationId };
    }
    let normalizedAttachments;
    try {
      normalizedAttachments = normalizeChannelAttachmentAssets(attachmentAssets, {
        terminalId: channel.taskTerminalId,
        projectId: channel.taskProjectId,
      });
    } catch (error) {
      return { ok: false, refused: true, reason: error?.code ?? "invalid_channel_attachment" };
    }

    // Preserved, not scrubbed (ADR 0011 rule 3): injection markers flag the
    // event for a human; the verbatim text stays data.
    const injection = detectPromptInjection(content);
    const result = runTx(() => {
      let conversation = (state.channelConversations ?? []).find(
        (row) => row.channelId === channel.id && row.externalUserId === senderId && row.status === "active",
      );
      if (!conversation) {
        conversation = {
          id: nextId(channelIdPrefixes.conversation),
          channelId: channel.id,
          externalUserId: senderId,
          ownerTeamId: channel.ownerTeamId ?? LOCAL_TEAM_ID,
          status: "active",
          invocationIds: [],
          replyContext: replyContext ?? null,
          createdAt: now(),
          updatedAt: now(),
          inboundSequence: 0,
          lastDispatchedSequence: 0,
        };
        state.channelConversations.push(conversation);
      } else if (replyContext) {
        // Refresh the reply target — Teams' serviceUrl can rotate between messages.
        conversation.replyContext = replyContext;
      }
      conversation.inboundSequence = Number(conversation.inboundSequence ?? 0) + 1;
      const event = {
        id: nextId(channelIdPrefixes.event),
        channelId: channel.id,
        conversationId: conversation.id,
        ownerTeamId: channel.ownerTeamId ?? LOCAL_TEAM_ID,
        providerMessageId: messageId,
        conversationSequence: conversation.inboundSequence,
        externalUserId: senderId,
        msgType: String(msgType ?? "text"),
        // Cap stored content: an inbound message is attacker-controlled; a signed
        // corp user could otherwise store unbounded text per event (heap + disk).
        content: String(content ?? "").slice(0, MAX_EVENT_CONTENT_CHARS),
        providerCreateTime: providerCreateTime ? String(providerCreateTime) : null,
        agentId: agentId ? String(agentId) : null,
        attachmentAssets: normalizedAttachments,
        mediaFailure: mediaFailure && typeof mediaFailure === "object"
          ? {
            total: Math.max(0, Math.min(20, Number(mediaFailure.total) || 0)),
            failed: Array.isArray(mediaFailure.failed)
              ? mediaFailure.failed.slice(0, 20).map((item) => ({
                kind: String(item?.kind ?? "file").slice(0, 40),
                filename: String(item?.filename ?? "attachment").slice(0, 160),
                code: String(item?.code ?? "media_import_failed").slice(0, 80),
              }))
              : [],
          }
          : null,
        status: "imported",
        // Marks events created by the durable inbound pipeline as eligible for
        // crash recovery. Keeping this explicit prevents a later upgrade from
        // replaying historical already-settled events on startup.
        replyRecoveryPending: true,
        replyDeliveryId: null,
        injectionSuspicious: injection.suspicious,
        receivedAt: now(),
      };
      state.channelEvents.push(event);
      // Bound the inbound event log (newest-keeps): these are historical records,
      // persisted, and were the one durable-core family with no cap — a flood of
      // distinct signed messages would otherwise grow heap + disk without limit.
      if (state.channelEvents.length > MAX_CHANNEL_EVENTS) {
        state.channelEvents = state.channelEvents.slice(-MAX_CHANNEL_EVENTS);
      }
      conversation.updatedAt = now();
      appendEvent({
        invocationId: null,
        type: "channel_event_imported",
        level: injection.suspicious ? "warn" : "info",
        message: `Channel ${channel.id}: event ${event.id} imported${injection.suspicious ? " (prompt injection flagged)" : ""}.`,
        data: {
          channelId: channel.id,
          eventId: event.id,
          conversationId: conversation.id,
          msgType: event.msgType,
          injectionMarkers: injection.markers,
        },
      });
      return { ok: true, eventId: event.id, conversationId: conversation.id, injectionSuspicious: injection.suspicious };
    });
    return result;
  }

  return {
    registerChannel,
    listChannels,
    listChannelInteractions,
    enableChannel,
    disableChannel,
    channelHealth,
    channelDiagnostics,
    mapChannelIdentity,
    removeChannelIdentity,
    listChannelIdentities,
    setChannelAllowlist,
    setChannelTaskProject,
    setChannelApprovalPolicy,
    importChannelEvent,
    findOwnChannel,
    readiness,
  };
}
