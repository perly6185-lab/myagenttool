/*
 * Device registry primitives.
 *
 * The control plane began with exactly one machine: `state.device`, a singleton
 * object, read from ~110 sites across the routes and services. Managing a fleet
 * needs a *set* of devices, but rewriting every one of those reads at once would
 * be a large, untestable change.
 *
 * So the authoritative store becomes `state.devices` (an array), and
 * `state.device` survives as a live alias for the primary device (see
 * `defineDeviceAlias`). Every existing singleton read keeps working unchanged;
 * the collection is what new code addresses.
 *
 * The alias is a migration seam, not the routing model. Anything that answers
 * "which machine is this?" must resolve the device from the authenticated bridge
 * credential (`deviceForToken`) rather than reaching for the primary — the
 * credential is what actually identifies the caller. Ownership gates that
 * compare against the primary alias are comparing a device to itself, which is
 * how they stayed vacuously true while only one device existed.
 *
 * This module is a leaf: it imports nothing from `../services`, so `state-factory`
 * (which the services import from) can depend on it without a cycle.
 *
 * The seam's size is frozen by `test/device-seam.test.mjs`: new `state.device`
 * reads fail that ratchet, so new code lands on the sanctioned accessors below
 * (`listDevices` / `findDevice`) or on `deviceForToken` for "which machine is
 * this?". The count only ever ratchets down. See ADR 0020 and
 * `docs/ARCHITECTURE_OVERVIEW.md` §1.
 */

/** The seeded local device. Kept stable so existing state snapshots restore. */
export const DEFAULT_DEVICE_ID = "dev_local_001";

/**
 * The fleet. A state built by `createServerState` always has `devices`; a state
 * hand-built as `{ device: {...} }` — the unit-test and smoke fixtures do this,
 * and so did every caller before the fleet existed — is read as a one-device
 * fleet rather than an empty one. Without that fallback those states would
 * authenticate no bridge at all, which is a silent failure, not a loud one.
 */
export function listDevices(state) {
  if (Array.isArray(state?.devices)) return state.devices;
  return state?.device ? [state.device] : [];
}

export function findDevice(state, deviceId) {
  if (!deviceId) return null;
  return listDevices(state).find((device) => device?.id === deviceId) ?? null;
}

/**
 * The device `state.device` aliases. Order is stable (devices are appended), so
 * the seeded local device stays primary for the single-device install.
 */
export function primaryDevice(state) {
  return listDevices(state)[0] ?? null;
}

export function normalizeDeviceTimeZone(value) {
  const candidate = String(value ?? "").trim();
  if (!candidate || candidate.length > 100) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: candidate }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export function currentDeviceTimeZone(state) {
  return normalizeDeviceTimeZone(primaryDevice(state)?.timeZone) ?? "UTC";
}

/**
 * Install `state.device` as a live accessor over `state.devices[0]`.
 *
 * A getter (rather than a duplicated object reference) is what keeps the two
 * views from drifting: `state.device.status = "online"` mutates the record in
 * `state.devices`, and a whole-object assignment (`state.device = {...}`, which
 * persistence's restore does) replaces devices[0] instead of silently detaching
 * the alias from the collection.
 */
export function defineDeviceAlias(state) {
  Object.defineProperty(state, "device", {
    get() {
      return primaryDevice(this);
    },
    set(value) {
      if (!Array.isArray(this.devices)) this.devices = [];
      if (this.devices.length) this.devices[0] = value;
      else this.devices.push(value);
    },
    enumerable: true,
    configurable: true,
  });
  return state;
}
