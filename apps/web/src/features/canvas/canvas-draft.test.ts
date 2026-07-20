import { describe, expect, it } from "vitest";
import { parseImportedScene, sceneFilename } from "./canvas-draft";

describe("parseImportedScene", () => {
  it("accepts a well-formed .excalidraw scene", () => {
    const scene = parseImportedScene(
      JSON.stringify({ type: "excalidraw", elements: [{ id: "a" }], appState: { viewBackgroundColor: "#fff" } }),
    );
    expect(scene.elements).toHaveLength(1);
    expect(scene.appState).toEqual({ viewBackgroundColor: "#fff" });
  });

  it("rejects invalid JSON", () => {
    expect(() => parseImportedScene("{not json")).toThrow(/invalid JSON/i);
  });

  it("rejects a JSON blob that is not an Excalidraw scene", () => {
    expect(() => parseImportedScene(JSON.stringify({ hello: "world" }))).toThrow(/valid \.excalidraw/i);
    expect(() => parseImportedScene(JSON.stringify({ type: "excalidraw" }))).toThrow(/missing elements/i);
  });
});

describe("sceneFilename", () => {
  it("builds a stable, sortable, extension-suffixed name", () => {
    const name = sceneFilename("png", new Date("2026-07-20T07:12:00.000Z"));
    expect(name).toBe("canvas-2026-07-20T07-12-00.png");
  });
});
