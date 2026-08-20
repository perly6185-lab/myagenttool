import { createHash } from "node:crypto";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

export const ARTICLE_EXTRACTOR_PLUGIN_ACTIONS = Object.freeze({
  install: "article_extractor_plugin.install",
  disable: "article_extractor_plugin.disable",
  activate: "article_extractor_plugin.activate",
});

const PLUGIN_ID = /^[a-z0-9](?:[a-z0-9._-]{1,62}[a-z0-9])?$/;
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const SIMPLE_SELECTOR = /^(?:[a-z][a-z0-9-]*)?(?:#[A-Za-z_][\w-]*)?(?:\.[A-Za-z_][\w-]*)?$/;
const SELECTOR_FIELDS = ["content", "title", "author", "publishedAt"];
const MAX_PLUGINS = 100;
const MAX_VERSIONS = 10;

export function normalizeArticleExtractorManifest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw pluginError("invalid_article_extractor_manifest");
  const schemaVersion = Number(input.schemaVersion);
  const id = String(input.id ?? "").trim().toLowerCase();
  const name = boundedText(input.name, 80);
  const version = String(input.version ?? "").trim();
  if (schemaVersion !== 1 || input.kind !== "article_extractor" || !PLUGIN_ID.test(id) || !name || !VERSION.test(version)) {
    throw pluginError("invalid_article_extractor_manifest");
  }
  const hosts = [...new Set((Array.isArray(input.hosts) ? input.hosts : [])
    .map((host) => String(host).trim().toLowerCase()))];
  if (!hosts.length || hosts.length > 10 || hosts.some((host) => !HOST.test(host) || host === "localhost")) {
    throw pluginError("invalid_article_extractor_hosts");
  }
  const extraction = {};
  for (const field of SELECTOR_FIELDS) {
    const selectors = [...new Set((Array.isArray(input.extraction?.[field]) ? input.extraction[field] : [])
      .map((selector) => String(selector).trim()))];
    if (selectors.length > 8 || selectors.some((selector) => !selector || selector.length > 80 || !SIMPLE_SELECTOR.test(selector))) {
      throw pluginError("invalid_article_extractor_selectors");
    }
    extraction[field] = selectors;
  }
  if (!extraction.content.length) throw pluginError("article_extractor_content_selector_required");
  const minimumTextLength = input.minimumTextLength === undefined
    ? 120
    : boundedInteger(input.minimumTextLength, null, 1, 100_000);
  if (minimumTextLength === null) throw pluginError("invalid_article_extractor_minimum_text_length");
  return Object.freeze({
    schemaVersion: 1,
    id,
    name,
    version,
    kind: "article_extractor",
    hosts: Object.freeze(hosts),
    extraction: Object.freeze(Object.fromEntries(SELECTOR_FIELDS.map((field) => [field, Object.freeze(extraction[field])]))),
    minimumTextLength,
  });
}

export function articleExtractorManifestChecksum(manifest) {
  return createHash("sha256").update(JSON.stringify(normalizeArticleExtractorManifest(manifest))).digest("hex");
}

