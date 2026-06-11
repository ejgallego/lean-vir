/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createVirRuntime } from "../web/src/vir-runtime-node.js";
import {
  default as infoviewWidgetComponent,
  validateWidgetEntry,
} from "../web/src/vir-infoview-widget.js";

const wasmBytes = await readFile(new URL("../web/public/vir-upstream.wasm", import.meta.url));
const packageBytes = await readFile(new URL("../web/public/demo-host.irpkg", import.meta.url));
const runtime = await createVirRuntime({ wasmBytes, irPackageBytes: packageBytes });

assert.equal(typeof infoviewWidgetComponent, "function");
assert.equal(validateWidgetEntry(runtime, "ReactProofWidget.mount").entry, "ReactProofWidget.mount");
assert.throws(
  () => validateWidgetEntry(runtime, "ReactProofWidget.mountDefault"),
  /String -> IO Bool/,
);

runtime.dispose();
console.log("vir infoview widget smoke ok");
