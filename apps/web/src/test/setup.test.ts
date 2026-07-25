import { expect, it } from "vitest";

it("provides the same working localStorage through globalThis and window", () => {
  localStorage.clear();
  localStorage.setItem("vitest-storage-contract", "ready");

  expect(window.localStorage.getItem("vitest-storage-contract")).toBe("ready");
  expect(globalThis.localStorage).toBe(window.localStorage);
});
