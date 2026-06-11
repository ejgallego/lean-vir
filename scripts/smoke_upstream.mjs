/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createUpstreamSmokeContext } from "./upstream-smoke/context.mjs";
import { smokeFixtureManifest } from "./upstream-smoke/fixtures.mjs";
import { smokeRuntimeCalls } from "./upstream-smoke/runtime-calls.mjs";
import { smokeVirtualHostRuntime } from "./upstream-smoke/virtual-host.mjs";
import { smokeWasmPackageBoundary } from "./upstream-smoke/wasm-package.mjs";

const context = await createUpstreamSmokeContext();
const { runtime } = await smokeWasmPackageBoundary(context);
smokeRuntimeCalls(runtime);
await smokeVirtualHostRuntime(context);
const fixtureCount = await smokeFixtureManifest(context);

console.log(
  `upstream smoke ok: fib 17 = 1597, Lean DOM and React Tamagotchi work, editable SortDemo works, ${fixtureCount} fixtures run`,
);
