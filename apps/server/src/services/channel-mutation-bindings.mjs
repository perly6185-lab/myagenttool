import { basename, extname } from "node:path";

import { LOCAL_TEAM_ID } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

const STATUSES = new Set(["active", "disabled"]);
const FORMATS = new Set(["csv", "xlsx"]);

function teamOf(actor) { return actor?.teamId ?? LOCAL_TEAM_ID; }

function text(value, max = 300) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, max) : null;
}

function publicBinding(binding) {
  return {
    id: binding.id,
    projectId: binding.projectId,
    ownerTeamId: binding.ownerTeamId,
    fileSourceId: binding.fileSourceId,
    ledgerDefinitionId: binding.ledgerDefinitionId,
    status: binding.status,
    fileName: binding.fileName,
    format: binding.format,
    fileSourceRevision: binding.fileSourceRevision,
    ledgerDefinitionRevision: binding.ledgerDefinitionRevision,
    stale: binding.stale === true,
    revision: binding.revision,
    createdAt: binding.createdAt,
    updatedAt: binding.updatedAt,
  };
}

export function createChannelMutationBindingService({
  state, now, nextId, appendEvent, persistStateSoon, store,
} = {}) {
  state.channelMutationBindings ??= [];
  const runTx = makeRunTx({ store, persistStateSoon });

  function fileSourceFor(id, actor) {
    return (state.channelObjectFileSources ?? []).find((source) =>
      source.id === id && source.ownerTeamId === teamOf(actor) && source.status !== "disabled") ?? null;
  }

  function definitionFor(id, actor) {
    return (state.ledgerDefinitions ?? []).find((definition) =>
      definition.id === id
      && definition.ownerTeamId === teamOf(actor)
      && definition.state === "active") ?? null;
  }

  function workflowSourceFor(definition, actor) {
    return (state.workflowSources ?? []).find((source) =>
      source.id === definition?.sourceId
      && source.ownerTeamId === teamOf(actor)
      && source.projectId === definition?.projectId
      && source.state === "active") ?? null;
  }

  function compatible(fileSource, definition) {
    const fileName = text(fileSource?.fileName, 300);
    const relativePath = text(definition?.relativePath, 500);
    if (!fileName || !relativePath) return false;
    const format = extname(fileName).slice(1).toLowerCase();
    return FORMATS.has(format)
      && format === String(definition.format ?? "").toLowerCase()
      && basename(relativePath).toLowerCase() === basename(fileName).toLowerCase();
  }

  function currentState(binding, actor) {
    const source = fileSourceFor(binding.fileSourceId, actor);
    const definition = definitionFor(binding.ledgerDefinitionId, actor);
    const workflowSource = workflowSourceFor(definition, actor);
    const stale = !source || !definition || !workflowSource
      || source.projectId !== binding.projectId
      || definition.projectId !== binding.projectId
      || !compatible(source, definition)
      || source.revision !== binding.fileSourceRevision
      || definition.revision !== binding.ledgerDefinitionRevision;
    return { source, definition, stale };
  }

  function listBindings({ projectId = null, fileSourceId = null } = {}, actor = null) {
    const rows = state.channelMutationBindings
      .filter((binding) => binding.ownerTeamId === teamOf(actor))
      .filter((binding) => !projectId || binding.projectId === projectId)
      .filter((binding) => !fileSourceId || binding.fileSourceId === fileSourceId)
      .map((binding) => {
        const current = currentState(binding, actor);
        binding.stale = current.stale;
        return publicBinding(binding);
      });
    return { status: 200, body: { bindings: rows, count: rows.length } };
  }

  function upsertBinding(input = {}, actor = null) {
    const projectId = text(input.projectId, 200);
    const fileSourceId = text(input.fileSourceId, 200);
    const ledgerDefinitionId = text(input.ledgerDefinitionId, 200);
    const source = fileSourceFor(fileSourceId, actor);
    const definition = definitionFor(ledgerDefinitionId, actor);
    const workflowSource = workflowSourceFor(definition, actor);
    if (!projectId || !source || !definition
      || !workflowSource
      || source.projectId !== projectId
      || definition.projectId !== projectId
      || !compatible(source, definition)) {
      return { status: 409, body: { error: "channel_mutation_binding_incompatible" } };
    }
    const ownerTeamId = teamOf(actor);
    const existing = input.id
      ? state.channelMutationBindings.find((binding) => binding.id === input.id && binding.ownerTeamId === ownerTeamId)
      : state.channelMutationBindings.find((binding) => binding.ownerTeamId === ownerTeamId
        && binding.projectId === projectId && binding.fileSourceId === fileSourceId);
    const timestamp = now();
    if (existing) {
      if (input.expectedRevision != null && Number(input.expectedRevision) !== existing.revision) {
        return { status: 409, body: { error: "channel_mutation_binding_revision_conflict", currentRevision: existing.revision } };
      }
      runTx(() => {
        Object.assign(existing, {
          ledgerDefinitionId,
          fileName: source.fileName,
          format: definition.format,
          fileSourceRevision: source.revision,
          ledgerDefinitionRevision: definition.revision,
          status: "active",
          stale: false,
          revision: existing.revision + 1,
          updatedAt: timestamp,
          updatedBy: actor?.userId ?? null,
        });
        appendEvent?.({
          invocationId: null,
          type: "channel_mutation_binding_updated",
          level: "info",
          message: "Channel mutation binding updated.",
          data: { bindingId: existing.id, projectId, fileSourceId, ledgerDefinitionId },
        });
      });
      return { status: 200, body: { binding: publicBinding(existing), updated: true } };
    }
    const binding = {
      id: text(input.id, 200) ?? nextId("cmb"),
      schemaVersion: 1,
      ownerTeamId,
      projectId,
      fileSourceId,
      ledgerDefinitionId,
      fileName: source.fileName,
      format: definition.format,
      fileSourceRevision: source.revision,
      ledgerDefinitionRevision: definition.revision,
      status: "active",
      stale: false,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actor?.userId ?? null,
      updatedBy: actor?.userId ?? null,
    };
    if (state.channelMutationBindings.some((candidate) => candidate.id === binding.id)) {
      return { status: 409, body: { error: "channel_mutation_binding_id_conflict" } };
    }
    runTx(() => {
      state.channelMutationBindings.push(binding);
      appendEvent?.({
        invocationId: null,
        type: "channel_mutation_binding_created",
        level: "info",
        message: "Channel mutation binding created.",
        data: { bindingId: binding.id, projectId, fileSourceId, ledgerDefinitionId },
      });
    });
    return { status: 201, body: { binding: publicBinding(binding), created: true } };
  }

  function setBindingStatus(id, input = {}, actor = null) {
    const binding = state.channelMutationBindings.find((candidate) =>
      candidate.id === id && candidate.ownerTeamId === teamOf(actor));
    if (!binding) return { status: 404, body: { error: "channel_mutation_binding_not_found" } };
    if (!STATUSES.has(input.status) || Number(input.expectedRevision) !== binding.revision) {
      return { status: 409, body: { error: "channel_mutation_binding_revision_conflict", currentRevision: binding.revision } };
    }
    runTx(() => {
      binding.status = input.status;
      binding.revision += 1;
      binding.updatedAt = now();
      binding.updatedBy = actor?.userId ?? null;
    });
    return { status: 200, body: { binding: publicBinding(binding) } };
  }

  // A Ledger write performed through Channel is an approved internal change,
  // so the imported local-file snapshot must move forward with the target.
  // External edits do not pass through here and still fail the strict
  // content-identity check on the next preview.
  function refreshSourceIdentity({ fileSourceId, contentHash, rowCount = null } = {}, actor = null) {
    const source = fileSourceFor(fileSourceId, actor);
    const normalizedHash = text(contentHash, 200);
    if (!source || !normalizedHash) {
      return { ok: false, reason: "channel_mutation_source_not_found" };
    }
    const normalizedRowCount = Number.isInteger(Number(rowCount)) ? Number(rowCount) : null;
    const changed = source.contentHash !== normalizedHash
      || (normalizedRowCount != null && source.rowCount !== normalizedRowCount);
    const bindings = state.channelMutationBindings.filter((candidate) =>
      candidate.fileSourceId === source.id && candidate.ownerTeamId === teamOf(actor));
    const bindingsNeedRefresh = bindings.some((binding) =>
      binding.fileSourceRevision !== source.revision || binding.stale === true);
    if (changed || bindingsNeedRefresh) {
      const timestamp = now();
      runTx(() => {
        source.contentHash = normalizedHash;
        if (normalizedRowCount != null) source.rowCount = normalizedRowCount;
        if (changed) source.revision = Number(source.revision) + 1;
        source.updatedAt = timestamp;
        for (const binding of bindings) {
          binding.fileSourceRevision = source.revision;
          binding.stale = false;
          binding.revision += 1;
          binding.updatedAt = timestamp;
          binding.updatedBy = actor?.userId ?? null;
        }
      });
    }
    return {
      ok: true,
      changed,
      source: { id: source.id, revision: source.revision, contentHash: source.contentHash },
    };
  }

  function resolveBinding({ projectId, fileSourceId } = {}, actor = null) {
    const binding = state.channelMutationBindings.find((candidate) =>
      candidate.ownerTeamId === teamOf(actor)
      && candidate.projectId === projectId
      && candidate.fileSourceId === fileSourceId
      && candidate.status === "active") ?? null;
    if (!binding) return { ok: false, reason: "channel_mutation_binding_missing" };
    const current = currentState(binding, actor);
    binding.stale = current.stale;
    if (current.stale) return { ok: false, reason: "channel_mutation_binding_stale", binding: publicBinding(binding) };
    return { ok: true, binding: publicBinding(binding), source: current.source, definition: current.definition };
  }

  return { listBindings, upsertBinding, setBindingStatus, refreshSourceIdentity, resolveBinding };
}
