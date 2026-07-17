// Type surface for channel.mjs (the runtime lives in the .mjs twin, mirroring
// this package's issue-prompt.ts / issue-prompt.mjs split). Consumers import
// "@myagenttool/protocol/channel".
//
// Contracts for the Channel subsystem (ADR 0012, initiative #1090).

import type { IsoDateTime } from "./common.js";

/** Supported channel providers. WeCom (#1090), Feishu/Lark (#1110), DingTalk (#1119), Slack (#1128). */
export declare const channelProviders: readonly ["wecom", "feishu", "dingtalk", "slack", "teams"];
export type ChannelProvider = (typeof channelProviders)[number];

/** Channel lifecycle statuses. Registration is not enablement (ADR 0012). */
export declare const channelStatuses: readonly ["registered", "enabled", "disabled"];
export type ChannelStatus = (typeof channelStatuses)[number];

/** Inbound event statuses; `imported` is the exactly-once boundary. */
export declare const channelEventStatuses: readonly ["imported", "dispatched", "refused"];
export type ChannelEventStatus = (typeof channelEventStatuses)[number];

/** Conversation statuses. */
export declare const channelConversationStatuses: readonly ["active", "closed"];
export type ChannelConversationStatus = (typeof channelConversationStatuses)[number];

/** Outbound delivery statuses; `failed_terminal` pairs with an `undeliverable` refusal. */
export declare const channelDeliveryStatuses: readonly [
  "queued",
  "sending",
  "delivered",
  "retrying",
  "failed_terminal",
];
export type ChannelDeliveryStatus = (typeof channelDeliveryStatuses)[number];

/** The closed, deterministic command set (ADR 0012 rule 2). */
export declare const channelCommands: readonly [
  "/help",
  "/status",
  "/apps",
  "/run",
  "/result",
  "/approve",
  "/cancel",
];
export type ChannelCommand = (typeof channelCommands)[number];

/** WeCom readiness scopes, reported as booleans only (ADR 0012 rule 4). */
export declare const wecomReadinessScopes: readonly [
  "callback_token",
  "encoding_aes_key",
  "corp_secret",
];
export type WecomReadinessScope = (typeof wecomReadinessScopes)[number];

/** Feishu (Lark) readiness scopes, reported as booleans only (#1110). */
export declare const feishuReadinessScopes: readonly [
  "app_id",
  "app_secret",
  "verification_token",
  "encrypt_key",
];
export type FeishuReadinessScope = (typeof feishuReadinessScopes)[number];

/** DingTalk readiness scopes, reported as booleans only (#1119). */
export declare const dingtalkReadinessScopes: readonly ["app_key", "app_secret", "robot_code"];
export type DingtalkReadinessScope = (typeof dingtalkReadinessScopes)[number];

/** Slack readiness scopes, reported as booleans only (#1128). */
export declare const slackReadinessScopes: readonly ["signing_secret", "bot_token"];
export type SlackReadinessScope = (typeof slackReadinessScopes)[number];

/** Microsoft Teams readiness scopes, reported as booleans only (#1135). */
export declare const teamsReadinessScopes: readonly ["app_id", "app_password"];
export type TeamsReadinessScope = (typeof teamsReadinessScopes)[number];

/** Readiness scope names by provider. */
export declare const channelReadinessScopes: Record<ChannelProvider, readonly string[]>;

/** Id prefixes for channel collections. */
export declare const channelIdPrefixes: {
  readonly channel: "chn";
  readonly event: "chev";
  readonly conversation: "chcv";
  readonly delivery: "chdl";
  readonly identity: "chid";
};

export type ChannelId = `chn_${string}`;
export type ChannelEventId = `chev_${string}`;
export type ChannelConversationId = `chcv_${string}`;
export type ChannelDeliveryId = `chdl_${string}`;
export type ChannelIdentityId = `chid_${string}`;

/**
 * A registered channel: an owner-team-scoped control-plane record. Carries
 * readiness booleans, never provider secrets (ADR 0012 rule 4).
 */
export interface Channel {
  id: ChannelId;
  provider: ChannelProvider;
  name: string;
  status: ChannelStatus;
  ownerTeamId: string;
  /** Readiness by scope name — configuration presence, never values. */
  readiness: Partial<Record<WecomReadinessScope, boolean>>;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/**
 * An explicit provider-identity → myagenttool-user mapping. Absence of a
 * mapping fails closed (ADR 0012 rule 3).
 */
export interface ChannelIdentity {
  id: ChannelIdentityId;
  channelId: ChannelId;
  /** Provider-side sender id (WeCom UserID). */
  externalUserId: string;
  userId: string;
  ownerTeamId: string;
  createdAt: IsoDateTime;
}

/**
 * One verified, decrypted, normalized inbound message. `content` is untrusted
 * input preserved verbatim as data (ADR 0011/0012); `providerMessageId` is the
 * durable idempotency key.
 */
export interface ChannelEvent {
  id: ChannelEventId;
  channelId: ChannelId;
  conversationId: ChannelConversationId | null;
  /** Provider MsgId — the exactly-once import key. */
  providerMessageId: string;
  externalUserId: string;
  /** Verbatim message text; data, never instruction. */
  content: string;
  status: ChannelEventStatus;
  receivedAt: IsoDateTime;
}

/** Correlates a provider conversation with the invocations it created. */
export interface ChannelConversation {
  id: ChannelConversationId;
  channelId: ChannelId;
  externalUserId: string;
  status: ChannelConversationStatus;
  invocationIds: string[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** One outbound message with durable retry state and delivery evidence. */
export interface ChannelDelivery {
  id: ChannelDeliveryId;
  channelId: ChannelId;
  conversationId: ChannelConversationId;
  invocationId: string | null;
  status: ChannelDeliveryStatus;
  attempts: number;
  /** Provider receipt (WeCom msgid) when delivered. */
  providerReceiptId: string | null;
  /** Provider error code of the last failed attempt, if any. */
  lastErrorCode: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Deterministic command-parse result (never throws, never interprets text). */
export type ParsedChannelCommand =
  | { ok: true; command: ChannelCommand; args: string[] }
  | { ok: false; reason: "not_command" }
  | { ok: false; reason: "unknown_command"; attempted: string };

/** Parse one inbound message as a channel command. */
export declare function parseChannelCommand(text: string | null | undefined): ParsedChannelCommand;
