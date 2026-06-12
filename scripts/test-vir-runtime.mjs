/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { spawnSync } from "node:child_process";

const tests = [
  "scripts/runtime-tests/manifest-smoke.mjs",
  "scripts/runtime-tests/host-bindings-smoke.mjs",
  "scripts/runtime-tests/react-host-bindings-smoke.mjs",
  "scripts/runtime-tests/value-codec-smoke.mjs",
  "scripts/runtime-tests/package-generation-smoke.mjs",
  "scripts/runtime-tests/sdk-import-smoke.mjs",
];

for (const test of tests) {
  const result = spawnSync(process.execPath, [test], { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("vir runtime smoke ok");
