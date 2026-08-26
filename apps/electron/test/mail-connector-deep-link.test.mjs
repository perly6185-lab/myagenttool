import assert from "node:assert/strict";
import test from "node:test";
import { desktopRouteFromArgv, mailConnectorIntentFromArgv, rendererUrlForDesktopRoute, rendererUrlForMailConnector } from "../src/mail-connector-deep-link.mjs";

test("reads a bounded mailbox connector intent from an app deep link", () => {
  assert.equal(mailConnectorIntentFromArgv(["MyAgentTool.exe", "myagenttool://mail/connect?intent=organize"]), "organize");
  assert.equal(mailConnectorIntentFromArgv(["MyAgentTool.exe", "myagenttool://mail/connect?intent=send"]), "send");
  assert.equal(mailConnectorIntentFromArgv(["MyAgentTool.exe", "myagenttool://mail/connect?intent=unexpected"]), "manage");
  assert.equal(mailConnectorIntentFromArgv(["MyAgentTool.exe", "myagenttool://tasks/open"]), null);
});

test("desktop handoff accepts only allowlisted routes and parameters", () => {
  assert.deepEqual(desktopRouteFromArgv(["MyAgentTool.exe", "myagenttool://open?section=documents&desktopAction=open-system-document&project=p1&document=docs%2Fa.docx&evil=x"]), {
    section: "documents",
    desktopAction: "open-system-document",
    project: "p1",
    document: "docs/a.docx",
  });
  assert.equal(desktopRouteFromArgv(["MyAgentTool.exe", "myagenttool://open?section=audit&desktopAction=run-command"]), null);
  assert.deepEqual(desktopRouteFromArgv(["MyAgentTool.exe", "myagenttool://open?section=sessions&desktopAction=open-desktop-page&site=wechat_official"]), {
    section: "sessions",
    desktopAction: "open-desktop-page",
    site: "wechat_official",
  });
});

test("desktop handoff renderer URL retains the API address", () => {
  const result = new URL(rendererUrlForDesktopRoute("http://127.0.0.1:5000/?api=http%3A%2F%2F127.0.0.1%3A5001", {
    section: "workflowMemory",
    desktopAction: "add-real-case",
    source: "source-1",
  }));
  assert.equal(result.searchParams.get("api"), "http://127.0.0.1:5001");
  assert.equal(result.searchParams.get("section"), "workflowMemory");
  assert.equal(result.searchParams.get("desktopAction"), "add-real-case");
  assert.equal(result.searchParams.get("source"), "source-1");
});

test("opens the desktop renderer at the mailbox step without losing its server URL", () => {
  const result = new URL(rendererUrlForMailConnector("http://127.0.0.1:5000/?api=http%3A%2F%2F127.0.0.1%3A5001", "organize"));
  assert.equal(result.searchParams.get("api"), "http://127.0.0.1:5001");
  assert.equal(result.searchParams.get("section"), "mail");
  assert.equal(result.searchParams.get("mailConnect"), "organize");
});
