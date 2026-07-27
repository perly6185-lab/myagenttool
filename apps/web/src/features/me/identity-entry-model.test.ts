import { describe, expect, it } from "vitest";
import { safeAuthorizationUri, stageForChallenge } from "./identity-entry-model";

describe("identity entry state model", () => {
  it("maps the server challenge state without inventing a successful session", () => {
    expect(stageForChallenge("pending")).toBe("waiting");
    expect(stageForChallenge("authorized")).toBe("confirmed");
    expect(stageForChallenge("expired")).toBe("expired");
    expect(stageForChallenge("rejected")).toBe("rejected");
    expect(stageForChallenge("cancelled")).toBe("rejected");
    expect(stageForChallenge("failed")).toBe("rejected");
  });

  it("renders only HTTPS server authorization links", () => {
    expect(safeAuthorizationUri("https://identity.example.test/start")).toBe("https://identity.example.test/start");
    expect(safeAuthorizationUri("javascript:alert(1)")).toBeNull();
    expect(safeAuthorizationUri("http://identity.example.test/start")).toBeNull();
    expect(safeAuthorizationUri("not a url")).toBeNull();
  });
});
