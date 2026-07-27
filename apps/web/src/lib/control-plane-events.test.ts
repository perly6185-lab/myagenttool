import { afterEach, describe, expect, it, vi } from "vitest";
import { openControlPlaneEventStream } from "./api-client";

describe("control-plane event stream", () => {
  afterEach(() => vi.restoreAllMocks());

  it("parses ready and state events from a streamed response", async () => {
    const frames = [
      'event: ready\ndata: {"lastEventId":null}\n\n',
      'id: evt_1\nevent: state\ndata: {"eventId":"evt_1","type":"run_completed"}\n\n',
    ];
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: "usr_local" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(
      new ReadableStream({
        start(controller) {
          frames.forEach((frame) => controller.enqueue(new TextEncoder().encode(frame)));
          controller.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    )));
    const events: string[] = [];
    await openControlPlaneEventStream((event) => events.push(event.event), new AbortController().signal, "evt_0");
    expect(events).toEqual(["ready", "state"]);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/events/stream"),
      expect.objectContaining({ credentials: "include", headers: { "Last-Event-ID": "evt_0" } }),
    );
  });

  it("surfaces expired authentication so reconnect can recover the session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    await expect(openControlPlaneEventStream(() => {}, new AbortController().signal))
      .rejects.toEqual(expect.objectContaining({ code: "unauthenticated", status: 401 }));
  });
});
