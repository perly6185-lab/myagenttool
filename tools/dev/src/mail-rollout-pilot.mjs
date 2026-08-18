export const MAIL_PILOT_SCHEMA_VERSION = 1;
export const MAIL_PILOT_PHASES = Object.freeze(["readonly", "manual", "automatic"]);
export const MAIL_PILOT_REQUIRED_SCENARIOS = Object.freeze(["offline", "credential_expired", "restart", "conflict"]);

function dateKey(value, timeZone) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("invalid pilot timestamp");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(parsed);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dayNumber(day) {
  const parsed = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) throw new Error("invalid pilot day");
  return Math.floor(parsed / 86_400_000);
}

function boundedText(value, max = 80) {
  return String(value ?? "").trim().slice(0, max);
}

function nonnegativeInteger(value, name) {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

export function createMailPilot({ accountAlias, startedAt = new Date().toISOString(), timeZone = "Asia/Shanghai" } = {}) {
  const alias = boundedText(accountAlias);
  if (!alias) throw new Error("accountAlias is required; use a non-sensitive test-account alias");
  new Intl.DateTimeFormat("en", { timeZone }).format(new Date(startedAt));
  return {
    schemaVersion: MAIL_PILOT_SCHEMA_VERSION,
    accountAlias: alias,
    timeZone,
    startedAt: new Date(startedAt).toISOString(),
    records: [],
  };
}

export function recordMailPilotDay(pilot, {
  at = new Date().toISOString(), phase, scenarios = [],
  syncRuns = 0, moveBatches = 0, duplicateMoves = 0,
  crossTenantWrites = 0, unreconciledJobs = 0, recoveryFailures = 0,
} = {}, { now = new Date().toISOString() } = {}) {
  if (!pilot || pilot.schemaVersion !== MAIL_PILOT_SCHEMA_VERSION || !Array.isArray(pilot.records)) throw new Error("invalid pilot file");
  if (!MAIL_PILOT_PHASES.includes(phase)) throw new Error(`phase must be one of: ${MAIL_PILOT_PHASES.join(", ")}`);
  const unknownScenarios = scenarios.filter((item) => !MAIL_PILOT_REQUIRED_SCENARIOS.includes(item));
  if (unknownScenarios.length) throw new Error(`unknown scenarios: ${unknownScenarios.join(", ")}`);
  const day = dateKey(at, pilot.timeZone ?? "UTC");
  const currentDay = dateKey(now, pilot.timeZone ?? "UTC");
  const startedDay = dateKey(pilot.startedAt, pilot.timeZone ?? "UTC");
  if (dayNumber(day) < dayNumber(startedDay)) throw new Error("pilot records cannot predate the pilot start");
  if (dayNumber(day) >= dayNumber(currentDay)) throw new Error("pilot records require a completed natural day and cannot be prefilled");
  if (pilot.records.some((record) => record.day === day)) throw new Error(`pilot day ${day} is already recorded`);
  const previous = pilot.records.at(-1);
  if (previous && MAIL_PILOT_PHASES.indexOf(phase) < MAIL_PILOT_PHASES.indexOf(previous.phase)) throw new Error("pilot phases cannot move backward");
  const next = structuredClone(pilot);
  next.records.push({
    day,
    observedAt: new Date(at).toISOString(),
    recordedAt: new Date(now).toISOString(),
    phase,
    scenarios: [...new Set(scenarios)].sort(),
    metrics: {
      syncRuns: nonnegativeInteger(syncRuns, "syncRuns"),
      moveBatches: nonnegativeInteger(moveBatches, "moveBatches"),
      duplicateMoves: nonnegativeInteger(duplicateMoves, "duplicateMoves"),
      crossTenantWrites: nonnegativeInteger(crossTenantWrites, "crossTenantWrites"),
      unreconciledJobs: nonnegativeInteger(unreconciledJobs, "unreconciledJobs"),
      recoveryFailures: nonnegativeInteger(recoveryFailures, "recoveryFailures"),
    },
  });
  next.records.sort((a, b) => a.day.localeCompare(b.day));
  return next;
}

export function summarizeMailPilot(pilot, { now = new Date().toISOString() } = {}) {
  if (!pilot || pilot.schemaVersion !== MAIL_PILOT_SCHEMA_VERSION || !Array.isArray(pilot.records)) throw new Error("invalid pilot file");
  const records = [...pilot.records].sort((a, b) => a.day.localeCompare(b.day));
  const uniqueDays = new Set(records.map((record) => record.day));
  const currentDay = dateKey(now, pilot.timeZone ?? "UTC");
  const startedDay = dateKey(pilot.startedAt, pilot.timeZone ?? "UTC");
  let consecutive = records.length > 0;
  for (let index = 1; index < records.length; index += 1) {
    const previous = new Date(`${records[index - 1].day}T00:00:00.000Z`);
    const current = new Date(`${records[index].day}T00:00:00.000Z`);
    if (current.getTime() - previous.getTime() !== 86_400_000) consecutive = false;
  }
  const coveredScenarios = [...new Set(records.flatMap((record) => record.scenarios))].sort();
  const coveredPhases = [...new Set(records.map((record) => record.phase))];
  const totals = records.reduce((sum, record) => {
    for (const [key, value] of Object.entries(record.metrics)) sum[key] = (sum[key] ?? 0) + value;
    return sum;
  }, {});
  const gates = {
    sevenConsecutiveDays: uniqueDays.size >= 7
      && consecutive
      && records.every((record) => dayNumber(record.day) >= dayNumber(startedDay) && dayNumber(record.day) < dayNumber(currentDay))
      && dayNumber(records.at(-1)?.day) - dayNumber(records[0]?.day) >= 6,
    phasedRollout: MAIL_PILOT_PHASES.every((phase) => coveredPhases.includes(phase)),
    faultCoverage: MAIL_PILOT_REQUIRED_SCENARIOS.every((scenario) => coveredScenarios.includes(scenario)),
    noDuplicateMoves: (totals.duplicateMoves ?? 0) === 0,
    tenantIsolation: (totals.crossTenantWrites ?? 0) === 0,
    recoveryComplete: (totals.unreconciledJobs ?? 0) === 0 && (totals.recoveryFailures ?? 0) === 0,
  };
  return {
    schemaVersion: MAIL_PILOT_SCHEMA_VERSION,
    accountAlias: pilot.accountAlias,
    timeZone: pilot.timeZone ?? "UTC",
    startedAt: pilot.startedAt,
    daysRecorded: uniqueDays.size,
    coveredPhases,
    coveredScenarios,
    totals,
    gates,
    passed: Object.values(gates).every(Boolean),
    remainingDays: Math.max(0, 7 - uniqueDays.size),
  };
}
