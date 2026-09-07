/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";

const factory = createVirRuntimeFactory({
  wasmBytes: await readFile(
    new URL("../../web/public/vir-upstream.wasm", import.meta.url),
  ),
});
for (const suffix of ["first", "edited"]) {
  const bytes = await readFile(
    new URL(
      `../../build/infoview-smoke/snapshot-${suffix}.irpkg`,
      import.meta.url,
    ),
  );
  const runtime = await factory.createRuntime({ irPackageSet: [bytes] });
  try {
    assert.equal(
      runtime.call("snapshotValue"),
      `imported helper before${suffix}`,
    );
  } finally {
    runtime.dispose();
  }
}
console.log(
  "infoview module snapshot smoke ok: opaque imports, private owner, unsaved edits",
);
