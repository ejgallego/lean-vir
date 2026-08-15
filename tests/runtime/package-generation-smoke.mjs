/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { join, readRuntimeArtifacts } from "./shared.mjs";
import { runFreshPackageSmoke } from "./package-generation-fresh-cases.mjs";
import { runHostPackageSmoke } from "./package-generation-host-cases.mjs";
import { runIrPackageLifecycleSmoke } from "./package-generation-lifecycle-cases.mjs";
import { runUnsupportedInterfaceSmoke } from "./package-generation-unsupported-cases.mjs";

const { wasmBytes, leanPackageBytes } = await readRuntimeArtifacts();
const freshDir = await mkdtemp(join(tmpdir(), "lean-vir-fresh-"));
try {
  await runFreshPackageSmoke({ freshDir, wasmBytes });
  await runUnsupportedInterfaceSmoke(freshDir);
  await runHostPackageSmoke({ freshDir, wasmBytes });
  await runIrPackageLifecycleSmoke({ freshDir, wasmBytes, leanPackageBytes });
} finally {
  await rm(freshDir, { recursive: true, force: true });
}

console.log("vir runtime package generation smoke ok");
