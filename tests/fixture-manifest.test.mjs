/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import {
  fixtureManifestVersion,
  validateFixtureManifest,
} from "../fixtures/fixture-manifest.mjs";

function fixture(id, overrides = {}) {
  return {
    id,
    source: "fixtures/Fixture.lean",
    entry: "Fixture.run",
    result: { type: "Nat" },
    ...overrides,
  };
}

test("fixture manifests expose their validated version and entries", () => {
  const fixtures = [fixture("valid-fixture"), fixture("nested.case_2")];
  assert.equal(fixtureManifestVersion, 1);
  assert.equal(validateFixtureManifest({ version: fixtureManifestVersion, fixtures }), fixtures);
});

test("fixture manifests reject malformed containers and versions", () => {
  for (const manifest of [null, []]) {
    assert.throws(() => validateFixtureManifest(manifest), /fixture manifest must be an object/);
  }
  assert.throws(
    () => validateFixtureManifest({ fixtures: [] }),
    /fixture manifest version must be 1, got undefined/,
  );
  assert.throws(
    () => validateFixtureManifest({ version: 2, fixtures: [] }),
    /fixture manifest version must be 1, got 2/,
  );
  assert.throws(
    () => validateFixtureManifest({ version: 1, fixtures: null }),
    /fixture manifest fixtures must be an array/,
  );
});

test("fixture manifests require unique portable ids", () => {
  assert.throws(
    () => validateFixtureManifest({ version: 1, fixtures: [null] }),
    /fixture at index 0 must be an object/,
  );
  assert.throws(
    () => validateFixtureManifest({ version: 1, fixtures: [fixture("unsafe/fixture")] }),
    /lowercase filename-safe identifier/,
  );
  assert.throws(
    () => validateFixtureManifest({
      version: 1,
      fixtures: [fixture("duplicate"), fixture("duplicate")],
    }),
    /duplicate fixture id "duplicate"/,
  );
});

test("fixture manifests validate execution fields", () => {
  const invalidCases = [
    [fixture("missing-source", { source: "" }), /source must be a non-empty string/],
    [fixture("missing-entry", { entry: null }), /entry must be a non-empty string/],
    [fixture("empty-roots", { roots: [] }), /roots must be a non-empty array/],
    [fixture("blank-root", { roots: [""] }), /root must be a non-empty string/],
    [fixture("wrong-result", { result: { type: "String" } }), /result\.type must be Nat/],
    [fixture("wrong-unsafe", { unsafe: "yes" }), /unsafe must be a boolean/],
  ];
  for (const [invalidFixture, expected] of invalidCases) {
    assert.throws(
      () => validateFixtureManifest({ version: 1, fixtures: [invalidFixture] }),
      expected,
    );
  }
});
