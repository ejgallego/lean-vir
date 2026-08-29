/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import { parseLeanBuildIdentity } from "../../scripts/packages/lean-build-identity.mjs";

test("parses the normalized version and git hash from Lean --version", () => {
  assert.deepEqual(
    parseLeanBuildIdentity(
      "Lean (version 4.33.0, x86_64-unknown-linux-gnu, commit D8B18978322DE05A8F3DBA51EF03CF5461676C17, Release)",
    ),
    {
      leanVersionString: "4.33.0",
      leanGithash: "d8b18978322de05a8f3dba51ef03cf5461676c17",
    },
  );
});

test("rejects an unrecognized Lean build identity", () => {
  assert.throws(
    () => parseLeanBuildIdentity("Lean development build"),
    /could not parse Lean build identity/,
  );
});
