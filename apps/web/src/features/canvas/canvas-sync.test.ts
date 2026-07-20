import { afterEach, describe, expect, it } from "vitest";
import { clearOfflineDraft, loadOfflineDraft, offlineDraftKey, reconcile, saveOfflineDraft } from "./canvas-sync";

afterEach(() => localStorage.clear());

describe("reconcile", () => {
  it("does nothing when the server is not ahead", () => {
    expect(reconcile({ localRevision: 3, dirty: false, serverRevision: 3 })).toBe("idle");
    expect(reconcile({ localRevision: 3, dirty: true, serverRevision: 2 })).toBe("idle");
  });

  it("applies the server scene when ahead and there are no unsaved edits", () => {
    expect(reconcile({ localRevision: 3, dirty: false, serverRevision: 4 })).toBe("apply-server");
  });

  it("flags a conflict when the server is ahead AND there are unsaved edits", () => {
    expect(reconcile({ localRevision: 3, dirty: true, serverRevision: 4 })).toBe("conflict");
  });
});

describe("offline draft", () => {
  it("is keyed per scene and round-trips", () => {
    expect(offlineDraftKey("cvs_1")).toBe("myagenttool-canvas-offline:cvs_1");
    expect(loadOfflineDraft("cvs_1")).toBeNull();
    saveOfflineDraft("cvs_1", "{\"elements\":[]}");
    saveOfflineDraft("cvs_2", "other");
    expect(loadOfflineDraft("cvs_1")).toContain("elements");
    expect(loadOfflineDraft("cvs_2")).toBe("other");
    clearOfflineDraft("cvs_1");
    expect(loadOfflineDraft("cvs_1")).toBeNull();
    expect(loadOfflineDraft("cvs_2")).toBe("other"); // unaffected
  });
});
