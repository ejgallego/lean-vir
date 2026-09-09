/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { testModulePath } from "../support/module-project.mjs";
import {
  fixtureHostModule,
  fixtureModuleMap,
} from "../support/fixture-modules.mjs";

test("test module paths are explicit simple names, never source-path guesses", () => {
  assert.equal(testModulePath("Oracle.Case0"), "Oracle/Case0.lean");
  for (const name of [
    undefined,
    null,
    "",
    "../A",
    "A/B",
    "/A",
    "A..B",
    "--A",
    "A.lean-name",
    "«A.B»",
  ]) {
    assert.throws(() => testModulePath(name), /invalid test module name/);
  }
});

test("fixture source display paths map to catalog module identities", () => {
  const specs = [
    {
      fixtureInputs: [{ source: "display/path.lean", module: "Actual.Input" }],
    },
  ];
  const fixtures = [
    { id: "first", source: "display/path.lean" },
    { id: "second", source: "display/path.lean" },
  ];
  assert.deepEqual(
    [...fixtureModuleMap(specs, fixtures)],
    [["display/path.lean", "Actual.Input"]],
  );
  assert.throws(
    () => fixtureModuleMap(specs, [{ id: "missing", source: "Other.lean" }]),
    /missing: no compiled module for Other.lean/,
  );
});

test("host drivers import compiled IR and preserve interpreted unsafe Nat execution", () => {
  const fixture = {
    id: "entry",
    entry: "Actual.answer",
    result: { type: "Nat" },
  };
  const source = fixtureHostModule(fixture, "Actual.Input");
  assert.match(
    source,
    /^module\npublic import Actual.Input\nimport all Actual.Input\n/,
  );
  assert.match(source, /set_option interpreter.prefer_native false/);
  assert.match(source, /public def main : IO UInt32/);
  assert.match(source, /IO.println \(toString Actual.answer\)/);
  assert.match(
    fixtureHostModule({ ...fixture, unsafe: true }, "Actual.Input"),
    /public unsafe def main/,
  );
  assert.throws(
    () =>
      fixtureHostModule(
        { ...fixture, result: { type: "String" } },
        "Actual.Input",
      ),
    /unsupported host result type String/,
  );
});
