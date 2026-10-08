/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/
import {
  createVirRuntime,
  createVirRuntimeFactory,
} from "../../web/src/vir-runtime-node.js";
import { readFile, readRuntimeArtifacts } from "./shared.mjs";
import { check, runGenerationGcCases } from "./generation-gc-cases.js";
import {
  runGenerationLifecycleCases,
  runSharedBindingGcCases,
} from "./generation-lifecycle-cases.js";
check(typeof globalThis.gc === "function", "requires node --expose-gc");
const { hostPackageBytes } = await readRuntimeArtifacts();
for (const profile of ["vir-upstream.wasm", "vir-upstream.dev.wasm"]) {
  const wasmBytes = await readFile(new URL(`../../web/public/${profile}`, import.meta.url));
  const createRuntime = (hostBindings) =>
    createVirRuntime({
      wasmBytes,
      irPackageSet: [hostPackageBytes],
      hostBindings,
    });
  const result = await runGenerationGcCases(createRuntime);
  const lifecycle = await runGenerationLifecycleCases(
    createRuntime,
    hostPackageBytes,
    () => createVirRuntime({ wasmBytes }),
  );
  const sharedBindings = {};
  const shared = await runSharedBindingGcCases(
    createVirRuntimeFactory({ wasmBytes, hostBindings: sharedBindings }),
    sharedBindings,
    hostPackageBytes,
  );
  console.log(`${profile}: real-Wasm generation GC smoke ok`, { result, lifecycle, shared });
}
