import { test } from "node:test";
import assert from "node:assert/strict";

import { parseQichachaUrl, QichachaUrlError } from "../src/parse-url.mjs";

test("parseQichachaUrl: www firm detail page yields a canonical URL", () => {
  const r = parseQichachaUrl("https://www.qcc.com/firm/9d2f2be64b8b1b03ffef31fb800d5f85.shtml");
  assert.equal(r.canonicalUrl, "https://www.qcc.com/firm/9d2f2be64b8b1b03ffef31fb800d5f85.shtml");
});

test("parseQichachaUrl: qichacha.com mirror domain accepted", () => {
  const r = parseQichachaUrl("https://www.qichacha.com/firm/9d2f2be64b8b1b03ffef31fb800d5f85.shtml");
  assert.equal(r.canonicalUrl, "https://www.qichacha.com/firm/9d2f2be64b8b1b03ffef31fb800d5f85.shtml");
});

test("parseQichachaUrl: mobile host accepted (tuned later if needed)", () => {
  const r = parseQichachaUrl("https://m.qcc.com/firm/9d2f2be64b8b1b03ffef31fb800d5f85.shtml");
  assert.equal(r.canonicalUrl, "https://m.qcc.com/firm/9d2f2be64b8b1b03ffef31fb800d5f85.shtml");
});

test("parseQichachaUrl: strips the hash (tracking fragment) only", () => {
  const r = parseQichachaUrl("https://www.qcc.com/firm/9d2f2be64b8b1b03ffef31fb800d5f85.shtml#basic");
  assert.equal(r.canonicalUrl, "https://www.qcc.com/firm/9d2f2be64b8b1b03ffef31fb800d5f85.shtml");
});

test("parseQichachaUrl: keeps pathname + query routing", () => {
  const r = parseQichachaUrl("https://www.qcc.com/firm/9d2f2be64b8b1b03ffef31fb800d5f85.shtml?key=legal");
  assert.equal(r.canonicalUrl, "https://www.qcc.com/firm/9d2f2be64b8b1b03ffef31fb800d5f85.shtml?key=legal");
});

test("parseQichachaUrl: rejects non-qcc/qichacha hosts and lookalikes", () => {
  assert.throws(() => parseQichachaUrl("https://example.com/firm/x.shtml"), QichachaUrlError);
  assert.throws(() => parseQichachaUrl("https://qcc.com.evil.example.com/firm/x.shtml"), QichachaUrlError);
  assert.throws(() => parseQichachaUrl("https://xqcc.com/firm/x.shtml"), QichachaUrlError);
  assert.throws(() => parseQichachaUrl("https://qichacha.com.evil.example.com/firm/x.shtml"), QichachaUrlError);
});

test("parseQichachaUrl: rejects embedded credentials", () => {
  assert.throws(() => parseQichachaUrl("https://user:pass@www.qcc.com/firm/x.shtml"), QichachaUrlError);
});

test("parseQichachaUrl: rejects non-http(s) schemes", () => {
  assert.throws(() => parseQichachaUrl("file:///d:/x"), QichachaUrlError);
  assert.throws(() => parseQichachaUrl("javascript:alert(1)"), QichachaUrlError);
});

test("parseQichachaUrl: rejects empty / non-string / not-a-url", () => {
  assert.throws(() => parseQichachaUrl(""), QichachaUrlError);
  assert.throws(() => parseQichachaUrl("   "), QichachaUrlError);
  assert.throws(() => parseQichachaUrl("not a url"), QichachaUrlError);
});
