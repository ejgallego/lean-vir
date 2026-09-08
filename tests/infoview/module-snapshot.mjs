/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";
import { readIrPackageInfo } from "../../web/src/runtime/ir-package.js";

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
    const { manifest } = readIrPackageInfo(bytes);
    assert.deepEqual(manifest.metadata.targets, [{
      source: "untitled:ModuleSnapshot.lean",
      mode: "explicit",
      roots: ["snapshotValue"],
      resolvedRoots: ["snapshotValue"],
    }]);
    assert.equal(manifest.exports[0].source, "untitled:ModuleSnapshot.lean");
    assert.equal(
      runtime.call("snapshotValue"),
      `imported helper beforesnapshot:${suffix}`,
    );
  } finally {
    runtime.dispose();
  }
}
console.log(
  "infoview module snapshot smoke ok: document provenance, opaque imports, private owner, unsaved edits",
);
