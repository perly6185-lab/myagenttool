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
  wecomReadinessScopes,
} from "@myagenttool/protocol/channel";
import { LOCAL_TEAM_ID } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

export const CHANNEL_ENABLE_ACTION = "channel.enable";
const MAX_NAME_LENGTH = 80;

/** Default readiness probe: configuration PRESENCE from the gateway env — never values. */
export function wecomEnvReadiness(env = process.env) {
  return {
    callback_token: Boolean(String(env.WECOM_CALLBACK_TOKEN ?? "").trim()),
    encoding_aes_key: Boolean(String(env.WECOM_ENCODING_AES_KEY ?? "").trim()),
    corp_secret: Boolean(String(env.WECOM_CORP_SECRET ?? "").trim()),
  };
}

export function createChannelService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon = () => {},
  store,
  validateApprovalToken,
  readinessProbe = wecomEnvReadiness,
}) {
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
    const probed = channel.provider === "wecom" ? readinessProbe() : {};
    const scopes = {};
    for (const scope of wecomReadinessScopes) scopes[scope] = Boolean(probed?.[scope]);
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

  return {
    registerChannel,
    listChannels,
    enableChannel,
    disableChannel,
    channelHealth,
    mapChannelIdentity,
    removeChannelIdentity,
    listChannelIdentities,
    findOwnChannel,
  };
}
