/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { assertResourceCompatibility } from "../../web/src/resources/compatibility.js";
import { VIR_COMPATIBILITY_VERSION } from "../../web/src/runtime/versions.js";

const profile = JSON.parse(
  readFileSync(new URL("../../vir-resources/compatibility.json", import.meta.url)),
);
test("producer profile agrees with the browser resource contract", () => {
  assertResourceCompatibility(profile);
  assert.equal(profile.virVersion, VIR_COMPATIBILITY_VERSION);
});
test("virVersion rejects drift, a missing field and a wrong type", () => {
  for (const value of ["wrong", undefined, null, profile.virVersion - 1, profile.virVersion + 1]) {
    assert.notEqual(value, profile.virVersion);
    assert.throws(
      () => assertResourceCompatibility({ ...profile, virVersion: value }),
      /unsupported resource runtime compatibility/,
    );
  }
});
test("Lean revision must be present and nonempty", () => {
  for (const leanRevision of ["", undefined, null, 434]) {
    assert.throws(
      () => assertResourceCompatibility({ ...profile, leanRevision }),
      /unsupported resource runtime compatibility/,
    );
  }
});
test("rejects obsolete and mixed resource compatibility records", () => {
  const obsolete = {
    leanBuildId: profile.leanRevision,
    runtimeAbi: "4",
    jsApiVersion: 1,
    irFormatVersion: 11,
  };
  for (const candidate of [
    obsolete,
    { ...profile, runtimeAbi: "4" },
    { ...profile, ...obsolete },
  ]) {
    assert.throws(
      () => assertResourceCompatibility(candidate),
      /unsupported resource runtime compatibility/,
    );
  }
});