export function createArticleExtractorPluginService({
  state,
  now = () => new Date().toISOString(),
  nextId = (prefix) => `${prefix}_${Date.now().toString(36)}`,
  appendEvent = () => {},
  persistStateSoon = () => {},
  validateApprovalToken = null,
  store,
} = {}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  state.articleExtractorPlugins ??= [];

  function list(_input = {}, actor = null) {
    return {
      ok: true,
      status: 200,
      body: { plugins: state.articleExtractorPlugins.filter((row) => visible(row, actor)).map(pluginView) },
    };
  }

  function planInstall({ manifest: input } = {}, actor = null) {
    try {
      const manifest = normalizeArticleExtractorManifest(input);
      const ownerTeamId = actor?.teamId ?? "team_local";
      return {
        ok: true,
        status: 200,
        body: {
          manifest,
          checksum: articleExtractorManifestChecksum(manifest),
          approval: {
            action: ARTICLE_EXTRACTOR_PLUGIN_ACTIONS.install,
            targetId: approvalTarget(ownerTeamId, manifest.id, manifest.version),
          },
        },
      };
    } catch (error) {
      return failure(error.code, 400);
    }
  }

  function install({ manifest: input, approvalToken } = {}, actor = null) {
    let manifest;
    try {
      manifest = normalizeArticleExtractorManifest(input);
    } catch (error) {
      return failure(error.code, 400);
    }
    const ownerTeamId = actor?.teamId ?? "team_local";
    const targetId = approvalTarget(ownerTeamId, manifest.id, manifest.version);
    const checksum = articleExtractorManifestChecksum(manifest);
    const existing = state.articleExtractorPlugins.find((row) => row.ownerTeamId === ownerTeamId && row.pluginId === manifest.id);
    const sameVersion = existing?.versions?.find((entry) => entry.version === manifest.version);
    if (sameVersion && sameVersion.checksum !== checksum) return failure("article_extractor_version_conflict", 409);
    if (!existing && state.articleExtractorPlugins.filter((candidate) => candidate.ownerTeamId === ownerTeamId).length >= MAX_PLUGINS) {
      return failure("article_extractor_plugin_capacity_reached", 409);
    }
    if (hostConflict(state.articleExtractorPlugins, manifest, ownerTeamId, existing?.id)) {
      return failure("article_extractor_host_conflict", 409);
    }
    const approval = validate(approvalToken, ARTICLE_EXTRACTOR_PLUGIN_ACTIONS.install, targetId, actor);
    if (!approval.approved) return failure("article_extractor_plugin_approval_required", 403, approval.reason);
    const at = now();
    const record = runTx(() => {
      const row = existing ?? {
        id: nextId("article_extractor_plugin"),
        pluginId: manifest.id,
        ownerTeamId,
        name: manifest.name,
        enabled: true,
        activeVersion: manifest.version,
        versions: [],
        createdAt: at,
        updatedAt: at,
      };
      if (!existing) {
        state.articleExtractorPlugins.push(row);
      }
      if (!sameVersion) {
        row.versions.unshift({
          version: manifest.version,
          checksum,
          manifest,
          installedAt: at,
          installedBy: actor?.userId ?? "usr_local",
          approvalGrantId: approval.grantId ?? null,
        });
        row.versions = row.versions.slice(0, MAX_VERSIONS);
      }
      row.name = manifest.name;
      row.enabled = true;
      row.activeVersion = manifest.version;
      row.updatedAt = at;
      return row;
    });
    appendEvent({
      invocationId: null,
      type: "article_extractor_plugin_installed",
      level: "info",
      message: `Article extractor ${manifest.id}@${manifest.version} installed and activated.`,
      data: { pluginId: manifest.id, version: manifest.version, checksum, ownerTeamId, approvalGrantId: approval.grantId ?? null },
    });
    return { ok: true, status: existing ? 200 : 201, body: { plugin: pluginView(record) } };
  }

  function disable({ pluginId, approvalToken } = {}, actor = null) {
    const row = findVisible(pluginId, actor);
    if (!row) return failure("article_extractor_plugin_not_found", 404);
    const approval = validate(approvalToken, ARTICLE_EXTRACTOR_PLUGIN_ACTIONS.disable, row.id, actor);
    if (!approval.approved) return failure("article_extractor_plugin_approval_required", 403, approval.reason);
    runTx(() => {
      row.enabled = false;
      row.updatedAt = now();
    });
    appendEvent({ invocationId: null, type: "article_extractor_plugin_disabled", level: "warn", message: `Article extractor ${row.pluginId} disabled.`, data: { pluginId: row.pluginId, ownerTeamId: row.ownerTeamId } });
    return { ok: true, status: 200, body: { plugin: pluginView(row) } };
  }

  function activate({ pluginId, version, approvalToken } = {}, actor = null) {
    const row = findVisible(pluginId, actor);
    if (!row) return failure("article_extractor_plugin_not_found", 404);
    const selected = row.versions.find((entry) => entry.version === String(version ?? ""));
    if (!selected) return failure("article_extractor_plugin_version_not_found", 404);
    if (hostConflict(state.articleExtractorPlugins, selected.manifest, row.ownerTeamId, row.id)) {
      return failure("article_extractor_host_conflict", 409);
    }
    const targetId = `${row.id}:${selected.version}`;
    const approval = validate(approvalToken, ARTICLE_EXTRACTOR_PLUGIN_ACTIONS.activate, targetId, actor);
    if (!approval.approved) return failure("article_extractor_plugin_approval_required", 403, approval.reason);
    runTx(() => {
      row.activeVersion = selected.version;
      row.enabled = true;
      row.updatedAt = now();
    });
    appendEvent({ invocationId: null, type: "article_extractor_plugin_activated", level: "info", message: `Article extractor ${row.pluginId}@${selected.version} activated.`, data: { pluginId: row.pluginId, version: selected.version, ownerTeamId: row.ownerTeamId } });
    return { ok: true, status: 200, body: { plugin: pluginView(row) } };
  }

  function resolveForUrl(value, ownerTeamId = "team_local") {
    let hostname;
    try {
      const url = new URL(String(value));
      if (url.protocol !== "https:" || url.username || url.password) return null;
      hostname = url.hostname.toLowerCase();
    } catch {
      return null;
    }
    const row = state.articleExtractorPlugins.find((candidate) => candidate.ownerTeamId === ownerTeamId
      && candidate.enabled
      && safeActiveVersion(candidate)?.manifest.hosts.includes(hostname));
    if (!row) return null;
    const version = safeActiveVersion(row);
    return version ? { pluginId: row.pluginId, checksum: version.checksum, manifest: version.manifest } : null;
  }

  function findVisible(pluginId, actor) {
    return state.articleExtractorPlugins.find((row) => row.pluginId === String(pluginId ?? "") && visible(row, actor)) ?? null;
  }

  function validate(token, action, targetId, actor) {
    if (typeof validateApprovalToken !== "function") return { approved: false, reason: "approval_validator_unavailable" };
    return validateApprovalToken(token, { action, targetId, actor, allowLegacy: false });
  }

  return { activate, disable, install, list, planInstall, resolveForUrl };
}

