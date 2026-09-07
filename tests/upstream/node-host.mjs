/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntime } from "../../web/src/vir-runtime-node.js";
import { demoHostImportTargets } from "../../scripts/native/demo-host-import-targets.mjs";

export async function smokeNodeHostRuntime(context) {
  const runtime = await createVirRuntime({
    wasmBytes: context.wasmBytes,
    irPackageSet: [context.hostPackageBytes],
  });
  const actualTargets = runtime.interfaceManifest.hostImports
    .map((entry) => entry.target)
    .sort();
  if (
    runtime.packageInfo.hostImports !== demoHostImportTargets.length ||
    JSON.stringify(actualTargets) !== JSON.stringify(demoHostImportTargets)
  ) {
    throw new Error(
      `unexpected stock package host imports: expected ${JSON.stringify(demoHostImportTargets)}, got ${JSON.stringify(actualTargets)}`,
    );
  }

  assertMissingBrowserProvider(runtime, "HostInterop.titleHandshake", [
    "smoke",
  ]);
  assertMissingBrowserProvider(runtime, "ReactCounter.mount", ["#react"]);
  runtime.dispose();
}

function assertMissingBrowserProvider(runtime, entry, args) {
  let message = "";
  try {
    runtime.call(entry, ...args);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  if (
    !/host import binding not found/.test(message) ||
    runtime.liveCallbacks.size !== 0
  ) {
    throw new Error(
      `${entry} must require an explicit browser host: ${JSON.stringify({ message, callbacks: runtime.liveCallbacks.size })}`,
    );
  }
}
