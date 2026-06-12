/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { VirRuntime } from "../../web/src/vir-runtime.js";
import { packageForFixture } from "./context.mjs";
import { instantiateVirModule, loadIrPackage } from "./wasm-package.mjs";

export async function smokeFixtureManifest(context) {
  const fixtures = context.fixtureManifest.fixtures ?? [];
  for (const fixture of fixtures) {
    if (fixture.result?.type !== "Nat") {
      throw new Error(`${fixture.id}: unsupported smoke result type ${fixture.result?.type}`);
    }
    let value;
    try {
      const exports = await instantiateVirModule(context.wasmModule);
      loadIrPackage(exports, packageForFixture(context, fixture));
      value = new VirRuntime(exports).call(fixture.entry);
    } catch (error) {
      throw new Error(`${fixture.id}: fixture evaluation failed`, { cause: error });
    }
    if (!/^\d+$/.test(value)) {
      throw new Error(`${fixture.id}: expected Nat result, got ${value}`);
    }
  }
  return fixtures.length;
}
