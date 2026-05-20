/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntime } from "./vir-runtime.js";

const output = document.querySelector("#runtime-example-output");

try {
  const vir = await createVirRuntime({
    wasmUrl: `${import.meta.env.BASE_URL}vir-upstream.wasm`,
    irPackageUrl: `${import.meta.env.BASE_URL}vir-demo.irpkg`,
  });

  const results = {
    declarations: vir.packageInfo.count,
    constNat: vir.evalConstNat("SortDemo.demo"),
    natToNat: vir.evalNatToNat("fib", 12),
    natArrayToNat: vir.evalNatArrayToNat("SortDemo.demoFromArray", [4, 1, 3, 2]),
    stringToNat: vir.evalStringToNat("Vir.Fixtures.Basic.stringUtf8RoundtripScore", "Aé∀Z"),
    byteArrayToNat: vir.evalByteArrayToNat("Vir.Fixtures.Basic.byteArrayInputScore", [65, 66, 67]),
  };

  output.textContent = JSON.stringify(results, null, 2);
} catch (error) {
  output.textContent = error instanceof Error ? error.stack : String(error);
  throw error;
}
