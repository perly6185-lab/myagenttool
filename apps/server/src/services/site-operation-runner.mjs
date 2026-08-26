import { createSiteOperationContract, nextSiteOperationAction, normalizeSiteOperationResult } from "./site-operation-contract.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

/**
 * Runs trusted, local site executors with a per-account lock and durable-ish
 * receipts supplied by the caller's state. A confirmed or unknown write is
 * replayed from its receipt; it is never dispatched a second time implicitly.
 */
export function createSiteOperationRunner({ manifests = [], executors = new Map(), state, now = () => new Date().toISOString(), persistStateSoon = () => {}, store } = {}) {
  if (!state) throw new Error("site_operation_state_required");
  const runTx = makeRunTx({ store, persistStateSoon });
  if (!state.siteOperationReceipts) runTx(() => { state.siteOperationReceipts = []; });
  const byId = new Map(manifests.map((manifest) => [manifest.id, manifest]));
  const locks = new Map();

  async function run(input = {}) {
    const manifest = byId.get(String(input.pluginId ?? ""));
    if (!manifest) throw runnerError("site_capability_not_found");
    const contract = createSiteOperationContract({ ...input, manifest });
    const existing = state.siteOperationReceipts.find((receipt) => receipt.contractFingerprint === contract.fingerprint) ?? null;
    if (existing && ["succeeded", "unconfirmed"].includes(existing.result.status)) {
      return { replayed: true, contract, result: existing.result, next: nextSiteOperationAction(existing.result) };
    }
    const executor = executors.get(contract.executorId);
    if (typeof executor !== "function") throw runnerError("site_executor_unavailable");
    const lockKey = `${contract.pluginId}:${contract.accountId}:${contract.terminalId}`;
    return withLock(lockKey, async () => {
      const raced = state.siteOperationReceipts.find((receipt) => receipt.contractFingerprint === contract.fingerprint) ?? null;
      if (raced && ["succeeded", "unconfirmed"].includes(raced.result.status)) {
        return { replayed: true, contract, result: raced.result, next: nextSiteOperationAction(raced.result) };
      }
      let raw;
      try {
        raw = await executor(contract);
      } catch (error) {
        raw = {
          status: "failed",
          sideEffectState: error?.sideEffectState ?? "not_started",
          errorCode: error?.code ?? "site_executor_failed",
          summary: error?.message ?? String(error),
          retryable: error?.retryable === true,
        };
      }
      const result = normalizeSiteOperationResult({ contract, result: raw });
      const at = now();
      const row = raced ?? {
        id: `site_receipt_${contract.fingerprint.slice(-24)}`,
        contractFingerprint: contract.fingerprint,
        pluginId: contract.pluginId,
        operationId: contract.operationId,
        taskId: contract.taskId,
        ownerTeamId: contract.ownerTeamId,
        accountId: contract.accountId,
        terminalId: contract.terminalId,
        createdAt: at,
      };
      runTx(() => {
        row.result = result;
        row.updatedAt = at;
        if (!raced) {
          state.siteOperationReceipts.push(row);
          if (state.siteOperationReceipts.length > 1_000) {
            state.siteOperationReceipts.splice(0, state.siteOperationReceipts.length - 1_000);
          }
        }
      });
      return { replayed: false, contract, result, next: nextSiteOperationAction(result) };
    });
  }

  function withLock(key, fn) {
    const previous = locks.get(key) ?? Promise.resolve();
    const current = previous.then(fn, fn);
    locks.set(key, current.then(() => undefined, () => undefined));
    return current;
  }

  return { run };
}

function runnerError(code) {
  return Object.assign(new Error(code), { code });
}
