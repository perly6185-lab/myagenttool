import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applicationRunWebLink,
  applicationRunWebLinkFromInvocation,
  invocationWebLink,
} from "../src/read-models/web-navigation.mjs";

test("invocation web links use relative Web navigation query params", () => {
  assert.deepEqual(invocationWebLink("inv_123", "Open failed invocation"), {
    label: "Open failed invocation",
    query: "?section=invocations&invocation=inv_123",
    target: {
      section: "invocations",
      invocation: "inv_123",
    },
  });
});

test("application run links require complete application, routine, and run ids", () => {
  assert.equal(applicationRunWebLink(), null);

  assert.equal(applicationRunWebLink({
    applicationId: "app_docs",
    routineId: "",
    invocationId: "inv_123",
  }), null);

  assert.deepEqual(applicationRunWebLink({
    applicationId: "app_docs",
    routineId: "routine_docs_smoke",
    invocationId: "inv_123",
  }), {
    label: "Open application run",
    query: "?section=applications&application=app_docs&routine=routine_docs_smoke&run=inv_123",
    target: {
      section: "applications",
      application: "app_docs",
      routine: "routine_docs_smoke",
      run: "inv_123",
    },
  });
});

test("application run links can be derived from invocation metadata", () => {
  assert.equal(applicationRunWebLinkFromInvocation({
    id: "inv_without_routine",
    options: { metadata: { applicationId: "app_docs" } },
  }), null);

  assert.equal(applicationRunWebLinkFromInvocation({
    id: "inv_docs",
    options: {
      metadata: {
        applicationId: "app_docs",
        routineId: "routine_docs_smoke",
      },
    },
  })?.query, "?section=applications&application=app_docs&routine=routine_docs_smoke&run=inv_docs");
});
