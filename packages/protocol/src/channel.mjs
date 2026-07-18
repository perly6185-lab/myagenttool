// Channel contracts (ADR 0012, initiative #1090): the shared vocabulary for
// the Channel subsystem — provider ids, record statuses, the closed command
// set, readiness scope names, id prefixes, and the deterministic command
// parser. Server, gateway, and console import these so the contract's name and
// the code's name cannot drift (the ADR 0011 rule, applied to channels).
//
// Kept out of index.mjs (like issue-prompt.mjs) so importing it never runs the
// protocol vocabulary self-check and browser bundles stay clean.

/** Supported channel providers. WeCom (#1090), Feishu/Lark (#1110), DingTalk (#1119), Slack (#1128). */
export const channelProviders = ["wecom", "feishu", "dingtalk", "slack", "teams"];

/** Channel lifecycle statuses. Registration is not enablement (ADR 0012). */
export const channelStatuses = ["registered", "enabled", "disabled"];

/**
 * Inbound event statuses. `imported` is the exactly-once boundary — a
 * duplicate MsgId or replayed nonce never creates a second imported event.
 */
export const channelEventStatuses = ["imported", "dispatched", "refused"];

/** Conversation statuses. */
export const channelConversationStatuses = ["active", "closed"];

/**
 * Outbound delivery statuses. `failed_terminal` is a first-class end state
 * (paired with an `undeliverable` refusal), never a silent drop.
 */
export const channelDeliveryStatuses = [
  "queued",
  "sending",
  "delivered",
  "retrying",
  "failed_terminal",
];

/**
 * The closed, deterministic command set (ADR 0012 rule 2). No LLM reads raw
 * channel text; anything outside this list is refused, not interpreted.
 */
export const channelCommands = [
  "/help",
  "/status",
  "/apps",
  "/run",
  // Record free-text work as a tracked task: files a GitHub issue in the
  // channel's bound project with the auto-trigger label, so the existing
  // single-dispatcher routes + starts a tracked auto-run (six-state board).
  "/task",
  "/result",
  "/approve",
  "/cancel",
];

/**
 * WeCom readiness scopes: the control plane reports these as booleans
 * (configured or not) and never the secret values (ADR 0012 rule 4 / ADR 0010).
 */
export const wecomReadinessScopes = [
  "callback_token",
  "encoding_aes_key",
  "corp_secret",
];

/**
 * Feishu (Lark) readiness scopes (#1110): app credentials + event-callback
 * verification/encryption keys. Booleans only, never the secret values.
 */
export const feishuReadinessScopes = [
  "app_id",
  "app_secret",
  "verification_token",
  "encrypt_key",
];

/**
 * DingTalk readiness scopes (#1119): the enterprise-internal-robot app key/
 * secret + robot code. Booleans only, never the secret values.
 */
export const dingtalkReadinessScopes = ["app_key", "app_secret", "robot_code"];

/**
 * Slack readiness scopes (#1128): the Events API signing secret + the bot token.
 * Booleans only, never the secret values.
 */
export const slackReadinessScopes = ["signing_secret", "bot_token"];

/**
 * Microsoft Teams readiness scopes (#1135): the bot app id + password. Booleans
 * only, never the secret values.
 */
export const teamsReadinessScopes = ["app_id", "app_password"];

/** Readiness scope names by provider — the single source of truth for the console. */
export const channelReadinessScopes = {
  wecom: wecomReadinessScopes,
  feishu: feishuReadinessScopes,
  dingtalk: dingtalkReadinessScopes,
  slack: slackReadinessScopes,
  teams: teamsReadinessScopes,
};

/** Id prefixes for channel collections (see nextId in the server composer). */
export const channelIdPrefixes = {
  channel: "chn",
  event: "chev",
  conversation: "chcv",
  delivery: "chdl",
  identity: "chid",
};

/**
 * Parse one inbound message as a channel command. Mechanical and total: never
 * throws, never interprets free text.
 *
 * Returns:
 * - `{ ok: true, command, args }` — a known command; `args` are the
 *   whitespace-split tokens after it.
 * - `{ ok: false, reason: "not_command" }` — text that does not start with `/`
 *   (plain chat; the caller replies with usage help, it is never executed).
 * - `{ ok: false, reason: "unknown_command", attempted }` — starts with `/`
 *   but is not in the closed set; `attempted` is the first token only (bounded,
 *   safe to echo in an in-channel reply).
 */
export function parseChannelCommand(text) {
  const raw = String(text ?? "").trim();
  if (!raw.startsWith("/")) {
    return { ok: false, reason: "not_command" };
  }
  const tokens = raw.split(/\s+/);
  const head = tokens[0].toLowerCase();
  if (!channelCommands.includes(head)) {
    return { ok: false, reason: "unknown_command", attempted: head.slice(0, 32) };
  }
  return { ok: true, command: head, args: tokens.slice(1) };
}
