import assert from "node:assert/strict";
import test from "node:test";

import { requireArtifactManifestIdentity } from "../src/artifact-status.js";

const expected = {
  exampleId: "prettyM",
  variantId: "default",
  testPackage: {
    file: "examples/prettyM/tests.json",
    bytes: 123,
    sha256: "a".repeat(64),
  },
};

function manifest() {
  return {
    schemaVersion: 2,
    kind: "browser-benchmarks/artifact-set",
    example: { id: expected.exampleId, variant: expected.variantId },
    setId: "prettyM-set",
    testPackage: { ...expected.testPackage },
  };
}

test("accepts an exact example, variant, set, and test package identity", () => {
  const value = manifest();
  assert.equal(requireArtifactManifestIdentity(value, expected), value);
});

for (const [name, mutate] of [
  ["missing variant", (value) => delete value.example.variant],
  ["different variant", (value) => (value.example.variant = "wide")],
  ["empty set ID", (value) => (value.setId = "")],
]) {
  test(`rejects ${name}`, () => {
    const value = manifest();
    mutate(value);
    assert.throws(
      () => requireArtifactManifestIdentity(value, expected),
      /selected example variant/,
    );
  });
}

for (const [name, mutate] of [
  ["missing test package", (value) => delete value.testPackage],
  [
    "different test package digest",
    (value) => (value.testPackage.sha256 = "b".repeat(64)),
  ],
]) {
  test(`rejects ${name}`, () => {
    const value = manifest();
    mutate(value);
    assert.throws(
      () => requireArtifactManifestIdentity(value, expected),
      /test package/,
    );
  });
}
