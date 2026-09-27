import assert from "node:assert/strict";
import test from "node:test";
import { resolveProgramExports } from "../../web/src/resources/program-exports.js";

test("roles bind exact declarations despite colliding convenience aliases", () => {
  const wrong = { entry: "Test.wrong", id: "Test.right", jsName: "Test.right" };
  const right = { entry: "Test.right", id: "right", jsName: "right" };
  const roles = resolveProgramExports(
    [{ role: "run", declaration: right.entry }],
    [wrong, right],
  );
  assert.equal(roles.get("run"), right);
  assert.throws(
    () =>
      resolveProgramExports([{ role: "run", declaration: "right" }], [right]),
    /missing/,
  );
});

test("dependency-only declarations are not root entrypoints", () => {
  const manifests = [
    { exports: [{ entry: "Dependency.run" }] },
    { exports: [{ entry: "Root.run" }] },
  ];
  assert.throws(
    () =>
      resolveProgramExports(
        [{ role: "run", declaration: "Dependency.run" }],
        manifests.at(-1).exports,
      ),
    /missing program export Dependency.run/,
  );
});

test("ambiguous root declarations fail instead of first-wins selection", () => {
  assert.throws(
    () =>
      resolveProgramExports(
        [{ role: "run", declaration: "Root.run" }],
        [{ entry: "Root.run" }, { entry: "Root.run" }],
      ),
    /ambiguous/,
  );
});
