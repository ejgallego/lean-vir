/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createUpstreamSmokeContext } from "./context.mjs";
import { smokeFixtureManifest } from "./fixtures.mjs";
import { smokeRuntimeCalls } from "./runtime-calls.mjs";
import { smokeNodeHostRuntime } from "./node-host.mjs";
import { smokeWasmPackageBoundary } from "./wasm-package.mjs";

const context = await createUpstreamSmokeContext();
const { runtime } = await smokeWasmPackageBoundary(context);
smokeRuntimeCalls(runtime);
await smokeNodeHostRuntime(context);
const fixtureCount = await smokeFixtureManifest(context);

console.log(
  `upstream smoke ok: fib 17 = 1597, Node browser calls require an explicit host, editable SortDemo works, ${fixtureCount} fixtures run`,
);
