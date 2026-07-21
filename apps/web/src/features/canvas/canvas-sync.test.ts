import { afterEach, describe, expect, it } from "vitest";
import {
  clearOfflineDraft,
  heldImageElementIds,
  loadOfflineDraft,
  normalizeLoadedImageElements,
  offlineDraftKey,
  reconcile,
  saveOfflineDraft,
} from "./canvas-sync";

afterEach(() => localStorage.clear());

describe("normalizeLoadedImageElements", () => {
  const files = new Set(["f1"]);

  it("flips a pending image whose file we hold to saved (else Excalidraw renders it blank)", () => {
    const [img] = normalizeLoadedImageElements([{ id: "a", type: "image", status: "pending", fileId: "f1" }], files);
    expect(img.status).toBe("saved");
  });

  it("leaves a pending image whose file is ABSENT untouched (nothing to render against)", () => {
    const [img] = normalizeLoadedImageElements([{ id: "a", type: "image", status: "pending", fileId: "missing" }], files);
    expect(img.status).toBe("pending");
  });

  it("passes non-image elements and already-saved images through unchanged (no needless copy)", () => {
    const rect = { id: "r", type: "rectangle" };
    const saved = { id: "a", type: "image", status: "saved", fileId: "f1" };
    const out = normalizeLoadedImageElements([rect, saved], files);
    expect(out[0]).toBe(rect);
    expect(out[1]).toBe(saved);
  });
});

describe("heldImageElementIds", () => {
  const files = new Set(["f1", "f2"]);

  it("returns only image elements whose binary is present (a reachable reassert target)", () => {
    const ids = heldImageElementIds(
      [
        { id: "a", type: "image", fileId: "f1" },
        { id: "b", type: "image", fileId: "missing" }, // pruned permanently — never sticks
        { id: "c", type: "rectangle" },
        { id: "d", type: "image", fileId: "f2" },
      ],
      files,
    );
    expect(ids).toEqual(["a", "d"]);
  });

  it("returns [] when no image has a held file (so the reassert loop never starts)", () => {
    expect(heldImageElementIds([{ id: "a", type: "image", fileId: "missing" }], files)).toEqual([]);
  });
});

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
