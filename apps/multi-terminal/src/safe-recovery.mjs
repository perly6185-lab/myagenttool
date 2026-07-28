const SAFE_ACTIONS = new Set(["retry"]);

export class SafeRecovery {
  constructor({ enabled = false, service, audit = async () => {} } = {}) {
    this.enabled = enabled;
    this.service = service;
    this.audit = audit;
  }
  async handle(alert) {
    if (!this.enabled || !SAFE_ACTIONS.has(alert.recommendedAction)) return { executed: false, reason: "not_allowlisted" };
    if (!alert.terminalId || !alert.resourceType || !alert.localResourceId) return { executed: false, reason: "missing_owner_reference" };
    const idempotencyKey = `auto-${alert.id ?? alert.code}-${alert.terminalId}-${alert.localResourceId}`.slice(0, 128);
    const result = await this.service.proxyAction({
      terminalId: alert.terminalId,
      resourceType: alert.resourceType,
      localResourceId: alert.localResourceId,
      action: "retry",
      body: alert.resourceType === "application-runs"
        ? { applicationId: alert.applicationId, routineId: alert.routineId, reason: "Allowlisted automatic owner-local retry." }
        : {},
      idempotencyKey,
    });
    await this.audit({ terminalId: alert.terminalId, localResourceId: alert.localResourceId, action: "retry", result: result.ok ? "completed" : "failed" });
    return { executed: true, migrated: false, result };
  }
}
