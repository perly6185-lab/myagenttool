import assert from "node:assert/strict";
import test from "node:test";

import { certificateRequirementOf, chooseSigningIdentity, codesignArguments, hasElectronRuntimeEntitlements, isStableAppleRequirement, parseSigningIdentities, teamIdentifierOf } from "../macos-code-signing.mjs";

const DEVELOPMENT = "Apple Development: Example Developer (A1B2C3D4E5)";
const DEVELOPER_ID = "Developer ID Application: Example Developer (A1B2C3D4E5)";

test("selects only supported Apple application signing identities", () => {
  const output = `  1) AAAAA "${DEVELOPMENT}"\n  2) BBBBB "Mac Developer: Legacy"\n  3) CCCCC "${DEVELOPER_ID}"\n     3 valid identities found`;
  assert.deepEqual(parseSigningIdentities(output), [DEVELOPMENT, DEVELOPER_ID]);
  assert.equal(chooseSigningIdentity(output), DEVELOPER_ID);
  assert.equal(chooseSigningIdentity(output, DEVELOPMENT), DEVELOPMENT);
  assert.throws(() => chooseSigningIdentity(output, "Apple Development: Missing"), /unavailable/);
});

test("accepts Apple certificate requirements and rejects ad-hoc or self-signed requirements", () => {
  const stable = 'designated => identifier "com.myagenttool.desktop" and anchor apple generic and certificate leaf[subject.CN] = "Apple Development: Example"';
  const adHoc = 'designated => cdhash H"7cd0bc5e008641f0d909550a5afe7da7bdab004c"';
  const selfSigned = 'designated => identifier "com.myagenttool.desktop" and certificate root = H"a376b39cc71f769151977e9553a6ced6ebbf6dce"';
  assert.equal(certificateRequirementOf(`Executable=/Applications/MyAgentTool.app\n${stable}\n`), stable);
  assert.equal(isStableAppleRequirement(stable), true);
  assert.equal(isStableAppleRequirement(adHoc), false);
  assert.equal(isStableAppleRequirement(selfSigned), false);
});

test("requires a real Team Identifier", () => {
  assert.equal(teamIdentifierOf("TeamIdentifier=A1B2C3D4E5\n"), "A1B2C3D4E5");
  assert.equal(teamIdentifierOf("TeamIdentifier=not set\n"), null);
  assert.equal(teamIdentifierOf("Signature=adhoc\n"), null);
});

test("preserves Electron runtime entitlements and chooses a suitable timestamp mode", () => {
  const developmentArgs = codesignArguments("/tmp/MyAgentTool.app", DEVELOPMENT);
  const distributionArgs = codesignArguments("/tmp/MyAgentTool.app", DEVELOPER_ID);
  assert.equal(developmentArgs.includes("--timestamp=none"), true);
  assert.equal(distributionArgs.includes("--timestamp"), true);
  assert.equal(developmentArgs.includes("--preserve-metadata=identifier,entitlements,flags"), true);
  assert.equal(hasElectronRuntimeEntitlements("com.apple.security.cs.allow-jit com.apple.security.cs.allow-unsigned-executable-memory com.apple.security.cs.disable-library-validation"), true);
  assert.equal(hasElectronRuntimeEntitlements("com.apple.security.cs.allow-jit"), false);
});
