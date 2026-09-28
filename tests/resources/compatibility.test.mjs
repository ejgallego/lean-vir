/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { assertResourceCompatibility } from "../../web/src/resources/compatibility.js";
import { PACKAGE_VERSIONS } from "../../scripts/packages/package-versions.mjs";

const profile = JSON.parse(
  readFileSync(new URL("../../vir-resources/compatibility.json", import.meta.url)),
);
test("producer profile agrees with the browser and SDK contract", () => {
  assertResourceCompatibility(profile);
  assert.equal(profile.runtimeAbi, String(PACKAGE_VERSIONS.runtimeAbiVersion));
  assert.equal(profile.irFormatVersion, PACKAGE_VERSIONS.packageFormatVersion);
});
for (const field of ["runtimeAbi", "jsApiVersion", "irFormatVersion"]) {
  test(`${field} rejects drift, a missing field and a wrong type`, () => {
    for (const value of ["wrong", undefined, null, Number(profile[field]) + 1]) {
      assert.notEqual(value, profile[field]);
      assert.throws(
        () => assertResourceCompatibility({ ...profile, [field]: value }),
        /unsupported resource runtime compatibility/,
      );
    }
  });
}
