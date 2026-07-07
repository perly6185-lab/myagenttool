/*
 * D1 report rendering: the fence parser that decides what renders as aligned
 * monospace (ASCII wireframes) vs prose. A regression here silently mangles
 * design briefs back into clamped prose.
 */

import { describe, expect, it } from "vitest";

import { parseReportBlocks } from "./report-view";

describe("parseReportBlocks", () => {
  it("plain prose → one text block", () => {
    expect(parseReportBlocks("a design\nwith two lines")).toEqual([{ type: "text", text: "a design\nwith two lines" }]);
  });

  it("fenced block becomes code with lang; surrounding prose preserved", () => {
    const report = "Intro\n```text\n+----+\n| UI |\n+----+\n```\nOutro";
    expect(parseReportBlocks(report)).toEqual([
      { type: "text", text: "Intro" },
      { type: "code", text: "+----+\n| UI |\n+----+", lang: "text" },
      { type: "text", text: "Outro" },
    ]);
  });

  it("whitespace inside code is preserved exactly (ASCII alignment)", () => {
    const art = "  | a |   b |\n  |---|-----|";
    const [block] = parseReportBlocks("```\n" + art + "\n```");
    expect(block).toMatchObject({ type: "code", text: art });
  });

  it("an unclosed fence swallows the rest as code (truncated report)", () => {
    const blocks = parseReportBlocks("head\n```\nwire\nframe");
    expect(blocks).toEqual([
      { type: "text", text: "head" },
      { type: "code", text: "wire\nframe", lang: "" },
    ]);
  });

  it("blank-only prose between fences is dropped; empty code kept", () => {
    const blocks = parseReportBlocks("```\n\n```\n   \n```js\nx\n```");
    expect(blocks).toEqual([
      { type: "code", text: "", lang: "" },
      { type: "code", text: "x", lang: "js" },
    ]);
  });
});
