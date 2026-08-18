import assert from "node:assert/strict";
import { test } from "node:test";

import {
  currentDeviceTimeZone,
  normalizeDeviceTimeZone,
} from "../src/runtime/device.mjs";

test("device time zones are canonicalized and invalid values are rejected", () => {
  assert.equal(normalizeDeviceTimeZone(" Asia/Shanghai "), "Asia/Shanghai");
  assert.equal(normalizeDeviceTimeZone("not/a-time-zone"), null);
  assert.equal(normalizeDeviceTimeZone(""), null);
});

test("the current terminal time zone falls back safely for restored legacy state", () => {
  assert.equal(currentDeviceTimeZone({ devices: [{ timeZone: "America/Los_Angeles" }] }), "America/Los_Angeles");
  assert.equal(currentDeviceTimeZone({ devices: [{ timeZone: "invalid" }] }), "UTC");
  assert.equal(currentDeviceTimeZone({}), "UTC");
});