export function articleExtractorInstallApprovalTarget(ownerTeamId, pluginId, version) {
  return approvalTarget(ownerTeamId, String(pluginId).toLowerCase(), String(version));
}

function activeManifest(row) {
  return row.versions?.find((entry) => entry.version === row.activeVersion)?.manifest ?? null;
}

function safeActiveVersion(row) {
  const entry = row.versions?.find((candidate) => candidate.version === row.activeVersion);
  if (!entry) return null;
  try {
    const manifest = normalizeArticleExtractorManifest(entry.manifest);
    if (articleExtractorManifestChecksum(manifest) !== entry.checksum) return null;
    return { ...entry, manifest };
  } catch {
    return null;
  }
}

function hostConflict(rows, manifest, ownerTeamId, ignoredId = null) {
  const hosts = new Set(manifest.hosts);
  return rows.some((row) => row.id !== ignoredId
    && row.ownerTeamId === ownerTeamId
    && row.enabled
    && safeActiveVersion(row)?.manifest.hosts.some((host) => hosts.has(host)));
}

function visible(row, actor) {
  return !actor || row.ownerTeamId === actor.teamId;
}

function pluginView(row) {
  return {
    id: row.id,
    pluginId: row.pluginId,
    name: row.name,
    enabled: row.enabled,
    activeVersion: row.activeVersion,
    hosts: activeManifest(row)?.hosts ?? [],
    versions: (row.versions ?? []).map(({ version, checksum, installedAt, installedBy }) => ({ version, checksum, installedAt, installedBy })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function approvalTarget(ownerTeamId, pluginId, version) {
  return `${ownerTeamId}:${pluginId}:${version}`;
}

function boundedText(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : "";
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function failure(error, status, reason = null) {
  return { ok: false, status, body: { error, ...(reason ? { reason } : {}) } };
}

function pluginError(code) {
  return Object.assign(new Error(code), { code });
}
